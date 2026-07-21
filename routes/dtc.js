// DTC (Drugs & Therapeutics Committee) management routes — moved out
// of server.js unchanged, mounted at /api/dtc. All restricted to
// dtc/dtccommittee (or admin) per requireRole.

import express from 'express';
import { getConn } from '../db/pool.js';
import { requireRole } from '../middleware/requireAuth.js';
import { writeAudit, createNotification, saveApprovalRemarks } from '../utils/auditHelpers.js';

const router = express.Router();

router.get('/user-quotas', requireRole('dtc', 'dtccommittee'), async (req, res) => {
  const conn = await getConn();
  try {
    const usersRes = await conn.execute(
      `SELECT user_id, name, email, role, department FROM users
       WHERE LOWER(role) IN ('doctor', 'hod') AND is_active = 1`
    );
    const users = usersRes.rows;

    for (const u of users) {
      const quotaCheck = await conn.execute(
        `SELECT COUNT(*) AS cnt FROM user_request_quotas WHERE user_id = :userId`,
        { userId: u.USER_ID }
      );
      if (quotaCheck.rows[0].CNT === 0) {
        await conn.execute(
          `INSERT INTO user_request_quotas (user_id, quarterly_limit, updated_by)
           VALUES (:userId, 10, :updatedBy)`,
          { userId: u.USER_ID, updatedBy: u.USER_ID },
          { autoCommit: true }
        );
      }
    }

    const result = await conn.execute(
      `SELECT
         u.user_id,
         u.name,
         u.email,
         u.role,
         u.department,
         q.quarterly_limit,
         (
           SELECT COUNT(*) FROM drug_requests dr
           WHERE dr.created_by_user_id = u.user_id
             AND dr.created_at >= TRUNC(SYSDATE, 'Q')
             AND dr.created_at <  ADD_MONTHS(TRUNC(SYSDATE, 'Q'), 3)
         ) AS used_this_quarter
       FROM users u
       JOIN user_request_quotas q ON q.user_id = u.user_id
       WHERE LOWER(u.role) IN ('doctor', 'hod') AND u.is_active = 1
       ORDER BY u.name`
    );

    const quotas = result.rows.map(r => {
      const limit = r.QUARTERLY_LIMIT;
      const used = r.USED_THIS_QUARTER;
      return {
        user_id: r.USER_ID,
        name: r.NAME,
        email: r.EMAIL,
        role: r.ROLE,
        department: r.DEPARTMENT,
        quarterly_limit: limit,
        used_this_quarter: used,
        remaining_quota: Math.max(0, limit - used)
      };
    });

    res.json(quotas);
  } catch (err) {
    console.error('GET /api/dtc/user-quotas error:', err);
    res.status(500).json({ error: 'Internal server error.', detail: err.message });
  } finally {
    await conn.close();
  }
});

router.put('/user-quotas/:userId', requireRole('dtc', 'dtccommittee'), async (req, res) => {
  const conn = await getConn();
  try {
    const userId = parseInt(req.params.userId);
    const { quarterly_limit, performed_by } = req.body;

    if (quarterly_limit === undefined || quarterly_limit === null || isNaN(Number(quarterly_limit)) || Number(quarterly_limit) < 0) {
      return res.status(400).json({ error: 'Limit must be a non-negative number.' });
    }

    const perfRes = await conn.execute(
      `SELECT role FROM users WHERE user_id = :performedBy AND is_active = 1`,
      { performedBy: performed_by }
    );
    if (!perfRes.rows.length) {
      return res.status(403).json({ error: 'Performing user not found or inactive.' });
    }
    const perfRole = perfRes.rows[0].ROLE ? perfRes.rows[0].ROLE.toLowerCase() : '';
    if (perfRole !== 'dtc' && perfRole !== 'dtccommittee') {
      return res.status(403).json({ error: 'Unauthorized. Only DTC members can modify request quotas.' });
    }

    const userRes = await conn.execute(
      `SELECT role FROM users WHERE user_id = :userId AND is_active = 1`,
      { userId }
    );
    if (!userRes.rows.length) {
      return res.status(404).json({ error: 'Target user not found or inactive.' });
    }
    const targetRole = userRes.rows[0].ROLE ? userRes.rows[0].ROLE.toLowerCase() : '';
    if (targetRole !== 'doctor' && targetRole !== 'hod') {
      return res.status(400).json({ error: 'Quotas can only be assigned to Doctors or HODs.' });
    }

    const qCheck = await conn.execute(
      `SELECT COUNT(*) AS cnt FROM user_request_quotas WHERE user_id = :userId`,
      { userId }
    );
    if (qCheck.rows[0].CNT > 0) {
      await conn.execute(
        `UPDATE user_request_quotas
         SET quarterly_limit = :limit, updated_by = :updatedBy, updated_at = CURRENT_TIMESTAMP
         WHERE user_id = :userId`,
        { limit: Number(quarterly_limit), updatedBy: performed_by, userId },
        { autoCommit: true }
      );
    } else {
      await conn.execute(
        `INSERT INTO user_request_quotas (user_id, quarterly_limit, updated_by)
         VALUES (:userId, :limit, :updatedBy)`,
        { userId, limit: Number(quarterly_limit), updatedBy: performed_by },
        { autoCommit: true }
      );
    }

    res.json({ success: true, message: 'Quota updated successfully.' });
  } catch (err) {
    console.error('PUT /api/dtc/user-quotas/:userId error:', err);
    res.status(500).json({ error: 'Internal server error.', detail: err.message });
  } finally {
    await conn.close();
  }
});

