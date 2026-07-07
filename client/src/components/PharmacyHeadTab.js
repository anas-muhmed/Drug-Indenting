// =====================================================================
// PharmacyHeadTab.js – First-pass review + Post-analysis review
// =====================================================================
import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import Dashboard from './Dashboard';
import Notifications from './Notifications';
import ReactMarkdown from 'react-markdown';
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

export default function PharmacyHeadTab({ currentUser, onNotificationsRead }) {
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
  const [genericlist, setGenericlist] = useState([]);
  const [showGenericPopup, setShowGenericPopup] = useState(false);
  const [alternatives, setAlternatives] = useState([]);
  const [loadingAlts, setLoadingAlts] = useState(false);
  const [existingGenericData, setExistingGenericData] = useState(null);
  const [existingDetails, setExistingDetails] = useState([]);
  const [effectiveDrugEntries, setEffectiveDrugEntries] = useState([]);
  const [genericLoading, setGenericLoading] = useState(false);
  const [dosageFilter, setDosageFilter] = useState('');
  const [dosageFormFilter, setDosageFormFilter] = useState('');

  // PharmacyHead editable comparison sheet state
  const [showPhSheet, setShowPhSheet] = useState(false);
  const [phAltEdit, setPhAltEdit] = useState([]);
  const [phEgdEdit, setPhEgdEdit] = useState({});
  const [phRemarksEdit, setPhRemarksEdit] = useState('');
  const [dtcRecNotesEdit, setDtcRecNotesEdit] = useState('');
  const [phFinalRecommendation, setPhFinalRecommendation] = useState('');
  const [saving, setSaving] = useState(false);
  const [forwarding, setForwarding] = useState(false);

  // ── Revert-to-Pharmacist state ──
  const [revertModalOpen, setRevertModalOpen] = useState(false);
  const [revertRemarks, setRevertRemarks] = useState('');
  const [revertChecklist, setRevertChecklist] = useState([]);
  const [reverting, setReverting] = useState(false);
  const [revertErr, setRevertErr] = useState('');

  const extractDosage = (name = '') => {
    const match = name.match(/(\d+(?:\.\d+)?\s*(?:mg|ml|mcg|g|iu|meg|%|units?))/i);
    return match ? match[1].trim().toLowerCase().replace(/\s+/, '') : null;
  };

  const extractDosageForm = (value = '') => {
    if (!value) return null;
    const v = value.trim();
    // Normalise known variants to canonical abbreviations
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
    for (const [rx, label] of NORMALISE) {
      if (rx.test(v)) return label;
    }
    // Fallback: scan the raw string for embedded dosage-form keywords
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
    for (const [rx, label] of SCAN) {
      if (rx.test(v)) return label;
    }
    // Return the raw value as-is (capitalised) if no pattern matches
    return v.charAt(0).toUpperCase() + v.slice(1);
  };


  const loadRequests = useCallback(async () => {
    setLoading(true);
    try {
      const r = await axios.get(`${API}/requests/PharmacyHead/${currentUser.USER_ID}`);
      setRequests(r.data);
    } catch { } finally { setLoading(false); }
  }, [currentUser]);

  useEffect(() => { loadRequests(); }, [loadRequests]);

  const openModal = async (req, act) => {
    setSelected(req);
    setAction(act);
    setApproveRemarks('');
    setSelectedReasons([]); setCustomRemarks(['']); setRemarkErr('');
    setEffectiveDrugEntries(req.effective_drug_entries || []);
    const isOrderStage = req.STATUS === 'APPROVED_PENDING_ORDER' || req.STATUS === 'ORDER_PLACED' || req.STATUS === 'EMERGENCY_APPROVED';
    // Load alternatives + existing generic data if this is a review-2 request or order stage
    if (req.CURRENT_STAGE === 'PharmacyHeadReview2' || isOrderStage) {
      setLoadingAlts(true);
      try {
        const endpoint = isOrderStage
          ? `${API}/alternatives/${req.REQUEST_ID}/selected`
          : `${API}/alternatives/${req.REQUEST_ID}`;

        const [altsRes, egdRes] = await Promise.all([
          axios.get(endpoint),
          axios.get(`${API}/requests/${req.REQUEST_ID}/existing-generic-data`),
        ]);
        const altsRaw = isOrderStage
          ? (altsRes.data?.data ? [altsRes.data.data] : [])
          : (altsRes.data?.alternatives || []);
        const existingDetailsRaw = altsRes.data?.existing_details || [];
        console.log("ALTS RAW FROM API:", altsRaw);
        setAlternatives(altsRaw);
        setExistingDetails(existingDetailsRaw);
        const egd = egdRes.data?.existing_generic_data || null;
        setExistingGenericData(egd);
        if (altsRes.data?.effective_drug_entries) {
          setEffectiveDrugEntries(altsRes.data.effective_drug_entries);
        }
        // Pre-populate edit state (normalize DB columns to frontend keys)
        const mappedAlts = altsRaw.map(a => {
          if (!a) return {};
          return {
            brand_name: a.BRAND_NAME || a.final_brand_name || '',
            manufacturer: a.MANUFACTURER || a.final_manufacturer || '',
            marketer: a.MARKETER || a.final_marketer || '',
            mrp_per_pack: a.MRP_PER_PACK ?? a.final_mrp ?? '',
            rate_per_pack: a.RATE_PER_PACK ?? a.final_rate ?? '',
            gst_percent: a.GST_PERCENT ?? '',
            mrp: a.MRP ?? a.final_mrp ?? '',
            rate: a.RATE ?? a.final_rate ?? '',
            qty: a.QTY ?? a.final_scheme_qty ?? '',
            offer: a.OFFER ?? a.final_scheme_offer ?? '',
            markupmargin: a.MARKUP_MARGIN ?? '',
            net_rate: a.NET_RATE ?? a.final_net_rate ?? '',
            margin: a.ABSOLUTE_MARGIN ?? a.final_absolute_margin ?? '',
            profit_margin: a.PROFIT_MARGIN ?? a.final_profit_margin ?? '',
            stock: a.STOCK ?? '',
            purchase_qty: a.PURCHASE_QUANTITY ?? '',
            consultant: a.CONSULTANT ?? '',
            sale_qty: a.SALE_QTY ?? '',
            pack: a.PACK ?? a.final_pack ?? '',
            introduced_on: a.INTRODUCED_ON || 'New Item',
            remark: a.REMARK ?? '',
            negorate: a.NEGOTIATED_RATE ?? '',
            abs_margin: a.ABSOLUTE_MARGIN ?? a.final_absolute_margin ?? '',
            comparison_type: a.COMPARISON_TYPE ?? '',
            submitted_by: a.SUBMITTED_BY ?? '',
            negotiated_mrp: a.NEGOTIATED_MRP ?? a.MRP_PER_PACK ?? a.final_mrp ?? '',
            negotiated_rate: a.NEGOTIATED_RATE ?? a.RATE_PER_PACK ?? a.final_rate ?? '',
            negotiated_gst: a.NEGOTIATED_GST ?? a.GST_PERCENT ?? '',
            negotiated_scheme_qty: a.NEGOTIATED_SCHEME_QTY ?? a.QTY ?? a.final_scheme_qty ?? '',
            negotiated_scheme_offer: a.NEGOTIATED_SCHEME_OFFER ?? a.OFFER ?? a.final_scheme_offer ?? '',
            negotiation_remarks: a.NEGOTIATION_REMARKS ?? a.REMARK ?? '',
          };
        });
        console.log("MAPPED ALTS:", mappedAlts);
        setPhAltEdit(mappedAlts);
        setPhEgdEdit(egd || {});
        setPhRemarksEdit(req.PH_REVIEW2_REMARKS || req.PH_REMARKS2 || '');
        setDtcRecNotesEdit(req.DTC_RECOMMENDATION_NOTES || '');
        setPhFinalRecommendation(altsRes.data?.ph_final_recommendation || req.PH_FINAL_RECOMMENDATION || '');
      } catch { setAlternatives([]); setExistingGenericData(null); setExistingDetails([]); } finally { setLoadingAlts(false); }
    } else {
      setAlternatives([]);
      setExistingGenericData(null);
      setExistingDetails([]);
    }
  };
  const closeModal = () => {
    setSelected(null);
    setAction('');
    setApproveRemarks('');
    setSelectedReasons([]); setCustomRemarks(['']); setRemarkErr('');
    setAlternatives([]);
    setExistingGenericData(null);
    setDosageFilter('');
    setDosageFormFilter('');
    setDtcRecNotesEdit('');
    setPhFinalRecommendation('');
    setPhRemarksEdit('');
    setEffectiveDrugEntries([]);
  };
  const closePhSheet = () => setShowPhSheet(false);

  const savePhComparison = async () => {
    setSaving(true);
    try {
      await axios.put(`${API}/pharmacy-head/comparison/${selected.REQUEST_ID}`, {
        performed_by: currentUser.USER_ID,
        alternatives: phAltEdit,
        existing_generic_data: phEgdEdit,
        ph_review2_remarks: phRemarksEdit,
        ph_review_remarks: phRemarksEdit,
        dtc_recommendation_notes: dtcRecNotesEdit,
        ph_final_recommendation: phFinalRecommendation,
      });
      setAlertMsg({ type: 'success', msg: `✅ Comparison sheet saved for request #${selected.REQUEST_ID}.` });
    } catch (err) {
      setAlertMsg({ type: 'error', msg: err.response?.data?.error || 'Save failed.' });
    } finally { setSaving(false); }
  };

  const forwardToDTC = async () => {
    setForwarding(true);
    try {
      // Save first, then approve/forward
      await axios.put(`${API}/pharmacy-head/comparison/${selected.REQUEST_ID}`, {
        performed_by: currentUser.USER_ID,
        alternatives: phAltEdit,
        existing_generic_data: phEgdEdit,
        ph_review2_remarks: phRemarksEdit,
        ph_review_remarks: phRemarksEdit,
        dtc_recommendation_notes: dtcRecNotesEdit,
        ph_final_recommendation: phFinalRecommendation,
      });
      await axios.put(`${API}/requests/${selected.REQUEST_ID}/approve`, {
        performed_by: currentUser.USER_ID,
        remarks: phRemarksEdit.trim() || 'Forwarded to DTC after Pharmacy Head review.',
      });
      setAlertMsg({ type: 'success', msg: `🚀 Request #${selected.REQUEST_ID} forwarded to DTC for final evaluation.` });
      setShowPhSheet(false);
      closeModal();
      await loadRequests();
      setDashKey(k => k + 1);
    } catch (err) {
      setAlertMsg({ type: 'error', msg: err.response?.data?.error || 'Forward failed.' });
    } finally { setForwarding(false); }
  };

  const openRevertModal = () => {
    setRevertRemarks('');
    setRevertChecklist([]);
    setRevertErr('');
    setRevertModalOpen(true);
  };

  const closeRevertModal = () => {
    setRevertModalOpen(false);
    setRevertRemarks('');
    setRevertChecklist([]);
    setRevertErr('');
  };

  const toggleRevertCheck = (item) => {
    setRevertChecklist(prev =>
      prev.includes(item) ? prev.filter(x => x !== item) : [...prev, item]
    );
  };

  const revertToPharmacist = async () => {
    const fullRemarks = [
      ...revertChecklist.map(c => `• ${c}`),
      revertRemarks.trim(),
    ].filter(Boolean).join('\n');

    if (!fullRemarks.trim()) {
      setRevertErr('Please add remarks or select at least one issue before reverting.');
      return;
    }
    setReverting(true);
    setRevertErr('');
    try {
      // Save the current sheet state first (preserve edits)
      await axios.put(`${API}/pharmacy-head/comparison/${selected.REQUEST_ID}`, {
        performed_by: currentUser.USER_ID,
        alternatives: phAltEdit,
        existing_generic_data: phEgdEdit,
        ph_review2_remarks: phRemarksEdit,
        ph_review_remarks: phRemarksEdit,
        dtc_recommendation_notes: dtcRecNotesEdit,
        ph_final_recommendation: phFinalRecommendation,
      });
      await axios.put(`${API}/requests/${selected.REQUEST_ID}/revert-to-pharmacist`, {
        performed_by: currentUser.USER_ID,
        remarks: fullRemarks,
      });
      setAlertMsg({ type: 'error', msg: `↩ Request #${selected.REQUEST_ID} (${selected.BRAND_NAME}) reverted to Pharmacist for correction.` });
      closeRevertModal();
      setShowPhSheet(false);
      closeModal();
      await loadRequests();
      setDashKey(k => k + 1);
    } catch (err) {
      setRevertErr(err.response?.data?.error || 'Revert failed. Please try again.');
    } finally {
      setReverting(false);
    }
  };

  const handleAction = async () => {
    if (action === 'reject') {
      const err = validateRejection(selectedReasons, customRemarks);
      if (err) { setRemarkErr(err); return; }
    }
    setSubmitting(true);
    try {
      const endpoint = action === 'approve' ? 'approve' : 'reject';
      const remarks = action === 'reject'
        ? composeRejectionRemarks(selectedReasons, customRemarks)
        : (approveRemarks.trim() || undefined);
      await axios.put(`${API}/requests/${selected.REQUEST_ID}/${endpoint}`, {
        performed_by: currentUser.USER_ID,
        remarks,
        customRemarks: action === 'reject' ? customRemarks.filter(r => r.trim() !== '') : undefined,
      });
      const isReview2 = selected.CURRENT_STAGE === 'PharmacyHeadReview2';
      setAlertMsg({
        type: action === 'approve' ? 'success' : 'error',
        msg: action === 'approve'
          ? isReview2
            ? ` Request #${selected.REQUEST_ID} forwarded to DTC for final evaluation.`
            : ` Request #${selected.REQUEST_ID} approved and forwarded to DTC Committee.`
          : `Request #${selected.REQUEST_ID} rejected.`,
      });
      closeModal();
      await loadRequests();
      setDashKey(k => k + 1);
    } catch (err) {
      setRemarkErr(err.response?.data?.error || 'Action failed.');
    } finally { setSubmitting(false); }
  };

  const getGenericDetails = async (generic_name, dosage_form) => {
    setGenericLoading(true);
    setDosageFilter('');

    try {
      const res = await axios.post(`${API}/getGeneric`, {
        search: generic_name,
        dosage_form: dosage_form
      });

      setGenericlist(res.data.list || []);
      setShowGenericPopup(true);
    } catch {
      setGenericlist([]);
      setShowGenericPopup(true);
    } finally {
      setGenericLoading(false);
    }
  };

  const firstPass = requests.filter(r => r.CURRENT_STAGE === 'PharmacyHead');
  const review2 = requests.filter(r => r.CURRENT_STAGE === 'PharmacyHeadReview2');
  const emergencyView = requests.filter(r => r.IS_EMERGENCY === 1);

  return (
    <div>
      <div className="inner-tabs">
        {[
          { key: 'pending', label: ` First Review (${firstPass.length})` },
          { key: 'review2', label: ` Analysis Review (${review2.length})` },
          { key: 'emergency', label: `🚨 Emergency (${emergencyView.length})` },
          { key: 'dashboard', label: ' Dashboard' },
          { key: 'notifications', label: ' Notifications' },
        ].map(({ key, label }) => (
          <button key={key} className={`inner-tab-btn ${view === key ? 'active' : ''}`}
            onClick={() => setView(key)}>{label}</button>
        ))}
      </div>

      {alertMsg && (
        <div className={`alert alert-${alertMsg.type}`} style={{ marginBottom: 18 }}>
          {alertMsg.msg}
          <button style={{ float: 'right', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 700 }}
            onClick={() => setAlertMsg(null)}>•</button>
        </div>
      )}

      {/* ======== FIRST PASS PENDING ======== */}
      {view === 'pending' && (
        <div className="card">
          <div className="card-title" style={{ justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div className="icon"></div>Pending Drug Requests
            </div>
            <button className="btn btn-ghost btn-sm" onClick={loadRequests}>Refresh</button>
          </div>
          {loading ? (
            <div style={{ textAlign: 'center', padding: 60 }}><div className="spinner" /></div>
          ) : firstPass.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 60, color: 'var(--text-subtle)' }}>
              <div style={{ fontSize: '3rem', marginBottom: 12 }}>✓</div>No pending requests.
            </div>
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr><th>#ID</th><th>Brand Name</th><th>Generic Name</th><th>Category</th><th>Type</th><th>Source</th><th>Doctor</th><th>Submitted</th><th>Actions</th></tr>
                </thead>
                <tbody>
                  {firstPass.map(r => (
                    <tr key={r.REQUEST_ID}>
                      <td style={{ fontWeight: 700, color: 'var(--primary-light)' }}>#{r.REQUEST_ID}</td>
                      <td style={{ fontWeight: 600 }}>{r.BRAND_NAME}</td>
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
                      <td><span className="badge badge-info">{r.REQUEST_TYPE}</span></td>
                      <td>{r.REQUEST_SOURCE_TYPE === 'NON_PROMOTIONAL' ? <span className="badge badge-non-promotional">Clinician initiated</span> : <span className="badge badge-promotional">Via Medical Representative</span>}</td>
                      <td>
                        <div>{r.DOCTOR_NAME}</div>
                        <small className="text-muted" style={{ display: 'block', fontSize: '0.75rem' }}>
                          {r.CREATED_BY_ROLE || 'Doctor'} • {r.DOCTOR_DEPT || ''}
                        </small>
                      </td>
                      <td style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{new Date(r.CREATED_AT).toLocaleDateString('en-IN')}</td>
                      <td style={{ fontSize: '0.8rem', color: 'var(--primary-light)' }}>
                        {r.EFFECTIVE_CREATED_AT
                          ? new Date(r.EFFECTIVE_CREATED_AT).toLocaleString('en-IN')
                          : new Date(r.CREATED_AT).toLocaleString('en-IN')}
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button className="btn btn-ghost btn-sm" onClick={() => openModal(r, 'view')}> View</button>
                          <button className="btn btn-success btn-sm" onClick={() => openModal(r, 'approve')}> Approve</button>
                          <button className="btn btn-danger btn-sm" onClick={() => openModal(r, 'reject')}> Reject</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ======== EMERGENCY VIEW-ONLY ======== */}
      {view === 'emergency' && (
        <div className="card">
          <div className="card-title" style={{ justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div className="icon">🚨</div>
              Emergency Requests
              <span className="badge" style={{ background: '#fef3c7', color: '#92400e' }}>View Only — DTC Decides</span>
            </div>
            <button className="btn btn-ghost btn-sm" onClick={loadRequests}>↺ Refresh</button>
          </div>
          <div className="alert alert-warning" style={{ marginBottom: 18, fontSize: '0.82rem' }}>
            ⚠️ Emergency requests bypass normal flow for immediate DTC approval. You have view-only access here.
          </div>
          {emergencyView.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 60, color: 'var(--text-subtle)' }}>
              <div style={{ fontSize: '3rem', marginBottom: 12 }}>✅</div>No active emergency requests.
            </div>
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr><th>#ID</th><th>Brand Name</th><th>Generic</th><th>Doctor</th><th>Stage</th><th>Submitted</th><th>View</th></tr>
                </thead>
                <tbody>
                  {emergencyView.map(r => (
                    <tr key={r.REQUEST_ID}>
                      <td style={{ fontWeight: 700, color: '#dc2626' }}>🚨 #{r.REQUEST_ID}</td>
                      <td style={{ fontWeight: 600 }}>{r.BRAND_NAME}</td>
                      <td style={{ color: 'var(--text-muted)' }}>{r.GENERIC_NAME}</td>
                      <td>
                        <div>{r.DOCTOR_NAME}</div>
                        <small className="text-muted" style={{ display: 'block', fontSize: '0.75rem' }}>
                          {r.CREATED_BY_ROLE || 'Doctor'} • {r.DOCTOR_DEPT || ''}
                        </small>
                      </td>
                      <td>
                        <span className="badge" style={
                          r.STATUS === 'EMERGENCY_APPROVED' ? { background: '#dcfce7', color: '#166534' } :
                            r.STATUS === 'EMERGENCY_REJECTED' ? { background: '#fee2e2', color: '#991b1b' } :
                              r.STATUS === 'ORDER_PLACED' ? { background: '#dbeafe', color: '#1e40af' } :
                                { background: '#fef3c7', color: '#92400e' }
                        }>
                          {r.STATUS}
                        </span>
                      </td>
                      <td style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{new Date(r.CREATED_AT).toLocaleDateString('en-IN')}</td>
                      <td>
                        <button className="btn btn-ghost btn-sm" onClick={() => openModal(r, 'view')}>👁 View</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ======== ANALYSIS REVIEW (Review 2) ======== */}
      {view === 'review2' && (
        <div className="card">
          <div className="card-title" style={{ justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div className="icon"></div>Post-Analysis Review
              <span className="badge badge-info">Pharmacist Submitted Alternatives</span>
            </div>
            <button className="btn btn-ghost btn-sm" onClick={loadRequests}> Refresh</button>
          </div>
          <div className="alert alert-info" style={{ marginBottom: 18, fontSize: '0.82rem' }}>
            Review the alternatives and quotations submitted by the Pharmacist. Select the best options and forward to DTC for final evaluation.
          </div>
          {review2.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 60, color: 'var(--text-subtle)' }}>
              <div style={{ fontSize: '3rem', marginBottom: 12 }}>­</div>No requests pending analysis review.
            </div>
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr><th>#ID</th><th>Brand Name</th><th>Generic</th><th>Category</th><th>Source</th><th>Doctor</th><th>Pharmacist Remarks</th><th>Submitted</th><th>Actions</th></tr>
                </thead>
                <tbody>
                  {review2.map(r => (
                    <tr key={r.REQUEST_ID}
                      style={r.REVERT_COUNT > 0 ? { background: 'rgba(217,119,6,0.04)', borderLeft: '3px solid #d97706' } : {}}
                    >
                      <td style={{ fontWeight: 700, color: 'var(--primary-light)' }}>#{r.REQUEST_ID}</td>
                      <td style={{ fontWeight: 600 }}>
                        {r.BRAND_NAME}
                        {r.REVERT_COUNT > 0 && (
                          <span style={{
                            display: 'block', fontSize: '0.7rem', marginTop: 2, fontWeight: 700,
                            color: '#92400e', background: '#fef3c7',
                            borderRadius: 10, padding: '1px 7px', width: 'fit-content',
                          }}>
                            ↩ Reverted ×{r.REVERT_COUNT}
                          </span>
                        )}
                      </td>
                      <td style={{ color: 'var(--text-muted)' }}>{r.GENERIC_NAME}</td>
                      <td>{r.CATEGORY}</td>
                      <td>{r.REQUEST_SOURCE_TYPE === 'NON_PROMOTIONAL' ? <span className="badge badge-non-promotional">Clinician initiated</span> : <span className="badge badge-promotional">Via Medical Representative</span>}</td>
                      <td>
                        <div>{r.DOCTOR_NAME}</div>
                        <small className="text-muted" style={{ display: 'block', fontSize: '0.75rem' }}>
                          {r.CREATED_BY_ROLE || 'Doctor'} • {r.DOCTOR_DEPT || ''}
                        </small>
                      </td>
                      <td style={{ fontSize: '0.78rem', color: 'var(--text-muted)', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {r.PHARMACIST_REMARKS || '—'}
                      </td>
                      <td style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{new Date(r.CREATED_AT).toLocaleDateString('en-IN')}</td>
                      <td>
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                          <button className="btn btn-ghost btn-sm" onClick={() => openModal(r, 'view')}>👁 View Alternatives</button>
                          <button
                            className="btn btn-sm"
                            style={{ background: '#d97706', color: '#fff', border: 'none', fontWeight: 600 }}
                            onClick={() => { openModal(r, 'view'); setTimeout(() => openRevertModal(), 50); }}
                          >
                            ↩ Revert
                          </button>
                          <button className="btn btn-success btn-sm" onClick={() => openModal(r, 'approve')}>🚀 Forward to DTC</button>
                          <button className="btn btn-danger btn-sm" onClick={() => openModal(r, 'reject')}>Reject</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {view === 'dashboard' && <Dashboard role="PharmacyHead" userId={currentUser.USER_ID} refresh={dashKey} />}
      {view === 'notifications' && <Notifications userId={currentUser.USER_ID} onRead={onNotificationsRead} />}

      {/* ======== VIEW MODAL ======== */}
      {selected && action === 'view' && (
        <div className="modal-overlay" onClick={closeModal}>
          <div className="modal" style={{ maxWidth: '95vw', width: '95vw', maxHeight: '92vh', display: 'flex', flexDirection: 'column', padding: 0, overflow: 'hidden' }}
            onClick={e => e.stopPropagation()}>
            <div style={{ padding: '18px 24px', borderBottom: '1px solid var(--border)', fontWeight: 700, fontSize: '1.05rem', flexShrink: 0 }}>
              ‹ Request #{selected.REQUEST_ID}  Full Details
            </div>
            <div style={{ overflowY: 'auto', flex: 1, padding: '20px 24px' }}>
              {/* Revert History Banner */}
              {selected.REVERT_COUNT > 0 && (
                <div style={{
                  background: '#fef3c7', border: '1px solid #f59e0b',
                  borderLeft: '4px solid #d97706', borderRadius: 10,
                  padding: '12px 16px', marginBottom: 16,
                }}>
                  <div style={{ fontWeight: 700, color: '#92400e', marginBottom: 6, fontSize: '0.85rem' }}>
                    ↩ Reverted {selected.REVERT_COUNT} time{selected.REVERT_COUNT > 1 ? 's' : ''} — Resubmitted by Pharmacist
                  </div>
                  {selected.REVERT_REMARKS && (
                    <div style={{ fontSize: '0.82rem', color: '#78350f', whiteSpace: 'pre-line', lineHeight: 1.6 }}>
                      <strong>Last Revert Reason:</strong><br />{selected.REVERT_REMARKS}
                    </div>
                  )}
                  {selected.LAST_CORRECTED_AT && (
                    <div style={{ fontSize: '0.75rem', color: '#92400e', marginTop: 6 }}>
                      Last corrected: {new Date(selected.LAST_CORRECTED_AT).toLocaleString('en-IN')}
                    </div>
                  )}
                </div>
              )}
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem', marginBottom: 16 }}>
                <tbody>
                  {DETAIL_ROWS.map(([label, key]) => (
                    <tr key={key} style={{ borderBottom: '1px solid var(--border)' }}>
                      <td style={{ padding: '9px 12px', color: 'var(--text-muted)', width: '42%', fontWeight: 600, fontSize: '0.8rem' }}>{label}</td>
                      <td style={{ padding: '9px 12px', color: 'var(--text)' }}>
                        {key === 'COST_REDUCTION_BENEFIT' ? (selected[key] ? 'Yes' : 'No')
                          : key === 'FORMULARY_REQUEST_TYPE'
                            ? (selected[key] === 'FORMULARY' ? <span className="badge" style={{ background: '#ecfdf5', color: '#065f46' }}>Formulary Drug Addition Request</span> : selected[key] === 'NON_FORMULARY' ? <span className="badge" style={{ background: '#fef2f2', color: '#991b1b' }}>Non-Formulary Drug Request</span> : '—')
                            : key === 'REQUEST_SOURCE_TYPE'
                              ? (selected[key] === 'NON_PROMOTIONAL' ? <span className='badge badge-non-promotional'>Clinician initiated</span> : <span className='badge badge-promotional'>Via Medical Representative</span>)
                              : key === 'EFFECTIVE_CREATED_AT'
                                ? (() => {
                                  const raw = selected.EFFECTIVE_CREATED_AT || selected.CREATED_AT;
                                  return raw
                                    ? <span style={{ fontWeight: 600, color: 'var(--primary-light)' }}>{new Date(raw).toLocaleString('en-IN')}</span>
                                    : '—';
                                })()
                                : key === 'CREATED_AT'
                                  ? (selected[key] ? new Date(selected[key]).toLocaleString('en-IN') : '—')
                                  : (selected[key] || '\u2014')}
                      </td>
                    </tr>
                  ))}
                  <tr style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '9px 12px', color: 'var(--text-muted)', fontWeight: 600, fontSize: '0.8rem', verticalAlign: 'top' }}>Clinical Justification</td>
                    <td style={{ padding: '9px 12px', color: 'var(--text)', lineHeight: 1.6 }}>{selected.CLINICAL_JUSTIFICATION}</td>
                  </tr>
                </tbody>
              </table>
              {selected.AI_CONTENT && (
                <div className="alert alert-info" style={{ marginTop: 16 }}>
                  <strong>AI Drug Profile</strong>
                  <div style={{ marginTop: 8 }}><ReactMarkdown>{selected.AI_CONTENT.replace(/<br\s*\/?>/g, '\n')}</ReactMarkdown></div>
                </div>
              )}

              {/* ── Patient Information Block (Emergency Only) ── */}
              {selected.IS_EMERGENCY === 1 && (
                <div style={{ marginTop: 20 }}>
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
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
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
                          <th style={{ padding: '8px 10px', fontWeight: 600, color: 'var(--primary-light)' }}>Effective Created Date</th>
                          {/* <th style={{ padding: '8px 10px', fontWeight: 600, color: 'var(--primary-light)' }}>Remarks</th> */}
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
                              <td style={{ padding: '6px 8px' }}>{formattedDate}</td>
                              {/* <td style={{ padding: '6px 8px' }}>{entry.remarks || entry.REMARKS || '—'}</td> */}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {selected.CURRENT_STAGE === 'PharmacyHeadReview2' && (
                <div style={{ marginTop: 20 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                    <div style={{ fontWeight: 700 }}>📊 Pharmacist Comparison Sheet</div>
                    <button
                      className="btn btn-primary btn-sm"
                      style={{ background: '#7c3aed', border: 'none' }}
                      onClick={() => setShowPhSheet(true)}
                      disabled={loadingAlts}
                    >
                      {loadingAlts ? '⏳ Loading…' : '📝 Open & Edit Comparison Sheet'}
                    </button>
                  </div>
                  {loadingAlts && <div className="spinner" />}
                  {!loadingAlts && alternatives.length > 0 && (
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', padding: '8px 12px', background: '#f9fafb', borderRadius: 6, border: '1px solid var(--border)' }}>
                      ✅ {alternatives.length} alternative(s) submitted by Pharmacist. Click "Open & Edit Comparison Sheet" to review and edit.
                    </div>
                  )}
                </div>
              )}

              {/* CEO Approved / Ready to Order card view for Pharmacy Head */}
              {(selected.STATUS === 'APPROVED_PENDING_ORDER' || selected.STATUS === 'ORDER_PLACED' || selected.STATUS === 'EMERGENCY_APPROVED') && alternatives.length > 0 && (() => {
                const sel = alternatives[0];
                const drug = sel?.data || sel;
                return (
                  <div style={{ marginTop: 20 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                      <span style={{ fontSize: '1rem' }}>🏆</span>
                      <span style={{ fontWeight: 700, color: '#1e293b' }}>CEO Approved Drug — Ready to Order</span>
                      <span style={{ fontSize: '0.72rem', background: '#dcfce7', color: '#166534', borderRadius: 20, padding: '2px 10px', fontWeight: 600 }}>
                        {drug.dtc_selected_category || selected.CATEGORY || 'Formulary'}
                      </span>
                    </div>

                    <div style={{ background: 'linear-gradient(135deg,#f0fdf4,#eff6ff)', border: '2px solid #16a34a', borderRadius: 10, padding: '16px 20px' }}>
                      <div style={{ fontWeight: 800, fontSize: '1.1rem', color: '#166534', marginBottom: 12 }}>
                        💊 {drug.final_brand_name || drug.BRAND_NAME || '—'}
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))', gap: '10px 20px' }}>
                        {[
                          ['Generic Name', drug.final_generic_name || selected.GENERIC_NAME],
                          ['Manufacturer', drug.final_manufacturer || drug.MANUFACTURER],
                          ['Marketer', drug.final_marketer || drug.MARKETER],
                          ['MRP', drug.final_mrp ? `₹${drug.final_mrp}` : (drug.MRP ? `₹${drug.MRP}` : '—')],
                          ['Net Rate', drug.final_net_rate ? `₹${drug.final_net_rate}` : (drug.NET_RATE ? `₹${drug.NET_RATE}` : '—')],
                          ['Profit Margin', drug.final_profit_margin ? `${drug.final_profit_margin}%` : (drug.PROFIT_MARGIN ? `${drug.PROFIT_MARGIN}%` : '—')],
                        ].map(([label, val]) => (
                          <div key={label}>
                            <div style={{ fontSize: '0.68rem', fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</div>
                            <div style={{ fontSize: '0.875rem', fontWeight: 600, color: '#1e293b' }}>{val || '—'}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                );
              })()}
            </div>
            <div className="modal-footer" style={{ borderTop: '1px solid var(--border)', margin: 0, padding: '14px 24px' }}>
              <button className="btn btn-ghost" onClick={closeModal}>Close</button>
              {selected.CURRENT_STAGE !== 'PharmacyHeadReview2' && (
                <>
                  <button className="btn btn-success" onClick={() => setAction('approve')}> Approve</button>
                  <button className="btn btn-danger" onClick={() => setAction('reject')}> Reject</button>
                </>
              )}
              {selected.CURRENT_STAGE === 'PharmacyHeadReview2' && (
                <>
                  <button className="btn btn-danger" onClick={() => setAction('reject')}> Reject</button>
                  <button
                    className="btn btn-sm"
                    style={{ background: '#d97706', color: '#fff', border: 'none', fontWeight: 600 }}
                    onClick={openRevertModal}
                  >
                    ↩ Revert to Pharmacist
                  </button>
                  <button className="btn btn-primary" style={{ background: '#7c3aed', border: 'none' }}
                    onClick={() => setShowPhSheet(true)} disabled={loadingAlts}>
                    📝 Open Comparison Sheet
                  </button>
                </>
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
            style={{ maxWidth: '92vw', width: '92vw', maxHeight: '80vh', display: 'flex', flexDirection: 'column' }}
            onClick={e => e.stopPropagation()}
          >
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <div className="modal-title" style={{ margin: 0 }}>Existing Drugs in Formulary</div>
              <button onClick={() => { setShowGenericPopup(false); setDosageFilter(''); setDosageFormFilter(''); }} className="btn btn-ghost btn-sm">✕</button>
            </div>

            {/* ── Dosage Strength Filter Bar ── */}
            {genericlist.length > 0 && (() => {
              const dosages = [...new Set(
                genericlist.map(item => extractDosage(item.NAME)).filter(Boolean)
              )].sort((a, b) => parseFloat(a) - parseFloat(b));

              // Compute combined filtered count for the strength result hint
              const strengthHintCount = genericlist.filter(i => {
                const sMatch = extractDosage(i.NAME) === dosageFilter;
                const fMatch = !dosageFormFilter || extractDosageForm(i.DOSAGE_FORM || i.NAME) === dosageFormFilter;
                return sMatch && fMatch;
              }).length;

              return (
                <div style={{
                  background: '#f8fafc', border: '1px solid #e2e8f0',
                  borderRadius: 10, padding: '12px 16px', marginBottom: 8
                }}>
                  <div style={{
                    fontSize: '0.72rem', fontWeight: 700, color: '#64748b',
                    textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 8
                  }}>
                    🔍 Filter by Dosage Strength
                    {dosageFilter && (
                      <span style={{ marginLeft: 8, color: '#2563eb', fontWeight: 600, textTransform: 'none' }}>
                        — {strengthHintCount} result{strengthHintCount !== 1 ? 's' : ''}
                      </span>
                    )}
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
                    <button
                      onClick={() => setDosageFilter('')}
                      style={{
                        padding: '4px 13px', fontSize: '0.78rem', fontWeight: 700,
                        borderRadius: 20, border: '1.5px solid',
                        borderColor: !dosageFilter ? '#2563eb' : '#cbd5e1',
                        background: !dosageFilter ? '#2563eb' : '#fff',
                        color: !dosageFilter ? '#fff' : '#64748b',
                        cursor: 'pointer', transition: 'all 0.15s',
                      }}
                    >
                      All ({genericlist.length})
                    </button>
                    {dosages.map(d => {
                      const count = genericlist.filter(i => extractDosage(i.NAME) === d).length;
                      const isActive = dosageFilter === d;
                      return (
                        <button
                          key={d}
                          onClick={() => setDosageFilter(isActive ? '' : d)}
                          style={{
                            padding: '4px 13px', fontSize: '0.78rem', fontWeight: 600,
                            borderRadius: 20, border: '1.5px solid',
                            borderColor: isActive ? '#7c3aed' : '#cbd5e1',
                            background: isActive ? '#7c3aed' : '#fff',
                            color: isActive ? '#fff' : '#475569',
                            cursor: 'pointer', transition: 'all 0.15s',
                          }}
                        >
                          {d}
                          <span style={{
                            marginLeft: 5, fontSize: '0.7rem', fontWeight: 700,
                            background: isActive ? 'rgba(255,255,255,0.25)' : '#e2e8f0',
                            color: isActive ? '#fff' : '#64748b',
                            borderRadius: 10, padding: '1px 6px',
                          }}>{count}</span>
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
                genericlist
                  .map(item => extractDosageForm(item.DOSAGE_FORM || item.NAME))
                  .filter(Boolean)
              )].sort((a, b) => a.localeCompare(b));

              if (dosageForms.length === 0) return null;

              // Compute combined filtered count for the form result hint
              const formHintCount = genericlist.filter(i => {
                const sMatch = !dosageFilter || extractDosage(i.NAME) === dosageFilter;
                const fMatch = extractDosageForm(i.DOSAGE_FORM || i.NAME) === dosageFormFilter;
                return sMatch && fMatch;
              }).length;

              return (
                <div style={{
                  background: '#f8fafc', border: '1px solid #e2e8f0',
                  borderRadius: 10, padding: '12px 16px', marginBottom: 14
                }}>
                  <div style={{
                    fontSize: '0.72rem', fontWeight: 700, color: '#64748b',
                    textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 8
                  }}>
                    💊 Filter by Dosage Form
                    {dosageFormFilter && (
                      <span style={{ marginLeft: 8, color: '#059669', fontWeight: 600, textTransform: 'none' }}>
                        — {formHintCount} result{formHintCount !== 1 ? 's' : ''}
                      </span>
                    )}
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
                    <button
                      onClick={() => setDosageFormFilter('')}
                      style={{
                        padding: '4px 13px', fontSize: '0.78rem', fontWeight: 700,
                        borderRadius: 20, border: '1.5px solid',
                        borderColor: !dosageFormFilter ? '#059669' : '#cbd5e1',
                        background: !dosageFormFilter ? '#059669' : '#fff',
                        color: !dosageFormFilter ? '#fff' : '#64748b',
                        cursor: 'pointer', transition: 'all 0.15s',
                      }}
                    >
                      All ({genericlist.length})
                    </button>
                    {dosageForms.map(form => {
                      const count = genericlist.filter(i =>
                        extractDosageForm(i.DOSAGE_FORM || i.NAME) === form
                      ).length;
                      const isActive = dosageFormFilter === form;
                      return (
                        <button
                          key={form}
                          onClick={() => setDosageFormFilter(isActive ? '' : form)}
                          style={{
                            padding: '4px 13px', fontSize: '0.78rem', fontWeight: 600,
                            borderRadius: 20, border: '1.5px solid',
                            borderColor: isActive ? '#059669' : '#cbd5e1',
                            background: isActive ? '#059669' : '#fff',
                            color: isActive ? '#fff' : '#475569',
                            cursor: 'pointer', transition: 'all 0.15s',
                          }}
                        >
                          {form}
                          <span style={{
                            marginLeft: 5, fontSize: '0.7rem', fontWeight: 700,
                            background: isActive ? 'rgba(255,255,255,0.25)' : '#e2e8f0',
                            color: isActive ? '#fff' : '#64748b',
                            borderRadius: 10, padding: '1px 6px',
                          }}>{count}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })()}

            {/* Table */}
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
                          <th>Brand Name</th>
                          <th>Generic Name</th>
                          <th>Status</th>
                          <th>MRP</th>
                          <th>Created DateTime</th>
                          <th>Marketer</th>
                          <th>Manufacturer</th>
                          <th>First Purchase Rate</th>
                          <th>
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
                                <span style={{
                                  marginLeft: 6, fontSize: '0.68rem', fontWeight: 700,
                                  background: '#ede9fe', color: '#6d28d9',
                                  borderRadius: 8, padding: '1px 7px',
                                }}>
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
                    {dosageFilter || dosageFormFilter
                      ? `No drugs found for selected dosage strength and dosage form. Try adjusting your filters.`
                      : 'No existing drugs found for this generic.'}
                  </div>
                );
              })()}
            </div>

            <div className="modal-footer" style={{ marginTop: 16 }}>
              {(dosageFilter || dosageFormFilter) && (
                <button className="btn btn-ghost btn-sm" onClick={() => { setDosageFilter(''); setDosageFormFilter(''); }}>↺ Clear All Filters</button>
              )}
              <button className="btn btn-primary btn-sm" onClick={() => { setShowGenericPopup(false); setDosageFilter(''); setDosageFormFilter(''); }}>Close</button>
            </div>
          </div>
        </div>
      )}
      {/* ======== APPROVE / REJECT MODAL ======== */}
      {selected && (action === 'approve' || action === 'reject') && (
        <div className="modal-overlay">
          <div className="modal" style={{ maxWidth: action === 'reject' ? '92vw' : 600, width: '95vw' }} onClick={e => e.stopPropagation()}>
            <div className="modal-title" style={{ color: action === 'approve' ? 'var(--success)' : 'var(--danger)' }}>
              {action === 'approve' ? 'Approve Request' : 'Reject Request'}
            </div>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: 16 }}>
              {action === 'approve'
                ? selected.CURRENT_STAGE === 'PharmacyHeadReview2'
                  ? `Forwarding request #${selected.REQUEST_ID} (${selected.BRAND_NAME}) to DTC for final evaluation.`
                  : `Approving request #${selected.REQUEST_ID} (${selected.BRAND_NAME}) and forwarding to DTC Committee.`
                : `Rejecting request #${selected.REQUEST_ID}. Select reasons and/or add remarks.`}
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
                    role="PharmacyHead"
                    value={approveRemarks}
                    onChange={setApproveRemarks}
                    placeholder="Optional Pharmacy Head comments…"
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
                {submitting ? <><div className="spinner" /> Processing…</> : (action === 'approve' ? 'Confirm' : 'Confirm Reject')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ======== REVERT TO PHARMACIST MODAL ======== */}
      {revertModalOpen && selected && (
        <div className="modal-overlay" onClick={closeRevertModal}>
          <div className="modal" style={{ maxWidth: 780, width: '100%' }} onClick={e => e.stopPropagation()}>
            <div className="modal-title" style={{ color: '#d97706', display: 'flex', alignItems: 'center', gap: 8 }}>
              ↩ Revert Comparison Sheet to Pharmacist
            </div>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem', marginBottom: 16 }}>
              Request #{selected.REQUEST_ID} — <strong>{selected.BRAND_NAME}</strong>.<br />
              The comparison sheet will be sent back to the Pharmacist with your remarks. All entered data is preserved.
            </p>

            {/* Checklist */}
            <div className="form-group">
              <label className="form-label" style={{ fontWeight: 600 }}>Common Issues <span style={{ color: '#94a3b8', fontWeight: 400 }}>(optional — select all that apply)</span></label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 6 }}>
                {['Margin mismatch', 'Missing fields', 'Wrong stock values', 'Calculation error', 'Wrong alternative drug', 'Pricing mismatch', 'Formatting issue', 'Incorrect consultant/sale qty', 'Incomplete data', 'Other'].map(item => {
                  const active = revertChecklist.includes(item);
                  return (
                    <button
                      key={item}
                      type="button"
                      onClick={() => toggleRevertCheck(item)}
                      style={{
                        padding: '5px 12px', fontSize: '0.78rem', fontWeight: 600,
                        borderRadius: 20, border: '1.5px solid',
                        borderColor: active ? '#d97706' : '#cbd5e1',
                        background: active ? '#fef3c7' : '#fff',
                        color: active ? '#92400e' : '#475569',
                        cursor: 'pointer', transition: 'all 0.15s',
                      }}
                    >
                      {active ? '✓ ' : ''}{item}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Detailed Remarks */}
            <div className="form-group">
              <label className="form-label" style={{ fontWeight: 600 }}>
                Detailed Remarks <span style={{ color: '#dc2626' }}>*</span>
                <span style={{ color: '#94a3b8', fontWeight: 400, marginLeft: 4 }}>(required if no checklist items selected)</span>
              </label>
              <textarea
                className="form-textarea"
                rows={4}
                placeholder="Describe the specific issues found in the comparison sheet (e.g. Paracetamol 500mg margin shows 12% but should be 18% based on negotiated rate)..."
                value={revertRemarks}
                onChange={e => { setRevertRemarks(e.target.value); setRevertErr(''); }}
              />
            </div>

            {revertErr && <div className="alert alert-error" style={{ marginBottom: 12 }}>{revertErr}</div>}

            <div className="modal-footer" style={{ borderTop: '1px solid var(--border)', padding: '14px 0 0' }}>
              <button className="btn btn-ghost" onClick={closeRevertModal} disabled={reverting}>Cancel</button>
              <button
                style={{
                  background: reverting ? '#e2e8f0' : '#d97706',
                  color: reverting ? '#94a3b8' : '#fff',
                  border: 'none', borderRadius: 8, padding: '8px 20px',
                  fontWeight: 700, cursor: reverting ? 'not-allowed' : 'pointer', fontSize: '0.9rem',
                }}
                onClick={revertToPharmacist}
                disabled={reverting}
              >
                {reverting ? '⏳ Reverting…' : '↩ Confirm Revert to Pharmacist'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── PharmacyHead Editable Comparison Sheet Overlay ── */}
      {showPhSheet && selected && (
        <ComparisonSheet
          mode="pharmacy_head"
          compType={
            (phAltEdit.length > 0 && phAltEdit[0].comparison_type) ||
            (selected.REQUEST_TYPE === 'New Molecule' ? 'new_generic' : 'existing_generic')
          }
          alternatives={phAltEdit}
          existingGenericData={phEgdEdit}
          existingDetails={existingDetails}
          pharmRemarks={selected.PHARMACIST_REMARKS || ''}
          phRemarks={phRemarksEdit}
          dtcRecommendationNotes={dtcRecNotesEdit}
          onDtcRecommendationNotesChange={setDtcRecNotesEdit}
          requestInfo={selected}
          effectiveDrugEntries={effectiveDrugEntries}
          phFinalRecommendation={phFinalRecommendation}
          onPhFinalRecommendationChange={setPhFinalRecommendation}
          onAlternativesChange={setPhAltEdit}
          onExistingChange={setPhEgdEdit}
          onPhRemarksChange={setPhRemarksEdit}
          onAddAlt={() => setPhAltEdit(prev => [
            ...prev,
            {
              brand_name: '', manufacturer: '', marketer: '',
              mrp_per_pack: '', rate_per_pack: '', gst_percent: '',
              mrp: '', rate: '', qty: '',
              offer: '', net_rate: '', margin: '', markupmargin: '', profit_margin: '',
              stock: '', purchase_qty: '', remark: '', consultant: '', sale_qty: '',
              pack: '', introduced_on: 'New Item', negorate: '',
              negotiated_mrp: '', negotiated_rate: '', negotiated_gst: '',
              negotiated_scheme_qty: '', negotiated_scheme_offer: '', negotiation_remarks: '',
            }
          ])}
          onSave={savePhComparison}
          saving={saving}
          onForwardToDTC={forwardToDTC}
          forwarding={forwarding}
          onBack={closePhSheet}
        />
      )}
    </div>
  );
}
