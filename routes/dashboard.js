// Dashboard route — moved out of server.js unchanged, mounted at
// /api/dashboard. Has custom inline auth (not requireAuth/requireRole)
// because it has three different authorization shapes in one route:
// doctor/hod are personal (must match your own userId), other clinical
// roles are role-level aggregates, and admin needs a separate admin
// token entirely. See utils/workflow.js for why these role/stage
// spellings look the way they do.

import express from 'express';
import { getConn } from '../db/pool.js';
import { extractBearerToken, verifyToken } from '../utils/auth.js';

const router = express.Router();

// GET /api/dashboard/:role
router.get('/:role', async (req, res) => {
  const { role } = req.params;
  const { userId, source_type, formulary_type } = req.query;
  const normalizedRole = role ? role.toLowerCase().trim() : '';

  const token = extractBearerToken(req.headers.authorization);
  if (!token) {
    return res.status(401).json({ error: 'Authentication required.' });
  }
  let decoded;
  try {
    decoded = verifyToken(token);
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired session. Please log in again.' });
  }

  if (normalizedRole === 'admin') {
    if (decoded.type !== 'admin') {
      return res.status(403).json({ error: 'Only an admin can view this dashboard.' });
    }
  } else {
    // Role-level dashboards (pharmacyhead/pharmacist/dtccommittee/ceo) just
    // require your token's role to match; doctor/hod additionally require
    // the userId query param to be you, since those are personal views.
    if (decoded.type !== 'user' || decoded.role !== normalizedRole) {
      return res.status(403).json({ error: 'You are not authorized to view this dashboard.' });
    }
    if ((normalizedRole === 'doctor' || normalizedRole === 'hod') && decoded.id !== Number(userId)) {
      return res.status(403).json({ error: 'You can only view your own dashboard.' });
    }
  }

  const conn = await getConn();
  try {
    let whereClause = '1=1';
    const binds = {};

    if (normalizedRole === 'doctor') {
      whereClause = 'doctor_id = :userId';
      binds.userId = userId;
    } else if (normalizedRole === 'hod') {
      whereClause = '(hod_id = :userId OR created_by_user_id = :userId)';
      binds.userId = userId;
    } else if (normalizedRole === 'pharmacyhead') {
      whereClause = `current_stage IN ('PharmacyHead','DTCCommittee','Pharmacist','PharmacyHeadReview2','DTCFinal','CEO','Final','Rejected','EmergencyDTC')`;
    } else if (normalizedRole === 'pharmacist') {
      whereClause = `current_stage IN ('Pharmacist','PharmacyHeadReview2','DTCFinal','CEO','Final','Rejected','EmergencyDTC')`;
    } else if (normalizedRole === 'dtccommittee') {
      whereClause = `current_stage IN ('DTCCommittee','Pharmacist','PharmacyHeadReview2','DTCFinal','CEO','Final','Rejected','EmergencyDTC')`;
    } else if (normalizedRole === 'ceo') {
      whereClause = `current_stage IN ('CEO','Final','Rejected')`;
    } else if (normalizedRole === 'admin') {
      whereClause = '1=1';
    }


    // Optional source_type filter
    if (source_type && ['PROMOTIONAL', 'NON_PROMOTIONAL'].includes(source_type.toUpperCase())) {
      whereClause += ` AND request_source_type = :source_type`;
      binds.source_type = source_type.toUpperCase();
    }
    if (formulary_type && ['FORMULARY', 'NON_FORMULARY'].includes(formulary_type.toUpperCase())) {
      whereClause += ` AND formulary_request_type = :formulary_type`;
      binds.formulary_type = formulary_type.toUpperCase();
    }

    const totalResult = await conn.execute(`SELECT COUNT(*) AS cnt FROM drug_requests WHERE ${whereClause}`, binds);
    const approvedResult = await conn.execute(`SELECT COUNT(*) AS cnt FROM drug_requests WHERE ${whereClause} AND status = 'Approved'`, binds);
    const rejectedResult = await conn.execute(`SELECT COUNT(*) AS cnt FROM drug_requests WHERE ${whereClause} AND status = 'Rejected'`, binds);
    const pendingResult = await conn.execute(`SELECT COUNT(*) AS cnt FROM drug_requests WHERE ${whereClause} AND status = 'Pending'`, binds);
    const catResult = await conn.execute(`SELECT category, COUNT(*) AS cnt FROM drug_requests WHERE ${whereClause} GROUP BY category`, binds);
    const promoResult = await conn.execute(`SELECT COUNT(*) AS cnt FROM drug_requests WHERE ${whereClause} AND (request_source_type = 'PROMOTIONAL' OR request_source_type IS NULL)`, binds);
    const nonPromoResult = await conn.execute(`SELECT COUNT(*) AS cnt FROM drug_requests WHERE ${whereClause} AND request_source_type = 'NON_PROMOTIONAL'`, binds);

    res.json({
      total: totalResult.rows[0].CNT,
      approved: approvedResult.rows[0].CNT,
      rejected: rejectedResult.rows[0].CNT,
      pending: pendingResult.rows[0].CNT,
      by_category: catResult.rows,
      promotional: promoResult.rows[0].CNT,
      non_promotional: nonPromoResult.rows[0].CNT,
    });
  } catch (err) {
    console.error('GET dashboard error:', err);
    res.status(500).json({ error: 'Internal server error.', detail: err.message });
  } finally {
    await conn.close();
  }
});

export default router;
