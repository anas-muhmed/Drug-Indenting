// =server.js=========================================================
// Formulary Drug Addition Request System — Backend Server
// =============================================================
// Tech: Node.js + Express + oracledb (Oracle)
// =============================================================

import dotenv from "dotenv";
dotenv.config();
import express from "express";
import cors from "cors";
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
import { initDB, getConn } from './db/pool.js';
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
app.use(cors());
const PORT = process.env.PORT || 5000;


app.use(express.json());

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
    console.warn("⚠️  GROQ_API_KEY missing in .env — AI drug-profile endpoints will return errors until it's set.");
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
        console.log('   ✔ Column ENTRY_DATA CLOB added to drug_effective_entries.');
      } else {
        console.log('   – Column ENTRY_DATA already exists.');
      }
    } catch (migErr) {
      console.error('Migration error adding column ENTRY_DATA:', migErr.message);
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
          console.log('   ✔ Column USER_LOGIN_ID added as nullable.');
        } catch (addErr) {
          if (addErr.message.includes('ORA-01430')) {
            console.log('   – Column USER_LOGIN_ID already exists.');
          } else {
            throw addErr;
          }
        }

        // 2. Fetch and backfill existing users (only if any null exists)
        const checkNull = await connUsers.execute(
          `SELECT COUNT(*) AS cnt FROM users WHERE user_login_id IS NULL`
        );
        if (checkNull.rows[0].CNT > 0) {
          console.log('   🔧 Backfilling null User IDs...');
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
          console.log(`   ✔ Backfilled ${existing.rows.length} existing users.`);
        }

        // 3. Make column NOT NULL
        try {
          await connUsers.execute(
            `ALTER TABLE users MODIFY (user_login_id VARCHAR2(50) NOT NULL)`
          );
          console.log('   ✔ Column USER_LOGIN_ID modified to NOT NULL.');
        } catch (nnErr) {
          if (nnErr.message.includes('ORA-01442') || nnErr.message.includes('already NOT NULL') || nnErr.message.includes('already null') || nnErr.message.includes('already NOT NULL')) {
            console.log('   – Column USER_LOGIN_ID is already NOT NULL.');
          } else {
            throw nnErr;
          }
        }

        // 4. Create unique index
        try {
          await connUsers.execute(
            `CREATE UNIQUE INDEX UK_USERS_LOGIN_ID ON users (user_login_id)`
          );
          console.log('   ✔ Unique index UK_USERS_LOGIN_ID created.');
        } catch (idxErr) {
          if (idxErr.message.includes('ORA-00955') || idxErr.message.includes('already exists')) {
            console.log('   – Unique index UK_USERS_LOGIN_ID already exists.');
          } else {
            throw idxErr;
          }
        }

      } finally {
        await connUsers.close();
      }
    } catch (migErr) {
      console.error('Migration error on USERS table:', migErr.message);
    }

    // Serve React frontend
    app.use(express.static(path.join(process.cwd(), "client/build")));

    app.get("*", (req, res) => {
      res.sendFile(path.join(process.cwd(), "client/build", "index.html"));
    });

    app.listen(PORT, () => {
      console.log(`🚀  Drug Indenting Server running on http://localhost:${PORT}`);
    });

  } catch (err) {
    console.error('❌  Boot failed:', err.message);
    process.exit(1);
  }
}

// Only auto-start when run directly (`node server.js`) — not when imported
// by tests, so importing this file never tries to reach Oracle on its own.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  boot();
}

export default app;