router.post('/final-select/:requestId', requireRole('dtc', 'dtccommittee'), async (req, res) => {
  const conn = await getConn();
  try {
    const requestId = parseInt(req.params.requestId);
    const {
      recommendations,
      selected_alternative_id,
      selection_type,
      remarks,
      dtc_selected_brand,
      dtc_selected_category,
      dtc_selection_reasons,
      dtc_recommendation_notes,
      dtc_reviewed_by_name,
      dtc_review_signature,
      dtc_remarks,
      alternatives: altRows,
      existing_details: existingRows
    } = req.body;
    const performed_by = req.user.id; // never trust a client-supplied performer id

    const reqResult = await conn.execute(
      `SELECT dr.*, u.name AS doctor_name
       FROM drug_requests dr
       JOIN users u ON u.user_id = dr.doctor_id
       WHERE dr.request_id = :requestId`,
      { requestId }
    );
    if (!reqResult.rows.length) return res.status(404).json({ error: 'Request not found.' });
    const dr = reqResult.rows[0];

    if (dr.CURRENT_STAGE !== 'DTCFinal') {
      return res.status(400).json({ error: 'Final drug selection is only allowed at DTCFinal stage.' });
    }

    // Reset all alternatives to not-selected
    await conn.execute(
      `UPDATE drug_alternatives SET is_final_selected = 0 WHERE request_id = :requestId`,
      { requestId }
    );

    let recs = recommendations;
    if (!recs || !Array.isArray(recs)) {
      // Build synthesized recommendation for legacy API callers
      let selectedName = dr.BRAND_NAME;
      if (selection_type === 'alternative' && selected_alternative_id) {
        const altCheck = await conn.execute(
          `SELECT * FROM drug_alternatives WHERE alt_id = :altId AND request_id = :requestId`,
          { altId: selected_alternative_id, requestId }
        );
        if (altCheck.rows.length) {
          selectedName = altCheck.rows[0].BRAND_NAME;
        }
      }
      recs = [{
        brand_name: dtc_selected_brand || selectedName,
        category: dtc_selected_category || 'Formulary',
        reasons: dtc_selection_reasons || ['DTC Approved'],
        is_original: selection_type === 'original' || (!selected_alternative_id && selection_type !== 'alternative'),
        alternative_id: selection_type === 'alternative' ? selected_alternative_id : null
      }];
    }

    const selectedAltIds = recs
      .filter(rec => !rec.is_original && rec.alternative_id)
      .map(rec => rec.alternative_id);

    for (const altId of selectedAltIds) {
      await conn.execute(
        `UPDATE drug_alternatives SET is_final_selected = 1 WHERE alt_id = :altId AND request_id = :requestId`,
        { altId, requestId }
      );
    }

    const selectedBrandsList = recs && recs.length > 0
      ? recs.map(rec => rec.brand_name).join(', ')
      : 'DTC Reviewed';
    const hasFormulary = recs.some(rec => rec.category === 'FORMULARY');
    const aggregatedCategory = hasFormulary ? 'FORMULARY' : (recs[0]?.category || 'NON_FORMULARY');

    const allReasonsSet = new Set();
    recs.forEach(rec => {
      if (Array.isArray(rec.reasons)) {
        rec.reasons.forEach(r => allReasonsSet.add(r));
      }
    });
    const mergedReasons = Array.from(allReasonsSet);
    const selectionReasonsJson = JSON.stringify(mergedReasons);

    const finalNotes = (recs && recs.length > 0)
      ? recs.map(r => `${r.brand_name}: [Notes: ${r.notes || '—'}][Remarks: ${r.remarks || '—'}]`).join(' | ')
      : (dtc_recommendation_notes || remarks || null);
    const recommendationsJson = JSON.stringify(recs);

    const firstAlt = recs.find(rec => !rec.is_original && rec.alternative_id);
    const finalAltId = firstAlt ? firstAlt.alternative_id : null;

    // Store the selection details on the request
    await conn.execute(
      `UPDATE drug_requests
         SET final_selected_alternative_id = :altId,
             dtc_final_selection_notes     = :notes,
             dtc_final_remarks             = :dtcRemarks,
             dtc_remarks                   = :dtcRemarks,
             dtc_selected_brand            = :selectedBrand,
             dtc_selected_category         = :selectedCategory,
             dtc_selection_reasons         = :selectionReasons,
             dtc_recommendation_notes      = :recNotes,
             dtc_reviewed_by               = :reviewedBy,
             dtc_reviewed_at               = CURRENT_TIMESTAMP,
             current_stage                 = 'CEO',
             status                        = 'Pending',
             updated_at                    = CURRENT_TIMESTAMP,
             dtc_reviewed_by_name          = :reviewedByName,
             dtc_review_signature          = :reviewSignature,
             final_selected_brand          = :finalSelectedBrand,
             final_selected_category       = :finalSelectedCategory,
             final_selection_reasons       = :finalSelectionReasons,
             final_recommendation_notes    = :finalRecNotes,
             dtc_final_recommendations     = :dtcFinalRecs
       WHERE request_id = :requestId`,
      {
        altId: finalAltId,
        notes: finalNotes,
        dtcRemarks: dtc_remarks || finalNotes || null,
        selectedBrand: selectedBrandsList,
        selectedCategory: aggregatedCategory,
        selectionReasons: selectionReasonsJson,
        recNotes: finalNotes,
        reviewedBy: performed_by,
        reviewedByName: dtc_reviewed_by_name || null,
        reviewSignature: dtc_review_signature || null,
        finalSelectedBrand: selectedBrandsList,
        finalSelectedCategory: aggregatedCategory,
        finalSelectionReasons: selectionReasonsJson,
        finalRecNotes: finalNotes,
        dtcFinalRecs: recommendationsJson,
        requestId
      }
    );

    // ── Persist DTC-set row-level remarks on alternatives ──────────────────
    if (Array.isArray(altRows) && altRows.length > 0) {
      for (const alt of altRows) {
        const altId = alt.alt_id || alt.ALT_ID;
        const altRemark = alt.remark ?? alt.REMARK ?? null;
        const altNegRemark = alt.negotiation_remarks ?? alt.NEGOTIATION_REMARKS ?? null;

        if (altId) {
          // Update remark on drug_alternatives
          if (altRemark !== null && altRemark !== undefined) {
            await conn.execute(
              `UPDATE drug_alternatives SET remark = :remark WHERE alt_id = :altId AND request_id = :requestId`,
              { remark: String(altRemark), altId, requestId }
            );
          }
          // Update negotiation_remarks on drug_alternative_negotiations (Insert if not exists)
          if (altNegRemark !== null && altNegRemark !== undefined) {
            const checkNeg = await conn.execute(
              `SELECT COUNT(*) AS cnt FROM drug_alternative_negotiations WHERE alternative_id = :altId`,
              { altId }
            );
            if (checkNeg.rows[0].CNT > 0) {
              await conn.execute(
                `UPDATE drug_alternative_negotiations SET negotiation_remarks = :negRemark WHERE alternative_id = :altId`,
                { negRemark: String(altNegRemark), altId }
              );
            } else {
              // Fetch the original alternative row to copy default values for required columns
              const altRow = await conn.execute(
                `SELECT * FROM drug_alternatives WHERE alt_id = :altId`,
                { altId }
              );
              const originalAlt = altRow.rows[0] || {};
              await conn.execute(
                `INSERT INTO drug_alternative_negotiations (
                   alternative_id, negotiated_mrp, negotiated_rate, negotiated_gst,
                   negotiated_scheme_qty, negotiated_scheme_offer, negotiated_net_rate,
                   negotiated_profit_margin, negotiated_absolute_margin, negotiated_total_margin,
                   negotiated_by, negotiated_at, negotiation_remarks
                 ) VALUES (
                   :altId, :mrp, :rate, :gst, :qty, :offer, :net_rate, :profit, :abs_margin, :total_margin,
                   :by, CURRENT_TIMESTAMP, :negRemark
                 )`,
                {
                  altId,
                  mrp: originalAlt.MRP_PER_PACK ?? originalAlt.mrp_per_pack ?? null,
                  rate: originalAlt.RATE_PER_PACK ?? originalAlt.rate_per_pack ?? null,
                  gst: originalAlt.GST_PERCENT ?? originalAlt.gst_percent ?? null,
                  qty: originalAlt.SCHEME_QTY ?? originalAlt.scheme_qty ?? null,
                  offer: originalAlt.SCHEME_OFFER ?? originalAlt.scheme_offer ?? null,
                  net_rate: originalAlt.NET_RATE ?? originalAlt.net_rate ?? null,
                  profit: originalAlt.PROFIT_MARGIN ?? originalAlt.profit_margin ?? null,
                  abs_margin: originalAlt.ABSOLUTE_MARGIN ?? originalAlt.absolute_margin ?? null,
                  total_margin: originalAlt.TOTAL_MARGIN ?? originalAlt.total_margin ?? null,
                  by: performed_by,
                  negRemark: String(altNegRemark)
                }
              );
            }
          }
        }
      }
    }

    // ── Persist DTC-set row-level remarks on existing details ──────────────
    if (Array.isArray(existingRows) && existingRows.length > 0) {
      for (let rowIdx = 0; rowIdx < existingRows.length; rowIdx++) {
        const row = existingRows[rowIdx];
        const rowRemark = row.remark ?? row.REMARK ?? null;
        if (rowRemark !== null && rowRemark !== undefined) {
          // row_no is 1-indexed; use idx+1 as fallback if not provided
          const rowNo = row.row_no ?? row.ROW_NO ?? (rowIdx + 1);
          await conn.execute(
            `UPDATE drug_existing_details SET remark = :remark WHERE request_id = :requestId AND row_no = :rowNo`,
            { remark: String(rowRemark), requestId, rowNo }
          );
        }
      }
    }

    await writeAudit(conn, requestId, 'DTC_FINAL_SELECTION', performed_by, 'DTCFinal', 'CEO',
      `Selected: ${selectedBrandsList}. ${remarks || ''}`);

    // Save DTC final select notes/remarks to history
    const dtcNotesText = dtc_recommendation_notes || remarks || dtc_remarks;
    if (dtcNotesText) {
      const customRemarksVal = req.body.customRemarks || dtcNotesText;
      await saveApprovalRemarks(conn, customRemarksVal, 'DTC', performed_by);
    }

    // Notify CEO
    const ceoUsers = await conn.execute(
      `SELECT user_id FROM users WHERE UPPER(role) = 'CEO' AND is_active = 1`
    );
    for (const row of ceoUsers.rows) {
      await createNotification(conn, row.USER_ID, requestId,
        `🏛️ Drug request #${requestId} (${dr.BRAND_NAME}) — DTC has reviewed and forwarded to CEO. Selected drug(s): ${selectedBrandsList}. Awaiting your approval.`
      );
    }
    // Notify doctor
    await createNotification(conn, dr.DOCTOR_ID, requestId,
      `Your drug request #${requestId} has been reviewed by DTC. Selected drug(s): ${selectedBrandsList}. Forwarded to CEO for final approval.`
    );

    await conn.commit();
    res.json({ message: 'Final drug selected. Request forwarded to CEO.', selected_drug: selectedBrandsList });
  } catch (err) {
    console.error('POST /api/dtc/final-select error:', err);
    res.status(500).json({ error: 'Internal server error.', detail: err.message });
  } finally {
    await conn.close();
  }
});

