// Analytics routes — moved out of server.js unchanged, mounted at
// /api/analytics. Restricted to ceo/dtc/dtccommittee (or admin) per
// requireRole — see the AnalyticsDashboard import-chain evidence
// documented when these were originally secured.

import express from 'express';
import { getConn } from '../db/pool.js';
import { requireRole } from '../middleware/requireAuth.js';
import { ROLES } from '../utils/workflow.js';

const router = express.Router();

router.get('/summary', requireRole(ROLES.CEO, 'dtc', ROLES.DTC_COMMITTEE), async (req, res) => {
  const conn = await getConn();
  try {
    const r = await conn.execute(`
      SELECT
        COUNT(*) AS total_requests,
        SUM(CASE WHEN status = 'Pending' THEN 1 ELSE 0 END) AS total_pending,
        SUM(CASE WHEN status IN ('Approved','HOD_APPROVED','APPROVED_PENDING_ORDER','EMERGENCY_APPROVED','INVENTORY_RECEIVED') THEN 1 ELSE 0 END) AS total_approved,
        SUM(CASE WHEN status IN ('Rejected','HOD_REJECTED','PHARMACIST_REJECTED','PHARMACY_HEAD_REJECTED','PHARMACY_HEAD_REJECTED_PENDING_DTC','PHARMACIST_REJECTED_PENDING_DTC','CEO_REJECTED','EMERGENCY_REJECTED') THEN 1 ELSE 0 END) AS total_rejected,
        SUM(CASE WHEN status IN ('EMERGENCY_PENDING_DTC','EMERGENCY_APPROVED','EMERGENCY_REJECTED') THEN 1 ELSE 0 END) AS total_emergency,
        SUM(CASE WHEN status IN ('ORDER_PLACED','INVENTORY_RECEIVED') OR current_stage = 'OrderPlaced' THEN 1 ELSE 0 END) AS total_order_placed,
        SUM(CASE WHEN current_stage = 'Final' THEN 1 ELSE 0 END) AS total_final_approved,
        SUM(CASE WHEN current_stage IN ('DTCCommittee','DTCFinal','EmergencyDTC') THEN 1 ELSE 0 END) AS total_dtc_review,
        SUM(CASE WHEN current_stage = 'CEO' THEN 1 ELSE 0 END) AS total_ceo_review,
        SUM(CASE WHEN request_source_type = 'NON_PROMOTIONAL' THEN 1 ELSE 0 END) AS total_clinical,
        SUM(CASE WHEN request_source_type = 'PROMOTIONAL' OR request_source_type IS NULL THEN 1 ELSE 0 END) AS total_via_rep,
        SUM(CASE WHEN formulary_request_type = 'FORMULARY' THEN 1 ELSE 0 END) AS total_formulary,
        SUM(CASE WHEN formulary_request_type = 'NON_FORMULARY' THEN 1 ELSE 0 END) AS total_non_formulary
      FROM drug_requests
    `);
    const row = r.rows[0];
    res.json({
      total_requests: row.TOTAL_REQUESTS,
      total_pending: row.TOTAL_PENDING,
      total_approved: row.TOTAL_APPROVED,
      total_rejected: row.TOTAL_REJECTED,
      total_emergency: row.TOTAL_EMERGENCY,
      total_order_placed: row.TOTAL_ORDER_PLACED,
      total_final_approved: row.TOTAL_FINAL_APPROVED,
      total_dtc_review: row.TOTAL_DTC_REVIEW,
      total_ceo_review: row.TOTAL_CEO_REVIEW,
      total_clinical: row.TOTAL_CLINICAL,
      total_via_rep: row.TOTAL_VIA_REP,
      total_formulary: row.TOTAL_FORMULARY,
      total_non_formulary: row.TOTAL_NON_FORMULARY,
    });
  } catch (err) {
    console.error('GET analytics/summary error:', err);
    res.status(500).json({ error: 'Internal server error.', detail: err.message });
  } finally { await conn.close(); }
});

