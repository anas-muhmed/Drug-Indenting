// =DTCCommitteeTab====================================================================
// DTCCommitteeTab.js — First-pass DTC + Final DTC + Emergency DTC
// =====================================================================
import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import AnalyticsDashboard from './AnalyticsDashboard';
import Notifications from './Notifications';
import ReactMarkdown from 'react-markdown';
import { AlternativesTable } from './PharmacistTab';
import ComparisonSheet from './ComparisonSheet';
import RejectionRemarksPanel, { composeRejectionRemarks, validateRejection } from './RejectionRemarksPanel';
import ApprovalRemarksPanel from './ApprovalRemarksPanel';
const API = '/api';

const DETAIL_ROWS = [
  ['Brand Name', 'BRAND_NAME'], ['Generic Name', 'GENERIC_NAME'],
  ['Dose / Strength', 'DOSE_STRENGTH'], ['Dosage Form', 'DOSAGE_FORM'],
  ['Category', 'CATEGORY'], ['Request Type', 'REQUEST_TYPE'],
  ['Request Source', 'REQUEST_SOURCE_TYPE'],
  ['Formulary Type', 'FORMULARY_REQUEST_TYPE'],
  ['Manufacturer', 'MANUFACTURER'], ['Marketer', 'MARKETER'],
  ['Existing Brands', 'EXISTING_BRANDS'],
  ['Expected Patients/Month', 'EXPECTED_PATIENTS_PM'], ['Medicine Quantity', 'MEDICINE_QUANTITY'], ['Cost Reduction', 'COST_REDUCTION_BENEFIT'],
  ['Original Submitted Date', 'CREATED_AT'],
  ['Effective Created Date', 'EFFECTIVE_CREATED_AT'],
];

const getOrderedRemarks = (selected, auditLogs) => {
  if (!selected) return [];
  const seen = new Set();
  const unified = [];

  const getStage = (role, fromStage) => {
    const r = (role || '').toUpperCase();
    const f = (fromStage || '').toUpperCase();
    if (r === 'DOCTOR') return 'Doctor';
    if (r === 'HOD') return 'HOD';
    if (r === 'PHARMACIST') return 'Pharmacist';
    if (r === 'PHARMACYHEAD' || r === 'PHARMACY HEAD') return 'Pharmacy Head';
    if (r === 'DTC' || r === 'DTCCOMMITTEE') return 'DTC';
    if (r === 'CEO') return 'CEO';

    if (f.includes('HOD')) return 'HOD';
    if (f.includes('PHARMACIST')) return 'Pharmacist';
    if (f.includes('PHARMACYHEAD') || f.includes('PHARMACY HEAD')) return 'Pharmacy Head';
    if (f.includes('DTC')) return 'DTC';
    if (f.includes('CEO')) return 'CEO';
    return null;
  };

  if (auditLogs && auditLogs.length > 0) {
    auditLogs.forEach(row => {
      const text = (row.REMARKS || row.remarks || '').trim();
      if (!text) return;

      if (text.startsWith('Source: ') && text.includes('Class: ')) return;
      if (text === 'Drug order placed') return;
      if (text === 'Pharmacist direct request submitted.') return;

      const stage = getStage(row.PERFORMER_ROLE || row.performer_role, row.FROM_STAGE || row.from_stage);
      if (!stage) return;

      const key = `${stage}:${text.toLowerCase()}`;
      if (!seen.has(key)) {
        seen.add(key);
        unified.push({
          stage,
          author: row.PERFORMER_NAME || row.performer_name || stage,
          text,
          timestamp: row.LOGGED_AT || row.logged_at
        });
      }
    });
  }

  const staticRemarks = [
    { stage: 'Doctor', author: selected.doctor_name || 'Doctor', text: selected.CLINICAL_JUSTIFICATION, timestamp: selected.CREATED_AT },
    { stage: 'HOD', author: 'HOD', text: selected.HOD_REMARKS, timestamp: selected.HOD_ACTION_TIMESTAMP },
    { stage: 'Pharmacist', author: 'Pharmacist', text: selected.PHARMACIST_REMARKS, timestamp: null },
    { stage: 'Pharmacy Head', author: 'Pharmacy Head', text: selected.PH_REMARKS, timestamp: null },
    { stage: 'Pharmacy Head', author: 'Pharmacy Head', text: selected.PH_REVIEW_REMARKS, timestamp: null },
    { stage: 'Pharmacy Head', author: 'Pharmacy Head', text: selected.PH_REVIEW2_REMARKS || selected.PH_REMARKS2, timestamp: null },
    { stage: 'DTC', author: 'DTC Committee', text: selected.DTC_REMARKS, timestamp: null },
    { stage: 'DTC', author: 'DTC Committee', text: selected.DTC_FINAL_REMARKS, timestamp: null },
    { stage: 'CEO', author: 'CEO', text: selected.CEO_REMARKS, timestamp: null }
  ];

  staticRemarks.forEach(item => {
    const text = (item.text || '').trim();
    if (!text) return;

    const key = `${item.stage}:${text.toLowerCase()}`;
    if (!seen.has(key)) {
      seen.add(key);
      unified.push(item);
    }
  });

  const STAGE_ORDER = {
    'Doctor': 0,
    'HOD': 1,
    'Pharmacist': 2,
    'Pharmacy Head': 3,
    'DTC': 4,
    'CEO': 5
  };

  unified.sort((a, b) => {
    const orderA = STAGE_ORDER[a.stage];
    const orderB = STAGE_ORDER[b.stage];
    if (orderA !== orderB) {
      return orderA - orderB;
    }
    if (a.timestamp && b.timestamp) {
      return new Date(a.timestamp) - new Date(b.timestamp);
    }
    return 0;
  });

  return unified;
};


