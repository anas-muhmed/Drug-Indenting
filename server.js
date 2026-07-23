// =server.js=========================================================
// Formulary Drug Addition Request System — Backend Server
// =============================================================
// Tech: Node.js + Express + oracledb (Oracle)
// =============================================================

import dotenv from "dotenv";
dotenv.config();
import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import pinoHttp from "pino-http";
import { logger } from './utils/logger.js';
import oracledb from "oracledb";
import fetch from "node-fetch";
import bcrypt from 'bcrypt';
import path from "path";
import { fileURLToPath } from "url";
import { normalizeGenericCombo, computeAltDerived, computeExistingDerived, validatePassword, formatEffectiveEntryRow } from './utils/pureHelpers.js';
import { signToken, normalizeRole } from './utils/auth.js';
import { requireAuth, requireAdminAuth, requireRole } from './middleware/requireAuth.js';
import { extractBearerToken, verifyToken, SALT_ROUNDS } from './utils/auth.js';
import { getApproverRoleForStage, NEXT_STAGE, STAGE_LABELS } from './utils/workflow.js';
import { initDB, getConn, isPoolReady, closePool } from './db/pool.js';
import { createNotification, writeAudit, saveApprovalRemarks, writeAdminAudit } from './utils/auditHelpers.js';
import notificationsRouter from './routes/notifications.js';
import pharmacistDraftsRouter from './routes/pharmacistDrafts.js';
import dashboardRouter from './routes/dashboard.js';
import analyticsRouter from './routes/analytics.js';
import quotaRouter from './routes/quota.js';
import usersRouter from './routes/users.js';
import dtcRouter from './routes/dtc.js';
import adminRouter from './routes/admin.js';
import authRouter from './routes/auth.js';
import aiRouter from './routes/ai.js';
import alternativesRouter from './routes/alternatives.js';
import requestsRouter from './routes/requests.js';
import miscRouter from './routes/misc.js';

const app = express();
// Trust exactly one hop of reverse proxy (CRA's dev proxy today, nginx
// once that's in place) so express-rate-limit can safely read the real
// client IP from X-Forwarded-For instead of throwing
// ERR_ERL_UNEXPECTED_X_FORWARDED_FOR. `true` would trust the whole
// chain blindly, which lets a client spoof X-Forwarded-For to dodge the
// rate limit -- `1` only trusts the immediate proxy in front of us.
app.set('trust proxy', 1);
// contentSecurityPolicy off for now: helmet's default policy is strict
// enough to risk silently breaking the built React frontend (inline
// styles, resource loading) in ways that wouldn't show up in these
// backend tests -- would need real browser testing to tune safely. Every
// other helmet protection (X-Content-Type-Options, X-Frame-Options,
// Strict-Transport-Security, etc.) stays on.
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
// Structured request/response log for every request (method, path, status,
// duration) -- skips /health so routine monitoring polling doesn't drown
// out real traffic in the logs.
app.use(pinoHttp({
  logger,
  autoLogging: { ignore: (req) => req.url === '/health' },
}));
const PORT = process.env.PORT || 5000;


app.use(express.json());

// Both limits are configurable via env vars, defaulting to the real,
// secure values below -- so forgetting to set anything fails safe
// (strict), never silently insecure. During active manual testing (many
// logins across a handful of shared test accounts, repeated re-testing
// in one sitting), the default login limit is easy to trip legitimately;
// on a machine doing that kind of testing, raise AUTH_RATE_LIMIT_MAX in
// its own .env (e.g. to 500) rather than changing this file -- the
// moment this goes toward real go-live, just leave it unset again.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.AUTH_RATE_LIMIT_MAX) || 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts. Please try again in a few minutes.' },
});
app.use('/api/login', authLimiter);
app.use('/api/register', authLimiter);

// General limit across the rest of the API. Generous on purpose -- this
// is real hospital staff doing real work, not a public-facing consumer
// app; the goal is capping abuse/runaway clients, not throttling normal
// use. /health is outside /api, so monitoring polling it isn't affected.
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.API_RATE_LIMIT_MAX) || 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please try again in a few minutes.' },
});
app.use('/api', apiLimiter);

// Unauthenticated on purpose -- load balancers/monitoring need to reach
// this without a token. Reports 503 rather than crashing if the DB pool
// isn't up yet or a real query fails, so it reflects whether the app can
// actually serve real traffic, not just whether the process is alive.
app.get('/health', async (req, res) => {
  if (!isPoolReady()) {
    return res.status(503).json({ status: 'unavailable', db: 'not initialized' });
  }
  let conn;
  try {
    conn = await getConn();
    await conn.execute('SELECT 1 FROM DUAL');
    res.json({ status: 'ok', db: 'connected' });
  } catch (err) {
    res.status(503).json({ status: 'unavailable', db: 'error', detail: err.message });
  } finally {
    if (conn) await conn.close();
  }
});