// GET /api/analytics/workflow-stages — Count per workflow stage
router.get('/workflow-stages', requireRole(ROLES.CEO, 'dtc', ROLES.DTC_COMMITTEE), async (req, res) => {
  const conn = await getConn();
  try {
    const r = await conn.execute(`
      SELECT current_stage, COUNT(*) AS cnt
      FROM drug_requests
      GROUP BY current_stage
      ORDER BY cnt DESC
    `);
    res.json(r.rows.map(row => ({ stage: row.CURRENT_STAGE, count: row.CNT })));
  } catch (err) {
    console.error('GET analytics/workflow-stages error:', err);
    res.status(500).json({ error: 'Internal server error.', detail: err.message });
  } finally { await conn.close(); }
});

// GET /api/analytics/doctor-performance — Per-doctor/HOD analytics
router.get('/doctor-performance', requireRole(ROLES.CEO, 'dtc', ROLES.DTC_COMMITTEE), async (req, res) => {
  const conn = await getConn();
  try {
    const r = await conn.execute(`
      SELECT
        u.user_id,
        u.name,
        u.role,
        u.department,
        COUNT(dr.request_id) AS total_requests,
        SUM(CASE WHEN dr.status IN ('Approved','HOD_APPROVED','APPROVED_PENDING_ORDER','EMERGENCY_APPROVED','INVENTORY_RECEIVED') THEN 1 ELSE 0 END) AS approved,
        SUM(CASE WHEN dr.status IN ('Rejected','HOD_REJECTED','PHARMACIST_REJECTED','PHARMACY_HEAD_REJECTED','CEO_REJECTED','EMERGENCY_REJECTED') THEN 1 ELSE 0 END) AS rejected,
        SUM(CASE WHEN dr.status = 'Pending' OR dr.status LIKE '%PENDING%' THEN 1 ELSE 0 END) AS pending,
        SUM(CASE WHEN dr.status IN ('EMERGENCY_PENDING_DTC','EMERGENCY_APPROVED','EMERGENCY_REJECTED') THEN 1 ELSE 0 END) AS emergency_count,
        MAX(dr.created_at) AS latest_request
      FROM users u
      LEFT JOIN drug_requests dr ON dr.created_by_user_id = u.user_id
      WHERE LOWER(u.role) IN ('doctor','hod') AND u.is_active = 1
      GROUP BY u.user_id, u.name, u.role, u.department
      ORDER BY total_requests DESC
    `);
    res.json(r.rows.map(row => ({
      user_id: row.USER_ID,
      name: row.NAME,
      role: row.ROLE,
      department: row.DEPARTMENT || '—',
      total_requests: row.TOTAL_REQUESTS,
      approved: row.APPROVED,
      rejected: row.REJECTED,
      pending: row.PENDING,
      emergency_count: row.EMERGENCY_COUNT,
      latest_request: row.LATEST_REQUEST,
    })));
  } catch (err) {
    console.error('GET analytics/doctor-performance error:', err);
    res.status(500).json({ error: 'Internal server error.', detail: err.message });
  } finally { await conn.close(); }
});

// GET /api/analytics/drug-analytics — Top drugs by requests/approvals/rejections
router.get('/drug-analytics', requireRole(ROLES.CEO, 'dtc', ROLES.DTC_COMMITTEE), async (req, res) => {
  const conn = await getConn();
  try {
    const [topBrands, topGenerics, topRejected, topApproved] = await Promise.all([
      conn.execute(`
        SELECT brand_name, COUNT(*) AS cnt FROM drug_requests
        WHERE brand_name IS NOT NULL
        GROUP BY brand_name ORDER BY cnt DESC FETCH FIRST 10 ROWS ONLY
      `),
      conn.execute(`
        SELECT generic_name, COUNT(*) AS cnt FROM drug_requests
        WHERE generic_name IS NOT NULL
        GROUP BY generic_name ORDER BY cnt DESC FETCH FIRST 10 ROWS ONLY
      `),
      conn.execute(`
        SELECT brand_name, COUNT(*) AS cnt FROM drug_requests
        WHERE status IN ('Rejected','HOD_REJECTED','PHARMACIST_REJECTED','PHARMACY_HEAD_REJECTED','CEO_REJECTED','EMERGENCY_REJECTED')
        AND brand_name IS NOT NULL
        GROUP BY brand_name ORDER BY cnt DESC FETCH FIRST 10 ROWS ONLY
      `),
      conn.execute(`
        SELECT brand_name, COUNT(*) AS cnt FROM drug_requests
        WHERE status IN ('Approved','APPROVED_PENDING_ORDER','ORDER_PLACED','EMERGENCY_APPROVED')
        AND brand_name IS NOT NULL
        GROUP BY brand_name ORDER BY cnt DESC FETCH FIRST 10 ROWS ONLY
      `),
    ]);
    res.json({
      top_brands: topBrands.rows.map(r => ({ name: r.BRAND_NAME, count: r.CNT })),
      top_generics: topGenerics.rows.map(r => ({ name: r.GENERIC_NAME, count: r.CNT })),
      top_rejected: topRejected.rows.map(r => ({ name: r.BRAND_NAME, count: r.CNT })),
      top_approved: topApproved.rows.map(r => ({ name: r.BRAND_NAME, count: r.CNT })),
    });
  } catch (err) {
    console.error('GET analytics/drug-analytics error:', err);
    res.status(500).json({ error: 'Internal server error.', detail: err.message });
  } finally { await conn.close(); }
});

