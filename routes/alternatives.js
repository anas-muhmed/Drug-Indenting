// Alternatives + comparison-sheet routes — moved out of server.js
// unchanged, mounted at the API root (/api) since they span three
// different sub-prefixes (/api/alternatives, /api/pharmacist/*,
// /api/pharmacy-head/*) that don't share one clean mount point.

import express from 'express';
import oracledb from 'oracledb';
import { getConn } from '../db/pool.js';
import { requireAuth, requireRole } from '../middleware/requireAuth.js';
import { computeAltDerived, formatEffectiveEntryRow } from '../utils/pureHelpers.js';
import { writeAudit, createNotification } from '../utils/auditHelpers.js';

const router = express.Router();

router.post('/alternatives/:requestId', requireRole('pharmacist'), async (req, res) => {
  const conn = await getConn();
  try {
    const requestId = parseInt(req.params.requestId);
    const { alternatives, comparison_type, remarks, existing_generic_data } = req.body;
    const performed_by = req.user.id; // never trust a client-supplied performer id

    if (!alternatives || alternatives.length < 1) {
      return res.status(400).json({ error: 'Minimum 3 alternatives are required.' });
    }

    const reqResult = await conn.execute(
      `SELECT * FROM drug_requests WHERE request_id = :requestId`, { requestId }
    );
    if (!reqResult.rows.length) return res.status(404).json({ error: 'Request not found.' });
    const dr = reqResult.rows[0];

    // Replace any prior submission
    await conn.execute(`DELETE FROM drug_alternatives WHERE request_id = :requestId`, { requestId });

    for (const alt of alternatives) {
      const d = computeAltDerived(alt);



      await conn.execute(
        `INSERT INTO drug_alternatives (
           request_id,
           brand_name, manufacturer, marketer,
           mrp_per_pack, rate_per_pack, gst_percent,
           mrp, rate, qty, offer,
           markup_margin,
           net_rate,
           absolute_margin,
           negotiated_rate,
           profit_margin,
           stock,
           purchase_quantity,
           consultant, sale_qty, pack, introduced_on,
           comparison_type,
           remark,
           submitted_by
         ) VALUES (
           :request_id,
           :brand_name, :manufacturer, :marketer,
           :mrp_per_pack, :rate_per_pack, :gst_percent,
           :mrp, :rate, :qty, :offer,
           :markup_margin,
           :net_rate,
           :absolute_margin,
           :negotiated_rate,
           :profit_margin,
           :stock,
           :purchase_quantity,
           :consultant, :sale_qty, :pack, :introduced_on,
           :comparison_type,
           :remark,
           :submitted_by
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

    // Save existing generic master data on the request (once, not per-alternative)
    const egdJson = existing_generic_data ? JSON.stringify(existing_generic_data) : null;
    await conn.execute(
      `UPDATE drug_requests SET existing_generic_data = :egd WHERE request_id = :rid`,
      { egd: egdJson, rid: requestId }
    );

    await conn.execute(
      `UPDATE drug_requests SET current_stage = 'PharmacyHeadReview2',
         pharmacist_remarks = :remarks, updated_at = CURRENT_TIMESTAMP
       WHERE request_id = :requestId`,
      { remarks: remarks || null, requestId }
    );
    await writeAudit(conn, requestId, 'ALTERNATIVES_SUBMITTED', performed_by, 'Pharmacist', 'PharmacyHeadReview2', remarks);

    const phUsers = await conn.execute(
      `SELECT user_id FROM users WHERE UPPER(role) = 'PHARMACYHEAD' AND is_active = 1`
    );
    for (const row of phUsers.rows) {
      await createNotification(conn, row.USER_ID, requestId,
        `Pharmacist submitted ${alternatives.length} alternatives for request #${requestId} (${dr.BRAND_NAME}). Please review.`
      );
    }

    // Clean up any saved draft for this request (submission is final)
    await conn.execute(
      `DELETE FROM analysis_drafts WHERE request_id = :requestId AND pharmacist_id = :pid AND status = 'DRAFT'`,
      { requestId, pid: performed_by }
    );

    res.json({ message: 'Alternatives submitted. Forwarded to Pharmacy Head.' });

  } catch (err) {
    console.error('POST /api/alternatives error:', err);
    res.status(500).json({ error: 'Internal server error.', detail: err.message });
  } finally {
    await conn.close();
  }
});

