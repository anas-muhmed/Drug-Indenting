// Core drug-request workflow routes — moved out of server.js unchanged,
// mounted at /api/requests. This is the biggest route group: creation,
// viewing, and every stage of the approval workflow (approve/reject/
// review/pharmacist-submit/emergency/order-placement/inventory/revert/
// resubmit). Route order preserved exactly as it was — in particular,
// /:requestId/existing-generic-data must stay registered before
// /:role/:userId, since the latter's :userId wildcard would otherwise
// shadow it.

import express from 'express';
import oracledb from 'oracledb';
import { getConn } from '../db/pool.js';
import { requireAuth, requireRole } from '../middleware/requireAuth.js';
import { NEXT_STAGE, STAGE_LABELS, getApproverRoleForStage, ROLES } from '../utils/workflow.js';
import { computeAltDerived, formatEffectiveEntryRow } from '../utils/pureHelpers.js';
import { writeAudit, createNotification, saveApprovalRemarks } from '../utils/auditHelpers.js';

const router = express.Router();

router.post('/', requireAuth, async (req, res) => {
  const {
    doctor_id, med_rep_name, med_rep_email, med_rep_phone,
    request_type, formulary_request_type, category, request_source_type,
    brand_name, generic_name, dose_strength, dosage_form,
    manufacturer, marketer, existing_brands,
    clinical_justification, expected_patients_pm, cost_reduction_benefit,
    medicine_quantity, ai_content
  } = req.body;

  // Only doctors/HODs create requests, and only as themselves — without
  // this, any authenticated user's token could submit a request with an
  // arbitrary doctor_id, impersonating any doctor.
  if (![ROLES.DOCTOR, ROLES.HOD].includes(req.user.role)) {
    return res.status(403).json({ error: 'Only doctors and HODs can submit drug requests.' });
  }
  if (req.user.id !== Number(doctor_id)) {
    return res.status(403).json({ error: 'You can only submit requests as yourself.' });
  }

  const conn = await getConn();
  try {
    // Validate source type
    const sourceType = (request_source_type || 'PROMOTIONAL').toUpperCase();
    if (!['PROMOTIONAL', 'NON_PROMOTIONAL'].includes(sourceType)) {
      return res.status(400).json({ error: 'request_source_type must be PROMOTIONAL or NON_PROMOTIONAL.' });
    }

    const isPromotional = sourceType === 'PROMOTIONAL';
    let formatai = ai_content ? ai_content.replace(/\n/g, '<br>') : '';

    // Base required fields (always needed)
    const baseRequired = {
      doctor_id, request_type, formulary_request_type, category, brand_name, generic_name,
      dose_strength, dosage_form, manufacturer, marketer,
      clinical_justification, expected_patients_pm
    };

    // Validate medicine_quantity
    if (medicine_quantity !== undefined && medicine_quantity !== null && String(medicine_quantity).trim() !== '') {
      if (isNaN(Number(medicine_quantity)) || Number(medicine_quantity) <= 0) {
        return res.status(400).json({ error: `Field 'medicine_quantity' must be a positive number.` });
      }
    } else if (!isPromotional) {
      return res.status(400).json({ error: `Field 'medicine_quantity' is required for Non-Promotional requests.` });
    }
    for (const [key, val] of Object.entries(baseRequired)) {
      if (val === undefined || val === null || String(val).trim() === '') {
        return res.status(400).json({ error: `Field '${key}' is required.` });
      }
    }

    // Conditional: Med Rep fields required only for PROMOTIONAL
    if (isPromotional) {
      const repRequired = { med_rep_name, med_rep_email, med_rep_phone };
      for (const [key, val] of Object.entries(repRequired)) {
        if (!val || String(val).trim() === '') {
          return res.status(400).json({ error: `Field '${key}' is required for Promotional requests.` });
        }
      }
    }
    

    const qCheck = await conn.execute(
      `SELECT COUNT(*) AS cnt FROM user_request_quotas WHERE user_id = :userId`,
      { userId: doctor_id }
    );
    if (qCheck.rows[0].CNT === 0) {
      await conn.execute(
        `INSERT INTO user_request_quotas (user_id, quarterly_limit, updated_by)
         VALUES (:userId, 10, :updatedBy)`,
        { userId: doctor_id, updatedBy: doctor_id },
        { autoCommit: true }
      );
    }

    const quotaResult = await conn.execute(
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
      { userId: doctor_id }
    );
    const qRow = quotaResult.rows[0];
    const qLimit = qRow.QUARTERLY_LIMIT;
    const qUsed = qRow.USED_THIS_QUARTER;

    if (qUsed >= qLimit) {
      return res.status(400).json({
        success: false,
        error: 'Quarterly request quota exceeded.'
      });
    }

    // -- Blacklist validation --
    const blCheck = await conn.execute(
      `SELECT company_type, remarks FROM blacklisted_companies
       WHERE is_active = 1
         AND (
           (company_type = 'MANUFACTURER' AND UPPER(TRIM(company_name)) = UPPER(TRIM(:mfg)))
           OR
           (company_type = 'MARKETER' AND UPPER(TRIM(company_name)) = UPPER(TRIM(:mkt)))
         )
       FETCH FIRST 1 ROW ONLY`,
      { mfg: manufacturer || '', mkt: marketer || '' }
    );
    if (blCheck.rows.length > 0) {
      const blRow = blCheck.rows[0];
      const blType = blRow.COMPANY_TYPE === 'MANUFACTURER' ? 'Manufacturer' : 'Marketer';
      return res.status(400).json({
        success: false,
        error: `Request denied. ${blType} is blacklisted by DTC.`,
        remarks: blRow.REMARKS || ''
      });
    }

    // Fetch creator role, department & name to determine workflow and to
    // address notifications correctly (see notification-text fix below).
    const creatorRes = await conn.execute(`SELECT role, department, name FROM users WHERE user_id = :id`, { id: doctor_id });
    if (creatorRes.rows.length === 0) return res.status(400).json({ error: 'User not found.' });
    const creatorRole = creatorRes.rows[0].ROLE;
    const creatorDept = creatorRes.rows[0].DEPARTMENT;
    const creatorName = creatorRes.rows[0].NAME;

    // Initialize workflow variables
    let initialStatus = 'HOD_APPROVED';
    let initialStage = 'PharmacistInitialReview';
    let hodId = null;

    // Determine workflow based on role
    if (creatorRole && creatorRole.toLowerCase() === ROLES.DOCTOR) {
      // Only attempt HOD routing if the doctor has a department set
      if (creatorDept && creatorDept.trim() !== '') {
        const hodRes = await conn.execute(
          `SELECT user_id FROM users WHERE UPPER(role) = 'HOD' AND UPPER(TRIM(department)) = UPPER(TRIM(:dept)) AND is_active = 1`,
          { dept: creatorDept.trim() }
        );
        if (hodRes.rows.length > 0) {
          // HOD found → route through HOD first
          hodId = hodRes.rows[0].USER_ID;
          initialStatus = 'PENDING_HOD';
          initialStage = 'HOD';
        } else {
          // No HOD for this department → route to Pharmacist (Initial Review)
          console.warn(`[WARN] No HOD found for department '${creatorDept}'. Routing to PharmacistInitialReview.`);
          initialStatus = 'HOD_APPROVED';
          initialStage = 'PharmacistInitialReview';
        }
      } else {
        // Doctor has no department set → route to Pharmacist (Initial Review)
        console.warn(`[WARN] Doctor (user_id=${doctor_id}) has no department set. Routing to PharmacistInitialReview.`);
        initialStatus = 'HOD_APPROVED';
        initialStage = 'PharmacistInitialReview';
      }
    } else if (creatorRole && creatorRole.toLowerCase() === ROLES.HOD) {
      initialStatus = 'HOD_APPROVED';
      initialStage = 'PharmacistInitialReview';
    }

    const isHOD = creatorRole && creatorRole.toLowerCase() === ROLES.HOD;

    const insertResult = await conn.execute(
      `INSERT INTO drug_requests (
         doctor_id, created_by_user_id, created_by_role, hod_id,
         med_rep_name, med_rep_email, med_rep_phone,
         request_type, formulary_request_type, category, request_source_type,
         brand_name, generic_name, dose_strength, dosage_form,
         manufacturer, marketer, existing_brands,
         clinical_justification, expected_patients_pm, cost_reduction_benefit,
         medicine_quantity, ai_content,
         status, current_stage,
         approved_by_hod, hod_action_timestamp
       ) VALUES (
         :doctor_id, :doctor_id, :created_by_role, :hod_id,
         :med_rep_name, :med_rep_email, :med_rep_phone,
         :request_type, :formulary_request_type, :category, :request_source_type,
         :brand_name, :generic_name, :dose_strength, :dosage_form,
         :manufacturer, :marketer, :existing_brands,
         :clinical_justification, :expected_patients_pm, :cost_reduction_benefit,
         :medicine_quantity, :ai_content,
         :status, :current_stage,
         :approved_by_hod, :hod_action_timestamp
       ) RETURNING request_id INTO :request_id`,
      {
        doctor_id,
        created_by_role: creatorRole,
        hod_id: hodId,
        med_rep_name: isPromotional ? med_rep_name : null,
        med_rep_email: isPromotional ? med_rep_email : null,
        med_rep_phone: isPromotional ? med_rep_phone : null,
        request_type, formulary_request_type, category,
        request_source_type: sourceType,
        brand_name, generic_name, dose_strength, dosage_form,
        manufacturer, marketer,
        existing_brands: existing_brands || null,
        clinical_justification, expected_patients_pm,
        ai_content: formatai || null,
        cost_reduction_benefit: cost_reduction_benefit ? 1 : 0,
        medicine_quantity: medicine_quantity ? Number(medicine_quantity) : null,
        status: initialStatus,
        current_stage: initialStage,
        approved_by_hod: isHOD ? 1 : 0,
        hod_action_timestamp: isHOD ? new Date() : null,
        request_id: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER }
      }
    );
    const requestId = insertResult.outBinds.request_id[0];

    const sourceLabel = isPromotional ? 'Promotional (Industry-Sponsored)' : 'Non-Promotional (Clinician-Initiated)';
    const classLabel = formulary_request_type === 'FORMULARY' ? '[Formulary Request]' : '[Non-Formulary Request]';

    await writeAudit(conn, requestId, 'SUBMITTED', doctor_id, null, initialStage,
      `Source: ${sourceLabel} | Class: ${formulary_request_type}`);

    if (creatorRole && creatorRole.toLowerCase() === ROLES.DOCTOR && hodId) {
      await createNotification(conn, hodId, requestId,
        `${classLabel} New ${sourceLabel} drug request #${requestId} submitted by Dr. ${creatorName || 'Unknown'}. Awaiting HOD approval.`
      );
    } else if (creatorRole && creatorRole.toLowerCase() === ROLES.HOD) {
      const pharmUsers = await conn.execute(`SELECT user_id FROM users WHERE UPPER(role) = 'PHARMACIST' AND is_active = 1`);
      for (const row of pharmUsers.rows) {
        await createNotification(conn, row.USER_ID, requestId,
          `${classLabel} New ${sourceLabel} drug request #${requestId} submitted by HOD. Drug: ${brand_name}. Awaiting initial review.`
        );
      }
    } else {
      const phUsers = await conn.execute(`SELECT user_id FROM users WHERE UPPER(role) = 'PHARMACYHEAD' AND is_active = 1`);
      // Not necessarily a doctor here (falls through when creator is
      // neither 'doctor' nor 'hod'), so no "Dr." prefix — just their name.
      const submitterText = creatorName || 'a colleague';
      for (const row of phUsers.rows) {
        await createNotification(conn, row.USER_ID, requestId,
          `${classLabel} New ${sourceLabel} drug request #${requestId} submitted by ${submitterText}. Drug: ${brand_name}. Awaiting your review.`
        );
      }
    }

    res.status(201).json({ message: 'Drug request submitted successfully.', request_id: requestId });
  } catch (err) {
    console.error('POST /api/requests error:', err);
    res.status(500).json({ error: 'Internal server error.', detail: err.message });
  } finally {
    await conn.close();
  }
});