// GET /api/analytics/rejection-breakdown — Rejections per stage + top remarks
router.get('/rejection-breakdown', requireRole(ROLES.CEO, 'dtc', ROLES.DTC_COMMITTEE), async (req, res) => {
  const conn = await getConn();
  try {
    const [breakdown, remarks] = await Promise.all([
      conn.execute(`
        SELECT
          SUM(CASE WHEN status = 'HOD_REJECTED' THEN 1 ELSE 0 END) AS rejected_by_hod,
          SUM(CASE WHEN status IN ('PHARMACY_HEAD_REJECTED','PHARMACY_HEAD_REJECTED_PENDING_DTC') THEN 1 ELSE 0 END) AS rejected_by_ph,
          SUM(CASE WHEN status IN ('Rejected','PHARMACIST_REJECTED') AND current_stage IN ('DTCCommittee','DTCFinal','EmergencyDTC','Pharmacist','PharmacyHeadReview2') THEN 1 ELSE 0 END) AS rejected_by_dtc,
          SUM(CASE WHEN status = 'CEO_REJECTED' THEN 1 ELSE 0 END) AS rejected_by_ceo,
          SUM(CASE WHEN status = 'EMERGENCY_REJECTED' THEN 1 ELSE 0 END) AS rejected_emergency
        FROM drug_requests
      `),
      conn.execute(`
        SELECT remarks, COUNT(*) AS cnt
        FROM rejection_remark_history
        WHERE remarks IS NOT NULL AND TRIM(remarks) != ''
        GROUP BY remarks ORDER BY cnt DESC FETCH FIRST 10 ROWS ONLY
      `).catch(() => ({ rows: [] })),
    ]);
    const b = breakdown.rows[0];
    res.json({
      rejected_by_hod: b.REJECTED_BY_HOD,
      rejected_by_ph: b.REJECTED_BY_PH,
      rejected_by_dtc: b.REJECTED_BY_DTC,
      rejected_by_ceo: b.REJECTED_BY_CEO,
      rejected_emergency: b.REJECTED_EMERGENCY,
      top_remarks: remarks.rows.map(r => ({ remark: r.REMARKS, count: r.CNT })),
    });
  } catch (err) {
    console.error('GET analytics/rejection-breakdown error:', err);
    res.status(500).json({ error: 'Internal server error.', detail: err.message });
  } finally { await conn.close(); }
});