router.post('/pharmacist/correction-submit/:requestId', requireRole('pharmacist'), async (req, res) => {
  const conn = await getConn();
  try {
    const requestId = parseInt(req.params.requestId);
    const {
      alternatives,
      comparison_type,
      remarks,
      existing_generic_data
    } = req.body;
    const performed_by = req.user.id; // never trust a client-supplied performer id

    if (!alternatives || alternatives.length < 1) {
      return res.status(400).json({ error: 'Minimum 1 alternative is required for correction.' });
    }

    // Validate request exists and is in PharmacistCorrection stage
    const reqResult = await conn.execute(
      `SELECT * FROM drug_requests WHERE request_id = :requestId`,
      { requestId }
    );
    if (!reqResult.rows.length) {
      return res.status(404).json({ error: 'Request not found.' });
    }
    const dr = reqResult.rows[0];
    if (dr.CURRENT_STAGE !== 'PharmacistCorrection') {
      return res.status(400).json({ error: 'Resubmit is only allowed from Pharmacist Correction stage.' });
    }

    // Delete old alternatives
    await conn.execute(
      `DELETE FROM drug_alternatives WHERE request_id = :requestId`,
      { requestId }
    );

    // Insert corrected alternatives
    for (const alt of alternatives) {
      const d = computeAltDerived(alt);
      await conn.execute(
        `INSERT INTO drug_alternatives (
           request_id,
           brand_name, manufacturer, marketer,
           mrp_per_pack, rate_per_pack, gst_percent,
           mrp, rate, qty, offer,
           markup_margin,
           net_rate,
           absolute_margin,
           negotiated_rate,
           profit_margin,
           stock,
           purchase_quantity,
           consultant, sale_qty, pack, introduced_on,
           comparison_type,
           remark,
           submitted_by
         ) VALUES (
           :request_id,
           :brand_name, :manufacturer, :marketer,
           :mrp_per_pack, :rate_per_pack, :gst_percent,
           :mrp, :rate, :qty, :offer,
           :markup_margin,
           :net_rate,
           :absolute_margin,
           :negotiated_rate,
           :profit_margin,
           :stock,
           :purchase_quantity,
           :consultant, :sale_qty, :pack, :introduced_on,
           :comparison_type,
           :remark,
           :submitted_by
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

    // Save existing generic data and update request workflow
    const egdJson = existing_generic_data ? JSON.stringify(existing_generic_data) : null;
    await conn.execute(
      `UPDATE drug_requests
       SET
         pharmacist_remarks = :remarks,
         existing_generic_data = :egd,
         current_stage = 'PharmacyHeadReview2',
         status = 'Pending',
         is_reverted = 0,
         revert_remarks = NULL,
         last_corrected_at = CURRENT_TIMESTAMP,
         last_corrected_by = :performed_by,
         updated_at = CURRENT_TIMESTAMP
       WHERE request_id = :requestId`,
      {
        remarks: remarks || null,
        egd: egdJson,
        performed_by,
        requestId
      }
    );

    // Audit log
    await writeAudit(
      conn,
      requestId,
      'CORRECTION_RESUBMITTED',
      performed_by,
      'PharmacistCorrection',
      'PharmacyHeadReview2',
      remarks || 'Corrected comparison sheet re-submitted to Pharmacy Head.'
    );

    // Notify Pharmacy Head users
    const phUsers = await conn.execute(
      `SELECT user_id FROM users WHERE UPPER(role) = 'PHARMACYHEAD' AND is_active = 1`
    );
    for (const row of phUsers.rows) {
      await createNotification(
        conn,
        row.USER_ID,
        requestId,
        `✅ Corrected comparison sheet for Request #${requestId} (${dr.BRAND_NAME}) has been resubmitted by Pharmacist. Please review.`
      );
    }

    // Clean up analysis drafts
    await conn.execute(
      `DELETE FROM analysis_drafts WHERE request_id = :requestId AND pharmacist_id = :pid AND status = 'DRAFT'`,
      { requestId, pid: performed_by }
    );

    res.json({
      success: true,
      message: 'Correction submitted successfully.'
    });

  } catch (err) {
    console.error('POST /api/pharmacist/correction-submit error:', err);
    res.status(500).json({ error: 'Correction resubmission failed.', detail: err.message });
  } finally {
    await conn.close();
  }
});

