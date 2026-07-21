// Doctor/HOD request-quota route — moved out of server.js unchanged.
// Mounted at /api/user/quota (singular "user", matching the original
// path — an existing inconsistency with /api/users, not something to
// silently "fix" as part of a pure structural move).

import express from 'express';
import { getConn } from '../db/pool.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { ROLES } from '../utils/workflow.js';

const router = express.Router();

router.get('/:userId', requireAuth, async (req, res) => {
  const userId = parseInt(req.params.userId);
  if (req.user.id !== userId) {
    return res.status(403).json({ error: 'You are not authorized to view this quota.' });
  }

  const conn = await getConn();
  try {
    const userRes = await conn.execute(
      `SELECT role FROM users WHERE user_id = :userId AND is_active = 1`,
      { userId }
    );
    if (!userRes.rows.length) {
      return res.status(404).json({ error: 'User not found or inactive.' });
    }
    const role = userRes.rows[0].ROLE ? userRes.rows[0].ROLE.toLowerCase() : '';
    if (role !== ROLES.DOCTOR && role !== ROLES.HOD) {
      return res.status(400).json({ error: 'Request quota is only applicable for Doctors or HODs.' });
    }

    const qCheck = await conn.execute(
      `SELECT COUNT(*) AS cnt FROM user_request_quotas WHERE user_id = :userId`,
      { userId }
    );
    if (qCheck.rows[0].CNT === 0) {
      await conn.execute(
        `INSERT INTO user_request_quotas (user_id, quarterly_limit, updated_by)
         VALUES (:userId, 10, :updatedBy)`,
        { userId, updatedBy: userId },
        { autoCommit: true }
      );
    }

    const result = await conn.execute(
      `SELECT
         q.quarterly_limit,
         (
           SELECT COUNT(*) FROM drug_requests dr
           WHERE dr.created_by_user_id = :userId
             AND dr.created_at >= TRUNC(SYSDATE, 'Q')
             AND dr.created_at <  ADD_MONTHS(TRUNC(SYSDATE, 'Q'), 3)
         ) AS used_this_quarter
       FROM user_request_quotas q
       WHERE q.user_id = :userId`,
      { userId }
    );

    const r = result.rows[0];
    const limit = r.QUARTERLY_LIMIT;
    const used = r.USED_THIS_QUARTER;

    res.json({
      quarterly_limit: limit,
      used_this_quarter: used,
      remaining_quota: Math.max(0, limit - used)
    });
  } catch (err) {
    console.error('GET /api/user/quota/:userId error:', err);
    res.status(500).json({ error: 'Internal server error.', detail: err.message });
  } finally {
    await conn.close();
  }
});

export default router;