// GET /api/analytics/request-history — Paginated full request list
router.get('/request-history', requireRole(ROLES.CEO, 'dtc', ROLES.DTC_COMMITTEE), async (req, res) => {
  const conn = await getConn();
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(50, Math.max(5, parseInt(req.query.limit) || 20));
    const offset = (page - 1) * limit;
    const search = (req.query.search || '').trim().toLowerCase();
    const stageFilter = (req.query.stage || '').trim();

    let whereClause = '1=1';
    // dataBinds includes pagination; countBinds only has filter values actually used in WHERE
    const dataBinds = { offset, limit };
    const countBinds = {};

    if (search) {
      whereClause += ` AND (LOWER(dr.brand_name) LIKE '%' || :search || '%' OR LOWER(u.name) LIKE '%' || :search || '%' OR LOWER(dr.generic_name) LIKE '%' || :search || '%')`;
      dataBinds.search = search;
      countBinds.search = search;
    }
    if (stageFilter) {
      whereClause += ` AND dr.current_stage = :stage`;
      dataBinds.stage = stageFilter;
      countBinds.stage = stageFilter;
    }

    const [dataRes, countRes] = await Promise.all([
      conn.execute(`
        SELECT
          dr.request_id, u.name AS doctor_name, u.department,
          dr.brand_name, dr.generic_name, dr.dosage_form, dr.dose_strength,
          dr.request_source_type, dr.formulary_request_type,
          dr.current_stage, dr.status, dr.created_at, dr.effective_created_at,
          dr.dtc_selected_brand, dr.created_by_role
        FROM drug_requests dr
        LEFT JOIN users u ON u.user_id = dr.created_by_user_id
        WHERE ${whereClause}
        ORDER BY dr.request_id DESC
        OFFSET :offset ROWS FETCH NEXT :limit ROWS ONLY
      `, dataBinds),
      conn.execute(`
        SELECT COUNT(*) AS total
        FROM drug_requests dr
        LEFT JOIN users u ON u.user_id = dr.created_by_user_id
        WHERE ${whereClause}
      `, countBinds),
    ]);

    const total = countRes.rows[0].TOTAL;
    res.json({
      data: dataRes.rows.map(r => ({
        request_id: r.REQUEST_ID,
        doctor_name: r.DOCTOR_NAME || '—',
        department: r.DEPARTMENT || '—',
        brand_name: r.BRAND_NAME,
        generic_name: r.GENERIC_NAME,
        dosage_form: r.DOSAGE_FORM,
        dose_strength: r.DOSE_STRENGTH,
        request_source_type: r.REQUEST_SOURCE_TYPE,
        formulary_request_type: r.FORMULARY_REQUEST_TYPE,
        current_stage: r.CURRENT_STAGE,
        status: r.STATUS,
        created_at: r.CREATED_AT,
        effective_created_at: r.EFFECTIVE_CREATED_AT,
        dtc_selected_brand: r.DTC_SELECTED_BRAND,
        created_by_role: r.CREATED_BY_ROLE,
      })),
      total,
      page,
      limit,
      total_pages: Math.ceil(total / limit),
    });
  } catch (err) {
    console.error('GET analytics/request-history error:', err);
    res.status(500).json({ error: 'Internal server error.', detail: err.message });
  } finally { await conn.close(); }
});