router.get('/alternatives/:requestId', requireAuth, async (req, res) => {
  const conn = await getConn();
  try {
    const result = await conn.execute(
      `SELECT da.alt_id, da.request_id, da.brand_name, da.manufacturer, da.marketer,
              da.mrp_per_pack, da.rate_per_pack, da.gst_percent, da.mrp, da.rate,
              da.qty, da.offer, da.markup_margin, da.scheme_qty, da.scheme_offer,
              da.net_rate, da.total_margin, da.profit_margin, da.absolute_margin,
              da.stock, da.existing_drug_details, da.remark, da.refer,
              da.submitted_by, da.created_at, da.is_final_selected,
              da.consultant, da.sale_qty, da.pack, da.introduced_on,
              u.name AS submitted_by_name,
              dn.negotiation_id, dn.negotiated_mrp, dn.negotiated_rate, dn.negotiated_gst,
              dn.negotiated_scheme_qty, dn.negotiated_scheme_offer, dn.negotiated_net_rate,
              dn.negotiated_profit_margin, dn.negotiated_absolute_margin, dn.negotiated_total_margin,
              dn.negotiation_remarks
       FROM drug_alternatives da
       LEFT JOIN users u ON u.user_id = da.submitted_by
       LEFT JOIN drug_alternative_negotiations dn ON dn.alternative_id = da.alt_id
       WHERE da.request_id = :requestId ORDER BY da.alt_id ASC`,
      { requestId: req.params.requestId }
    );

    const edResult = await conn.execute(
      `SELECT * FROM drug_existing_details WHERE request_id = :requestId ORDER BY row_no ASC`,
      { requestId: req.params.requestId }
    );

    const entriesResult = await conn.execute(
      `SELECT * FROM drug_effective_entries WHERE request_id = :requestId ORDER BY entry_id ASC`,
      { requestId: req.params.requestId }
    );

    const reqResult = await conn.execute(
      `SELECT dtc_reviewed_by_name, dtc_review_signature,
              final_selected_brand, final_selected_category,
              final_selection_reasons, final_recommendation_notes,
              ph_final_recommendation, dtc_final_recommendations
       FROM drug_requests WHERE request_id = :requestId`,
      { requestId: req.params.requestId }
    );
    const reqRow = reqResult.rows[0] || {};

    res.json({
      alternatives: result.rows,
      existing_details: edResult.rows,
      effective_drug_entries: entriesResult.rows.map(row => formatEffectiveEntryRow(row)),
      dtc_reviewed_by_name: reqRow.DTC_REVIEWED_BY_NAME || '',
      dtc_review_signature: reqRow.DTC_REVIEW_SIGNATURE || '',
      final_selected_brand: reqRow.FINAL_SELECTED_BRAND || '',
      final_selected_category: reqRow.FINAL_SELECTED_CATEGORY || '',
      final_selection_reasons: reqRow.FINAL_SELECTION_REASONS || '',
      final_recommendation_notes: reqRow.FINAL_RECOMMENDATION_NOTES || '',
      ph_final_recommendation: reqRow.PH_FINAL_RECOMMENDATION || '',
      dtc_final_recommendations: reqRow.DTC_FINAL_RECOMMENDATIONS || ''
    });
  } catch (err) {
    console.error('GET /api/alternatives error:', err);
    res.status(500).json({ error: 'Internal server error.', detail: err.message });
  } finally {
    await conn.close();
  }
});