export default function DTCCommitteeTab({ currentUser, onNotificationsRead }) {
  const [view, setView] = useState('pending');
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [action, setAction] = useState('');
  // Approve-only optional remark
  const [approveRemarks, setApproveRemarks] = useState('');
  // Rejection multi-select state
  const [selectedReasons, setSelectedReasons] = useState([]);
  const [customRemarks, setCustomRemarks] = useState(['']);
  const [remarkErr, setRemarkErr] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [alertMsg, setAlertMsg] = useState(null);
  const [dashKey, setDashKey] = useState(0);
  const [alternatives, setAlternatives] = useState([]);
  const [loadingAlts, setLoadingAlts] = useState(false);
  const [genericlist, setGenericlist] = useState([]);
  const [showGenericPopup, setShowGenericPopup] = useState(false);
  const [genericLoading, setGenericLoading] = useState(false);
  const [dosageFilter, setDosageFilter] = useState('');
  const [dosageFormFilter, setDosageFormFilter] = useState('');
  // Comparison Sheet view state
  const [showCompSheet, setShowCompSheet] = useState(false);
  const [dtcAltView, setDtcAltView] = useState([]);
  const [dtcEgdView, setDtcEgdView] = useState({});
  const [dtcExistingDetails, setDtcExistingDetails] = useState([]);
  const [effectiveDrugEntries, setEffectiveDrugEntries] = useState([]);
  // Final DTC drug selection state
  const [submittingSelection, setSubmittingSelection] = useState(false);
  const [dtcSelectedBrand, setDtcSelectedBrand] = useState('');
  const [dtcSelectedCategory, setDtcSelectedCategory] = useState('');
  const [dtcSelectionReasons, setDtcSelectionReasons] = useState([]);
  const [dtcRecommendationNotes, setDtcRecommendationNotes] = useState('');
  const [dtcReviewedByName, setDtcReviewedByName] = useState('');
  const [dtcReviewSignature, setDtcReviewSignature] = useState('');
  const [dtcRemarks, setDtcRemarks] = useState('');
  const [phFinalRecommendation, setPhFinalRecommendation] = useState('');
  const [dtcFinalRecommendations, setDtcFinalRecommendations] = useState([]);
  const [auditLogs, setAuditLogs] = useState([]);


  // ── Blacklist Management state ──
  const [blacklist, setBlacklist] = useState([]);
  const [blLoading, setBlLoading] = useState(false);
  const [blForm, setBlForm] = useState({ company_name: '', company_type: 'MANUFACTURER', remarks: '' });
  const [blSubmitting, setBlSubmitting] = useState(false);
  const [blAlert, setBlAlert] = useState(null);
  const [blRemoving, setBlRemoving] = useState(null);

  // ── Quota Management state ──
  const [quotas, setQuotas] = useState([]);
  const [qLoading, setQLoading] = useState(false);
  const [qSearch, setQSearch] = useState('');
  const [qRoleFilter, setQRoleFilter] = useState('');
  const [qDeptFilter, setQDeptFilter] = useState('');
  const [qEditingLimit, setQEditingLimit] = useState({}); // maps userId -> limit value during edit
  const [qSubmitting, setQSubmitting] = useState({}); // maps userId -> boolean
  const [qAlert, setQAlert] = useState(null);

  const extractDosage = (name = '') => {
    const match = name.match(/(\d+(?:\.\d+)?\s*(?:mg|ml|mcg|g|iu|meg|%|units?))/i);
    return match ? match[1].trim().toLowerCase().replace(/\s+/, '') : null;
  };

  const extractDosageForm = (value = '') => {
    if (!value) return null;
    const v = value.trim();
    const NORMALISE = [
      [/^inj(ection)?s?\.?$/i, 'Inj.'],
      [/^tab(let)?s?\.?$/i, 'Tab'],
      [/^cap(sule)?s?\.?$/i, 'Cap'],
      [/^syrup\.?$/i, 'Syrup'],
      [/^susp(ension)?n?\.?$/i, 'Suspn'],
      [/^oral\s*drops?\.?$/i, 'OralDrops'],
      [/^drops?\.?$/i, 'Drops'],
      [/^cream\.?$/i, 'Cream'],
      [/^ointment\.?$/i, 'Ointment'],
      [/^gel\.?$/i, 'Gel'],
      [/^lotion\.?$/i, 'Lotion'],
      [/^powder\.?$/i, 'Powder'],
      [/^granules?\.?$/i, 'Granules'],
      [/^sachet\.?$/i, 'Sachet'],
      [/^patch\.?$/i, 'Patch'],
      [/^inhaler?\.?$/i, 'Inhaler'],
      [/^spray\.?$/i, 'Spray'],
      [/^suppository\.?$/i, 'Suppository'],
      [/^solution\.?$/i, 'Solution'],
      [/^emulsion\.?$/i, 'Emulsion'],
    ];
    for (const [rx, label] of NORMALISE) { if (rx.test(v)) return label; }
    const SCAN = [
      [/\binjection\b/i, 'Inj.'], [/\binj\.?\b/i, 'Inj.'],
      [/\btablets?\b/i, 'Tab'], [/\btabs?\.?\b/i, 'Tab'],
      [/\bcapsules?\b/i, 'Cap'], [/\bcaps?\.?\b/i, 'Cap'],
      [/\bsyrup\b/i, 'Syrup'],
      [/\bsuspension\b/i, 'Suspn'], [/\bsuspn\b/i, 'Suspn'],
      [/\boral\s*drops?\b/i, 'OralDrops'],
      [/\bdrops?\b/i, 'Drops'],
      [/\bcream\b/i, 'Cream'],
      [/\bointment\b/i, 'Ointment'],
      [/\bgel\b/i, 'Gel'],
      [/\blotion\b/i, 'Lotion'],
      [/\bpowder\b/i, 'Powder'],
      [/\bsachet\b/i, 'Sachet'],
      [/\bpatch\b/i, 'Patch'],
      [/\binhaler?\b/i, 'Inhaler'],
      [/\bspray\b/i, 'Spray'],
      [/\bsolution\b/i, 'Solution'],
    ];
    for (const [rx, label] of SCAN) { if (rx.test(v)) return label; }
    return v.charAt(0).toUpperCase() + v.slice(1);
  };

  const loadRequests = useCallback(async () => {
    setLoading(true);
    try {
      const r = await axios.get(`${API}/requests/DTCCommittee/${currentUser.USER_ID}`);
      setRequests(r.data);
    } catch { } finally { setLoading(false); }
  }, [currentUser]);

  const loadBlacklist = useCallback(async () => {
    setBlLoading(true);
    try {
      const r = await axios.get(`${API}/dtc/blacklist?user_id=${currentUser.USER_ID}`);
      setBlacklist(r.data || []);
    } catch (err) {
      setBlAlert({ type: 'error', msg: err.response?.data?.error || 'Failed to load blacklist.' });
    } finally { setBlLoading(false); }
  }, [currentUser]);

  const loadQuotas = useCallback(async () => {
    setQLoading(true);
    setQAlert(null);
    try {
      const r = await axios.get(`${API}/dtc/user-quotas`);
      setQuotas(r.data || []);
      const initialEdits = {};
      (r.data || []).forEach(q => {
        initialEdits[q.user_id] = q.quarterly_limit;
      });
      setQEditingLimit(initialEdits);
    } catch (err) {
      setQAlert({ type: 'error', msg: err.response?.data?.error || 'Failed to load request quotas.' });
    } finally { setQLoading(false); }
  }, []);

  const saveQuota = async (userId) => {
    const limitVal = qEditingLimit[userId];
    if (limitVal === undefined || limitVal === null || isNaN(Number(limitVal)) || Number(limitVal) < 0) {
      setQAlert({ type: 'error', msg: 'Please enter a valid non-negative number for the limit.' });
      return;
    }
    setQSubmitting(prev => ({ ...prev, [userId]: true }));
    setQAlert(null);
    try {
      await axios.put(`${API}/dtc/user-quotas/${userId}`, {
        quarterly_limit: Number(limitVal),
        performed_by: currentUser.USER_ID
      });
      setQuotas(prev => prev.map(q => {
        if (q.user_id === userId) {
          const used = q.used_this_quarter;
          const limit = Number(limitVal);
          return {
            ...q,
            quarterly_limit: limit,
            remaining_quota: Math.max(0, limit - used)
          };
        }
        return q;
      }));
      setQAlert({ type: 'success', msg: 'User request quota updated successfully.' });
    } catch (err) {
      setQAlert({ type: 'error', msg: err.response?.data?.error || 'Failed to save request quota.' });
    } finally {
      setQSubmitting(prev => ({ ...prev, [userId]: false }));
    }
  };

  useEffect(() => { loadRequests(); }, [loadRequests]);

  const addToBlacklist = async (e) => {
    e.preventDefault();
    if (!blForm.company_name.trim()) {
      setBlAlert({ type: 'error', msg: 'Company Name is required.' });
      return;
    }
    setBlSubmitting(true);
    setBlAlert(null);
    try {
      const res = await axios.post(`${API}/dtc/blacklist`, {
        ...blForm,
        performed_by: currentUser.USER_ID,
      });
      setBlAlert({ type: 'success', msg: res.data.message });
      setBlForm({ company_name: '', company_type: 'MANUFACTURER', remarks: '' });
      await loadBlacklist();
    } catch (err) {
      setBlAlert({ type: 'error', msg: err.response?.data?.error || 'Failed to add blacklist entry.' });
    } finally { setBlSubmitting(false); }
  };

  const removeFromBlacklist = async (id) => {
    if (!window.confirm('Remove this company from the blacklist?')) return;
    setBlRemoving(id);
    setBlAlert(null);
    try {
      const res = await axios.put(`${API}/dtc/blacklist/${id}/remove`, { performed_by: currentUser.USER_ID });
      setBlAlert({ type: 'success', msg: res.data.message });
      await loadBlacklist();
    } catch (err) {
      setBlAlert({ type: 'error', msg: err.response?.data?.error || 'Failed to remove entry.' });
    } finally { setBlRemoving(null); }
  };

  const openModal = async (req, act) => {
    setSelected(req);
    setAction(act);
    setApproveRemarks('');
    setSelectedReasons([]); setCustomRemarks(['']); setRemarkErr('');
    setEffectiveDrugEntries(req.effective_drug_entries || []);
    setLoadingAlts(true);
    try {
      const [altsRes, egdRes, auditRes] = await Promise.all([
        axios.get(`${API}/alternatives/${req.REQUEST_ID}`),
        axios.get(`${API}/requests/${req.REQUEST_ID}/existing-generic-data`),
        axios.get(`${API}/audit/${req.REQUEST_ID}`).catch(err => {
          console.error("Failed to load audit logs:", err);
          return { data: [] };
        })
      ]);
      const altsRaw = altsRes.data?.alternatives || [];
      const existingDetailsRaw = altsRes.data?.existing_details || [];
      setAlternatives(altsRaw);
      setAuditLogs(auditRes.data || []);

      const normalizedExistingDetails = existingDetailsRaw.map(ed => ({
        introduced_on: ed.INTRODUCED_ON ?? ed.introduced_on ?? '',
        brand_name: ed.BRAND_NAME ?? ed.brand_name ?? '',
        manufacturer: ed.MANUFACTURER ?? ed.manufacturer ?? '',
        marketer: ed.MARKETER ?? ed.marketer ?? '',
        consultant: ed.CONSULTANT ?? ed.consultant ?? '',
        present_stock: ed.PRESENT_STOCK ?? ed.present_stock ?? '',
        purchase_qty: ed.PURCHASE_QTY ?? ed.purchase_qty ?? '',
        sale_qty: ed.SALE_QTY ?? ed.sale_qty ?? '',
        pack: ed.PACK ?? ed.pack ?? '',
        mrp_inc_gst_nos: ed.MRP_INC_GST_NOS ?? ed.mrp_inc_gst_nos ?? '',
        rate_inc_gst_nos: ed.RATE_INC_GST_NOS ?? ed.rate_inc_gst_nos ?? '',
        markup_margin: ed.MARKUP_MARGIN ?? ed.markup_margin ?? '',
        scheme_qty: ed.SCHEME_QTY ?? ed.scheme_qty ?? '',
        scheme_offer: ed.SCHEME_OFFER ?? ed.scheme_offer ?? '',
        net_rate: ed.NET_RATE ?? ed.net_rate ?? '',
        profit_margin: ed.PROFIT_MARGIN ?? ed.profit_margin ?? '',
        absolute_margin: ed.ABSOLUTE_MARGIN ?? ed.absolute_margin ?? '',
        total_margin: ed.TOTAL_MARGIN ?? ed.total_margin ?? '',
        remark: ed.REMARK ?? ed.remark ?? '',
      }));
      setDtcExistingDetails(normalizedExistingDetails);

      const egd = egdRes.data?.existing_generic_data || null;
      setDtcEgdView(egd || {});
      if (altsRes.data?.effective_drug_entries) {
        setEffectiveDrugEntries(altsRes.data.effective_drug_entries);
      }

      // Normalize alternatives for ComparisonSheet
      setDtcAltView(altsRaw.map(a => ({
        // Preserve the database alt_id so buildAutoRecommendations can reference it
        alt_id: a.ALT_ID ?? a.alt_id ?? null,
        brand_name: a.BRAND_NAME || a.brand_name || '',
        manufacturer: a.MANUFACTURER || a.manufacturer || '',
        marketer: a.MARKETER || a.marketer || '',
        mrp_per_pack: a.MRP_PER_PACK ?? a.mrp_per_pack ?? '',
        rate_per_pack: a.RATE_PER_PACK ?? a.rate_per_pack ?? '',
        gst_percent: a.GST_PERCENT ?? a.gst_percent ?? '',
        mrp: a.MRP ?? a.mrp ?? '',
        rate: a.RATE ?? a.rate ?? '',
        qty: a.QTY ?? a.qty ?? '',
        offer: a.OFFER ?? a.offer ?? '',
        net_rate: a.NET_RATE ?? a.net_rate ?? '',
        margin: a.ABSOLUTE_MARGIN ?? a.margin ?? '',
        markupmargin: a.MARKUP_MARGIN ?? a.markupmargin ?? '',
        profit_margin: a.PROFIT_MARGIN ?? a.profit_margin ?? '',
        stock: a.STOCK || a.stock || '',
        purchase_qty: a.PURCHASE_QUANTITY ?? a.purchase_qty ?? '',
        consultant: a.CONSULTANT || a.consultant || '',
        sale_qty: a.SALE_QTY ?? a.sale_qty ?? '',
        pack: a.PACK || a.pack || '',
        introduced_on: a.INTRODUCED_ON || a.introduced_on || 'New Item',
        remark: a.REMARK || a.remark || '',
        negorate: a.NEGOTIATED_RATE ?? a.negorate ?? '',
        comparison_type: a.COMPARISON_TYPE || a.comparison_type || '',
        submitted_by: a.SUBMITTED_BY || a.submitted_by || '',

        // Negotiated fields
        negotiated_mrp: a.NEGOTIATED_MRP ?? a.negotiated_mrp ?? a.MRP_PER_PACK ?? a.mrp_per_pack ?? '',
        negotiated_rate: a.NEGOTIATED_RATE ?? a.negotiated_rate ?? a.RATE_PER_PACK ?? a.rate_per_pack ?? '',
        negotiated_gst: a.NEGOTIATED_GST ?? a.negotiated_gst ?? a.GST_PERCENT ?? a.gst_percent ?? '',
        negotiated_scheme_qty: a.NEGOTIATED_SCHEME_QTY ?? a.negotiated_scheme_qty ?? a.QTY ?? a.qty ?? '',
        negotiated_scheme_offer: a.NEGOTIATED_SCHEME_OFFER ?? a.negotiated_scheme_offer ?? a.OFFER ?? a.offer ?? '',
        negotiation_remarks: a.NEGOTIATION_REMARKS ?? a.negotiation_remarks ?? a.REMARK ?? a.remark ?? '',
      })));

      setDtcSelectedBrand(req.DTC_SELECTED_BRAND || '');
      setDtcSelectedCategory(req.DTC_SELECTED_CATEGORY || req.FORMULARY_REQUEST_TYPE || '');

      let reasons = [];
      if (req.DTC_SELECTION_REASONS) {
        try {
          reasons = JSON.parse(req.DTC_SELECTION_REASONS);
        } catch {
          reasons = req.DTC_SELECTION_REASONS.split(',').map(r => r.trim()).filter(Boolean);
        }
      }
      setDtcSelectionReasons(reasons);
      setDtcRecommendationNotes(req.DTC_RECOMMENDATION_NOTES || req.DTC_FINAL_SELECTION_NOTES || '');
      setDtcReviewedByName(altsRes.data?.dtc_reviewed_by_name || req.DTC_REVIEWED_BY_NAME || '');
      setDtcReviewSignature(altsRes.data?.dtc_review_signature || req.DTC_REVIEW_SIGNATURE || '');
      setDtcRemarks(altsRes.data?.dtc_remarks || req.DTC_REMARKS || req.DTC_FINAL_REMARKS || '');
      setPhFinalRecommendation(altsRes.data?.ph_final_recommendation || req.PH_FINAL_RECOMMENDATION || '');

      let recs = [];
      if (altsRes.data?.dtc_final_recommendations) {
        try {
          recs = JSON.parse(altsRes.data.dtc_final_recommendations);
        } catch (e) {
          console.error('Failed to parse dtc_final_recommendations JSON:', e);
        }
      } else if (req.DTC_FINAL_RECOMMENDATIONS) {
        try {
          recs = JSON.parse(req.DTC_FINAL_RECOMMENDATIONS);
        } catch (e) {
          console.error('Failed to parse req.DTC_FINAL_RECOMMENDATIONS JSON:', e);
        }
      }
      setDtcFinalRecommendations(recs);
    } catch (err) {
      console.error('Failed to load alternatives/generic data in DTC modal:', err);
      setAlternatives([]);
      setDtcAltView([]);
      setDtcEgdView({});
      setDtcExistingDetails([]);
    } finally { setLoadingAlts(false); }
  };
  const closeModal = () => {
    setSelected(null); setAction('');
    setApproveRemarks('');
    setSelectedReasons([]); setCustomRemarks(['']); setRemarkErr('');
    setAlternatives([]);
    setDtcAltView([]); setDtcEgdView({}); setDtcExistingDetails([]); setShowCompSheet(false);
    setSelectionType(''); setSelectedAltId(null); setSelectionNotes(''); setSelectionErr('');
    setDtcSelectedBrand(''); setDtcSelectedCategory(''); setDtcSelectionReasons([]); setDtcRecommendationNotes('');
    setAuditLogs([]);
    setDtcReviewedByName(''); setDtcReviewSignature(''); setDtcRemarks(''); setPhFinalRecommendation('');
    setDtcFinalRecommendations([]);
    setEffectiveDrugEntries([]);
  };

  const handleAction = async () => {
    if (action === 'reject') {
      const err = validateRejection(selectedReasons, customRemarks);
      if (err) { setRemarkErr(err); return; }
    }
    setSubmitting(true);
    try {
      const remarks = action === 'reject'
        ? composeRejectionRemarks(selectedReasons, customRemarks)
        : (approveRemarks.trim() || undefined);
      await axios.put(`${API}/requests/${selected.REQUEST_ID}/${action}`, {
        performed_by: currentUser.USER_ID,
        remarks,
        customRemarks: action === 'reject' ? customRemarks.filter(r => r.trim() !== '') : undefined,
      });
      const stage = selected.CURRENT_STAGE;
      setAlertMsg({
        type: action === 'approve' ? 'success' : 'error',
        msg: action === 'approve'
          ? stage === 'DTCFinal'
            ? `✅ Final DTC approval granted. Request #${selected.REQUEST_ID} forwarded to CEO.`
            : stage === 'EmergencyDTC'
              ? `✅ Emergency request #${selected.REQUEST_ID} approved!`
              : `✅ Request #${selected.REQUEST_ID} approved. Pharmacist will now submit alternatives.`
          : `❌ Request #${selected.REQUEST_ID} rejected.`,
      });
      closeModal();
      await loadRequests();
      setDashKey(k => k + 1);
    } catch (err) {
      setRemarkErr(err.response?.data?.error || 'Action failed.');
    } finally { setSubmitting(false); }
  };

  const getGenericDetails = async (generic_name) => {
    setGenericLoading(true);
    setDosageFilter('');
    setDosageFormFilter('');

    try {
      const res = await axios.post(`${API}/getGeneric`, {
        search: generic_name
      });

      setGenericlist(res.data.list || []);
      setShowGenericPopup(true);

    } catch (err) {
      console.error(err);

      setGenericlist([]);
      setShowGenericPopup(true);

    } finally {
      setGenericLoading(false);
    }
  };

  const handleDtcFinalize = async ({ recommendations, notes, reviewed_by_name, review_signature, dtc_remarks, alternatives: altRows, existing_details: existingRows }) => {
    if (!reviewed_by_name || !reviewed_by_name.trim()) {
      alert('Please enter DTC Chairperson Reviewed By Name.');
      return;
    }
    if (!review_signature || !review_signature.trim()) {
      alert('Please enter Electronic Approval Signature.');
      return;
    }

    setSubmittingSelection(true);
    try {
      const payload = {
        recommendations: recommendations || [],
        remarks: notes || '',
        performed_by: currentUser.USER_ID,
        dtc_reviewed_by_name: reviewed_by_name,
        dtc_review_signature: review_signature,
        dtc_remarks: dtc_remarks,
        alternatives: altRows || [],
        existing_details: existingRows || [],
      };

      await axios.post(`${API}/dtc/final-select/${selected.REQUEST_ID}`, payload);
      const selectedBrandsList = recommendations && recommendations.length > 0
        ? recommendations.map(rec => rec.brand_name).join(', ')
        : 'Selected via remarks';
      setAlertMsg({ type: 'success', msg: `✅ DTC review confirmed: ${selectedBrandsList}. Request #${selected.REQUEST_ID} forwarded to CEO.` });
      setShowCompSheet(false);
      closeModal();
      await loadRequests();
      setDashKey(k => k + 1);
    } catch (err) {
      alert(err.response?.data?.error || 'Finalization failed. Please try again.');
    } finally {
      setSubmittingSelection(false);
    }
  };


  const firstPass = requests.filter(r => r.CURRENT_STAGE === 'DTCCommittee');
  const finalPass = requests.filter(r => r.CURRENT_STAGE === 'DTCFinal');
  const emergency = requests.filter(r => r.CURRENT_STAGE === 'EmergencyDTC');

  const RequestTable = ({ rows, showAlternativesBtn = false, showEmergencyBadge = false, isFinalPass = false }) => (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            <th className="sticky-col">#ID</th><th>Brand Name</th><th>Generic</th><th>Category</th>
            <th>Doctor</th><th>Source</th><th>PH Remarks</th><th>Submitted</th>
            {/* <th>Effective Created</th> */}
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => {
            const isRejected = r.STATUS === "PHARMACY_HEAD_REJECTED_PENDING_DTC"; return (
              <tr key={r.REQUEST_ID} style={isRejected ? { background: "#fef2f2", borderLeft: "4px solid #dc2626" } : {}}>
                <td className="sticky-col" style={{ fontWeight: 700, color: showEmergencyBadge ? '#dc2626' : 'var(--primary-light)' }}>
                  {showEmergencyBadge ? '🚨 ' : ''}#{r.REQUEST_ID}
                </td>
                <td style={{ fontWeight: 600 }}>{r.BRAND_NAME}{isRejected && <span style={{ display: "block", fontSize: "0.7rem", color: "#b91c1c", marginTop: 2, fontWeight: 700 }}>⚠ Rejected by PH</span>}</td>
                <td style={{ color: 'var(--text-muted)' }}>
                  {r.GENERIC_NAME}
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    style={{
                      marginTop: 4,
                      borderColor: 'var(--primary)',
                      color: 'var(--primary)'
                    }}
                    onClick={() => getGenericDetails(r.GENERIC_NAME, r.DOSAGE_FORM)}
                    disabled={genericLoading}
                  >
                    {genericLoading ? (
                      <>
                        <div
                          className="spinner"
                          style={{ width: 12, height: 12, borderWidth: 2 }}
                        />
                        {' '}Fetching…
                      </>
                    ) : (
                      'Check ExistingDrugs'
                    )}
                  </button>
                </td>
                <td>{r.CATEGORY}</td>
                <td>
                  <div>{r.DOCTOR_NAME}</div>
                  <small className="text-muted" style={{ display: 'block', fontSize: '0.75rem' }}>
                    {r.CREATED_BY_ROLE || 'Doctor'} • {r.DOCTOR_DEPT || ''}
                  </small>
                </td>
                <td>{r.REQUEST_SOURCE_TYPE === 'NON_PROMOTIONAL' ? <span className="badge badge-non-promotional">Clinician initiated</span> : <span className="badge badge-promotional">Via Medical Representative</span>}</td>
                <td style={{ fontSize: '0.78rem', color: isRejected ? '#991b1b' : 'var(--text-muted)', maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.PH_REMARKS}>
                  {isRejected && <span style={{ fontWeight: 700 }}>⚠ Rejection Reason: </span>}
                  {r.PH_REMARKS || '—'}
                </td>
                <td style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{new Date(r.CREATED_AT).toLocaleDateString('en-IN')}</td>
                {/* <td style={{ fontSize: '0.8rem', color: 'var(--primary-light)' }}>
                  {r.EFFECTIVE_CREATED_AT
                    ? new Date(r.EFFECTIVE_CREATED_AT).toLocaleString('en-IN')
                    : new Date(r.CREATED_AT).toLocaleString('en-IN')}
                </td> */}
                <td>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button className="btn btn-ghost btn-sm" onClick={() => openModal(r, 'view')}>
                      {isFinalPass ? '🏆 Review & Select' : showAlternativesBtn ? '📊 View' : '👁 View'}
                    </button>
                    {!isFinalPass && (
                      <button className="btn btn-success btn-sm" onClick={() => openModal(r, 'approve')}>
                        {showEmergencyBadge ? '✅ Approve' : '✓ Approve'}
                      </button>
                    )}
                    <button className="btn btn-danger btn-sm" onClick={() => openModal(r, 'reject')}>✕ Reject</button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );

  const renderWorkflowRemarks = () => {
    const orderedRemarks = getOrderedRemarks(selected, auditLogs);
    if (orderedRemarks.length === 0) return null;

    const getStageColor = (stage) => {
      switch (stage) {
        case 'Doctor': return '#2563eb';
        case 'HOD': return '#0d9488';
        case 'Pharmacist': return '#d97706';
        case 'Pharmacy Head': return '#7c3aed';
        case 'DTC': return '#db2777';
        case 'CEO': return '#16a34a';
        default: return '#64748b';
      }
    };

    const getStageBgColor = (stage) => {
      switch (stage) {
        case 'Doctor': return '#dbeafe';
        case 'HOD': return '#ccfbf1';
        case 'Pharmacist': return '#fef3c7';
        case 'Pharmacy Head': return '#ede9fe';
        case 'DTC': return '#fce7f3';
        case 'CEO': return '#dcfce7';
        default: return '#f1f5f9';
      }
    };

    return (
      <div style={{ marginTop: 24, borderTop: '1px solid var(--border)', paddingTop: 20 }}>
        <div style={{ fontWeight: 700, fontSize: '0.92rem', color: 'var(--text)', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
          <span>💬</span> Workflow Remarks History
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {orderedRemarks.map((rem, idx) => (
            <div key={idx} style={{
              background: 'var(--card-bg, #fff)',
              border: '1px solid var(--border)',
              borderLeft: `4px solid ${getStageColor(rem.stage)}`,
              borderRadius: '8px',
              padding: '12px 16px',
              boxShadow: '0 1px 3px rgba(0,0,0,0.05)'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 8, marginBottom: 6 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{
                    fontSize: '0.72rem',
                    fontWeight: 700,
                    background: getStageBgColor(rem.stage),
                    color: getStageColor(rem.stage),
                    padding: '2px 8px',
                    borderRadius: '12px',
                    textTransform: 'uppercase'
                  }}>
                    {rem.stage}
                  </span>
                  {rem.author && (
                    <span style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text)' }}>
                      {rem.author}
                    </span>
                  )}
                </div>
                {rem.timestamp && (
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                    {new Date(rem.timestamp).toLocaleString('en-IN')}
                  </span>
                )}
              </div>
              <div style={{ fontSize: '0.85rem', color: 'var(--text-dark, #334155)', lineHeight: 1.5, whiteSpace: 'pre-line' }}>
                {rem.text}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  return (
    <div>
      <div className="inner-tabs">
        {[
          { key: 'pending', label: `🏛️ First Review (${firstPass.length})` },
          { key: 'final', label: `✅ Final Evaluation (${finalPass.length})` },
          { key: 'emergency', label: `🚨 Emergency (${emergency.length})` },
          { key: 'blacklist', label: '🚫 Blacklist Management' },
          { key: 'quota_management', label: '👨‍⚕️ User Quota Management' },
          { key: 'dashboard', label: '📊 Dashboard' },
          { key: 'notifications', label: '🔔 Notifications' },
        ].map(({ key, label }) => (
          <button key={key} className={`inner-tab-btn ${view === key ? 'active' : ''}`}
            onClick={() => {
              setView(key);
              if (key === 'blacklist') loadBlacklist();
              if (key === 'quota_management') loadQuotas();
            }}>{label}</button>
        ))}
      </div>

      {alertMsg && (
        <div className={`alert alert-${alertMsg.type}`} style={{ marginBottom: 18 }}>
          {alertMsg.msg}
          <button style={{ float: 'right', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 700 }}
            onClick={() => setAlertMsg(null)}>✕</button>
        </div>
      )}

      {/* ======== FIRST PASS DTC ======== */}
      {view === 'pending' && (
        <div className="card">
          <div className="card-title" style={{ justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div className="icon">🏛️</div>Requests Approved by Pharmacy Head
              <span className="badge badge-info">DTC First Review</span>
            </div>
            <button className="btn btn-ghost btn-sm" onClick={loadRequests}>↺ Refresh</button>
          </div>
          <div className="alert alert-info" style={{ marginBottom: 18, fontSize: '0.82rem' }}>
            💡 Approving here will send the request to the Pharmacist for quotation analysis (not directly to CEO).
          </div>
          {loading ? <div style={{ textAlign: 'center', padding: 60 }}><div className="spinner" /></div>
            : firstPass.length === 0 ? <div style={{ textAlign: 'center', padding: 60, color: 'var(--text-subtle)' }}><div style={{ fontSize: '3rem', marginBottom: 12 }}>✅</div>No requests pending DTC first review.</div>
              : <RequestTable rows={firstPass} />}
        </div>
      )}

      {/* ======== FINAL DTC EVALUATION ======== */}
      {view === 'final' && (
        <div className="card">
          <div className="card-title" style={{ justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div className="icon">✅</div>Final DTC Evaluation
              <span className="badge badge-approved">With Pharmacist Quotations</span>
            </div>
            <button className="btn btn-ghost btn-sm" onClick={loadRequests}>↺ Refresh</button>
          </div>
          <div className="alert alert-info" style={{ marginBottom: 18, fontSize: '0.82rem' }}>
            💡 Review the Pharmacist's alternatives and comparison data. Select the best option and forward to CEO for final approval.
          </div>
          {finalPass.length === 0 ? <div style={{ textAlign: 'center', padding: 60, color: 'var(--text-subtle)' }}><div style={{ fontSize: '3rem', marginBottom: 12 }}>📭</div>No requests pending final DTC evaluation.</div>
            : <RequestTable rows={finalPass} showAlternativesBtn isFinalPass />}
        </div>
      )}

      {/* ======== EMERGENCY DTC ======== */}
      {view === 'emergency' && (
        <div className="card">
          <div className="card-title" style={{ justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div className="icon">🚨</div>Emergency Drug Requests
              <span className="badge" style={{ background: '#fee2e2', color: '#991b1b' }}>Requires Immediate Decision</span>
            </div>
            <button className="btn btn-ghost btn-sm" onClick={loadRequests}>↺ Refresh</button>
          </div>
          <div className="alert alert-warning" style={{ marginBottom: 18, fontSize: '0.82rem' }}>
            ⚠️ Only DTC has authority to approve or reject emergency requests. Pharmacy Head and Pharmacist have view-only access.
          </div>
          {emergency.length === 0 ? <div style={{ textAlign: 'center', padding: 60, color: 'var(--text-subtle)' }}><div style={{ fontSize: '3rem', marginBottom: 12 }}>✅</div>No active emergency requests.</div>
            : <RequestTable rows={emergency} showEmergencyBadge />}
        </div>
      )}

      {view === 'dashboard' && <AnalyticsDashboard role="DTCCommittee" />}
      {view === 'notifications' && <Notifications userId={currentUser.USER_ID} onRead={onNotificationsRead} />}

      {/* ======== USER QUOTA MANAGEMENT ======== */}
      {view === 'quota_management' && (() => {
        const uniqueDepts = [...new Set(quotas.map(q => q.department).filter(Boolean))].sort();
        const filteredQuotas = quotas.filter(q => {
          const nameMatch = !qSearch || q.name.toLowerCase().includes(qSearch.toLowerCase());
          const roleMatch = !qRoleFilter || q.role.toLowerCase() === qRoleFilter.toLowerCase();
          const deptMatch = !qDeptFilter || q.department === qDeptFilter;
          return nameMatch && roleMatch && deptMatch;
        });

        return (
          <div>
            {qAlert && (
              <div className={`alert alert-${qAlert.type}`} style={{ marginBottom: 18 }}>
                {qAlert.msg}
                <button style={{ float: 'right', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 700 }}
                  onClick={() => setQAlert(null)}>✕</button>
              </div>
            )}

            {/* Search + Filters card */}
            <div className="card" style={{ marginBottom: 20 }}>
              <div className="card-title">
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div className="icon">👨‍⚕️</div>User Quota Management
                </div>
              </div>
              <div className="form-grid" style={{ gridTemplateColumns: '2fr 1fr 1fr', gap: 14 }}>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">Search User Name</label>
                  <input
                    className="form-input"
                    placeholder="🔍 Search Doctor or HOD name..."
                    value={qSearch}
                    onChange={e => setQSearch(e.target.value)}
                  />
                </div>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">Filter by Role</label>
                  <select
                    className="form-select"
                    value={qRoleFilter}
                    onChange={e => setQRoleFilter(e.target.value)}
                  >
                    <option value="">All Roles</option>
                    <option value="doctor">Doctor</option>
                    <option value="hod">HOD</option>
                  </select>
                </div>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">Filter by Department</label>
                  <select
                    className="form-select"
                    value={qDeptFilter}
                    onChange={e => setQDeptFilter(e.target.value)}
                  >
                    <option value="">All Departments</option>
                    {uniqueDepts.map(d => (
                      <option key={d} value={d}>{d}</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            {/* User Table card */}
            <div className="card">
              <div className="card-title" style={{ justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div className="icon">📋</div>User Limits & Quarterly Usage
                </div>
                <button className="btn btn-ghost btn-sm" onClick={loadQuotas}>↺ Refresh</button>
              </div>
              {qLoading ? (
                <div style={{ textAlign: 'center', padding: 48 }}><div className="spinner" /></div>
              ) : filteredQuotas.length === 0 ? (
                <div style={{ textAlign: 'center', padding: 48, color: 'var(--text-subtle)' }}>
                  <div style={{ fontSize: '3rem', marginBottom: 10 }}>🔍</div>
                  No users match the search criteria.
                </div>
              ) : (
                <div className="table-wrap">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th className="sticky-col">User</th>
                        <th>Role</th>
                        <th>Department</th>
                        <th style={{ textAlign: 'center' }}>Used</th>
                        <th style={{ width: '150px', textAlign: 'center' }}>Limit</th>
                        <th style={{ textAlign: 'center' }}>Remaining</th>
                        <th style={{ width: '120px' }}>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredQuotas.map(item => {
                        const used = item.used_this_quarter;
                        const limit = item.quarterly_limit;
                        const pct = limit > 0 ? (used / limit) * 100 : 0;

                        let statusColor = '#059669'; // Green
                        let statusBg = 'rgba(5, 150, 105, 0.08)';
                        if (used >= limit) {
                          statusColor = '#dc2626'; // Red
                          statusBg = 'rgba(220, 38, 38, 0.08)';
                        } else if (pct > 80) {
                          statusColor = '#d97706'; // Yellow/Orange
                          statusBg = 'rgba(217, 119, 6, 0.08)';
                        }

                        return (
                          <tr key={item.user_id}>
                            <td className="sticky-col">
                              <div style={{ fontWeight: 700 }}>{item.name}</div>
                              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{item.email}</div>
                            </td>
                            <td>
                              <span className="badge" style={
                                item.role.toLowerCase() === 'hod'
                                  ? { background: '#ede9fe', color: '#6d28d9' }
                                  : { background: '#e0f2fe', color: '#0369a1' }
                              }>
                                {item.role.toUpperCase()}
                              </span>
                            </td>
                            <td style={{ color: 'var(--text-muted)' }}>{item.department || '—'}</td>
                            <td style={{ textAlign: 'center', fontWeight: 600 }}>
                              <span style={{
                                padding: '3px 8px', borderRadius: 12,
                                color: statusColor, background: statusBg,
                                fontSize: '0.85rem'
                              }}>
                                {used}
                              </span>
                            </td>
                            <td style={{ textAlign: 'center' }}>
                              <input
                                type="number"
                                className="form-input"
                                style={{ width: '80px', textAlign: 'center', padding: '6px', margin: '0 auto', display: 'block' }}
                                value={qEditingLimit[item.user_id] ?? ''}
                                onChange={e => {
                                  const val = e.target.value;
                                  setQEditingLimit(prev => ({ ...prev, [item.user_id]: val }));
                                }}
                                min="0"
                              />
                            </td>
                            <td style={{ textAlign: 'center', fontWeight: 600, color: item.remaining_quota === 0 ? 'var(--danger)' : 'var(--text-muted)' }}>
                              {item.remaining_quota}
                            </td>
                            <td>
                              <button
                                className="btn btn-primary btn-sm"
                                style={{ width: '100%', background: 'var(--primary)', borderColor: 'var(--primary)' }}
                                onClick={() => saveQuota(item.user_id)}
                                disabled={qSubmitting[item.user_id] || Number(qEditingLimit[item.user_id]) === limit}
                              >
                                {qSubmitting[item.user_id] ? (
                                  <div className="spinner" style={{ display: 'inline-block', width: 12, height: 12 }} />
                                ) : (
                                  'Save'
                                )}
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {/* ======== BLACKLIST MANAGEMENT ======== */}
      {view === 'blacklist' && (
        <div>
          {blAlert && (
            <div className={`alert alert-${blAlert.type}`} style={{ marginBottom: 18 }}>
              {blAlert.msg}
              <button style={{ float: 'right', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 700 }}
                onClick={() => setBlAlert(null)}>✕</button>
            </div>
          )}

          {/* Summary Stats */}
          <div style={{ display: 'flex', gap: 16, marginBottom: 20 }}>
            {[
              { label: 'Blacklisted Manufacturers', color: '#dc2626', bg: '#fef2f2', val: blacklist.filter(b => b.COMPANY_TYPE === 'MANUFACTURER').length },
              { label: 'Blacklisted Marketers', color: '#d97706', bg: '#fffbeb', val: blacklist.filter(b => b.COMPANY_TYPE === 'MARKETER').length },
            ].map(({ label, color, bg, val }) => (
              <div key={label} style={{ flex: 1, background: bg, border: `1px solid ${color}30`, borderLeft: `4px solid ${color}`, borderRadius: 10, padding: '14px 18px' }}>
                <div style={{ fontSize: '2rem', fontWeight: 800, color }}>{val}</div>
                <div style={{ fontSize: '0.82rem', color, fontWeight: 600, marginTop: 2 }}>{label}</div>
              </div>
            ))}
          </div>

          {/* Add Entry Form */}
          <div className="card" style={{ marginBottom: 20 }}>
            <div className="card-title">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div className="icon">🚫</div>Add Company to Blacklist
              </div>
            </div>
            <form onSubmit={addToBlacklist}>
              <div className="form-grid" style={{ gridTemplateColumns: '2fr 1fr', gap: 14, marginBottom: 14 }}>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">Company Name <span className="req">*</span></label>
                  <input
                    className="form-input"
                    placeholder="Enter exact manufacturer or marketer name"
                    value={blForm.company_name}
                    onChange={e => setBlForm(f => ({ ...f, company_name: e.target.value }))}
                  />
                </div>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">Company Type <span className="req">*</span></label>
                  <select
                    className="form-select"
                    value={blForm.company_type}
                    onChange={e => setBlForm(f => ({ ...f, company_type: e.target.value }))}
                  >
                    <option value="MANUFACTURER">Manufacturer</option>
                    <option value="MARKETER">Marketer</option>
                  </select>
                </div>
              </div>
              <div className="form-group" style={{ marginBottom: 14 }}>
                <label className="form-label">Blacklist Reason / Remarks</label>
                <textarea
                  className="form-textarea"
                  rows={2}
                  placeholder="State the reason for blacklisting (e.g. quality complaints, regulatory issues...)"
                  value={blForm.remarks}
                  onChange={e => setBlForm(f => ({ ...f, remarks: e.target.value }))}
                />
              </div>
              <div style={{ display: 'flex', gap: 10 }}>
                <button type="submit" className="btn btn-danger" disabled={blSubmitting}>
                  {blSubmitting ? <><div className="spinner" style={{ display: 'inline-block', width: 14, height: 14, marginRight: 6 }} />Adding…</> : '🚫 Add to Blacklist'}
                </button>
                <button type="button" className="btn btn-ghost"
                  onClick={() => setBlForm({ company_name: '', company_type: 'MANUFACTURER', remarks: '' })}
                  disabled={blSubmitting}>↺ Reset</button>
              </div>
            </form>
          </div>

          {/* Blacklist Table */}
          <div className="card">
            <div className="card-title" style={{ justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div className="icon">📋</div>Active Blacklist
              </div>
              <button className="btn btn-ghost btn-sm" onClick={loadBlacklist}>↺ Refresh</button>
            </div>
            {blLoading ? (
              <div style={{ textAlign: 'center', padding: 48 }}><div className="spinner" /></div>
            ) : blacklist.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 48, color: 'var(--text-subtle)' }}>
                <div style={{ fontSize: '3rem', marginBottom: 10 }}>✅</div>
                No companies are currently blacklisted.
              </div>
            ) : (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>#ID</th><th>Company Name</th><th>Type</th>
                      <th>Remarks / Reason</th><th>Blacklisted By</th>
                      <th>Date</th><th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {blacklist.map(b => (
                      <tr key={b.BLACKLIST_ID}>
                        <td style={{ fontWeight: 700, color: 'var(--primary-light)' }}>#{b.BLACKLIST_ID}</td>
                        <td style={{ fontWeight: 700 }}>{b.COMPANY_NAME}</td>
                        <td>
                          <span className="badge" style={
                            b.COMPANY_TYPE === 'MANUFACTURER'
                              ? { background: '#fef2f2', color: '#991b1b' }
                              : { background: '#fffbeb', color: '#92400e' }
                          }>
                            {b.COMPANY_TYPE === 'MANUFACTURER' ? '🏭 Manufacturer' : '📦 Marketer'}
                          </span>
                        </td>
                        <td style={{ fontSize: '0.82rem', color: 'var(--text-muted)', maxWidth: 220, wordBreak: 'break-word' }}>
                          {b.REMARKS || '—'}
                        </td>
                        <td style={{ fontSize: '0.82rem' }}>{b.CREATED_BY_NAME || '—'}</td>
                        <td style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                          {b.CREATED_AT ? new Date(b.CREATED_AT).toLocaleDateString('en-IN') : '—'}
                        </td>
                        <td>
                          <button
                            className="btn btn-ghost btn-sm"
                            style={{ color: '#dc2626', borderColor: '#dc2626' }}
                            onClick={() => removeFromBlacklist(b.BLACKLIST_ID)}
                            disabled={blRemoving === b.BLACKLIST_ID}
                          >
                            {blRemoving === b.BLACKLIST_ID
                              ? <><div className="spinner" style={{ display: 'inline-block', width: 12, height: 12, marginRight: 4 }} />Removing…</>
                              : '✕ Remove'}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ======== VIEW DETAIL MODAL ======== */}
      {selected && action === 'view' && (
        <div className="modal-overlay" onClick={closeModal}>
          <div className="modal" style={{ maxWidth: '94vw', width: '94vw', maxHeight: '88vh', display: 'flex', flexDirection: 'column', padding: 0, overflow: 'hidden' }}
            onClick={e => e.stopPropagation()}>
            <div style={{ padding: '18px 24px', borderBottom: '1px solid var(--border)', fontWeight: 700, fontSize: '1.05rem', flexShrink: 0 }}>
              📋 Request #{selected.REQUEST_ID} — {selected.BRAND_NAME}
              {selected.IS_EMERGENCY === 1 && <span className="badge" style={{ marginLeft: 8, background: '#fee2e2', color: '#991b1b' }}>🚨 Emergency</span>}
            </div>
            <div style={{ overflowY: 'auto', flex: 1, padding: '20px 24px' }}>
              <table className="details-table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem', marginBottom: 16 }}>
                <tbody>
                  {DETAIL_ROWS.map(([label, key]) => (
                    <tr key={key} style={{ borderBottom: '1px solid var(--border)' }}>
                      <td style={{ padding: '9px 12px', color: 'var(--text-muted)', width: '42%', fontWeight: 600, fontSize: '0.8rem' }}>{label}</td>
                      <td style={{ padding: '9px 12px', color: 'var(--text)' }}>
                        {key === 'COST_REDUCTION_BENEFIT'
                          ? (selected[key] ? '✅ Yes' : '❌ No')
                          : key === 'FORMULARY_REQUEST_TYPE'
                            ? (selected[key] === 'FORMULARY' ? <span className="badge" style={{ background: '#ecfdf5', color: '#065f46' }}>Formulary Drug Addition Request</span> : selected[key] === 'NON_FORMULARY' ? <span className="badge" style={{ background: '#fef2f2', color: '#991b1b' }}>Non-Formulary Drug Request</span> : '—')
                            : key === 'REQUEST_SOURCE_TYPE'
                              ? (selected[key] === 'NON_PROMOTIONAL'
                                ? <span className="badge badge-non-promotional">Clinician initiated</span>
                                : <span className="badge badge-promotional">Via Medical Representative</span>)
                              : key === 'EFFECTIVE_CREATED_AT'
                                ? (() => {
                                  const raw = selected.EFFECTIVE_CREATED_AT || selected.CREATED_AT;
                                  return raw
                                    ? <span style={{ fontWeight: 600, color: 'var(--primary-light)' }}>{new Date(raw).toLocaleString('en-IN')}</span>
                                    : '—';
                                })()
                                : key === 'CREATED_AT'
                                  ? (selected[key] ? new Date(selected[key]).toLocaleString('en-IN') : '—')
                                  : (selected[key] || '—')}
                      </td>
                    </tr>
                  ))}
                  {selected.REQUEST_SOURCE_TYPE !== 'NON_PROMOTIONAL' && (
                    [['Med Rep Name', 'MED_REP_NAME'], ['Med Rep Email', 'MED_REP_EMAIL'], ['Med Rep Phone', 'MED_REP_PHONE']].map(([label, key]) => (
                      <tr key={key} style={{ borderBottom: '1px solid var(--border)' }}>
                        <td style={{ padding: '9px 12px', color: 'var(--text-muted)', width: '42%', fontWeight: 600, fontSize: '0.8rem' }}>{label}</td>
                        <td style={{ padding: '9px 12px', color: 'var(--text)' }}>{selected[key] || '—'}</td>
                      </tr>
                    ))
                  )}
                  <tr style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '9px 12px', color: 'var(--text-muted)', fontWeight: 600, fontSize: '0.8rem', verticalAlign: 'top' }}>Clinical Justification</td>
                    <td style={{ padding: '9px 12px', color: 'var(--text)', lineHeight: 1.6 }}>{selected.CLINICAL_JUSTIFICATION}</td>
                  </tr>
                </tbody>
              </table>
              {selected.AI_CONTENT && (
                <div className="alert alert-info" style={{ marginTop: 8, marginBottom: 16 }}>
                  <strong>🤖 AI Drug Profile</strong>
                  <div style={{ marginTop: 8 }}><ReactMarkdown>{selected.AI_CONTENT.replace(/<br\s*\/?>/g, '\n')}</ReactMarkdown></div>
                </div>
              )}

              {/* ── Patient Information Block (Emergency Only) ── */}
              {selected.IS_EMERGENCY === 1 && (
                <div style={{ marginTop: 16, marginBottom: 16 }}>
                  <div style={{
                    fontSize: '0.78rem', fontWeight: 700, color: '#dc2626',
                    textTransform: 'uppercase', letterSpacing: '0.08em',
                    marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6
                  }}>
                    <span>🧑</span> Patient Information
                  </div>
                  <div style={{
                    background: 'rgba(220,38,38,0.04)', border: '1px solid rgba(220,38,38,0.2)',
                    borderLeft: '4px solid #dc2626', borderRadius: 10, overflow: 'hidden'
                  }}>
                    <table className="details-table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
                      <tbody>
                        {[
                          ['MRNO', selected.PATIENT_MRNO],
                          ['Patient Name', selected.PATIENT_NAME],
                          ['Age', selected.PATIENT_AGE],
                          ['Diagnosis', selected.PATIENT_DIAGNOSIS],
                          ['Department / Ward', selected.PATIENT_DEPARTMENT],
                          ['Visit ID', selected.PATIENT_VISIT_ID],
                        ].map(([label, val]) => (
                          <tr key={label} style={{ borderBottom: '1px solid rgba(220,38,38,0.1)' }}>
                            <td style={{ padding: '8px 14px', color: '#b91c1c', width: '42%', fontWeight: 600, fontSize: '0.8rem' }}>{label}</td>
                            <td style={{ padding: '8px 14px', color: 'var(--text)', fontWeight: val ? 500 : 400 }}>{val || <span style={{ color: 'var(--text-subtle)' }}>—</span>}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* ── Effective Drug Entries Section ── */}
              {effectiveDrugEntries && effectiveDrugEntries.length > 0 && (
                <div style={{ marginTop: 20 }}>
                  <div style={{
                    fontSize: '0.78rem', fontWeight: 700, color: 'var(--primary-light)',
                    textTransform: 'uppercase', letterSpacing: '0.08em',
                    marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6
                  }}>
                    <span>📋</span> Drug Effective Created Entries
                  </div>
                  <div style={{ overflowX: 'auto', border: '1px solid rgba(124, 58, 237, 0.15)', borderRadius: 10, background: '#ffffff' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.72rem', textAlign: 'left', minWidth: '1800px' }}>
                      <thead style={{ background: 'rgba(124, 58, 237, 0.05)', borderBottom: '2px solid rgba(124, 58, 237, 0.15)' }}>
                        <tr>
                          <th style={{ padding: '8px 10px', fontWeight: 600, color: 'var(--primary-light)' }}>Drug Name</th>
                          <th style={{ padding: '8px 10px', fontWeight: 600, color: 'var(--primary-light)' }}>Brand Name</th>
                          <th style={{ padding: '8px 10px', fontWeight: 600, color: 'var(--primary-light)' }}>Manufacturer</th>
                          <th style={{ padding: '8px 10px', fontWeight: 600, color: 'var(--primary-light)' }}>Marketer</th>
                          <th style={{ padding: '8px 10px', fontWeight: 600, color: 'var(--primary-light)' }}>Consultant</th>
                          <th style={{ padding: '8px 10px', fontWeight: 600, color: 'var(--primary-light)', textAlign: 'right' }}>Present Stock</th>
                          <th style={{ padding: '8px 10px', fontWeight: 600, color: 'var(--primary-light)', textAlign: 'right' }}>Purchase Qty</th>
                          <th style={{ padding: '8px 10px', fontWeight: 600, color: 'var(--primary-light)', textAlign: 'right' }}>Sale Qty</th>
                          <th style={{ padding: '8px 10px', fontWeight: 600, color: 'var(--primary-light)' }}>Pack</th>
                          <th style={{ padding: '8px 10px', fontWeight: 600, color: 'var(--primary-light)', textAlign: 'right' }}>MRP</th>
                          <th style={{ padding: '8px 10px', fontWeight: 600, color: 'var(--primary-light)', textAlign: 'right' }}>Rate</th>
                          <th style={{ padding: '8px 10px', fontWeight: 600, color: 'var(--primary-light)', textAlign: 'right' }}>Margin</th>
                          <th style={{ padding: '8px 10px', fontWeight: 600, color: 'var(--primary-light)' }}>Scheme Qty</th>
                          <th style={{ padding: '8px 10px', fontWeight: 600, color: 'var(--primary-light)' }}>Offer Qty</th>
                          <th style={{ padding: '8px 10px', fontWeight: 600, color: 'var(--primary-light)', textAlign: 'right' }}>Net Rate</th>
                          <th style={{ padding: '8px 10px', fontWeight: 600, color: 'var(--primary-light)', textAlign: 'right' }}>Profit Margin</th>
                          <th style={{ padding: '8px 10px', fontWeight: 600, color: 'var(--primary-light)', textAlign: 'right' }}>Total Margin</th>
                          <th style={{ padding: '8px 10px', fontWeight: 600, color: 'var(--primary-light)', width: '120px' }}>Introduced On</th>
                          <th style={{ padding: '8px 10px', fontWeight: 600, color: 'var(--primary-light)' }}>Effective Created Date</th>
                          <th style={{ padding: '8px 10px', fontWeight: 600, color: 'var(--primary-light)' }}>Remarks</th>
                        </tr>
                      </thead>
                      <tbody>
                        {effectiveDrugEntries.map((entry, idx) => {
                          const rawDate = entry.effective_created_at || entry.EFFECTIVE_CREATED_AT;
                          const formattedDate = rawDate ? new Date(rawDate).toLocaleString('en-IN') : '—';
                          return (
                            <tr key={idx} style={{ borderBottom: '1px solid rgba(124, 58, 237, 0.1)', background: idx % 2 === 0 ? '#ffffff' : 'rgba(124, 58, 237, 0.01)' }}>
                              <td style={{ padding: '6px 8px', fontWeight: 600, color: 'var(--text)' }}>{entry.drug_name || entry.DRUG_NAME || '—'}</td>
                              <td style={{ padding: '6px 8px' }}>{entry.brand_name || entry.BRAND_NAME || '—'}</td>
                              <td style={{ padding: '6px 8px' }}>{entry.manufacturer || entry.MANUFACTURER || '—'}</td>
                              <td style={{ padding: '6px 8px' }}>{entry.marketer || entry.MARKETER || '—'}</td>
                              <td style={{ padding: '6px 8px' }}>{entry.consultant || entry.CONSULTANT || '—'}</td>
                              <td style={{ padding: '6px 8px', textAlign: 'right' }}>{entry.present_stock !== undefined ? entry.present_stock : (entry.PRESENT_STOCK !== undefined ? entry.PRESENT_STOCK : '—')}</td>
                              <td style={{ padding: '6px 8px', textAlign: 'right' }}>{entry.purchase_quantity !== undefined ? entry.purchase_quantity : (entry.PURCHASE_QUANTITY !== undefined ? entry.PURCHASE_QUANTITY : '—')}</td>
                              <td style={{ padding: '6px 8px', textAlign: 'right' }}>{entry.sale_qty !== undefined ? entry.sale_qty : (entry.SALE_QTY !== undefined ? entry.SALE_QTY : '—')}</td>
                              <td style={{ padding: '6px 8px' }}>{entry.pack || entry.PACK || '—'}</td>
                              <td style={{ padding: '6px 8px', textAlign: 'right' }}>{entry.mrp_incl_gst !== undefined ? entry.mrp_incl_gst : (entry.MRP_INCL_GST !== undefined ? entry.MRP_INCL_GST : '—')}</td>
                              <td style={{ padding: '6px 8px', textAlign: 'right' }}>{entry.rate_incl_gst !== undefined ? entry.rate_incl_gst : (entry.RATE_INCL_GST !== undefined ? entry.RATE_INCL_GST : '—')}</td>
                              <td style={{ padding: '6px 8px', textAlign: 'right' }}>{entry.absolute_margin !== undefined ? entry.absolute_margin : (entry.ABSOLUTE_MARGIN !== undefined ? entry.ABSOLUTE_MARGIN : '—')}</td>
                              <td style={{ padding: '6px 8px' }}>{entry.scheme_qty || entry.SCHEME_QTY || '—'}</td>
                              <td style={{ padding: '6px 8px' }}>{entry.offer_qty || entry.OFFER_QTY || '—'}</td>
                              <td style={{ padding: '6px 8px', textAlign: 'right' }}>{entry.net_rate !== undefined ? entry.net_rate : (entry.NET_RATE !== undefined ? entry.NET_RATE : '—')}</td>
                              <td style={{ padding: '6px 8px', textAlign: 'right' }}>{entry.profit_margin !== undefined ? (typeof entry.profit_margin === 'number' ? `${entry.profit_margin}%` : entry.profit_margin) : (entry.PROFIT_MARGIN !== undefined ? (typeof entry.PROFIT_MARGIN === 'number' ? `${entry.PROFIT_MARGIN}%` : entry.PROFIT_MARGIN) : '—')}</td>
                              <td style={{ padding: '6px 8px', textAlign: 'right' }}>{entry.total_margin_markup !== undefined ? (typeof entry.total_margin_markup === 'number' ? `${entry.total_margin_markup}%` : entry.total_margin_markup) : (entry.TOTAL_MARGIN_MARKUP !== undefined ? (typeof entry.TOTAL_MARGIN_MARKUP === 'number' ? `${entry.TOTAL_MARGIN_MARKUP}%` : entry.TOTAL_MARGIN_MARKUP) : '—')}</td>
                              <td style={{ padding: '6px 8px' }}>
                                {(()=>{
                                  const val = entry.introduced_on || entry.INTRODUCED_ON;
                                  if (!val) return '—';
                                  const d = new Date(val);
                                  if (isNaN(d.getTime())) return String(val);
                                  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
                                })()}
                              </td>
                              <td style={{ padding: '6px 8px' }}>{formattedDate}</td>
                              <td style={{ padding: '6px 8px' }}>{entry.remarks || entry.REMARKS || '—'}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {selected.CURRENT_STAGE === 'DTCFinal' && (
                <div style={{ marginTop: 16 }}>
                  <div style={{ fontWeight: 700, marginBottom: 12 }}>📊 Pharmacist Comparison Sheet</div>
                  {loadingAlts ? <div className="spinner" /> : <div className="table-wrap"><AlternativesTable alts={alternatives} /></div>}

                  <div style={{ marginTop: 24, borderTop: '2px solid #2563eb', paddingTop: 20, fontSize: '0.85rem', color: '#475569' }}>
                    Open the Comparison Sheet to mark each row's recommendation and forward the final selection to the CEO.
                  </div>
                </div>
              )}

              {/* Ordered Workflow Remarks timeline */}
              {renderWorkflowRemarks()}
            </div>
            <div className="modal-footer" style={{ borderTop: '1px solid var(--border)', margin: 0, padding: '14px 24px', display: 'flex', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn btn-ghost" onClick={closeModal}>Close</button>
                <button className="btn btn-danger btn-sm" onClick={() => setAction('reject')}>✕ Reject</button>
              </div>
              {selected.CURRENT_STAGE === 'DTCFinal' ? (
                <button
                  className="btn btn-primary"
                  style={{ background: '#7c3aed', border: 'none', fontWeight: 700, borderRadius: 10, padding: '8px 22px' }}
                  onClick={() => setShowCompSheet(true)}
                  disabled={loadingAlts}
                >
                  📊 View Comparison Sheet
                </button>
              ) : (
                <button className="btn btn-success" onClick={() => setAction('approve')}>✓ Approve</button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ======== GENERIC POPUP ======== */}
      {showGenericPopup && (
        <div className="modal-overlay" style={{ animation: 'none' }} onClick={() => { setShowGenericPopup(false); setDosageFilter(''); setDosageFormFilter(''); }}>
          <div
            className="modal"
            style={{
              maxWidth: '92vw',
              width: '92vw',
              maxHeight: '80vh',
              display: 'flex',
              flexDirection: 'column'
            }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div className="modal-title" style={{ margin: 0 }}>
                Existing Drugs in Formulary
              </div>

              <button
                onClick={() => { setShowGenericPopup(false); setDosageFilter(''); setDosageFormFilter(''); }}
                className="btn btn-ghost btn-sm"
              >
                ✕
              </button>
            </div>

            {/* ── Dosage Strength Filter Bar ── */}
            {genericlist.length > 0 && (() => {
              const dosages = [...new Set(
                genericlist.map(item => extractDosage(item.NAME)).filter(Boolean)
              )].sort((a, b) => parseFloat(a) - parseFloat(b));

              const CHIP = {
                padding: '4px 13px', fontSize: '0.78rem', fontWeight: 600,
                borderRadius: 20, border: '1.5px solid', cursor: 'pointer', transition: 'all 0.15s',
              };

              return dosages.length === 0 ? null : (
                <div style={{
                  background: '#f8fafc', border: '1px solid #e2e8f0',
                  borderRadius: 10, padding: '12px 16px', marginBottom: 8
                }}>
                  <div style={{
                    fontSize: '0.72rem', fontWeight: 700, color: '#64748b',
                    textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 8
                  }}>
                    🔍 Filter by Dosage Strength
                    {dosageFilter && (() => {
                      const cnt = genericlist.filter(i => {
                        const sM = extractDosage(i.NAME) === dosageFilter;
                        const fM = !dosageFormFilter || extractDosageForm(i.DOSAGE_FORM || i.NAME) === dosageFormFilter;
                        return sM && fM;
                      }).length;
                      return (
                        <span style={{ marginLeft: 8, color: '#2563eb', fontWeight: 600, textTransform: 'none' }}>
                          — {cnt} result{cnt !== 1 ? 's' : ''}
                        </span>
                      );
                    })()}
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    <button onClick={() => setDosageFilter('')}
                      style={{ ...CHIP, fontWeight: 700, borderColor: !dosageFilter ? '#2563eb' : '#cbd5e1', background: !dosageFilter ? '#2563eb' : '#fff', color: !dosageFilter ? '#fff' : '#64748b' }}
                    >
                      All ({genericlist.length})
                    </button>
                    {dosages.map(d => {
                      const count = genericlist.filter(i => extractDosage(i.NAME) === d).length;
                      const isActive = dosageFilter === d;
                      return (
                        <button key={d} onClick={() => setDosageFilter(isActive ? '' : d)}
                          style={{ ...CHIP, borderColor: isActive ? '#7c3aed' : '#cbd5e1', background: isActive ? '#7c3aed' : '#fff', color: isActive ? '#fff' : '#475569' }}
                        >
                          {d}
                          <span style={{ marginLeft: 5, fontSize: '0.7rem', fontWeight: 700, background: isActive ? 'rgba(255,255,255,0.25)' : '#e2e8f0', color: isActive ? '#fff' : '#64748b', borderRadius: 10, padding: '1px 6px' }}>{count}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })()}

            {/* ── Dosage Form Filter Bar ── */}
            {genericlist.length > 0 && (() => {
              const dosageForms = [...new Set(
                genericlist.map(item => extractDosageForm(item.DOSAGE_FORM || item.NAME)).filter(Boolean)
              )].sort((a, b) => a.localeCompare(b));

              const CHIP = {
                padding: '4px 13px', fontSize: '0.78rem', fontWeight: 600,
                borderRadius: 20, border: '1.5px solid', cursor: 'pointer', transition: 'all 0.15s',
              };

              return dosageForms.length === 0 ? null : (
                <div style={{
                  background: '#f8fafc', border: '1px solid #e2e8f0',
                  borderRadius: 10, padding: '12px 16px', marginBottom: 14
                }}>
                  <div style={{
                    fontSize: '0.72rem', fontWeight: 700, color: '#64748b',
                    textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 8
                  }}>
                    💊 Filter by Dosage Form
                    {dosageFormFilter && (() => {
                      const cnt = genericlist.filter(i => {
                        const sM = !dosageFilter || extractDosage(i.NAME) === dosageFilter;
                        const fM = extractDosageForm(i.DOSAGE_FORM || i.NAME) === dosageFormFilter;
                        return sM && fM;
                      }).length;
                      return (
                        <span style={{ marginLeft: 8, color: '#059669', fontWeight: 600, textTransform: 'none' }}>
                          — {cnt} result{cnt !== 1 ? 's' : ''}
                        </span>
                      );
                    })()}
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    <button onClick={() => setDosageFormFilter('')}
                      style={{ ...CHIP, fontWeight: 700, borderColor: !dosageFormFilter ? '#059669' : '#cbd5e1', background: !dosageFormFilter ? '#059669' : '#fff', color: !dosageFormFilter ? '#fff' : '#64748b' }}
                    >
                      All ({genericlist.length})
                    </button>
                    {dosageForms.map(form => {
                      const count = genericlist.filter(i => extractDosageForm(i.DOSAGE_FORM || i.NAME) === form).length;
                      const isActive = dosageFormFilter === form;
                      return (
                        <button key={form} onClick={() => setDosageFormFilter(isActive ? '' : form)}
                          style={{ ...CHIP, borderColor: isActive ? '#059669' : '#cbd5e1', background: isActive ? '#059669' : '#fff', color: isActive ? '#fff' : '#475569' }}
                        >
                          {form}
                          <span style={{ marginLeft: 5, fontSize: '0.7rem', fontWeight: 700, background: isActive ? 'rgba(255,255,255,0.25)' : '#e2e8f0', color: isActive ? '#fff' : '#64748b', borderRadius: 10, padding: '1px 6px' }}>{count}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })()}

            <div style={{ overflowY: 'auto', flex: 1 }}>
              {(() => {
                const filtered = genericlist.filter(item => {
                  const dosageMatch = !dosageFilter || extractDosage(item.NAME) === dosageFilter;
                  const formMatch = !dosageFormFilter || extractDosageForm(item.DOSAGE_FORM || item.NAME) === dosageFormFilter;
                  return dosageMatch && formMatch;
                });
                return filtered.length > 0 ? (
                  <div className="table-wrap">
                    <table className="data-table" style={{ minWidth: '1100px' }}>
                      <thead>
                        <tr>
                          <th style={{ whiteSpace: 'nowrap' }}>Brand Name</th>
                          <th style={{ whiteSpace: 'nowrap' }}>Generic Name</th>
                          <th>Status</th>
                          <th style={{ whiteSpace: 'nowrap' }}>MRP</th>
                          <th style={{ whiteSpace: 'nowrap' }}>Created DateTime</th>
                          <th style={{ whiteSpace: 'nowrap' }}>Marketer</th>
                          <th style={{ whiteSpace: 'nowrap' }}>Manufacturer</th>
                          <th style={{ whiteSpace: 'nowrap' }}>First Purchase Rate</th>
                          <th style={{ whiteSpace: 'nowrap' }}>
                            Total Sale Qty
                            <div style={{ fontSize: '0.7rem', fontWeight: 400, color: '#64748b' }}>(Last 3 Months)</div>
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {filtered.map((item, idx) => (
                          <tr key={idx}>
                            <td style={{ fontWeight: 500 }}>
                              {item.NAME}
                              {extractDosage(item.NAME) && (
                                <span style={{ marginLeft: 6, fontSize: '0.68rem', fontWeight: 700, background: '#ede9fe', color: '#6d28d9', borderRadius: 8, padding: '1px 7px' }}>
                                  {extractDosage(item.NAME)}
                                </span>
                              )}
                            </td>
                            <td style={{ color: 'var(--text-muted)' }}>{item.DRUG_GEN_NAME}</td>
                            <td>
                              <span
                                style={{
                                  padding: '3px 10px',
                                  borderRadius: '12px',
                                  fontSize: '0.75rem',
                                  fontWeight: 600,
                                  background:
                                    item.STATUS === 'Active✅'
                                      ? '#dcfce7'
                                      : '#fee2e2',
                                  color:
                                    item.STATUS === 'Active✅'
                                      ? '#166534'
                                      : '#991b1b'
                                }}
                              >
                                {item.STATUS || 'Unknown'}
                              </span>
                            </td>
                            <td style={{ color: 'var(--text-muted)' }}>{item.MRP}</td>
                            <td style={{ color: 'var(--text-muted)' }}>
                              {item.CREATEDDATETIME
                                ? new Date(item.CREATEDDATETIME).toLocaleDateString('en-IN')
                                : '—'}
                            </td>
                            <td style={{ color: 'var(--text-muted)' }}>{item.MARKETTER_NAME || '—'}</td>
                            <td style={{ color: 'var(--text-muted)' }}>{item.MANUFACTURER_NAME || '—'}</td>
                            <td style={{ color: 'var(--text-muted)' }}>{item.FIRST_PURCHASE_RATE || '—'}</td>
                            <td style={{ color: 'var(--text-muted)' }}>{item.TOTAL_SALE_QTY}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--text-subtle)' }}>
                    <div style={{ fontSize: '2.5rem', marginBottom: 10 }}>🔍</div>
                    <div>
                      {dosageFilter || dosageFormFilter
                        ? 'No drugs found for selected dosage strength and dosage form. Try adjusting your filters.'
                        : 'No existing drugs found for this generic.'}
                    </div>
                  </div>
                );
              })()}
            </div>

            <div className="modal-footer" style={{ marginTop: 16 }}>
              {(dosageFilter || dosageFormFilter) && (
                <button className="btn btn-ghost btn-sm" onClick={() => { setDosageFilter(''); setDosageFormFilter(''); }}>↺ Clear All Filters</button>
              )}
              <button
                className="btn btn-primary btn-sm"
                onClick={() => { setShowGenericPopup(false); setDosageFilter(''); setDosageFormFilter(''); }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ======== APPROVE / REJECT MODAL ======== */}
      {selected && (action === 'approve' || action === 'reject') && (
        <div className="modal-overlay">
          <div className="modal" style={{ maxWidth: action === 'reject' ? '92vw' : 600, width: '95vw' }} onClick={e => e.stopPropagation()}>
            <div className="modal-title" style={{ color: action === 'approve' ? 'var(--success)' : 'var(--danger)' }}>
              {action === 'approve'
                ? selected.CURRENT_STAGE === 'DTCFinal' ? '✅ DTC Final Approval'
                  : selected.CURRENT_STAGE === 'EmergencyDTC' ? '🚨 Emergency Approval' : '✅ DTC Approval'
                : '❌ Rejection'}
            </div>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: 16 }}>
              {action === 'approve'
                ? selected.CURRENT_STAGE === 'DTCFinal'
                  ? `Approving #${selected.REQUEST_ID} will forward it to the CEO for final decision.`
                  : selected.CURRENT_STAGE === 'EmergencyDTC'
                    ? `Approving emergency #${selected.REQUEST_ID} will grant immediate approval.`
                    : `Approving #${selected.REQUEST_ID} will send it to the Pharmacist for quotation analysis.`
                : `Rejecting will notify the Doctor and Pharmacy Head. Select reasons and/or add remarks.`}
            </p>
            <div className="form-group">
              {action === 'reject' ? (
                <RejectionRemarksPanel
                  currentUser={currentUser}
                  selectedReasons={selectedReasons}
                  onReasonsChange={setSelectedReasons}
                  customRemarks={customRemarks}
                  onCustomRemarksChange={setCustomRemarks}
                  error={remarkErr}
                  onErrorClear={() => setRemarkErr('')}
                />
              ) : (
                <>
                  <label className="form-label">Remarks <span style={{ color: '#94a3b8', fontWeight: 400 }}>(optional)</span></label>
                  <ApprovalRemarksPanel
                    role="DTC"
                    value={approveRemarks}
                    onChange={setApproveRemarks}
                    placeholder="Optional DTC comments…"
                    rows={3}
                  />
                  {remarkErr && <span className="form-error">{remarkErr}</span>}
                </>
              )}
            </div>

            <div className="modal-footer">
              <button className="btn btn-ghost" onClick={closeModal} disabled={submitting}>Cancel</button>
              <button className={`btn ${action === 'approve' ? 'btn-success' : 'btn-danger'}`}
                onClick={handleAction} disabled={submitting}>
                {submitting ? <><div className="spinner" /> Processing…</> : (action === 'approve' ? '✓ Confirm' : '✕ Confirm Reject')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Read-Only Comparison Sheet Overlay ── */}
      {showCompSheet && selected && (
        <ComparisonSheet
          mode={selected.CURRENT_STAGE === 'DTCFinal' ? 'dtc' : 'readonly'}
          compType={
            (dtcAltView.length > 0 && dtcAltView[0].comparison_type) ||
            (((selected.REQUEST_TYPE || selected.request_type || '').toLowerCase() === 'new molecule') ? 'new_generic' : 'existing_generic')
          }
          alternatives={dtcAltView}
          existingGenericData={dtcEgdView}
          existingDetails={dtcExistingDetails}
          pharmRemarks={selected.PHARMACIST_REMARKS || ''}
          phRemarks={selected.PH_REVIEW_REMARKS || selected.PH_REVIEW2_REMARKS || selected.PH_REMARKS2 || ''}
          requestInfo={selected}
          effectiveDrugEntries={effectiveDrugEntries}
          dtcSelectedBrand={dtcSelectedBrand}
          dtcSelectedCategory={dtcSelectedCategory}
          dtcSelectionReasons={dtcSelectionReasons}
          dtcRecommendationNotes={dtcRecommendationNotes}
          dtcReviewedByName={dtcReviewedByName}
          dtcReviewSignature={dtcReviewSignature}
          dtcRemarks={dtcRemarks}
          phFinalRecommendation={phFinalRecommendation}
          dtcReviewedAt={selected.DTC_REVIEWED_AT}
          dtcFinalRecommendations={dtcFinalRecommendations}
          onDtcFinalRecommendationsChange={setDtcFinalRecommendations}
          onAlternativesChange={setDtcAltView}
          onExistingDetailsChange={setDtcExistingDetails}
          onDtcSelectedBrandChange={setDtcSelectedBrand}
          onDtcSelectedCategoryChange={setDtcSelectedCategory}
          onDtcSelectionReasonsChange={setDtcSelectionReasons}
          onDtcRecommendationNotesChange={setDtcRecommendationNotes}
          onDtcReviewedByNameChange={setDtcReviewedByName}
          onDtcReviewSignatureChange={setDtcReviewSignature}
          onDtcRemarksChange={setDtcRemarks}
          onPhFinalRecommendationChange={setPhFinalRecommendation}
          onDtcFinalize={handleDtcFinalize}
          finalizing={submittingSelection}
          onBack={() => setShowCompSheet(false)}
        />
      )}
    </div>
  );
}