router.get('/:requestId/existing-generic-data', requireAuth, async (req, res) => {
  const conn = await getConn();
  try {
    const rid = parseInt(req.params.requestId);
    const result = await conn.execute(
      `SELECT existing_generic_data FROM drug_requests WHERE request_id = :rid`,
      { rid }
    );
    if (!result.rows.length) return res.json({ existing_generic_data: null });
    const row = result.rows[0];
    let parsed = null;
    try { parsed = row.EXISTING_GENERIC_DATA ? JSON.parse(row.EXISTING_GENERIC_DATA) : null; } catch { parsed = null; }
    res.json({ existing_generic_data: parsed });
  } catch (err) {
    console.error('GET existing-generic-data error:', err);
    res.status(500).json({ error: 'Internal server error.', detail: err.message });
  } finally {
    await conn.close();
  }
});

router.get('/:role/:userId', requireAuth, async (req, res) => {
  const { role, userId } = req.params;
  const normalizedRole = role?.toLowerCase();

  // 'dtc' and 'dtccommittee' are the same real role stored two different
  // ways (see AdminDashboard.js's ORDERED_ROLES, and the same alias
  // already handled in routes/dtc.js and routes/analytics.js) -- some
  // users are genuinely stored as the short form. The frontend always
  // requests this route as '.../DTCCommittee/:userId', so without this,
  // any DTC user actually stored as role='dtc' gets a 403 here even
  // though they're legitimately the person they claim to be.
  const isDtcAliasMatch = (req.user.role === 'dtc' && normalizedRole === ROLES.DTC_COMMITTEE) ||
    (req.user.role === ROLES.DTC_COMMITTEE && normalizedRole === 'dtc');

  // A token can only be used to view that same person's own requests —
  // without this, any logged-in user's valid token could read anyone
  // else's requests just by changing the URL's role/userId.
  if ((req.user.role !== normalizedRole && !isDtcAliasMatch) || req.user.id !== Number(userId)) {
    return res.status(403).json({ success: false, message: 'You are not authorized to view these requests.' });
  }

  const conn = await getConn();

  try {

    const {
      status,
      category,
      from_date,
      to_date,
      source_type,
      formulary_type
    } = req.query;

    let query = '';
    let binds = {};

    if (normalizedRole === ROLES.DOCTOR) {

      query = `
        SELECT dr.*, u.name AS doctor_name, u.department AS doctor_dept, u_dtc.name AS dtc_reviewer_name
        FROM drug_requests dr
        JOIN users u ON u.user_id = dr.doctor_id
        LEFT JOIN users u_dtc ON u_dtc.user_id = dr.dtc_reviewed_by
        WHERE dr.doctor_id = :userId
      `;

      binds = { userId };

    } else if (normalizedRole === ROLES.HOD) {

      query = `
        SELECT dr.*, u.name AS doctor_name, u.department AS doctor_dept, u_dtc.name AS dtc_reviewer_name
        FROM drug_requests dr
        JOIN users u ON u.user_id = dr.doctor_id
        LEFT JOIN users u_dtc ON u_dtc.user_id = dr.dtc_reviewed_by
        WHERE (dr.hod_id = :userId
          AND dr.current_stage = 'HOD'
          AND dr.status = 'PENDING_HOD')
          OR (dr.created_by_user_id = :userId)
      `;

      binds = { userId };

    } else if (normalizedRole === ROLES.PHARMACY_HEAD) {

      query = `
        SELECT dr.*, u.name AS doctor_name, u.department AS doctor_dept, u_dtc.name AS dtc_reviewer_name
        FROM drug_requests dr
        JOIN users u ON u.user_id = dr.doctor_id
        LEFT JOIN users u_dtc ON u_dtc.user_id = dr.dtc_reviewed_by
        WHERE (
          dr.current_stage IN ('PharmacyHead','PharmacyHeadReview2')
          AND dr.status IN ('Pending', 'HOD_APPROVED')
        )
        OR dr.is_emergency = 1
      `;

    } else if (normalizedRole === ROLES.PHARMACIST) {

      query = `
        SELECT dr.*, u.name AS doctor_name, u.department AS doctor_dept, u_dtc.name AS dtc_reviewer_name
        FROM drug_requests dr
        JOIN users u ON u.user_id = dr.doctor_id
        LEFT JOIN users u_dtc ON u_dtc.user_id = dr.dtc_reviewed_by
        WHERE (
          dr.current_stage = 'PharmacistInitialReview'
          AND dr.status = 'HOD_APPROVED'
        )
        OR (
          dr.current_stage = 'Pharmacist'
          AND dr.status = 'Pending'
        )
        OR (
          dr.current_stage = 'PharmacistCorrection'
          AND dr.status = 'REVERTED_FOR_CORRECTION'
        )
        OR dr.is_emergency = 1
        OR dr.status IN ('APPROVED_PENDING_ORDER', 'ORDER_PLACED', 'INVENTORY_RECEIVED')
        OR dr.created_by_user_id = :userId
      `;

      binds = { userId };

    } else if (normalizedRole === ROLES.DTC_COMMITTEE) {

      query = `
        SELECT dr.*, u.name AS doctor_name, u.department AS doctor_dept, u_dtc.name AS dtc_reviewer_name
        FROM drug_requests dr
        JOIN users u ON u.user_id = dr.doctor_id
        LEFT JOIN users u_dtc ON u_dtc.user_id = dr.dtc_reviewed_by
        WHERE (
          dr.current_stage IN ('DTCCommittee','DTCFinal')
          AND dr.status IN ('Pending', 'PHARMACY_HEAD_REJECTED_PENDING_DTC')
        )
        OR (
          dr.current_stage = 'EmergencyDTC'
          AND dr.status = 'EMERGENCY_PENDING_DTC'
        )
      `;

    } else if (normalizedRole === ROLES.CEO) {

      query = `
        SELECT dr.*, u.name AS doctor_name, u.department AS doctor_dept, u_dtc.name AS dtc_reviewer_name
        FROM drug_requests dr
        JOIN users u ON u.user_id = dr.doctor_id
        LEFT JOIN users u_dtc ON u_dtc.user_id = dr.dtc_reviewed_by
        WHERE dr.current_stage = 'CEO'
        AND dr.status = 'Pending'
      `;

    } else {

      console.log("INVALID ROLE:", role);

      return res.status(400).json({
        error: 'Invalid role.'
      });
    }

    let whereClause = '';

    if (status) {
      whereClause += ` AND dr.status = :status`;
      binds.status = status;
    }

    if (category) {
      whereClause += ` AND LOWER(dr.category) LIKE LOWER(:category)`;
      binds.category = `%${category}%`;
    }

    if (from_date) {
      whereClause += ` AND dr.created_at >= TO_TIMESTAMP(:from_date, 'YYYY-MM-DD')`;
      binds.from_date = from_date;
    }

    if (to_date) {
      whereClause += ` AND dr.created_at < TO_TIMESTAMP(:to_date, 'YYYY-MM-DD') + 1`;
      binds.to_date = to_date;
    }

    if (source_type) {
      whereClause += ` AND dr.request_source_type = :source_type`;
      binds.source_type = source_type;
    }

    if (formulary_type) {
      whereClause += ` AND dr.formulary_request_type = :formulary_type`;
      binds.formulary_type = formulary_type;
    }

    const finalQuery = `
      SELECT * FROM (${query}) dr
      WHERE 1=1 ${whereClause}
      ORDER BY dr.created_at DESC
    `;

    const result = await conn.execute(finalQuery, binds);
    const rows = result.rows;

    for (const r of rows) {
      r.DTC_REVIEWED_BY_NAME = r.DTC_REVIEWED_BY_NAME || r.DTC_REVIEWER_NAME || '';
    }

    if (rows.length > 0) {
      const requestIds = rows.map(r => r.REQUEST_ID);
      const placeholders = requestIds.map((_, idx) => `:id${idx}`).join(',');
      const bindParams = {};
      requestIds.forEach((id, idx) => {
        bindParams[`id${idx}`] = id;
      });

      const entriesResult = await conn.execute(
        `SELECT * FROM drug_effective_entries WHERE request_id IN (${placeholders}) ORDER BY entry_id ASC`,
        bindParams
      );

      const entriesMap = {};
      entriesResult.rows.forEach(entry => {
        const rid = entry.REQUEST_ID;
        if (!entriesMap[rid]) {
          entriesMap[rid] = [];
        }
        entriesMap[rid].push(formatEffectiveEntryRow(entry));
      });

      rows.forEach(r => {
        r.effective_drug_entries = entriesMap[r.REQUEST_ID] || [];
      });
    }

    res.json(rows);

  } catch (err) {

    console.error('GET /api/requests error:', err);

    res.status(500).json({
      error: 'Internal server error.',
      detail: err.message
    });

  } finally {
    await conn.close();
  }
});