// GET /api/analytics/workflow-tracker — Live workflow tracking
router.get('/workflow-tracker', requireRole(ROLES.CEO, 'dtc', ROLES.DTC_COMMITTEE), async (req, res) => {
  const conn = await getConn();
  const role = (req.query.role || '').toLowerCase();
  const userId = req.query.userId ? parseInt(req.query.userId, 10) : null;

  try {
    let whereClause = '1=1';
    const binds = {};

    if (role === ROLES.DOCTOR && userId) {
      whereClause = '(dr.doctor_id = :userId OR dr.created_by_user_id = :userId)';
      binds.userId = userId;
    } else if (role === ROLES.HOD && userId) {
      whereClause = `(dr.hod_id = :userId 
        OR dr.created_by_user_id = :userId 
        OR u.department = (SELECT department FROM users WHERE user_id = :userId))`;
      binds.userId = userId;
    }

    const query = `
      SELECT
        dr.request_id,
        u.name AS requester_name,
        dr.created_by_role AS requester_role,
        u.department,
        dr.brand_name,
        dr.generic_name,
        dr.current_stage,
        dr.status,
        dr.is_reverted,
        dr.created_at,
        dr.updated_at
      FROM drug_requests dr
      JOIN users u ON u.user_id = dr.doctor_id
      WHERE ${whereClause}
      ORDER BY dr.request_id DESC
    `;

    const result = await conn.execute(query, binds);

    const data = result.rows.map(row => {
      const dbStage = row.CURRENT_STAGE;
      const status = row.STATUS;
      const isReverted = row.IS_REVERTED === 1;

      // Map DB stage to standard key
      let stageKey = 'pharmacy_head_review1'; // fallback
      if (dbStage === 'HOD') stageKey = 'hod';
      else if (['PharmacistInitialReview', 'PharmacistCorrection', 'PharmacistReview1'].includes(dbStage)) stageKey = 'pharmacist_initial';
      else if (['PharmacyHead', 'PharmacyHeadReview1'].includes(dbStage)) stageKey = 'pharmacy_head_review1';
      else if (['DTCCommittee', 'DTCReview1', 'EmergencyDTC'].includes(dbStage)) stageKey = 'dtc_review1';
      else if (['Pharmacist', 'PharmacistReview2'].includes(dbStage)) stageKey = 'pharmacist_analysis';
      else if (dbStage === 'PharmacyHeadReview2') stageKey = 'pharmacy_head_review2';
      else if (['DTCFinal', 'DTCFinalReview'].includes(dbStage)) stageKey = 'dtc_final';
      else if (dbStage === 'CEO') stageKey = 'ceo';
      else if (['PharmacistOrder', 'APPROVED_PENDING_ORDER', 'OrderPlaced', 'Final'].includes(dbStage) || status === 'ORDER_PLACED' || status === 'Approved') stageKey = 'order_placed';

      // Let's determine owner
      let currentOwner = 'Pharmacy Head';
      if (status && (status.toLowerCase().includes('rejected') || status === 'Rejected')) {
        currentOwner = 'Rejected';
      } else if (stageKey === 'order_placed' && (status === 'ORDER_PLACED' || status === 'Approved')) {
        currentOwner = 'Completed';
      } else {
        if (stageKey === 'hod') currentOwner = 'HOD';
        else if (stageKey === 'pharmacist_initial' || stageKey === 'pharmacist_analysis' || stageKey === 'order_placed') currentOwner = 'Pharmacist';
        else if (stageKey === 'pharmacy_head_review1' || stageKey === 'pharmacy_head_review2') currentOwner = 'Pharmacy Head';
        else if (stageKey === 'dtc_review1' || stageKey === 'dtc_final') currentOwner = 'DTC';
        else if (stageKey === 'ceo') currentOwner = 'CEO';
      }

      // Calculate days in stage
      const lastActionDate = row.UPDATED_AT || row.CREATED_AT;
      const diffTime = Math.max(0, new Date() - new Date(lastActionDate));
      const daysInStage = Math.floor(diffTime / (1000 * 60 * 60 * 24));

      // Build workflow progress
      const STAGE_ORDER = [
        'hod',
        'pharmacist_initial',
        'pharmacy_head_review1',
        'dtc_review1',
        'pharmacist_analysis',
        'pharmacy_head_review2',
        'dtc_final',
        'ceo',
        'order_placed'
      ];

      const workflowProgress = {
        hod: false,
        pharmacist_initial: false,
        pharmacy_head_review1: false,
        dtc_review1: false,
        pharmacist_analysis: false,
        pharmacy_head_review2: false,
        dtc_final: false,
        ceo: false,
        order_placed: false
      };

      const currentIdx = STAGE_ORDER.indexOf(stageKey);
      if (currentIdx !== -1) {
        for (let i = 0; i <= currentIdx; i++) {
          workflowProgress[STAGE_ORDER[i]] = true;
        }
      }

      // Format stage string for output
      let stageString = 'PHARMACY_HEAD';
      if (stageKey === 'hod') stageString = 'HOD';
      else if (stageKey === 'pharmacist_initial') stageString = 'PHARMACIST_INITIAL';
      else if (stageKey === 'pharmacy_head_review1') stageString = 'PHARMACY_HEAD';
      else if (stageKey === 'dtc_review1') stageString = 'DTC_REVIEW1';
      else if (stageKey === 'pharmacist_analysis') stageString = 'PHARMACIST_ANALYSIS';
      else if (stageKey === 'pharmacy_head_review2') stageString = 'PHARMACY_HEAD_REVIEW2';
      else if (stageKey === 'dtc_final') stageString = 'DTC_FINAL';
      else if (stageKey === 'ceo') stageString = 'CEO';
      else if (stageKey === 'order_placed') stageString = 'ORDER_PLACED';

      return {
        request_id: row.REQUEST_ID,
        requester_name: row.REQUESTER_NAME || '—',
        requester_role: row.REQUESTER_ROLE || ROLES.DOCTOR,
        department: row.DEPARTMENT || '—',
        brand_name: row.BRAND_NAME,
        generic_name: row.GENERIC_NAME,
        current_stage: stageString,
        current_owner: currentOwner,
        status: status,
        is_reverted: isReverted,
        days_in_stage: daysInStage,
        created_date: row.CREATED_AT,
        last_action_date: lastActionDate,
        workflow_progress: workflowProgress
      };
    });

    res.json(data);
  } catch (err) {
    console.error('GET workflow-tracker error:', err);
    res.status(500).json({ error: 'Internal server error.', detail: err.message });
  } finally {
    await conn.close();
  }
});