// Schema provisioning has moved to db/setupSchema.js — a real, callable,
// on-demand tool (`npm run db:setup-schema`), not something run on every
// boot. See that file for why.


// Core drug-request workflow routes — see routes/requests.js
app.use('/api/requests', requestsRouter);

app.use('/api/notifications', notificationsRouter);

// Dashboard route — see routes/dashboard.js
app.use('/api/dashboard', dashboardRouter);

// Analytics routes — see routes/analytics.js
app.use('/api/analytics', analyticsRouter);

// DTC management routes — see routes/dtc.js
app.use('/api/dtc', dtcRouter);

// User profile + quota routes — see routes/users.js and routes/quota.js
app.use('/api/user/quota', quotaRouter);
app.use('/api/users', usersRouter);

// Remaining utility routes — see routes/misc.js
app.use('/api', miscRouter);

// AI drug-profile routes — see routes/ai.js and prompts/drugProfilePrompts.js
app.use('/api', aiRouter);

// Alternatives + comparison-sheet routes — see routes/alternatives.js
app.use('/api', alternativesRouter);

// Pharmacist draft management — see routes/pharmacistDrafts.js
app.use('/api/pharmacist/drafts', pharmacistDraftsRouter);

// Core register/login routes — see routes/auth.js
app.use('/api', authRouter);

// Admin portal routes — see routes/admin.js
app.use('/api/admin', adminRouter);