router.put('/:id/approve', requireAuth, async (req, res) => {
  const conn = await getConn();
  try {
    const requestId = parseInt(req.params.id);
    const { remarks } = req.body;
    const performed_by = req.user.id; // never trust a client-supplied performer id

    const reqResult = await conn.execute(
      `SELECT dr.*, u.name AS doctor_name, u.department AS doctor_dept
       FROM drug_requests dr
       JOIN users u ON u.user_id = dr.doctor_id
       WHERE dr.request_id = :requestId`,
      { requestId }
    );
    if (!reqResult.rows.length) return res.status(404).json({ error: 'Request not found.' });

    const dr = reqResult.rows[0];
    if (dr.STATUS !== 'Pending' && dr.STATUS !== 'EMERGENCY_PENDING_DTC' && dr.STATUS !== 'PENDING_HOD' && dr.STATUS !== 'HOD_APPROVED' && dr.STATUS !== 'PHARMACY_HEAD_REJECTED_PENDING_DTC') return res.status(400).json({ error: 'Request is no longer pending.' });

    const fromStage = dr.CURRENT_STAGE;

    // The core Bucket B rule: only the role responsible for the request's
    // CURRENT stage may approve it — e.g. only 'hod' can approve while it
    // sits at the HOD stage, only 'ceo' once it reaches CEO, etc.
    const approverRole = getApproverRoleForStage(fromStage);
    if (!approverRole || req.user.role !== approverRole) {
      return res.status(403).json({ error: 'You are not authorized to approve this request at its current stage.' });
    }

    let toStage = NEXT_STAGE[fromStage];

    // PHARMACIST Direct Flow overrides
    if (dr.REQUEST_SOURCE_TYPE === 'PHARMACIST') {
      if (fromStage === 'DTCCommittee') {
        toStage = 'CEO'; // Skip alternatives
      } else if (fromStage === 'CEO') {
        toStage = 'PharmacistOrder'; // Go straight to order placed
      }
    }

    // ── Block DTCFinal from using /approve — must use /dtc/final-select instead
    if (fromStage === 'DTCFinal') {
      return res.status(400).json({
        error: 'DTCFinal stage requires drug selection. Use POST /api/dtc/final-select/:id instead of /approve.'
      });
    }


    const isFinal = (toStage === 'Final');
    const remarksCol = fromStage === 'HOD' ? 'hod_remarks'
      : fromStage === 'PharmacistInitialReview' ? 'pharmacist_remarks'
        : fromStage === 'PharmacyHead' ? 'ph_remarks'
          : fromStage === 'DTCCommittee' ? 'dtc_remarks'
            : fromStage === 'Pharmacist' ? 'pharmacist_remarks'
              : fromStage === 'PharmacyHeadReview2' ? 'ph_remarks2'
                : fromStage === 'DTCFinal' ? 'dtc_final_remarks'
                  : fromStage === 'EmergencyDTC' ? 'dtc_remarks'
                    : 'ceo_remarks';

    const isEmergency = dr.IS_EMERGENCY === 1;
    let newStatus = isEmergency ? 'EMERGENCY_APPROVED' : (isFinal ? 'Approved' : 'Pending');
    if (fromStage === 'HOD') newStatus = 'HOD_APPROVED';
    if (toStage === 'PharmacistOrder') newStatus = 'APPROVED_PENDING_ORDER';

    let updateQuery = `UPDATE drug_requests
          SET current_stage = :toStage,
              status        = :newStatus,
              ${remarksCol} = :remarks,
              updated_at    = CURRENT_TIMESTAMP`;
    if (fromStage === 'HOD') {
      updateQuery += `, approved_by_hod = 1, hod_action_timestamp = CURRENT_TIMESTAMP`;
    }
    updateQuery += ` WHERE request_id = :requestId`;

    await conn.execute(
      updateQuery,
      { toStage, newStatus, remarks: remarks || null, requestId }
    );

    await writeAudit(conn, requestId, 'APPROVED', performed_by, fromStage, toStage, remarks);

    // Save approval remarks to history
    let remarkRole = null;
    if (fromStage === 'HOD') remarkRole = 'HOD';
    else if (fromStage === 'PharmacyHead' || fromStage === 'PharmacyHeadReview2') remarkRole = 'PharmacyHead';
    else if (fromStage === 'DTCCommittee' || fromStage === 'EmergencyDTC') remarkRole = 'DTC';
    else if (fromStage === 'CEO') remarkRole = 'CEO';

    if (remarkRole && remarks) {
      const customRemarksVal = req.body.customRemarks || remarks;
      await saveApprovalRemarks(conn, customRemarksVal, remarkRole, performed_by);
    }

    if (isFinal) {
      // Notify doctor
      await createNotification(conn, dr.DOCTOR_ID, requestId,
        `🎉 Your drug request #${requestId} (${dr.BRAND_NAME}) has received FINAL APPROVAL!`
      );
      // Notify Pharmacist to initiate drug order
      const pharmUsers = await conn.execute(
        `SELECT user_id FROM users WHERE UPPER(role) = 'PHARMACIST' AND is_active = 1`
      );
      for (const row of pharmUsers.rows) {
        await createNotification(conn, row.USER_ID, requestId,
          `✅ Drug request #${requestId} (${dr.BRAND_NAME}) is FINALLY APPROVED. Please initiate the drug order process.`
        );
      }
    } else {
      if (toStage === 'PharmacistOrder') {
        const orderUsers = await conn.execute(
          `SELECT user_id FROM users WHERE UPPER(role) IN ('PHARMACIST', 'PHARMACYHEAD') AND is_active = 1`
        );
        for (const row of orderUsers.rows) {
          await createNotification(conn, row.USER_ID, requestId,
            `🚨 Emergency request #${requestId} (${dr.BRAND_NAME}) has been APPROVED. Please place the order immediately.`
          );
        }
      } else {
        // Determine which role(s) to notify based on toStage
        const stageRoleMap = {
          PharmacistInitialReview: 'Pharmacist',
          PharmacyHead: 'PharmacyHead',
          DTCCommittee: 'DTCCommittee',
          Pharmacist: 'Pharmacist',
          PharmacyHeadReview2: 'PharmacyHead',
          DTCFinal: 'DTCCommittee',
          CEO: 'CEO',
        };
        const nextRole = stageRoleMap[toStage];
        if (nextRole) {
          let roleQuery = `SELECT user_id FROM users WHERE UPPER(role) = :role AND is_active = 1`;
          let binds = { role: nextRole.toUpperCase() };
          if (nextRole.toUpperCase() === 'DTCCOMMITTEE') {
            roleQuery = `SELECT user_id FROM users WHERE UPPER(role) IN ('DTC', 'DTCCOMMITTEE') AND is_active = 1`;
            binds = {};
          }
          const nextUsers = await conn.execute(roleQuery, binds);
          for (const row of nextUsers.rows) {
            await createNotification(conn, row.USER_ID, requestId,
              `Drug request #${requestId} (${dr.BRAND_NAME}) approved by ${STAGE_LABELS[fromStage]}. Awaiting your review.`
            );
          }
        }
      }
      let doctorMsg = `Your drug request #${requestId} (${dr.BRAND_NAME}) has been approved by ${STAGE_LABELS[fromStage]} and forwarded to ${STAGE_LABELS[toStage]}.`;
      const internalStages = ['PharmacistInitialReview', 'PharmacyHead', 'Pharmacist', 'PharmacyHeadReview2', 'DTCCommittee', 'DTCFinal'];
      if (fromStage === 'HOD' || internalStages.includes(toStage)) {
        doctorMsg = `Your drug request #${requestId} (${dr.BRAND_NAME}) has been forwarded to DTC Committee for further review.`;
      }
      await createNotification(conn, dr.DOCTOR_ID, requestId, doctorMsg);
    }

    res.json({
      message: isFinal ? 'Request finally approved.' : `Request approved and forwarded to ${STAGE_LABELS[toStage]}.`,
      new_stage: toStage,
      new_status: newStatus
    });
  } catch (err) {
    console.error('PUT approve error:', err);
    res.status(500).json({ error: 'Internal server error.', detail: err.message });
  } finally {
    await conn.close();
  }
});