// GET /api/analytics/audit-trail — Global request audit trail
router.get('/audit-trail', requireRole(ROLES.CEO, 'dtc', ROLES.DTC_COMMITTEE), async (req, res) => {
  const conn = await getConn();
  const role = (req.query.role || '').toLowerCase();
  const userId = req.query.userId ? parseInt(req.query.userId, 10) : null;

  try {
    let whereClause = '1=1';
    const binds = {};

    if (role === ROLES.DOCTOR && userId) {
      whereClause = '(dr.doctor_id = :userId OR dr.created_by_user_id = :userId)';
      binds.userId = userId;
    } else if (role === ROLES.HOD && userId) {
      whereClause = `(dr.hod_id = :userId 
        OR dr.created_by_user_id = :userId 
        OR u.department = (SELECT department FROM users WHERE user_id = :userId))`;
      binds.userId = userId;
    }

    const query = `
      SELECT
        al.log_id,
        al.request_id,
        al.action,
        al.from_stage,
        al.to_stage,
        al.remarks,
        al.logged_at,
        u_perf.name AS performer_name,
        u_perf.role AS performer_role,
        dr.brand_name,
        dr.generic_name
      FROM audit_logs al
      JOIN users u_perf ON u_perf.user_id = al.performed_by
      JOIN drug_requests dr ON dr.request_id = al.request_id
      JOIN users u ON u.user_id = dr.doctor_id
      WHERE ${whereClause}
      ORDER BY al.logged_at DESC
      OFFSET 0 ROWS FETCH NEXT 100 ROWS ONLY
    `;

    const result = await conn.execute(query, binds);
    let rows = result.rows;

    // Filter out internal stages for doctor and HOD roles
    if (role === ROLES.DOCTOR || role === ROLES.HOD) {
      const internalStages = [
        'PharmacistInitialReview',
        'PharmacistCorrection',
        'PharmacyHead',
        'PharmacyHeadReview1',
        'Pharmacist',
        'PharmacistReview2',
        'PharmacyHeadReview2'
      ];
      rows = rows.filter(row => {
        const fromStage = row.FROM_STAGE;
        const toStage = row.TO_STAGE;
        const action = row.ACTION;
        if (action === 'REVERTED_TO_PHARMACIST') return false;
        if (internalStages.includes(fromStage) || internalStages.includes(toStage)) return false;
        return true;
      });
    }

    res.json(rows);
  } catch (err) {
    console.error('GET global audit-trail error:', err);
    res.status(500).json({ error: 'Internal server error.', detail: err.message });
  } finally {
    await conn.close();
  }
});

