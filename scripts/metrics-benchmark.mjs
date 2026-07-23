// One-off benchmark script -- NOT part of the app's runtime. Measures the
// exact operation that changed in the N+1 notification fix (18 call sites,
// see commit 0cf5b47): N sequential single-row INSERTs vs one executeMany()
// batch INSERT, using the REAL count of active users in a real role for
// realism.
//
// Safe to run against the real database: uses request_id = -999999, which
// cannot match any real drug_requests row (IDs are Oracle IDENTITY columns,
// always positive), and deletes every row it inserts before exiting either
// way (success or failure).
//
// Usage: node scripts/metrics-benchmark.mjs
// Requires the same .env as the running server (DB_USER/DB_PASSWORD/
// DB_CONNECT_STRING).

import dotenv from 'dotenv';
dotenv.config();
import { initDB, getConn, closePool } from '../db/pool.js';
import { createNotification, createNotificationsBulk } from '../utils/auditHelpers.js';

const FAKE_REQUEST_ID = -999999;
const RUNS = 5;

async function cleanup(conn) {
  await conn.execute(`DELETE FROM notifications WHERE request_id = :rid`, { rid: FAKE_REQUEST_ID });
  await conn.commit();
}

async function timeIt(label, fn) {
  const samples = [];
  for (let i = 0; i < RUNS; i++) {
    const start = process.hrtime.bigint();
    await fn();
    const end = process.hrtime.bigint();
    samples.push(Number(end - start) / 1e6); // ms
  }
  const avg = samples.reduce((a, b) => a + b, 0) / samples.length;
  console.log(`${label}: ${samples.map(s => s.toFixed(1)).join(', ')} ms  (avg ${avg.toFixed(1)} ms)`);
  return avg;
}

async function main() {
  await initDB();
  const conn = await getConn();

  try {
    console.log('=== Real production scale ===');
    const roleCounts = await conn.execute(
      `SELECT role, COUNT(*) AS cnt FROM users WHERE is_active = 1 GROUP BY role ORDER BY cnt DESC`
    );
    for (const row of roleCounts.rows) {
      console.log(`  ${row.ROLE}: ${row.CNT} active user(s)`);
    }
    const tableCounts = await conn.execute(`
      SELECT
        (SELECT COUNT(*) FROM drug_requests) AS requests,
        (SELECT COUNT(*) FROM notifications) AS notifications,
        (SELECT COUNT(*) FROM audit_logs) AS audit_logs,
        (SELECT COUNT(*) FROM drug_alternatives) AS alternatives
      FROM DUAL
    `);
    const t = tableCounts.rows[0];
    console.log(`  Total drug_requests: ${t.REQUESTS}`);
    console.log(`  Total notifications ever sent: ${t.NOTIFICATIONS}`);
    console.log(`  Total audit_logs: ${t.AUDIT_LOGS}`);
    console.log(`  Total drug_alternatives: ${t.ALTERNATIVES}`);

    // Use the role with the most active members for the clearest signal --
    // whatever real count that turns out to be.
    const biggestRole = roleCounts.rows[0];
    const userIdsRes = await conn.execute(
      `SELECT user_id FROM users WHERE role = :role AND is_active = 1`,
      { role: biggestRole.ROLE }
    );
    const userIds = userIdsRes.rows.map(r => r.USER_ID);
    console.log(`\n=== Benchmarking notification dispatch to role '${biggestRole.ROLE}' (${userIds.length} real recipients) ===`);

    if (userIds.length < 2) {
      console.log('Fewer than 2 active users in the largest role -- benchmark would not be meaningful. Skipping.');
    } else {
      const oldAvg = await timeIt('OLD (one createNotification() call per recipient, sequential)', async () => {
        for (const userId of userIds) {
          await createNotification(conn, userId, FAKE_REQUEST_ID, 'benchmark test notification');
        }
        await cleanup(conn);
      });

      const newAvg = await timeIt('NEW (one createNotificationsBulk() call, executeMany)', async () => {
        await createNotificationsBulk(conn, userIds, FAKE_REQUEST_ID, 'benchmark test notification');
        await cleanup(conn);
      });

      const improvementPct = ((oldAvg - newAvg) / oldAvg) * 100;
      console.log(`\nResult: ${userIds.length} recipients, DB round trips ${userIds.length} -> 1.`);
      console.log(`Average latency: ${oldAvg.toFixed(1)} ms -> ${newAvg.toFixed(1)} ms (${improvementPct.toFixed(1)}% faster)`);
    }

    console.log('\n=== Test suite ===');
  } finally {
    await cleanup(conn).catch(() => {});
    await conn.close();
    await closePool();
  }
}

main().catch(err => {
  console.error('Benchmark failed:', err);
  process.exit(1);
});