router.post('/blacklist', requireRole('dtc', 'dtccommittee'), async (req, res) => {
  const conn = await getConn();
  try {
    const { company_name, company_type, remarks, performed_by } = req.body;

    if (!company_name || !String(company_name).trim()) {
      return res.status(400).json({ error: 'company_name is required.' });
    }
    const typeUpper = (company_type || '').toUpperCase().trim();
    if (!['MANUFACTURER', 'MARKETER'].includes(typeUpper)) {
      return res.status(400).json({ error: 'company_type must be MANUFACTURER or MARKETER.' });
    }
    if (!performed_by) {
      return res.status(400).json({ error: 'performed_by is required.' });
    }

    // Role protection: only DTCCommittee/DTC
    const roleCheck = await conn.execute(
      `SELECT role FROM users WHERE user_id = :p_uid AND is_active = 1`, { p_uid: performed_by }
    );
    const userRole = roleCheck.rows[0] ? (roleCheck.rows[0].ROLE || '').toLowerCase().trim() : '';
    if (!roleCheck.rows.length || (userRole !== 'dtccommittee' && userRole !== 'dtc')) {
      return res.status(403).json({ error: 'Access denied. Only DTC Committee members can manage the blacklist.' });
    }

    const normalizedName = String(company_name).trim().toUpperCase();

    // Duplicate prevention
    const dupCheck = await conn.execute(
      `SELECT blacklist_id FROM blacklisted_companies
       WHERE is_active = 1
         AND UPPER(TRIM(company_name)) = :p_name
         AND company_type = :p_ctype`,
      { p_name: normalizedName, p_ctype: typeUpper }
    );
    if (dupCheck.rows.length > 0) {
      return res.status(409).json({ error: 'Company is already blacklisted.' });
    }

    await conn.execute(
      `INSERT INTO blacklisted_companies (company_name, company_type, remarks, created_by)
       VALUES (:p_name, :p_ctype, :p_remarks, :p_created_by)`,
      { p_name: normalizedName, p_ctype: typeUpper, p_remarks: remarks?.trim() || null, p_created_by: performed_by }
    );
    await conn.commit();
    res.status(201).json({ message: `${typeUpper === 'MANUFACTURER' ? 'Manufacturer' : 'Marketer'} "${normalizedName}" added to blacklist.` });
  } catch (err) {
    console.error('POST /api/dtc/blacklist error:', err);
    res.status(500).json({ error: 'Internal server error.', detail: err.message });
  } finally {
    await conn.close();
  }
});