router.put('/:id/reject', requireAuth, async (req, res) => {
  const conn = await getConn();
  try {
    const requestId = parseInt(req.params.id);
    const { remarks, customRemarks } = req.body;
    const performed_by = req.user.id; // never trust a client-supplied performer id

    if (!remarks || remarks.trim() === '') {
      return res.status(400).json({ error: 'Remarks are mandatory when rejecting a request.' });
    }

    const reqResult = await conn.execute(
      `SELECT dr.*, u.name AS doctor_name, u.department AS doctor_dept
       FROM drug_requests dr
       JOIN users u ON u.user_id = dr.doctor_id
       WHERE dr.request_id = :requestId`,
      { requestId }
    );
    if (!reqResult.rows.length) return res.status(404).json({ error: 'Request not found.' });

    const dr = reqResult.rows[0];
    if (dr.STATUS !== 'Pending' && dr.STATUS !== 'EMERGENCY_PENDING_DTC' && dr.STATUS !== 'PENDING_HOD' && dr.STATUS !== 'HOD_APPROVED' && dr.STATUS !== 'PHARMACY_HEAD_REJECTED_PENDING_DTC') return res.status(400).json({ error: 'Request is no longer pending.' });

    const fromStage = dr.CURRENT_STAGE;

    const approverRole = getApproverRoleForStage(fromStage);
    if (!approverRole || req.user.role !== approverRole) {
      return res.status(403).json({ error: 'You are not authorized to reject this request at its current stage.' });
    }

    const remarksCol = fromStage === 'HOD' ? 'hod_remarks'
      : fromStage === 'PharmacistInitialReview' ? 'pharmacist_remarks'
        : fromStage === 'PharmacyHead' ? 'ph_remarks'
          : fromStage === 'DTCCommittee' ? 'dtc_remarks'
            : fromStage === 'Pharmacist' ? 'pharmacist_remarks'
              : fromStage === 'PharmacyHeadReview2' ? 'ph_remarks2'
                : fromStage === 'DTCFinal' ? 'dtc_final_remarks'
                  : fromStage === 'EmergencyDTC' ? 'dtc_remarks'
                    : 'ceo_remarks';

    const isEmergency = dr.IS_EMERGENCY === 1;
    let rejectStatus = isEmergency ? 'EMERGENCY_REJECTED' : 'Rejected';
    let toStage = 'Rejected';

    if (fromStage === 'HOD') rejectStatus = 'HOD_REJECTED';
    else if (fromStage === 'PharmacistInitialReview') {
      rejectStatus = 'Rejected';
      toStage = 'Rejected';
    } else if (fromStage === 'PharmacyHead') {
      rejectStatus = 'PHARMACY_HEAD_REJECTED_PENDING_DTC';
      toStage = 'DTCCommittee';
    }

    let updateQuery = `UPDATE drug_requests
          SET current_stage = :toStage,
              status        = :rejectStatus,
              ${remarksCol} = :remarks,
              updated_at    = CURRENT_TIMESTAMP`;
    if (fromStage === 'HOD') {
      updateQuery += `, hod_action_timestamp = CURRENT_TIMESTAMP`;
    }
    updateQuery += ` WHERE request_id = :requestId`;

    await conn.execute(
      updateQuery,
      { toStage, rejectStatus, remarks, requestId }
    );

    await writeAudit(conn, requestId, 'REJECTED', performed_by, fromStage, toStage, remarks);

    if (fromStage === 'PharmacyHead') {
      const dtcUsers = await conn.execute(`SELECT user_id FROM users WHERE UPPER(role) IN ('DTC', 'DTCCOMMITTEE') AND is_active = 1`);
      for (const row of dtcUsers.rows) {
        await createNotification(conn, row.USER_ID, requestId,
          `Drug request #${requestId} (${dr.BRAND_NAME}) was rejected by Pharmacy Head and forwarded for your final review. Reason: ${remarks}`
        );
      }
      // Notify Doctor & HOD neutrally
      await createNotification(conn, dr.DOCTOR_ID, requestId,
        `Your drug request #${requestId} (${dr.BRAND_NAME}) has been forwarded to DTC Committee for further review.`
      );
      if (dr.HOD_ID) {
        await createNotification(conn, dr.HOD_ID, requestId,
          `Drug request #${requestId} (${dr.BRAND_NAME}) has been forwarded to DTC Committee for further review.`
        );
      }
    } else {
      // For all other stages (including PharmacistInitialReview, DTC, CEO) — notify the Doctor
      await createNotification(conn, dr.DOCTOR_ID, requestId,
        `Your drug request #${requestId} (${dr.BRAND_NAME}) has been rejected by ${STAGE_LABELS[fromStage] || fromStage}. Reason: ${remarks}`
      );
    }

    if (fromStage === 'DTCCommittee' || fromStage === 'CEO') {
      const phUsers = await conn.execute(
        `SELECT user_id FROM users WHERE UPPER(role) = 'PHARMACYHEAD' AND is_active = 1`
      );
      for (const row of phUsers.rows) {
        await createNotification(conn, row.USER_ID, requestId,
          `Drug request #${requestId} (${dr.BRAND_NAME}) was rejected by DTC Committee. Reason: ${remarks}`
        );
      }
    }
    if (fromStage === 'CEO') {
      const dtcUsers = await conn.execute(
        `SELECT user_id FROM users WHERE UPPER(role) IN ('DTC', 'DTCCOMMITTEE') AND is_active = 1`
      );
      for (const row of dtcUsers.rows) {
        await createNotification(conn, row.USER_ID, requestId,
          `Drug request #${requestId} (${dr.BRAND_NAME}) was rejected by DTC Committee. Reason: ${remarks}`
        );
      }
    }

    // Safe save of manually entered custom remarks to history
    if (customRemarks && Array.isArray(customRemarks)) {
      try {
        for (const remark of customRemarks) {
          const trimmedRemark = remark.trim();
          if (trimmedRemark === '') continue;

          // Check if same remark already exists (case-insensitive + trimmed)
          const remarkCheck = await conn.execute(
            `SELECT history_id, usage_count FROM rejection_remark_history
             WHERE LOWER(TRIM(remark_text)) = LOWER(TRIM(:remarkText))`,
            { remarkText: trimmedRemark }
          );

          if (remarkCheck.rows.length > 0) {
            const historyId = remarkCheck.rows[0].HISTORY_ID;
            await conn.execute(
              `UPDATE rejection_remark_history
               SET usage_count = usage_count + 1,
                   last_used_at = CURRENT_TIMESTAMP
               WHERE history_id = :historyId`,
              { historyId }
            );
          } else {
            await conn.execute(
              `INSERT INTO rejection_remark_history (remark_text, created_by, usage_count, last_used_at, is_active)
               VALUES (:remarkText, :createdBy, 1, CURRENT_TIMESTAMP, 1)`,
              { remarkText: trimmedRemark, createdBy: performed_by || null }
            );
          }
        }
      } catch (historyErr) {
        console.error('Failed to save rejection remark history:', historyErr);
      }
    }

    res.json({ message: 'Request rejected successfully.' });
  } catch (err) {
    console.error('PUT reject error:', err);
    res.status(500).json({ error: 'Internal server error.', detail: err.message });
  } finally {
    await conn.close();
  }
});

