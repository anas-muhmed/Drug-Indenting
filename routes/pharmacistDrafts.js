// Pharmacist drafts routes — moved out of server.js unchanged, mounted
// at /api/pharmacist/drafts in server.js (so paths here are relative to
// that). Route order preserved exactly as it was in server.js.

import express from 'express';
import { getConn } from '../db/pool.js';
import { requireAuth } from '../middleware/requireAuth.js';

const router = express.Router();

// POST /api/pharmacist/drafts
router.post('/', requireAuth, async (req, res) => {
  const { request_id, pharmacist_id, draft_name } = req.body;
  if (!request_id || !pharmacist_id) return res.status(400).json({ error: 'request_id and pharmacist_id are required.' });
  if (req.user.id !== Number(pharmacist_id)) {
    return res.status(403).json({ error: 'You can only save drafts as yourself.' });
  }

  const conn = await getConn();
  try {
    console.log('Saving draft for request', request_id, 'pharmacist', pharmacist_id);

    // Build the draft data object: everything except the three metadata keys
    const dataObj = { ...req.body };
    delete dataObj.request_id;
    delete dataObj.pharmacist_id;
    delete dataObj.draft_name;
    const draftData = JSON.stringify(dataObj);

    // Auto-generate a sensible draft name when none is provided
    const alts = req.body.alternatives;
    const name = draft_name?.trim() ||
      (Array.isArray(alts) ? alts.find(a => a.brand_name?.trim())?.brand_name?.trim() : undefined) ||
      `Draft - Request #${request_id}`;

    const existing = await conn.execute(
      `SELECT draft_id FROM analysis_drafts WHERE request_id = :rid AND pharmacist_id = :pid AND status = 'DRAFT'`,
      { rid: request_id, pid: pharmacist_id }
    );

    let draftId;
    if (existing.rows.length > 0) {
      draftId = existing.rows[0].DRAFT_ID;
      await conn.execute(
        `UPDATE analysis_drafts
           SET draft_name = :name, draft_data = :data, updated_at = CURRENT_TIMESTAMP
         WHERE draft_id = :id`,
        { name, data: draftData, id: draftId }
      );
      console.log('Draft updated, draft_id:', draftId);
    } else {
      await conn.execute(
        `INSERT INTO analysis_drafts (request_id, pharmacist_id, draft_name, draft_data, status)
         VALUES (:rid, :pid, :name, :data, 'DRAFT')`,
        { rid: request_id, pid: pharmacist_id, name, data: draftData }
      );
      // Retrieve the auto-generated ID
      const idRes = await conn.execute(
        `SELECT draft_id FROM analysis_drafts
         WHERE request_id = :rid AND pharmacist_id = :pid AND status = 'DRAFT'
         ORDER BY draft_id DESC FETCH FIRST 1 ROWS ONLY`,
        { rid: request_id, pid: pharmacist_id }
      );
      draftId = idRes.rows[0]?.DRAFT_ID;
      console.log('Draft inserted, draft_id:', draftId);
    }
    await conn.commit();
    res.json({ success: true, draft_id: draftId, draft_name: name, message: 'Draft saved successfully.' });
  } catch (err) {
    console.error('POST /api/pharmacist/drafts error:', err);
    res.status(500).json({ success: false, error: 'Failed to save draft.', detail: err.message });
  } finally {
    await conn.close();
  }
});

// GET /api/pharmacist/drafts/for-request/:requestId/:pharmacistId
router.get('/for-request/:requestId/:pharmacistId', requireAuth, async (req, res) => {
  const { requestId, pharmacistId } = req.params;
  if (req.user.id !== Number(pharmacistId)) {
    return res.status(403).json({ error: 'You are not authorized to view these drafts.' });
  }

  const conn = await getConn();
  try {
    const result = await conn.execute(
      `SELECT draft_id, draft_name, draft_data, updated_at
       FROM analysis_drafts
       WHERE request_id = :rid AND pharmacist_id = :pid AND status = 'DRAFT'
       ORDER BY updated_at DESC FETCH FIRST 1 ROWS ONLY`,
      { rid: parseInt(requestId), pid: parseInt(pharmacistId) }
    );
    if (!result.rows.length) return res.json(null);
    const row = result.rows[0];
    // fetchAsString = [CLOB] ensures DRAFT_DATA is already a plain string
    let parsed = {};
    try { parsed = row.DRAFT_DATA ? JSON.parse(row.DRAFT_DATA) : {}; } catch { parsed = {}; }
    res.json({ ...row, DRAFT_DATA: parsed });
  } catch (err) {
    console.error('GET /api/pharmacist/drafts/for-request error:', err);
    res.status(500).json({ error: 'Internal server error.', detail: err.message });
  } finally {
    await conn.close();
  }
});