router.get('/blacklist', requireRole('dtc', 'dtccommittee'), async (req, res) => {
  const conn = await getConn();
  try {
    const userId = req.query.user_id;
    if (!userId) return res.status(400).json({ error: 'user_id query param is required.' });

    // Role protection: only DTCCommittee/DTC
    const roleCheck = await conn.execute(
      `SELECT role FROM users WHERE user_id = :p_uid AND is_active = 1`, { p_uid: userId }
    );
    const userRole = roleCheck.rows[0] ? (roleCheck.rows[0].ROLE || '').toLowerCase().trim() : '';
    if (!roleCheck.rows.length || (userRole !== 'dtccommittee' && userRole !== 'dtc')) {
      return res.status(403).json({ error: 'Access denied. Only DTC Committee members can view the blacklist.' });
    }

    const result = await conn.execute(
      `SELECT bl.blacklist_id, bl.company_name, bl.company_type, bl.remarks,
              bl.is_active, bl.created_at, bl.removed_at,
              u.name AS created_by_name,
              ru.name AS removed_by_name
       FROM blacklisted_companies bl
       LEFT JOIN users u  ON u.user_id  = bl.created_by
       LEFT JOIN users ru ON ru.user_id = bl.removed_by
       WHERE bl.is_active = 1
       ORDER BY bl.created_at DESC`
    );
    res.json(result.rows);
  } catch (err) {
    console.error('GET /api/dtc/blacklist error:', err);
    res.status(500).json({ error: 'Internal server error.', detail: err.message });
  } finally {
    await conn.close();
  }
});