router.put('/:id/initial-review-approve', requireAuth, async (req, res) => {
  const conn = await getConn();
  try {
    const requestId = parseInt(req.params.id);
    const { effective_created_at, remarks, effective_drug_entries } = req.body;
    const performed_by = req.user.id; // never trust a client-supplied performer id

    const reqResult = await conn.execute(
      `SELECT dr.*, u.name AS doctor_name, u.department AS doctor_dept
       FROM drug_requests dr
       JOIN users u ON u.user_id = dr.doctor_id
       WHERE dr.request_id = :requestId`,
      { requestId }
    );
    if (!reqResult.rows.length) return res.status(404).json({ error: 'Request not found.' });

    const dr = reqResult.rows[0];
    if (dr.CURRENT_STAGE !== 'PharmacistInitialReview') {
      return res.status(400).json({ error: 'Request is not in PharmacistInitialReview stage.' });
    }

    const approverRole = getApproverRoleForStage(dr.CURRENT_STAGE);
    if (!approverRole || req.user.role !== approverRole) {
      return res.status(403).json({ error: 'You are not authorized to review this request.' });
    }
    if (dr.STATUS !== 'HOD_APPROVED' && dr.STATUS !== 'Pending') {
      return res.status(400).json({ error: 'Request is not awaiting pharmacist initial review.' });
    }

    // Parse the effective_created_at value
    let effTs = null;
    if (effective_created_at && effective_created_at.trim() !== '') {
      effTs = new Date(effective_created_at);
      if (isNaN(effTs.getTime())) {
        return res.status(400).json({ error: 'Invalid effective_created_at datetime value.' });
      }
    }

    // Validate and prepare effective drug entries datetimes if any
    const entriesToSave = [];
    if (Array.isArray(effective_drug_entries)) {
      for (const entry of effective_drug_entries) {
        let entryEffTs = null;
        if (entry.effective_created_at && typeof entry.effective_created_at === 'string' && entry.effective_created_at.trim() !== '') {
          entryEffTs = new Date(entry.effective_created_at);
          if (isNaN(entryEffTs.getTime())) {
            return res.status(400).json({ error: `Invalid datetime value for drug: ${entry.drug_name}` });
          }
        }
        // Save the full entry structure inside the remarks JSON
        const remarksJson = JSON.stringify(entry);
        entriesToSave.push({
          drug_name: entry.drug_name || '',
          effective_created_at: entryEffTs,
          remarksJson: remarksJson
        });
      }
    }

    const toStage = 'PharmacyHead';
    const newStatus = 'Pending';

    // Build update — set effective_created_at only if provided, else default to created_at
    let updateQuery = '';
    let updateBinds = {
      toStage,
      newStatus,
      remarks: remarks || null,
      requestId
    };

    if (effTs) {
      updateQuery = `UPDATE drug_requests
         SET current_stage          = :toStage,
             status                 = :newStatus,
             pharmacist_remarks     = :remarks,
             effective_created_at   = :effTs,
             updated_at             = CURRENT_TIMESTAMP
       WHERE request_id = :requestId`;
      updateBinds.effTs = effTs;
    } else {
      updateQuery = `UPDATE drug_requests
         SET current_stage          = :toStage,
             status                 = :newStatus,
             pharmacist_remarks     = :remarks,
             effective_created_at   = created_at,
             updated_at             = CURRENT_TIMESTAMP
       WHERE request_id = :requestId`;
    }

    await conn.execute(updateQuery, updateBinds);

    // Save drug effective entries
    await conn.execute(
      `DELETE FROM drug_effective_entries WHERE request_id = :requestId`,
      { requestId }
    );

    for (const entry of entriesToSave) {
      await conn.execute(
        `INSERT INTO drug_effective_entries (
          request_id, drug_name, effective_created_at, remarks, created_by
        ) VALUES (
          :requestId, :drugName, :effectiveCreatedAt, :remarks, :createdBy
        )`,
        {
          requestId,
          drugName: entry.drug_name || null,
          effectiveCreatedAt: entry.effective_created_at,
          remarks: entry.remarksJson || null,
          createdBy: performed_by
        }
      );
    }

    await writeAudit(conn, requestId, 'INITIAL_REVIEW_APPROVED', performed_by, 'PharmacistInitialReview', toStage, remarks);

    // Notify PharmacyHead users
    const phUsers = await conn.execute(
      `SELECT user_id FROM users WHERE UPPER(role) = 'PHARMACYHEAD' AND is_active = 1`
    );
    for (const row of phUsers.rows) {
      await createNotification(conn, row.USER_ID, requestId,
        `Drug request #${requestId} (${dr.BRAND_NAME}) has passed Pharmacist Initial Review and is awaiting your approval.`
      );
    }

    // Notify Doctor that request has moved forward (neutral DTC-review message)
    await createNotification(conn, dr.DOCTOR_ID, requestId,
      `Your drug request #${requestId} (${dr.BRAND_NAME}) is currently under DTC review.`
    );

    res.json({
      message: `Request #${requestId} approved by Pharmacist Initial Review and forwarded to Pharmacy Head.`,
      new_stage: toStage,
      new_status: newStatus
    });
  } catch (err) {
    console.error('PUT /initial-review-approve error:', err);
    res.status(500).json({ error: 'Internal server error.', detail: err.message });
  } finally {
    await conn.close();
  }
});