router.get('/alternatives/:requestId/selected', requireAuth, async (req, res) => {
  const conn = await getConn();
  try {
    const requestId = parseInt(req.params.requestId);

    const drResult = await conn.execute(
      `SELECT dr.final_selected_alternative_id,
              dr.dtc_selected_brand,
              dr.dtc_selected_category,
              dr.dtc_selection_reasons,
              dr.dtc_recommendation_notes,
              dr.dtc_reviewed_by_name,
              dr.dtc_review_signature,
              dr.ph_final_recommendation,
              dr.generic_name AS request_generic_name,
              dr.brand_name AS request_brand_name,
              dr.manufacturer AS request_manufacturer,
              dr.marketer AS request_marketer,
              dr.dosage_form AS request_dosage_form,
              dr.dose_strength AS request_dose_strength,
              dr.dtc_final_recommendations,
              dr.existing_generic_data,
              dr.final_selected_brand,
              dr.final_selected_category,
              dr.final_selection_reasons,
              dr.final_recommendation_notes
       FROM drug_requests dr
       WHERE dr.request_id = :requestId`,
      { requestId }
    );

    if (!drResult.rows.length) {
      return res.status(404).json({ error: 'Request not found.' });
    }

    const dr = drResult.rows[0];
    const final_selected_alternative_id = dr.FINAL_SELECTED_ALTERNATIVE_ID;

    // Resolve original brand details (mrp, rate, stock, purchase_qty) dynamically
    let origMrp = '';
    let origRate = '';
    let origStock = '';
    let origQty = '';
    try {
      const origAltResult = await conn.execute(
        `SELECT mrp_per_pack, rate_per_pack, stock, purchase_quantity
         FROM drug_alternatives
         WHERE request_id = :requestId AND LOWER(brand_name) = LOWER(:brandName)`,
        { requestId, brandName: dr.REQUEST_BRAND_NAME }
      );
      if (origAltResult.rows.length) {
        origMrp = origAltResult.rows[0].MRP_PER_PACK;
        origRate = origAltResult.rows[0].RATE_PER_PACK;
        origStock = origAltResult.rows[0].STOCK;
        origQty = origAltResult.rows[0].PURCHASE_QUANTITY;
      }
    } catch (altErr) {
      console.error('Error fetching original alternative details:', altErr);
    }

    if ((!origMrp || origMrp === '') && dr.EXISTING_GENERIC_DATA) {
      try {
        const egd = JSON.parse(dr.EXISTING_GENERIC_DATA);
        origMrp = egd.existing_mrp || egd.existing_mrp_inc_gst_nos || '';
        origRate = egd.existing_rate || egd.existing_rate_inc_gst_nos || '';
        origStock = egd.existing_stock || egd.existing_present_stock || '';
        origQty = egd.existing_purchase_qty || '';
      } catch (jsonEgdErr) {
        console.error('Error parsing existing_generic_data for selected original:', jsonEgdErr);
      }
    }

    let list = [];
    const recommendationsJson = dr.DTC_FINAL_RECOMMENDATIONS;
    if (recommendationsJson) {
      try {
        const recs = JSON.parse(recommendationsJson);
        for (const rec of recs) {
          if (rec.is_original) {
            list.push({
              type: 'original',
              brand_name: rec.brand_name || dr.REQUEST_BRAND_NAME,
              manufacturer: dr.REQUEST_MANUFACTURER,
              marketer: dr.REQUEST_MARKETER,
              mrp: origMrp || '',
              rate: origRate || '',
              net_rate: origRate || '',
              profit_margin: '',
              absolute_margin: '',
              scheme_qty: '',
              scheme_offer: '',
              pack: `${dr.REQUEST_DOSE_STRENGTH} ${dr.REQUEST_DOSAGE_FORM}`,
              stock: origStock || '',
              purchase_qty: origQty || '',
              category: rec.category,
              reasons: rec.reasons,
              notes: rec.notes,
              remarks: rec.remarks || ''
            });
          } else {
            // Try lookup by alternative_id first, fall back to brand_name if id is missing (legacy)
            let altLookupResult = null;
            if (rec.alternative_id) {
              altLookupResult = await conn.execute(
                `SELECT da.alt_id AS final_alt_id,
                        da.brand_name AS final_brand_name,
                        da.manufacturer AS final_manufacturer,
                        da.marketer AS final_marketer,
                        da.mrp AS final_mrp,
                        da.rate AS final_rate,
                        da.net_rate AS final_net_rate,
                        da.profit_margin AS final_profit_margin,
                        da.absolute_margin AS final_absolute_margin,
                        da.scheme_qty AS final_scheme_qty,
                        da.scheme_offer AS final_scheme_offer,
                        da.pack AS final_pack,
                        da.remark,
                        dn.negotiated_mrp, dn.negotiated_rate, dn.negotiated_gst,
                        dn.negotiated_scheme_qty, dn.negotiated_scheme_offer, dn.negotiated_net_rate,
                        dn.negotiated_profit_margin, dn.negotiated_absolute_margin, dn.negotiated_total_margin,
                        dn.negotiation_remarks
                 FROM drug_alternatives da
                 LEFT JOIN drug_alternative_negotiations dn ON dn.alternative_id = da.alt_id
                 WHERE da.alt_id = :altId AND da.request_id = :requestId`,
                { altId: rec.alternative_id, requestId }
              );
            }
            // Brand-name fallback for legacy records (alternative_id was null)
            if ((!altLookupResult || !altLookupResult.rows.length) && rec.brand_name) {
              altLookupResult = await conn.execute(
                `SELECT da.alt_id AS final_alt_id,
                        da.brand_name AS final_brand_name,
                        da.manufacturer AS final_manufacturer,
                        da.marketer AS final_marketer,
                        da.mrp AS final_mrp,
                        da.rate AS final_rate,
                        da.net_rate AS final_net_rate,
                        da.profit_margin AS final_profit_margin,
                        da.absolute_margin AS final_absolute_margin,
                        da.scheme_qty AS final_scheme_qty,
                        da.scheme_offer AS final_scheme_offer,
                        da.pack AS final_pack,
                        da.remark,
                        dn.negotiated_mrp, dn.negotiated_rate, dn.negotiated_gst,
                        dn.negotiated_scheme_qty, dn.negotiated_scheme_offer, dn.negotiated_net_rate,
                        dn.negotiated_profit_margin, dn.negotiated_absolute_margin, dn.negotiated_total_margin,
                        dn.negotiation_remarks
                 FROM drug_alternatives da
                 LEFT JOIN drug_alternative_negotiations dn ON dn.alternative_id = da.alt_id
                 WHERE LOWER(da.brand_name) = LOWER(:brandName) AND da.request_id = :requestId
                 ORDER BY da.alt_id ASC
                 FETCH FIRST 1 ROWS ONLY`,
                { brandName: rec.brand_name, requestId }
              );
            }
            if (altLookupResult && altLookupResult.rows.length) {
              const alt = altLookupResult.rows[0];
              list.push({
                type: 'alternative',
                alternative_id: rec.alternative_id || alt.FINAL_ALT_ID,
                brand_name: rec.brand_name || alt.FINAL_BRAND_NAME,
                manufacturer: alt.FINAL_MANUFACTURER || rec.manufacturer,
                marketer: alt.FINAL_MARKETER || rec.marketer,
                mrp: alt.NEGOTIATED_MRP ?? alt.FINAL_MRP,
                rate: alt.NEGOTIATED_RATE ?? alt.FINAL_RATE,
                net_rate: alt.NEGOTIATED_NET_RATE ?? alt.FINAL_NET_RATE,
                profit_margin: alt.NEGOTIATED_PROFIT_MARGIN ?? alt.FINAL_PROFIT_MARGIN,
                absolute_margin: alt.NEGOTIATED_ABSOLUTE_MARGIN ?? alt.FINAL_ABSOLUTE_MARGIN,
                scheme_qty: alt.NEGOTIATED_SCHEME_QTY ?? alt.FINAL_SCHEME_QTY,
                scheme_offer: alt.NEGOTIATED_SCHEME_OFFER ?? alt.FINAL_SCHEME_OFFER,
                pack: alt.FINAL_PACK,
                remark: alt.NEGOTIATION_REMARKS ?? alt.REMARK,
                category: rec.category,
                reasons: rec.reasons,
                notes: rec.notes,
                remarks: rec.remarks || '',
                // Negotiated fields for downstream use
                negotiated_mrp: alt.NEGOTIATED_MRP,
                negotiated_rate: alt.NEGOTIATED_RATE,
                negotiated_gst: alt.NEGOTIATED_GST,
                negotiated_scheme_qty: alt.NEGOTIATED_SCHEME_QTY,
                negotiated_scheme_offer: alt.NEGOTIATED_SCHEME_OFFER,
                negotiation_remarks: alt.NEGOTIATION_REMARKS
              });
            }
          }
        }
      } catch (jsonErr) {
        console.error('JSON parse error on dtc_final_recommendations:', jsonErr);
      }
    }


    // Fallback for legacy requests
    if (list.length === 0) {
      if (final_selected_alternative_id) {
        const altResult = await conn.execute(
          `SELECT da.brand_name AS final_brand_name,
                  da.manufacturer AS final_manufacturer,
                  da.marketer AS final_marketer,
                  da.mrp AS final_mrp,
                  da.rate AS final_rate,
                  da.net_rate AS final_net_rate,
                  da.profit_margin AS final_profit_margin,
                  da.absolute_margin AS final_absolute_margin,
                  da.scheme_qty AS final_scheme_qty,
                  da.scheme_offer AS final_scheme_offer,
                  da.pack AS final_pack,
                  dn.negotiated_mrp, dn.negotiated_rate, dn.negotiated_gst,
                  dn.negotiated_scheme_qty, dn.negotiated_scheme_offer, dn.negotiated_net_rate,
                  dn.negotiated_profit_margin, dn.negotiated_absolute_margin, dn.negotiated_total_margin,
                  dn.negotiation_remarks
           FROM drug_alternatives da
           LEFT JOIN drug_alternative_negotiations dn ON dn.alternative_id = da.alt_id
           WHERE da.alt_id = :altId AND da.request_id = :requestId`,
          { altId: final_selected_alternative_id, requestId }
        );
        if (altResult.rows.length) {
          const alt = altResult.rows[0];
          list.push({
            type: 'alternative',
            alternative_id: final_selected_alternative_id,
            brand_name: alt.FINAL_BRAND_NAME,
            manufacturer: alt.FINAL_MANUFACTURER,
            marketer: alt.FINAL_MARKETER,
            mrp: alt.NEGOTIATED_MRP ?? alt.FINAL_MRP,
            rate: alt.NEGOTIATED_RATE ?? alt.FINAL_RATE,
            net_rate: alt.NEGOTIATED_NET_RATE ?? alt.FINAL_NET_RATE,
            profit_margin: alt.NEGOTIATED_PROFIT_MARGIN ?? alt.FINAL_PROFIT_MARGIN,
            absolute_margin: alt.NEGOTIATED_ABSOLUTE_MARGIN ?? alt.FINAL_ABSOLUTE_MARGIN,
            scheme_qty: alt.NEGOTIATED_SCHEME_QTY ?? alt.FINAL_SCHEME_QTY,
            scheme_offer: alt.NEGOTIATED_SCHEME_OFFER ?? alt.FINAL_SCHEME_OFFER,
            pack: alt.FINAL_PACK,
            category: dr.DTC_SELECTED_CATEGORY,
            reasons: dr.DTC_SELECTION_REASONS ? JSON.parse(dr.DTC_SELECTION_REASONS) : [],
            notes: dr.DTC_RECOMMENDATION_NOTES,
            // Add negotiated fields
            negotiated_mrp: alt.NEGOTIATED_MRP,
            negotiated_rate: alt.NEGOTIATED_RATE,
            negotiated_gst: alt.NEGOTIATED_GST,
            negotiated_scheme_qty: alt.NEGOTIATED_SCHEME_QTY,
            negotiated_scheme_offer: alt.NEGOTIATED_SCHEME_OFFER,
            negotiation_remarks: alt.NEGOTIATION_REMARKS
          });
        }
      } else if (dr.DTC_SELECTED_BRAND) {
        list.push({
          type: 'original',
          brand_name: dr.DTC_SELECTED_BRAND,
          manufacturer: dr.REQUEST_MANUFACTURER,
          marketer: dr.REQUEST_MARKETER,
          mrp: origMrp || '',
          rate: origRate || '',
          net_rate: origRate || '',
          profit_margin: '',
          absolute_margin: '',
          scheme_qty: '',
          scheme_offer: '',
          pack: `${dr.REQUEST_DOSE_STRENGTH} ${dr.REQUEST_DOSAGE_FORM}`,
          stock: origStock || '',
          purchase_qty: origQty || '',
          category: dr.DTC_SELECTED_CATEGORY,
          reasons: dr.DTC_SELECTION_REASONS ? JSON.parse(dr.DTC_SELECTION_REASONS) : [],
          notes: dr.DTC_RECOMMENDATION_NOTES
        });
      }
    }

    if (list.length === 0) {
      return res.status(404).json({ error: 'final selection not found' });
    }

    // ── Build final_drug: single normalized object for inventory insertion ──
    // Priority: alternative-type entry (has full pricing) → original-type entry → fallback columns
    const finalGenericName = dr.REQUEST_GENERIC_NAME || '';
    let final_drug = null;

    // 1. Find the DTC-selected alternative entry (has complete pricing from drug_alternatives)
    const finalAltEntry = list.find(item => item.type === 'alternative');
    if (finalAltEntry) {
      final_drug = {
        final_brand_name: finalAltEntry.brand_name || '',
        final_generic_name: finalGenericName,
        final_manufacturer: finalAltEntry.manufacturer || '',
        final_marketer: finalAltEntry.marketer || '',
        final_mrp: finalAltEntry.mrp != null ? finalAltEntry.mrp : null,
        final_rate: finalAltEntry.rate != null ? finalAltEntry.rate : null,
        final_net_rate: finalAltEntry.net_rate != null ? finalAltEntry.net_rate : null,
        final_profit_margin: finalAltEntry.profit_margin != null ? finalAltEntry.profit_margin : null,
        final_absolute_margin: finalAltEntry.absolute_margin != null ? finalAltEntry.absolute_margin : null,
        final_scheme_qty: finalAltEntry.scheme_qty != null ? finalAltEntry.scheme_qty : null,
        final_scheme_offer: finalAltEntry.scheme_offer || '',
        final_pack: finalAltEntry.pack || '',
        dtc_selected_category: finalAltEntry.category || dr.DTC_SELECTED_CATEGORY || '',
        dtc_recommendation_notes: finalAltEntry.notes || dr.DTC_RECOMMENDATION_NOTES || '',
        dtc_reviewed_by_name: dr.DTC_REVIEWED_BY_NAME || '',
        dtc_review_signature: dr.DTC_REVIEW_SIGNATURE || '',
        ph_final_recommendation: dr.PH_FINAL_RECOMMENDATION || '',
        dtc_selection_reasons: finalAltEntry.reasons || [],
      };
    } else {
      // 2. Original-type entry (DTC selected the originally-requested drug)
      const finalOrigEntry = list.find(item => item.type === 'original');
      if (finalOrigEntry) {
        final_drug = {
          final_brand_name: finalOrigEntry.brand_name || '',
          final_generic_name: finalGenericName,
          final_manufacturer: finalOrigEntry.manufacturer || '',
          final_marketer: finalOrigEntry.marketer || '',
          final_mrp: finalOrigEntry.mrp != null ? finalOrigEntry.mrp : null,
          final_rate: finalOrigEntry.rate != null ? finalOrigEntry.rate : null,
          final_net_rate: finalOrigEntry.net_rate != null ? finalOrigEntry.net_rate : null,
          final_profit_margin: finalOrigEntry.profit_margin != null ? finalOrigEntry.profit_margin : null,
          final_absolute_margin: finalOrigEntry.absolute_margin != null ? finalOrigEntry.absolute_margin : null,
          final_scheme_qty: finalOrigEntry.scheme_qty != null ? finalOrigEntry.scheme_qty : null,
          final_scheme_offer: finalOrigEntry.scheme_offer || '',
          final_pack: finalOrigEntry.pack || '',
          dtc_selected_category: finalOrigEntry.category || dr.DTC_SELECTED_CATEGORY || '',
          dtc_recommendation_notes: finalOrigEntry.notes || dr.DTC_RECOMMENDATION_NOTES || '',
          dtc_reviewed_by_name: dr.DTC_REVIEWED_BY_NAME || '',
          dtc_review_signature: dr.DTC_REVIEW_SIGNATURE || '',
          ph_final_recommendation: dr.PH_FINAL_RECOMMENDATION || '',
          dtc_selection_reasons: finalOrigEntry.reasons || [],
        };
      } else {
        // 3. Fallback: use the stored final_selected_brand column on drug_requests
        const fallbackBrand = dr.FINAL_SELECTED_BRAND || dr.DTC_SELECTED_BRAND || '';
        let parsedReasons = [];
        try { parsedReasons = dr.FINAL_SELECTION_REASONS ? JSON.parse(dr.FINAL_SELECTION_REASONS) : []; } catch (_) { }
        final_drug = {
          final_brand_name: fallbackBrand,
          final_generic_name: finalGenericName,
          final_manufacturer: dr.REQUEST_MANUFACTURER || '',
          final_marketer: dr.REQUEST_MARKETER || '',
          final_mrp: null,
          final_rate: null,
          final_net_rate: null,
          final_profit_margin: null,
          final_absolute_margin: null,
          final_scheme_qty: null,
          final_scheme_offer: '',
          final_pack: `${dr.REQUEST_DOSE_STRENGTH || ''} ${dr.REQUEST_DOSAGE_FORM || ''}`.trim(),
          dtc_selected_category: dr.FINAL_SELECTED_CATEGORY || dr.DTC_SELECTED_CATEGORY || '',
          dtc_recommendation_notes: dr.FINAL_RECOMMENDATION_NOTES || dr.DTC_RECOMMENDATION_NOTES || '',
          dtc_reviewed_by_name: dr.DTC_REVIEWED_BY_NAME || '',
          dtc_review_signature: dr.DTC_REVIEW_SIGNATURE || '',
          ph_final_recommendation: dr.PH_FINAL_RECOMMENDATION || '',
          dtc_selection_reasons: parsedReasons,
        };
      }
    }

    return res.json({
      type: 'multi',
      recommendations: list,
      final_drug,
    });

  } catch (err) {
    console.error('GET /api/alternatives/selected error:', err);
    res.status(500).json({ error: 'Internal server error.', detail: err.message });
  } finally {
    await conn.close();
  }
});