// GET /api/pharmacist/drafts/:pharmacistId — list all DRAFT records for a pharmacist
// Returns additional request columns (request_type, current_stage, req_status) and
// parses draft_data so the frontend can read comp_type for the Comparison Type column.
router.get('/:pharmacistId', requireAuth, async (req, res) => {
  const pid = parseInt(req.params.pharmacistId);
  if (req.user.id !== pid) {
    return res.status(403).json({ error: 'You are not authorized to view these drafts.' });
  }

  const conn = await getConn();
  try {
    const result = await conn.execute(
      `SELECT ad.draft_id, ad.request_id, ad.draft_name, ad.status,
              ad.created_at, ad.updated_at, ad.draft_data,
              dr.brand_name, dr.generic_name, dr.category,
              dr.request_type, dr.current_stage, dr.status AS req_status
       FROM analysis_drafts ad
       JOIN drug_requests dr ON dr.request_id = ad.request_id
       WHERE ad.pharmacist_id = :pid AND ad.status = 'DRAFT'
       ORDER BY ad.updated_at DESC`,
      { pid }
    );
    // Parse draft_data CLOB for each row so the frontend can read comp_type inline
    const list = result.rows.map(row => {
      let parsed = {};
      try { parsed = row.DRAFT_DATA ? JSON.parse(row.DRAFT_DATA) : {}; } catch { parsed = {}; }
      return { ...row, DRAFT_DATA: parsed };
    });
    res.json(list);
  } catch (err) {
    console.error('GET /api/pharmacist/drafts error:', err);
    res.status(500).json({ error: 'Internal server error.', detail: err.message });
  } finally {
    await conn.close();
  }
});

// GET /api/pharmacist/drafts/detail/:draftId
router.get('/detail/:draftId', requireAuth, async (req, res) => {
  const conn = await getConn();
  try {
    const did = parseInt(req.params.draftId);
    const result = await conn.execute(
      `SELECT ad.*, dr.brand_name, dr.generic_name, dr.category, dr.request_type
       FROM analysis_drafts ad
       JOIN drug_requests dr ON dr.request_id = ad.request_id
       WHERE ad.draft_id = :did`,
      { did }
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Draft not found.' });
    const row = result.rows[0];
    if (row.PHARMACIST_ID !== req.user.id) {
      return res.status(403).json({ error: 'You are not authorized to view this draft.' });
    }
    let parsed = {};
    try { parsed = row.DRAFT_DATA ? JSON.parse(row.DRAFT_DATA) : {}; } catch { parsed = {}; }
    res.json({ ...row, DRAFT_DATA: parsed });
  } catch (err) {
    console.error('GET /api/pharmacist/drafts/detail error:', err);
    res.status(500).json({ error: 'Internal server error.', detail: err.message });
  } finally {
    await conn.close();
  }
});

// PUT /api/pharmacist/drafts/:draftId — rename draft
router.put('/:draftId', requireAuth, async (req, res) => {
  const conn = await getConn();
  try {
    const did = parseInt(req.params.draftId);
    const ownerCheck = await conn.execute(
      `SELECT pharmacist_id FROM analysis_drafts WHERE draft_id = :did`,
      { did }
    );
    if (ownerCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Draft not found.' });
    }
    if (ownerCheck.rows[0].PHARMACIST_ID !== req.user.id) {
      return res.status(403).json({ error: 'You are not authorized to modify this draft.' });
    }

    const { draft_name } = req.body;
    await conn.execute(
      `UPDATE analysis_drafts SET draft_name = :name, updated_at = CURRENT_TIMESTAMP WHERE draft_id = :did`,
      { name: draft_name?.trim() || null, did }
    );
    await conn.commit();
    res.json({ message: 'Draft renamed.' });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error.', detail: err.message });
  } finally {
    await conn.close();
  }
});

// DELETE /api/pharmacist/drafts/:draftId — delete draft
router.delete('/:draftId', requireAuth, async (req, res) => {
  const conn = await getConn();
  try {
    const did = parseInt(req.params.draftId);
    const ownerCheck = await conn.execute(
      `SELECT pharmacist_id FROM analysis_drafts WHERE draft_id = :did`,
      { did }
    );
    if (ownerCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Draft not found.' });
    }
    if (ownerCheck.rows[0].PHARMACIST_ID !== req.user.id) {
      return res.status(403).json({ error: 'You are not authorized to delete this draft.' });
    }

    await conn.execute(`DELETE FROM analysis_drafts WHERE draft_id = :did`, { did });
    await conn.commit();
    res.json({ message: 'Draft deleted.' });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error.', detail: err.message });
  } finally {
    await conn.close();
  }
});

export default router;