router.post('/pharmacist', requireRole(ROLES.PHARMACIST), async (req, res) => {
  const conn = await getConn();
  try {
    const {
      doctor_id, request_type, category,
      brand_name, generic_name, dose_strength, dosage_form,
      manufacturer, marketer, existing_brands,
      clinical_justification, medicine_quantity, ai_content
    } = req.body;

    let formatai = ai_content ? ai_content.replace(/\n/g, '<br>') : '';

    const baseRequired = {
      doctor_id, category, brand_name, generic_name,
      dose_strength, dosage_form, manufacturer, marketer,
      clinical_justification
    };
    for (const [key, val] of Object.entries(baseRequired)) {
      if (val === undefined || val === null || String(val).trim() === '') {
        return res.status(400).json({ error: `Field '${key}' is required.` });
      }
    }

    // -- Blacklist validation --
    const blCheckP = await conn.execute(
      `SELECT company_type, remarks FROM blacklisted_companies
       WHERE is_active = 1
         AND (
           (company_type = 'MANUFACTURER' AND UPPER(TRIM(company_name)) = UPPER(TRIM(:mfg)))
           OR
           (company_type = 'MARKETER' AND UPPER(TRIM(company_name)) = UPPER(TRIM(:mkt)))
         )
       FETCH FIRST 1 ROW ONLY`,
      { mfg: manufacturer || '', mkt: marketer || '' }
    );
    if (blCheckP.rows.length > 0) {
      const blRow = blCheckP.rows[0];
      const blType = blRow.COMPANY_TYPE === 'MANUFACTURER' ? 'Manufacturer' : 'Marketer';
      return res.status(400).json({
        success: false,
        error: `Request denied. ${blType} is blacklisted by DTC.`,
        remarks: blRow.REMARKS || ''
      });
    }

    const insertQuery = `
      INSERT INTO drug_requests (
        doctor_id, request_source_type, request_type, category,
        brand_name, generic_name, dose_strength, dosage_form,
        manufacturer, marketer, existing_brands,
        clinical_justification, ai_content, expected_patients_pm, cost_reduction_benefit,
        medicine_quantity,
        current_stage, status, created_by_role, created_by_user_id
      ) VALUES (
        :doctorId, 'PHARMACIST', 'New Molecule', :category,
        :brandName, :genericName, :doseStrength, :dosageForm,
        :manufacturer, :marketer, :existingBrands,
        :clinicalJustification, :aiContent, 0, 0,
        :medicineQuantity,
        'PharmacyHead', 'Pending', 'Pharmacist', :doctorId
      ) RETURNING request_id INTO :reqId
    `;

    const binds = {
      doctorId: doctor_id,
      category,
      brandName: brand_name,
      genericName: generic_name,
      doseStrength: dose_strength,
      dosageForm: dosage_form,
      manufacturer,
      marketer,
      existingBrands: existing_brands || null,
      clinicalJustification: clinical_justification,
      aiContent: formatai,
      medicineQuantity: medicine_quantity ? Number(medicine_quantity) : null,
      reqId: { type: oracledb.NUMBER, dir: oracledb.BIND_OUT }
    };

    const result = await conn.execute(insertQuery, binds, { autoCommit: false });
    const reqId = result.outBinds.reqId[0];

    await writeAudit(conn, reqId, 'SUBMITTED', req.user.id, null, 'PharmacyHead', 'Pharmacist direct request submitted.');
    await conn.commit();

    // Notify PharmacyHead
    const phUsers = await conn.execute(`SELECT user_id FROM users WHERE UPPER(role) = 'PHARMACYHEAD' AND is_active = 1`);
    for (const row of phUsers.rows) {
      await createNotification(conn, row.USER_ID, reqId, `💊 New Pharmacist Direct drug request #${reqId} (${brand_name}) requires your review.`);
    }

    res.status(201).json({ message: 'Request submitted successfully.', request_id: reqId });
  } catch (err) {
    console.error('POST pharmacist request error:', err);
    res.status(500).json({ error: 'Internal server error.', detail: err.message });
  } finally {
    await conn.close();
  }
});

router.post('/emergency', requireAuth, async (req, res) => {
  const {
    doctor_id, request_type, category, brand_name, generic_name,
    dose_strength, dosage_form, manufacturer, marketer,
    existing_brands, clinical_justification, ai_content,
    request_source_type
  } = req.body;

  if (![ROLES.DOCTOR, ROLES.HOD].includes(req.user.role)) {
    return res.status(403).json({ error: 'Only doctors and HODs can submit emergency requests.' });
  }
  if (req.user.id !== Number(doctor_id)) {
    return res.status(403).json({ error: 'You can only submit requests as yourself.' });
  }

  const conn = await getConn();
  try {
    const required = {
      doctor_id, request_type, category, brand_name, generic_name, dose_strength,
      dosage_form, manufacturer, marketer, clinical_justification
    };
    for (const [k, v] of Object.entries(required)) {
      if (v === undefined || v === null || v === '') {
        return res.status(400).json({ error: `Field '${k}' is required.` });
      }
    }

    // -- Blacklist validation --
    const blCheckE = await conn.execute(
      `SELECT company_type, remarks FROM blacklisted_companies
       WHERE is_active = 1
         AND (
           (company_type = 'MANUFACTURER' AND UPPER(TRIM(company_name)) = UPPER(TRIM(:mfg)))
           OR
           (company_type = 'MARKETER' AND UPPER(TRIM(company_name)) = UPPER(TRIM(:mkt)))
         )
       FETCH FIRST 1 ROW ONLY`,
      { mfg: manufacturer || '', mkt: marketer || '' }
    );
    if (blCheckE.rows.length > 0) {
      const blRow = blCheckE.rows[0];
      const blType = blRow.COMPANY_TYPE === 'MANUFACTURER' ? 'Manufacturer' : 'Marketer';
      return res.status(400).json({
        success: false,
        error: `Request denied. ${blType} is blacklisted by DTC.`,
        remarks: blRow.REMARKS || ''
      });
    }

    const sourceType = (request_source_type || 'NON_PROMOTIONAL').toUpperCase();

    // Fetch creator role & department
    const creatorRes = await conn.execute(`SELECT role, department FROM users WHERE user_id = :id`, { id: doctor_id });
    if (creatorRes.rows.length === 0) return res.status(400).json({ error: 'User not found.' });
    const creatorRole = creatorRes.rows[0].ROLE;
    const creatorDept = creatorRes.rows[0].DEPARTMENT;

    let hodId = null;
    if (creatorRole && creatorRole.toLowerCase() === ROLES.DOCTOR) {
      if (creatorDept && creatorDept.trim() !== '') {
        const hodRes = await conn.execute(
          `SELECT user_id FROM users WHERE UPPER(role) = 'HOD' AND UPPER(TRIM(department)) = UPPER(TRIM(:dept)) AND is_active = 1`,
          { dept: creatorDept.trim() }
        );
        if (hodRes.rows.length > 0) hodId = hodRes.rows[0].USER_ID;
      }
    }

    const insertResult = await conn.execute(
      `INSERT INTO drug_requests (
         doctor_id, created_by_user_id, created_by_role, hod_id,
         med_rep_name, med_rep_email, med_rep_phone,
         request_type, category, request_source_type,
         brand_name, generic_name, dose_strength, dosage_form,
         manufacturer, marketer, existing_brands, clinical_justification,
         expected_patients_pm, cost_reduction_benefit, medicine_quantity, ai_content,
         status, current_stage, is_emergency
       ) VALUES (
         :doctor_id, :doctor_id, :created_by_role, :hod_id,
         NULL, NULL, NULL,
         :request_type, :category, :request_source_type,
         :brand_name, :generic_name, :dose_strength, :dosage_form,
         :manufacturer, :marketer, :existing_brands, :clinical_justification,
         NULL, 0, NULL, :ai_content,
         'EMERGENCY_PENDING_DTC', 'EmergencyDTC', 1
       ) RETURNING request_id INTO :request_id`,
      {
        doctor_id,
        created_by_role: creatorRole,
        hod_id: hodId,
        request_type, category,
        request_source_type: sourceType,
        brand_name, generic_name, dose_strength, dosage_form,
        manufacturer, marketer, existing_brands: existing_brands || null,
        clinical_justification,
        ai_content: ai_content || null,
        request_id: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER }
      }
    );
    const requestId = insertResult.outBinds.request_id[0];
    await writeAudit(conn, requestId, 'EMERGENCY_SUBMITTED', req.user.id, null, 'EmergencyDTC', `Source: ${sourceType}`);

    // Notify DTC (decision makers), PH + Pharmacist (view-only awareness)
    const notifyUsers = await conn.execute(
      `SELECT user_id, role FROM users WHERE UPPER(role) IN ('DTC','DTCCOMMITTEE','PHARMACYHEAD','PHARMACIST') AND is_active = 1`
    );
    for (const row of notifyUsers.rows) {
      const roleUpper = (row.ROLE || '').toUpperCase();
      const msg = (roleUpper === 'DTC' || roleUpper === 'DTCCOMMITTEE')
        ? `🚨 EMERGENCY request #${requestId} (${brand_name}) submitted. Requires your IMMEDIATE decision.`
        : `🚨 EMERGENCY request #${requestId} (${brand_name}) submitted. You have view-only access.`;
      await createNotification(conn, row.USER_ID, requestId, msg);
    }
    res.status(201).json({ message: 'Emergency drug request submitted.', request_id: requestId });
  } catch (err) {
    console.error('POST /api/requests/emergency error:', err);
    res.status(500).json({ error: 'Internal server error.', detail: err.message });
  } finally {
    await conn.close();
  }
});