// GET /api/analytics/drilldown — Drilldown for metric or stage click
router.get('/drilldown', requireRole(ROLES.CEO, 'dtc', ROLES.DTC_COMMITTEE), async (req, res) => {
  const conn = await getConn();
  try {
    const type = req.query.type;
    const key = req.query.key;
    if (!type || !key) {
      return res.status(400).json({ error: 'Missing type or key parameter.' });
    }

    let whereClause = '1=1';
    const binds = {};

    if (type === 'metric') {
      if (key === 'total_requests') {
        whereClause = '1=1';
      } else if (key === 'total_pending') {
        whereClause = "dr.status = 'Pending' OR dr.status LIKE '%PENDING%'";
      } else if (key === 'total_approved') {
        whereClause = "dr.status IN ('Approved','HOD_APPROVED','APPROVED_PENDING_ORDER','EMERGENCY_APPROVED','INVENTORY_RECEIVED')";
      } else if (key === 'total_rejected') {
        whereClause = "dr.status IN ('Rejected','HOD_REJECTED','PHARMACIST_REJECTED','PHARMACY_HEAD_REJECTED','PHARMACY_HEAD_REJECTED_PENDING_DTC','PHARMACIST_REJECTED_PENDING_DTC','CEO_REJECTED','EMERGENCY_REJECTED')";
      } else if (key === 'total_emergency') {
        whereClause = "dr.status IN ('EMERGENCY_PENDING_DTC','EMERGENCY_APPROVED','EMERGENCY_REJECTED')";
      } else if (key === 'total_order_placed') {
        whereClause = "dr.status IN ('ORDER_PLACED','INVENTORY_RECEIVED') OR dr.current_stage = 'OrderPlaced'";
      } else if (key === 'total_final_approved') {
        whereClause = "dr.current_stage = 'Final'";
      } else if (key === 'total_dtc_review') {
        whereClause = "dr.current_stage IN ('DTCCommittee','DTCFinal','EmergencyDTC')";
      } else if (key === 'total_ceo_review') {
        whereClause = "dr.current_stage = 'CEO'";
      } else if (key === 'total_clinical') {
        whereClause = "dr.request_source_type = 'NON_PROMOTIONAL'";
      } else if (key === 'total_via_rep') {
        whereClause = "dr.request_source_type = 'PROMOTIONAL' OR dr.request_source_type IS NULL";
      } else if (key === 'total_formulary') {
        whereClause = "dr.formulary_request_type = 'FORMULARY'";
      } else if (key === 'total_non_formulary') {
        whereClause = "dr.formulary_request_type = 'NON_FORMULARY'";
      }
    } else if (type === 'stage') {
      if (key === 'Rejected') {
        whereClause = "dr.current_stage = 'Rejected' OR dr.status IN ('Rejected','HOD_REJECTED','PHARMACIST_REJECTED','PHARMACY_HEAD_REJECTED','PHARMACY_HEAD_REJECTED_PENDING_DTC','PHARMACIST_REJECTED_PENDING_DTC','CEO_REJECTED','EMERGENCY_REJECTED')";
      } else if (key === 'EmergencyDTC') {
        whereClause = "dr.current_stage = 'EmergencyDTC' OR dr.status IN ('EMERGENCY_PENDING_DTC','EMERGENCY_APPROVED','EMERGENCY_REJECTED')";
      } else {
        whereClause = "dr.current_stage = :stageKey";
        binds.stageKey = key;
      }
    }

    const query = `
      SELECT
        dr.request_id,
        u.name AS doctor_name,
        u.department,
        dr.brand_name,
        dr.generic_name,
        dr.dosage_form,
        dr.dose_strength,
        dr.request_source_type,
        dr.current_stage,
        dr.status,
        dr.created_at,
        dr.dtc_selected_brand,
        (SELECT remarks FROM audit_logs WHERE request_id = dr.request_id AND action = 'REJECTED' ORDER BY logged_at DESC FETCH FIRST 1 ROWS ONLY) AS rejection_remarks,
        (SELECT remarks FROM audit_logs WHERE request_id = dr.request_id AND action = 'ORDER_PLACED' ORDER BY logged_at DESC FETCH FIRST 1 ROWS ONLY) AS order_remarks
      FROM drug_requests dr
      LEFT JOIN users u ON u.user_id = COALESCE(dr.created_by_user_id, dr.doctor_id)
      WHERE ${whereClause}
      ORDER BY dr.request_id DESC
    `;

    const result = await conn.execute(query, binds);
    res.json(result.rows.map(r => ({
      request_id: r.REQUEST_ID,
      doctor_name: r.DOCTOR_NAME || '—',
      department: r.DEPARTMENT || '—',
      brand_name: r.BRAND_NAME,
      generic_name: r.GENERIC_NAME,
      dosage_form: r.DOSAGE_FORM,
      dose_strength: r.DOSE_STRENGTH,
      request_source_type: r.REQUEST_SOURCE_TYPE,
      current_stage: r.CURRENT_STAGE,
      status: r.STATUS,
      created_at: r.CREATED_AT,
      dtc_selected_brand: r.DTC_SELECTED_BRAND,
      rejection_remarks: r.REJECTION_REMARKS || '—',
      order_remarks: r.ORDER_REMARKS || '—'
    })));
  } catch (err) {
    console.error('GET analytics/drilldown error:', err);
    res.status(500).json({ error: 'Internal server error.', detail: err.message });
  } finally {
    await conn.close();
  }
});

export default router;