async function boot() {

  if (!process.env.GROQ_API_KEY) {
    logger.warn("GROQ_API_KEY missing in .env — AI drug-profile endpoints will return errors until it's set.");
  }

  try {
    await initDB();

    // Column migration check for ENTRY_DATA CLOB in DRUG_EFFECTIVE_ENTRIES
    const conn = await getConn();
    try {
      const checkCol = await conn.execute(
        `SELECT COUNT(*) AS cnt FROM user_tab_columns
         WHERE table_name = 'DRUG_EFFECTIVE_ENTRIES' AND column_name = 'ENTRY_DATA'`
      );
      if (checkCol.rows[0].CNT === 0) {
        await conn.execute(
          `ALTER TABLE drug_effective_entries ADD (entry_data CLOB)`
        );
        logger.info('Column ENTRY_DATA CLOB added to drug_effective_entries.');
      } else {
        logger.info('Column ENTRY_DATA already exists.');
      }
    } catch (migErr) {
      logger.error({ err: migErr }, 'Migration error adding column ENTRY_DATA');
    } finally {
      await conn.close();
    }

    // Column migration check for USER_LOGIN_ID in USERS
    try {
      const connUsers = await getConn();
      try {
        // 1. Try to add column
        try {
          await connUsers.execute(`ALTER TABLE users ADD (user_login_id VARCHAR2(50))`);
          logger.info('Column USER_LOGIN_ID added as nullable.');
        } catch (addErr) {
          if (addErr.message.includes('ORA-01430')) {
            logger.info('Column USER_LOGIN_ID already exists.');
          } else {
            throw addErr;
          }
        }

        // 2. Fetch and backfill existing users (only if any null exists)
        const checkNull = await connUsers.execute(
          `SELECT COUNT(*) AS cnt FROM users WHERE user_login_id IS NULL`
        );
        if (checkNull.rows[0].CNT > 0) {
          logger.info('Backfilling null User IDs...');
          const existing = await connUsers.execute(
            `SELECT user_id, role, name FROM users WHERE user_login_id IS NULL`
          );
          for (const row of existing.rows) {
            const roleBase = (row.ROLE || 'user').toLowerCase().trim();
            const loginId = `${roleBase}${row.USER_ID}`;
            await connUsers.execute(
              `UPDATE users SET user_login_id = :loginId WHERE user_id = :userId`,
              { loginId, userId: row.USER_ID }
            );
          }
          logger.info(`Backfilled ${existing.rows.length} existing users.`);
        }

        // 3. Make column NOT NULL
        try {
          await connUsers.execute(
            `ALTER TABLE users MODIFY (user_login_id VARCHAR2(50) NOT NULL)`
          );
          logger.info('Column USER_LOGIN_ID modified to NOT NULL.');
        } catch (nnErr) {
          if (nnErr.message.includes('ORA-01442') || nnErr.message.includes('already NOT NULL') || nnErr.message.includes('already null') || nnErr.message.includes('already NOT NULL')) {
            logger.info('Column USER_LOGIN_ID is already NOT NULL.');
          } else {
            throw nnErr;
          }
        }

        // 4. Create unique index
        try {
          await connUsers.execute(
            `CREATE UNIQUE INDEX UK_USERS_LOGIN_ID ON users (user_login_id)`
          );
          logger.info('Unique index UK_USERS_LOGIN_ID created.');
        } catch (idxErr) {
          if (idxErr.message.includes('ORA-00955') || idxErr.message.includes('already exists')) {
            logger.info('Unique index UK_USERS_LOGIN_ID already exists.');
          } else {
            throw idxErr;
          }
        }

      } finally {
        await connUsers.close();
      }
    } catch (migErr) {
      logger.error({ err: migErr }, 'Migration error on USERS table');
    }

    // Serve React frontend
    app.use(express.static(path.join(process.cwd(), "client/build")));

    app.get("*", (req, res) => {
      // Unmatched /api/* requests are a real 404, not a client-side route —
      // don't fall through to the SPA index.html for these.
      if (req.path.startsWith('/api')) {
        return res.status(404).json({ error: 'Not found.' });
      }
      res.sendFile(path.join(process.cwd(), "client/build", "index.html"), (err) => {
        // Only reached if the file is missing/unreadable (e.g. frontend not
        // built on this machine yet) — respond cleanly instead of letting
        // Express's default error handler leak the local filesystem path.
        if (err && !res.headersSent) {
          res.status(404).json({ error: 'Not found.' });
        }
      });
    });

    // Centralized error handler -- safety net for anything that slips past
    // a route's own try/catch (every route already handles its own errors
    // and returns its own structured response; this is only reached by a
    // genuinely unexpected failure, e.g. a synchronous throw in middleware).
    // Must be the LAST app.use() -- Express only recognizes 4-arg
    // middleware as an error handler, and only errors passed to routes
    // registered before this point reach it.
    app.use((err, req, res, next) => {
      if (res.headersSent) return next(err);
      (req.log || logger).error({ err }, 'Unhandled error');
      res.status(err.status || 500).json({ error: 'Internal server error.' });
    });

    const httpServer = app.listen(PORT, () => {
      logger.info(`Drug Indenting Server running on http://localhost:${PORT}`);
    });

    // Graceful shutdown: stop taking new connections, let in-flight
    // requests finish, then close the DB pool -- instead of the process
    // (and every in-progress request's DB connection) getting yanked out
    // mid-request on every restart/deploy.
    //
    // httpServer.close() only *starts* closing -- it stops accepting new
    // connections and calls its callback once every existing connection has
    // ended, but it does not return a promise, so it must be wrapped and
    // genuinely awaited here. Found and fixed a real bug during remote
    // verification: the first version of this function fired
    // httpServer.close() without awaiting it and immediately moved on to
    // close the DB pool and exit -- verified directly with a reproduction
    // (a slow in-flight request against a real close() call) that the pool
    // closed and the process would have exited *before* the in-flight
    // request finished, exactly defeating the point of a graceful shutdown.
    // The forceTimeout exists so one stuck/keep-alive connection can't hang
    // shutdown forever.
    let shuttingDown = false;
    async function shutdown(signal) {
      if (shuttingDown) return;
      shuttingDown = true;
      logger.info(`${signal} received -- shutting down gracefully...`);

      await new Promise((resolve) => {
        let timeoutId;
        const finish = () => { clearTimeout(timeoutId); resolve(); };
        httpServer.close(() => { logger.info('HTTP server closed.'); finish(); });
        timeoutId = setTimeout(() => {
          logger.warn('HTTP server did not close within 10s -- forcing shutdown.');
          finish();
        }, 10000);
      });

      try {
        await closePool();
        logger.info('Oracle DB pool closed.');
      } catch (err) {
        logger.error({ err }, 'Error closing DB pool');
      }
      process.exit(0);
    }
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));

  } catch (err) {
    logger.error({ err }, 'Boot failed');
    process.exit(1);
  }
}

process.on('unhandledRejection', (reason) => {
  logger.error({ err: reason }, 'Unhandled promise rejection');
});
process.on('uncaughtException', (err) => {
  logger.error({ err }, 'Uncaught exception -- exiting');
  process.exit(1);
});

// Only auto-start when run directly (`node server.js`) — not when imported
// by tests, so importing this file never tries to reach Oracle on its own.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  boot();
}

export default app;