router.put('/blacklist/:id/remove', requireRole('dtc', 'dtccommittee'), async (req, res) => {
  const conn = await getConn();
  try {
    const blacklistId = parseInt(req.params.id);
    const { performed_by } = req.body;

    if (!performed_by) return res.status(400).json({ error: 'performed_by is required.' });

    // Role protection: only DTCCommittee/DTC
    const roleCheck = await conn.execute(
      `SELECT role FROM users WHERE user_id = :p_uid AND is_active = 1`, { p_uid: performed_by }
    );
    const userRole = roleCheck.rows[0] ? (roleCheck.rows[0].ROLE || '').toLowerCase().trim() : '';
    if (!roleCheck.rows.length || (userRole !== 'dtccommittee' && userRole !== 'dtc')) {
      return res.status(403).json({ error: 'Access denied. Only DTC Committee members can manage the blacklist.' });
    }

    const exists = await conn.execute(
      `SELECT blacklist_id, company_name FROM blacklisted_companies WHERE blacklist_id = :p_id AND is_active = 1`,
      { p_id: blacklistId }
    );
    if (!exists.rows.length) return res.status(404).json({ error: 'Blacklist entry not found or already removed.' });

    await conn.execute(
      `UPDATE blacklisted_companies
         SET is_active = 0, removed_by = :p_removed_by, removed_at = CURRENT_TIMESTAMP
       WHERE blacklist_id = :p_id`,
      { p_removed_by: performed_by, p_id: blacklistId }
    );
    await conn.commit();
    res.json({ message: `Blacklist entry #${blacklistId} removed.` });
  } catch (err) {
    console.error('PUT /api/dtc/blacklist remove error:', err);
    res.status(500).json({ error: 'Internal server error.', detail: err.message });
  } finally {
    await conn.close();
  }
});


export default router;