router.post('/:id/place_order', requireRole(ROLES.PHARMACIST), async (req, res) => {
  const conn = await getConn();
  try {
    const requestId = parseInt(req.params.id);
    const performed_by = req.user.id; // never trust a client-supplied performer id

    const reqResult = await conn.execute(
      `SELECT status FROM drug_requests WHERE request_id = :requestId`, { requestId }
    );
    if (!reqResult.rows.length) return res.status(404).json({ error: 'Request not found.' });
    const currentStatus = reqResult.rows[0].STATUS;
    if (currentStatus !== 'EMERGENCY_APPROVED' && currentStatus !== 'APPROVED_PENDING_ORDER') {
      return res.status(400).json({ error: 'Only approved requests can be ordered.' });
    }

    await conn.execute(
      `UPDATE drug_requests SET status = 'ORDER_PLACED', current_stage = 'OrderPlaced', updated_at = CURRENT_TIMESTAMP WHERE request_id = :requestId`,
      { requestId }
    );
    await writeAudit(conn, requestId, 'ORDER_PLACED', performed_by, 'PharmacistOrder', 'OrderPlaced', 'Drug order placed');
    res.json({ message: 'Order placed successfully.' });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error.' });
  } finally {
    await conn.close();
  }
});

router.put('/:id/mark-inventory-added', requireRole(ROLES.PHARMACIST), async (req, res) => {
  const conn = await getConn();
  try {
    const requestId = parseInt(req.params.id);
    const { inventory_item_name } = req.body;
    const performed_by = req.user.id; // never trust a client-supplied performer id

    if (!requestId) return res.status(400).json({ error: 'Request ID required.' });

    const reqResult = await conn.execute(
      `SELECT status, current_stage FROM drug_requests WHERE request_id = :requestId`,
      { requestId }
    );
    if (!reqResult.rows.length) return res.status(404).json({ error: 'Request not found.' });

    await conn.execute(
      `UPDATE drug_requests
         SET inventory_added     = 1,
             inventory_added_at  = CURRENT_TIMESTAMP,
             inventory_added_by  = :performedBy,
             inventory_item_name = :itemName,
             updated_at          = CURRENT_TIMESTAMP
       WHERE request_id = :requestId`,
      {
        performedBy: performed_by || null,
        itemName: inventory_item_name || null,
        requestId
      }
    );

    await writeAudit(
      conn, requestId, 'INVENTORY_ADDED', performed_by,
      'PharmacistOrder', reqResult.rows[0].CURRENT_STAGE,
      `Drug added to HIS inventory: ${inventory_item_name || 'unknown'}`
    );

    res.json({ success: true, message: 'Request marked as inventory-added.' });
  } catch (err) {
    console.error('PUT /api/requests/:id/mark-inventory-added error:', err);
    res.status(500).json({ error: 'Internal server error.', detail: err.message });
  } finally {
    try { await conn.close(); } catch (e) { }
  }
});

router.post('/:requestId/mark-inventory-received', requireRole(ROLES.PHARMACIST), async (req, res) => {
  const conn = await getConn();
  try {
    const requestId = parseInt(req.params.requestId);
    const performed_by = req.user.id; // never trust a client-supplied performer id

    if (!requestId) return res.status(400).json({ error: 'Request ID required.' });

    const reqResult = await conn.execute(
      `SELECT r.*, u.name AS doctor_name, u.department AS doctor_dept
       FROM drug_requests r
       JOIN users u ON u.user_id = r.doctor_id
       WHERE r.request_id = :requestId`,
      { requestId }
    );
    if (!reqResult.rows.length) return res.status(404).json({ error: 'Request not found.' });

    const dr = reqResult.rows[0];

    if (dr.STATUS !== 'ORDER_PLACED') {
      return res.status(400).json({
        error: 'Inventory can only be marked as received after the purchase order has been placed.'
      });
    }

    await conn.execute(
      `UPDATE drug_requests
          SET status = 'INVENTORY_RECEIVED',
              current_stage = 'Completed',
              inventory_received = 1,
              inventory_received_at = CURRENT_TIMESTAMP,
              inventory_received_by = :performedBy,
              updated_at = CURRENT_TIMESTAMP
       WHERE request_id = :requestId`,
      {
        performedBy: performed_by || null,
        requestId
      }
    );

    await writeAudit(
      conn, requestId, 'INVENTORY_RECEIVED', performed_by,
      dr.CURRENT_STAGE, 'Completed',
      `Drug order received and stocked`
    );

    // Create notifications
    const brandName = dr.FINAL_SELECTED_BRAND || dr.BRAND_NAME;
    const msg = `✅ Ordered drug "${brandName}" for Request #${requestId} has been received and stocked. The workflow is now completed.`;

    // 1. Notify doctor
    await createNotification(conn, dr.DOCTOR_ID, requestId, msg);

    // 2. Notify HOD if present
    if (dr.HOD_ID) {
      await createNotification(conn, dr.HOD_ID, requestId, msg);
    }

    // 3. Notify CEO
    const ceoUsers = await conn.execute(
      `SELECT user_id FROM users WHERE UPPER(role) = 'CEO' AND is_active = 1`
    );
    for (const row of ceoUsers.rows) {
      await createNotification(conn, row.USER_ID, requestId, msg);
    }

    // 4. Notify Pharmacists
    const pharmUsers = await conn.execute(
      `SELECT user_id FROM users WHERE UPPER(role) = 'PHARMACIST' AND is_active = 1`
    );
    for (const row of pharmUsers.rows) {
      await createNotification(conn, row.USER_ID, requestId, msg);
    }

    res.json({ success: true, message: 'Request marked as inventory received.' });
  } catch (err) {
    console.error('POST /api/requests/:requestId/mark-inventory-received error:', err);
    res.status(500).json({ error: 'Internal server error.', detail: err.message });
  } finally {
    try { await conn.close(); } catch (e) { }
  }
});