router.put('/pharmacist/comparison/:requestId', requireRole('pharmacist'), async (req, res) => {
  const conn = await getConn();
  try {
    const requestId = parseInt(req.params.requestId);
    const { existing_details } = req.body;

    if (!Array.isArray(existing_details)) {
      return res.status(400).json({ error: 'existing_details must be an array.' });
    }

    // Delete existing generic details rows for this request
    await conn.execute(
      `DELETE FROM drug_existing_details WHERE request_id = :requestId`,
      { requestId }
    );

    // Insert new rows
    for (let i = 0; i < existing_details.length; i++) {
      const row = existing_details[i];

      await conn.execute(
        `INSERT INTO drug_existing_details (
          request_id, row_no, introduced_on, brand_name, manufacturer, marketer, consultant,
          present_stock, purchase_qty, sale_qty, pack,
          mrp_inc_gst_nos, rate_inc_gst_nos, markup_margin,
          scheme_qty, scheme_offer, net_rate, profit_margin, absolute_margin, total_margin, remark
        ) VALUES (
          :request_id, :row_no, :introduced_on, :brand_name, :manufacturer, :marketer, :consultant,
          :present_stock, :purchase_qty, :sale_qty, :pack,
          :mrp_inc_gst_nos, :rate_inc_gst_nos, :markup_margin,
          :scheme_qty, :scheme_offer, :net_rate, :profit_margin, :absolute_margin, :total_margin, :remark
        )`,
        {
          request_id: requestId,
          row_no: i + 1,
          introduced_on: row.introduced_on || null,
          brand_name: row.brand_name || null,
          manufacturer: row.manufacturer || null,
          marketer: row.marketer || null,
          consultant: row.consultant || null,
          present_stock: parseFloat(row.present_stock) || null,
          purchase_qty: parseFloat(row.purchase_qty) || null,
          sale_qty: parseFloat(row.sale_qty) || null,
          pack: row.pack || null,
          mrp_inc_gst_nos: parseFloat(row.mrp_inc_gst_nos) || null,
          rate_inc_gst_nos: parseFloat(row.rate_inc_gst_nos) || null,
          markup_margin: parseFloat(row.markup_margin) || null,
          scheme_qty: parseFloat(row.scheme_qty) || null,
          scheme_offer: row.scheme_offer ? String(row.scheme_offer) : null,
          net_rate: parseFloat(row.net_rate) || null,
          profit_margin: parseFloat(row.profit_margin) || null,
          absolute_margin: parseFloat(row.absolute_margin) || null,
          total_margin: parseFloat(row.total_margin) || null,
          remark: row.remark || null
        }
      );
    }

    await conn.commit();
    res.json({ message: 'Existing drug details saved successfully.' });
  } catch (err) {
    console.error('PUT /api/pharmacist/comparison error:', err);
    res.status(500).json({ error: 'Internal server error.', detail: err.message });
  } finally {
    await conn.close();
  }
});

