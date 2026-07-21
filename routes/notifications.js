// Notification routes — moved out of server.js unchanged, mounted at
// /api/notifications in server.js (so paths here are relative to that).

import express from 'express';
import { getConn } from '../db/pool.js';
import { requireAuth } from '../middleware/requireAuth.js';

const router = express.Router();

// GET /api/notifications/:userId
router.get('/:userId', requireAuth, async (req, res) => {
  if (req.user.id !== Number(req.params.userId)) {
    return res.status(403).json({ error: 'You are not authorized to view these notifications.' });
  }
  const conn = await getConn();
  try {
    const result = await conn.execute(
      `SELECT n.*, dr.brand_name, dr.current_stage
       FROM notifications n
       LEFT JOIN drug_requests dr ON dr.request_id = n.request_id
       WHERE n.user_id = :userId
       ORDER BY n.created_at DESC
       FETCH FIRST 50 ROWS ONLY`,
      { userId: req.params.userId }
    );
    res.json(result.rows);
  } catch (err) {
    console.error('GET notifications error:', err);
    res.status(500).json({ error: 'Internal server error.', detail: err.message });
  } finally {
    await conn.close();
  }
});

// PUT /api/notifications/:id/read
router.put('/:id/read', requireAuth, async (req, res) => {
  const conn = await getConn();
  try {
    const ownerCheck = await conn.execute(
      `SELECT user_id FROM notifications WHERE notification_id = :id`,
      { id: req.params.id }
    );
    if (ownerCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Notification not found.' });
    }
    if (ownerCheck.rows[0].USER_ID !== req.user.id) {
      return res.status(403).json({ error: 'You are not authorized to modify this notification.' });
    }

    await conn.execute(
      `UPDATE notifications SET is_read = 1 WHERE notification_id = :id`,
      { id: req.params.id }
    );
    res.json({ message: 'Marked as read.' });
  } catch (err) {
    console.error('PUT notification read error:', err);
    res.status(500).json({ error: 'Internal server error.', detail: err.message });
  } finally {
    await conn.close();
  }
});

export default router;