router.put('/:id/revert-to-pharmacist', requireRole(ROLES.PHARMACY_HEAD), async (req, res) => {
  const conn = await getConn();
  try {
    const requestId = parseInt(req.params.id);
    const { remarks } = req.body;
    const performed_by = req.user.id; // never trust a client-supplied performer id

    if (!remarks || remarks.trim() === '') {
      return res.status(400).json({ error: 'Revert remarks are mandatory.' });
    }

    const reqResult = await conn.execute(
      `SELECT dr.*, u.name AS doctor_name FROM drug_requests dr
       JOIN users u ON u.user_id = dr.doctor_id
       WHERE dr.request_id = :requestId`,
      { requestId }
    );
    if (!reqResult.rows.length) return res.status(404).json({ error: 'Request not found.' });

    const dr = reqResult.rows[0];
    if (dr.CURRENT_STAGE !== 'PharmacyHeadReview2') {
      return res.status(400).json({ error: 'Revert is only allowed during Pharmacy Head Review 2 stage.' });
    }

    await conn.execute(
      `UPDATE drug_requests
       SET current_stage    = 'PharmacistCorrection',
           status           = 'REVERTED_FOR_CORRECTION',
           is_reverted      = 1,
           revert_count     = NVL(revert_count, 0) + 1,
           revert_remarks   = :remarks,
           reverted_by      = :performed_by,
           reverted_at      = CURRENT_TIMESTAMP,
           updated_at       = CURRENT_TIMESTAMP
       WHERE request_id = :requestId`,
      { remarks, performed_by, requestId }
    );

    await writeAudit(conn, requestId, 'REVERTED_TO_PHARMACIST', performed_by,
      'PharmacyHeadReview2', 'PharmacistCorrection', remarks);

    // Notify all Pharmacist users
    const pharmUsers = await conn.execute(
      `SELECT user_id FROM users WHERE UPPER(role) = 'PHARMACIST' AND is_active = 1`
    );
    for (const row of pharmUsers.rows) {
      await createNotification(conn, row.USER_ID, requestId,
        `⚠️ Comparison sheet for Request #${requestId} (${dr.BRAND_NAME}) has been reverted by Pharmacy Head for correction. Reason: ${remarks.substring(0, 200)}`
      );
    }

    // Doctor is not notified about internal pharmacist correction loop

    res.json({
      message: `Request #${requestId} reverted to Pharmacist for correction.`,
      new_stage: 'PharmacistCorrection',
      new_status: 'REVERTED_FOR_CORRECTION'
    });
  } catch (err) {
    console.error('PUT revert-to-pharmacist error:', err);
    res.status(500).json({ error: 'Internal server error.', detail: err.message });
  } finally {
    await conn.close();
  }
});

router.put('/:id/resubmit-correction', requireRole(ROLES.PHARMACIST), async (req, res) => {
  const conn = await getConn();
  try {
    const requestId = parseInt(req.params.id);
    const {
      alternatives,
      remarks,
      comparison_type,
      existing_generic_data
    } = req.body;
    const performed_by = req.user.id; // never trust a client-supplied performer id

    const reqResult = await conn.execute(
      `SELECT dr.*, u.name AS doctor_name FROM drug_requests dr
       JOIN users u ON u.user_id = dr.doctor_id
       WHERE dr.request_id = :requestId`,
      { requestId }
    );
    if (!reqResult.rows.length) return res.status(404).json({ error: 'Request not found.' });

    const dr = reqResult.rows[0];
    if (dr.CURRENT_STAGE !== 'PharmacistCorrection') {
      return res.status(400).json({ error: 'Resubmit is only allowed from Pharmacist Correction stage.' });
    }

    // Save corrected alternatives if provided
    if (alternatives && alternatives.length > 0) {
      await conn.execute(
        `DELETE FROM drug_alternatives WHERE request_id = :requestId`,
        { requestId }
      );
      for (const alt of alternatives) {
        const d = computeAltDerived(alt);
        await conn.execute(
          `INSERT INTO drug_alternatives (
             request_id, brand_name, manufacturer, marketer,
             mrp_per_pack, rate_per_pack, gst_percent,
             mrp, rate, qty, offer,
             markup_margin, net_rate, absolute_margin,
             negotiated_rate, profit_margin,
             stock, purchase_quantity,
             consultant, sale_qty, pack, introduced_on,
             comparison_type, remark, submitted_by
           ) VALUES (
             :request_id, :brand_name, :manufacturer, :marketer,
             :mrp_per_pack, :rate_per_pack, :gst_percent,
             :mrp, :rate, :qty, :offer,
             :markup_margin, :net_rate, :absolute_margin,
             :negotiated_rate, :profit_margin,
             :stock, :purchase_quantity,
             :consultant, :sale_qty, :pack, :introduced_on,
             :comparison_type, :remark, :submitted_by
           )`,
          {
            request_id: requestId,
            brand_name: alt.brand_name || null,
            manufacturer: alt.manufacturer || null,
            marketer: alt.marketer || null,
            mrp_per_pack: parseFloat(alt.mrp_per_pack) || null,
            rate_per_pack: parseFloat(alt.rate_per_pack) || null,
            gst_percent: parseFloat(alt.gst_percent) || null,
            mrp: d.mrp || null,
            rate: d.rate || null,
            qty: parseFloat(alt.qty) || null,
            offer: parseFloat(alt.offer) || null,
            markup_margin: d.markup_margin || null,
            net_rate: d.net_rate || null,
            absolute_margin: d.absolute_margin || null,
            negotiated_rate: parseFloat(alt.negorate) || null,
            profit_margin: d.profit_margin || null,
            stock: alt.stock || null,
            purchase_quantity: parseFloat(alt.purchase_qty) || null,
            consultant: alt.consultant || null,
            sale_qty: parseFloat(alt.sale_qty) || null,
            pack: alt.pack || null,
            introduced_on: alt.introduced_on || 'New Item',
            comparison_type: comparison_type || 'new_generic',
            remark: alt.remark || null,
            submitted_by: performed_by
          }
        );
      }
    }

    // Build the UPDATE statement with optional pharmacist_remarks and existing_generic_data
    const egdJson = existing_generic_data ? JSON.stringify(existing_generic_data) : null;
    await conn.execute(
      `UPDATE drug_requests
       SET current_stage         = 'PharmacyHeadReview2',
           status                = 'Pending',
           is_reverted           = 0,
           revert_remarks        = NULL,
           pharmacist_remarks    = CASE WHEN :remarks IS NOT NULL THEN :remarks ELSE pharmacist_remarks END,
           existing_generic_data = CASE WHEN :egd IS NOT NULL THEN TO_CLOB(:egd) ELSE existing_generic_data END,
           last_corrected_at     = CURRENT_TIMESTAMP,
           last_corrected_by     = :performed_by,
           updated_at            = CURRENT_TIMESTAMP
       WHERE request_id = :requestId`,
      { remarks: remarks || null, egd: egdJson, performed_by, requestId }
    );

    // Clean up analysis drafts for this pharmacist + request
    await conn.execute(
      `DELETE FROM analysis_drafts
       WHERE request_id = :requestId AND pharmacist_id = :pid AND status = 'DRAFT'`,
      { requestId, pid: performed_by }
    );

    await writeAudit(conn, requestId, 'CORRECTION_RESUBMITTED', performed_by,
      'PharmacistCorrection', 'PharmacyHeadReview2',
      remarks || `Corrected comparison sheet resubmitted (revert #${dr.REVERT_COUNT || 1})`);

    // Notify all PharmacyHead users
    const phUsers = await conn.execute(
      `SELECT user_id FROM users WHERE UPPER(role) = 'PHARMACYHEAD' AND is_active = 1`
    );
    for (const row of phUsers.rows) {
      await createNotification(conn, row.USER_ID, requestId,
        `✅ Corrected comparison sheet for Request #${requestId} (${dr.BRAND_NAME}) has been resubmitted by Pharmacist. Please review.`
      );
    }

    res.json({
      message: `Corrected comparison sheet for Request #${requestId} resubmitted to Pharmacy Head.`,
      new_stage: 'PharmacyHeadReview2',
      new_status: 'Pending'
    });
  } catch (err) {
    console.error('PUT resubmit-correction error:', err);
    res.status(500).json({ error: 'Internal server error.', detail: err.message });
  } finally {
    await conn.close();
  }
});


export default router;