router.put('/pharmacy-head/comparison/:requestId', requireRole('pharmacyhead'), async (req, res) => {
  const conn = await getConn();
  try {
    const requestId = parseInt(req.params.requestId);
    const { alternatives, existing_generic_data, ph_review2_remarks, ph_review_remarks, dtc_recommendation_notes, ph_final_recommendation } = req.body;
    const performed_by = req.user.id; // never trust a client-supplied performer id

    if (!alternatives || !Array.isArray(alternatives)) {
      return res.status(400).json({ error: 'alternatives array is required.' });
    }

    // Verify request exists and is at PharmacyHeadReview2
    const reqRes = await conn.execute(
      `SELECT request_id, current_stage, brand_name FROM drug_requests WHERE request_id = :rid`,
      { rid: requestId }
    );
    if (!reqRes.rows.length) return res.status(404).json({ error: 'Request not found.' });
    if (reqRes.rows[0].CURRENT_STAGE !== 'PharmacyHeadReview2') {
      return res.status(400).json({ error: 'Request is not at PharmacyHeadReview2 stage.' });
    }

    // Delete and re-insert alternatives (full replacement)
    await conn.execute(`DELETE FROM drug_alternatives WHERE request_id = :rid`, { rid: requestId });

    for (const alt of alternatives) {
      const d = computeAltDerived(alt);
      const insertAltRes = await conn.execute(
        `INSERT INTO drug_alternatives (
           request_id, brand_name, manufacturer, marketer,
           mrp_per_pack, rate_per_pack, gst_percent,
           mrp, rate, qty, offer,
           markup_margin, net_rate, absolute_margin, negotiated_rate, profit_margin,
           stock, purchase_quantity,
           consultant, sale_qty, pack, introduced_on,
           comparison_type, remark, submitted_by
         ) VALUES (
           :request_id, :brand_name, :manufacturer, :marketer,
           :mrp_per_pack, :rate_per_pack, :gst_percent,
           :mrp, :rate, :qty, :offer,
           :markup_margin, :net_rate, :absolute_margin, :negotiated_rate, :profit_margin,
           :stock, :purchase_quantity,
           :consultant, :sale_qty, :pack, :introduced_on,
           :comparison_type, :remark, :submitted_by
         ) RETURNING alt_id INTO :altId`,
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
          comparison_type: alt.comparison_type || 'existing_generic',
          remark: alt.remark || null,
          submitted_by: alt.submitted_by || performed_by,
          altId: { type: oracledb.NUMBER, dir: oracledb.BIND_OUT }
        },
        { autoCommit: false }
      );

      const newAltId = insertAltRes.outBinds.altId[0];

      // Calculate negotiated derived values
      const nd = computeAltDerived({
        mrp_per_pack: alt.negotiated_mrp,
        rate_per_pack: alt.negotiated_rate,
        gst_percent: alt.negotiated_gst,
        pack: alt.pack,
        qty: alt.negotiated_scheme_qty,
        offer: alt.negotiated_scheme_offer,
        // fallbacks
        mrp: alt.negotiated_mrp_derived,
        rate: alt.negotiated_rate_derived,
        markupmargin: alt.negotiated_total_margin,
        profit_margin: alt.negotiated_profit_margin,
        margin: alt.negotiated_absolute_margin,
        net_rate: alt.negotiated_net_rate
      });

      // Insert negotiated values
      await conn.execute(
        `INSERT INTO drug_alternative_negotiations (
           alternative_id,
           negotiated_mrp, negotiated_rate, negotiated_gst,
           negotiated_scheme_qty, negotiated_scheme_offer,
           negotiated_net_rate, negotiated_profit_margin,
           negotiated_absolute_margin, negotiated_total_margin,
           negotiated_by, negotiated_at, negotiation_remarks
         ) VALUES (
           :alternative_id,
           :negotiated_mrp, :negotiated_rate, :negotiated_gst,
           :negotiated_scheme_qty, :negotiated_scheme_offer,
           :negotiated_net_rate, :negotiated_profit_margin,
           :negotiated_absolute_margin, :negotiated_total_margin,
           :negotiated_by, CURRENT_TIMESTAMP, :negotiation_remarks
         )`,
        {
          alternative_id: newAltId,
          negotiated_mrp: parseFloat(alt.negotiated_mrp) || null,
          negotiated_rate: parseFloat(alt.negotiated_rate) || null,
          negotiated_gst: parseFloat(alt.negotiated_gst) || null,
          negotiated_scheme_qty: parseFloat(alt.negotiated_scheme_qty) || null,
          negotiated_scheme_offer: alt.negotiated_scheme_offer ? String(alt.negotiated_scheme_offer) : null,
          negotiated_net_rate: nd.net_rate || null,
          negotiated_profit_margin: nd.profit_margin || null,
          negotiated_absolute_margin: nd.absolute_margin || null,
          negotiated_total_margin: nd.total_margin || null,
          negotiated_by: performed_by,
          negotiation_remarks: alt.negotiation_remarks || null
        }
      );
    }


    // Update existing_generic_data CLOB + ph_review2_remarks + ph_review_remarks + dtc_recommendation_notes on drug_requests
    const egdJson = existing_generic_data ? JSON.stringify(existing_generic_data) : null;
    await conn.execute(
      `UPDATE drug_requests
         SET existing_generic_data = :egd,
             ph_review2_remarks    = :remarks,
             ph_review_remarks     = :phReviewRemarks,
             dtc_recommendation_notes = :recNotes,
             ph_final_recommendation = :phFinalRec,
             updated_at            = CURRENT_TIMESTAMP
       WHERE request_id = :rid`,
      {
        egd: egdJson,
        remarks: ph_review2_remarks || ph_review_remarks || null,
        phReviewRemarks: ph_review_remarks || null,
        recNotes: dtc_recommendation_notes || null,
        phFinalRec: ph_final_recommendation || null,
        rid: requestId
      }
    );

    await writeAudit(conn, requestId, 'PH_COMPARISON_UPDATED', performed_by, 'PharmacyHeadReview2', 'PharmacyHeadReview2', ph_review2_remarks || ph_review_remarks);
    await conn.commit();
    res.json({ message: 'Comparison sheet updated by Pharmacy Head.' });
  } catch (err) {
    console.error('PUT /api/pharmacy-head/comparison error:', err);
    res.status(500).json({ error: 'Internal server error.', detail: err.message });
  } finally {
    await conn.close();
  }
});


export default router;
