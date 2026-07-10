// =====================================================================
// CEOTab.js — Final approval stage
// =====================================================================
import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import AnalyticsDashboard from './AnalyticsDashboard';
import Notifications from './Notifications';
import { AlternativesTable } from './PharmacistTab';
import RejectionRemarksPanel, { composeRejectionRemarks, validateRejection } from './RejectionRemarksPanel';
import ApprovalRemarksPanel from './ApprovalRemarksPanel';
import ComparisonSheet from './ComparisonSheet';
import { ceoGuideContent } from './ceoGuideContent';


const API = '/api';

const DETAIL_ROWS = [
  ['Brand Name', 'BRAND_NAME'],
  ['Generic Name', 'GENERIC_NAME'],
  ['Dose / Strength', 'DOSE_STRENGTH'],
  ['Dosage Form', 'DOSAGE_FORM'],
  ['Category', 'CATEGORY'],
  ['Request Type', 'REQUEST_TYPE'],
  ['Request Source', 'REQUEST_SOURCE_TYPE'],
  ['Formulary Type', 'FORMULARY_REQUEST_TYPE'],
  ['Manufacturer', 'MANUFACTURER'],
  ['Marketer', 'MARKETER'],
  ['Existing Brands', 'EXISTING_BRANDS'],
  ['Expected Patients/Month', 'EXPECTED_PATIENTS_PM'],
  ['Medicine Quantity', 'MEDICINE_QUANTITY'],
  ['Cost Reduction', 'COST_REDUCTION_BENEFIT'],
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

export default function CEOTab({ currentUser, onNotificationsRead }) {
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
  const [showCompSheet, setShowCompSheet] = useState(false);
  const [ceoAltView, setCeoAltView] = useState([]);
  const [ceoEgdView, setCeoEgdView] = useState({});
  const [ceoExistingDetails, setCeoExistingDetails] = useState([]);
  const [effectiveDrugEntries, setEffectiveDrugEntries] = useState([]);
  const [auditLogs, setAuditLogs] = useState([]);


  const loadRequests = useCallback(async () => {
    setLoading(true);
    try {
      const r = await axios.get(`${API}/requests/CEO/${currentUser.USER_ID}`);
      setRequests(r.data);
    } catch {
    } finally {
      setLoading(false);
    }
  }, [currentUser]);

  useEffect(() => { loadRequests(); }, [loadRequests]);

  const openModal = async (req, act) => {
    setSelected(req);
    setAction(act);
    setApproveRemarks('');
    setSelectedReasons([]); setCustomRemarks(['']); setRemarkErr('');
    setEffectiveDrugEntries(req.effective_drug_entries || []);
    setLoadingAlts(true);

    // Fetch DTC selected recommendations independently
    axios.get(`${API}/alternatives/${req.REQUEST_ID}/selected`)
      .then(res => {
        setAlternatives(res.data ? [res.data] : []);
      })
      .catch(err => {
        console.error("Failed to load selected alternatives:", err);
        setAlternatives([]);
      });

    // Fetch lists and comparison data
    const loadAltsAndDetails = async () => {
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
        setCeoExistingDetails(normalizedExistingDetails);

        const egd = egdRes.data?.existing_generic_data || null;
        setCeoEgdView(egd || {});
        if (altsRes.data?.effective_drug_entries) {
          setEffectiveDrugEntries(altsRes.data.effective_drug_entries);
        }
        setCeoAltView(altsRaw.map(a => ({
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
      } catch (err) {
        console.error('Failed to load comparison sheet lists:', err);
        setCeoAltView([]);
        setCeoEgdView({});
        setCeoExistingDetails([]);
      } finally {
        setLoadingAlts(false);
      }
    };
    loadAltsAndDetails();
  };
  const closeModal = () => {
    setSelected(null); setAction('');
    setApproveRemarks('');
    setSelectedReasons([]); setCustomRemarks(['']); setRemarkErr('');
    setAlternatives([]);
    setCeoAltView([]); setCeoEgdView({}); setCeoExistingDetails([]); setShowCompSheet(false);
    setEffectiveDrugEntries([]);
    setAuditLogs([]);
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
      setAlertMsg({
        type: action === 'approve' ? 'success' : 'error',
        msg: action === 'approve'
          ? `🏆 Request #${selected.REQUEST_ID} (${selected.BRAND_NAME}) has been FINALLY APPROVED and added to the formulary!`
          : `❌ Request #${selected.REQUEST_ID} rejected. Doctor, Pharmacy Head, and DTC have been notified.`,
      });
      closeModal();
      await loadRequests();
      setDashKey(k => k + 1);
    } catch (err) {
      setRemarkErr(err.response?.data?.error || 'Action failed.');
    } finally {
      setSubmitting(false);
    }
  };

  const [genericlist, setGenericlist] = useState([]);
  const [showGenericPopup, setShowGenericPopup] = useState(false);
  const [dosageFilter, setDosageFilter] = useState('');
  const [dosageFormFilter, setDosageFormFilter] = useState('');

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

  const getGenericDetails = async (gerenic_name) => {
    setDosageFilter('');
    setDosageFormFilter('');
    try {
      const generic = gerenic_name;
      if (!generic || generic.trim() === '') {
        return;
      }
      const res = await axios.post(`${API}/getGeneric`, { search: generic });
      const record = res.data;
      setGenericlist(record.list || []);
      setShowGenericPopup(true);
    } catch (err) {
      console.error(err);
      setGenericlist([]);
      setShowGenericPopup(true);
    }
  };

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
    <div className="ceo-dashboard-root">
      <style>{`
        .ceo-dashboard-root {
          width: 100%;
          max-width: 100%;
          box-sizing: border-box;
        }

        .ceo-dashboard-root *, 
        .ceo-dashboard-root *::before, 
        .ceo-dashboard-root *::after {
          box-sizing: border-box;
        }

        /* inner-tabs wrapper and buttons */
        .ceo-dashboard-root .inner-tabs {
          display: flex !important;
          flex-wrap: wrap !important;
          gap: 8px !important;
          margin-bottom: 22px !important;
        }

        @media (max-width: 768px) {
          .ceo-dashboard-root .inner-tabs {
            flex-wrap: nowrap !important;
            overflow-x: auto !important;
            white-space: nowrap !important;
            -webkit-overflow-scrolling: touch !important;
            padding-bottom: 6px !important;
          }
          .ceo-dashboard-root .inner-tab-btn {
            flex: 0 0 auto !important;
          }
        }

        /* Desktop vs Mobile Request List Views */
        .ceo-desktop-table-view {
          display: block;
          width: 100%;
        }
        .ceo-mobile-cards-view {
          display: none;
        }

        @media (max-width: 991px) {
          .ceo-desktop-table-view {
            display: none !important;
          }
          .ceo-mobile-cards-view {
            display: flex !important;
            flex-direction: column;
            gap: 16px;
            width: 100%;
            margin-top: 10px;
          }
          
          .ceo-mobile-card {
            background: #fff;
            border: 1px solid #cbd5e1;
            border-radius: 12px;
            padding: 16px;
            box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05), 0 2px 4px -2px rgba(0, 0, 0, 0.05);
            display: flex;
            flex-direction: column;
            gap: 12px;
            text-align: left;
          }
          
          .ceo-mobile-card .card-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            border-bottom: 1.5px solid #f1f5f9;
            padding-bottom: 8px;
          }
          
          .ceo-mobile-card .card-header .request-id {
            font-weight: 700;
            color: var(--primary-light, #0284c7);
            font-size: 0.95rem;
          }
          
          .ceo-mobile-card .card-header .submitted-date {
            font-size: 0.78rem;
            color: var(--text-muted, #64748b);
          }
          
          .ceo-mobile-card .card-body-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
            gap: 12px 16px;
          }
          
          @media (max-width: 480px) {
            .ceo-mobile-card .card-body-grid {
              grid-template-columns: 1fr;
            }
          }
          
          .ceo-mobile-card .grid-item {
            display: flex;
            flex-direction: column;
            gap: 4px;
          }
          
          .ceo-mobile-card .grid-item.full-width {
            grid-column: 1 / -1;
          }
          
          .ceo-mobile-card .grid-item .label {
            font-size: 0.7rem;
            font-weight: 700;
            color: #64748b;
            text-transform: uppercase;
            letter-spacing: 0.05em;
          }
          
          .ceo-mobile-card .grid-item .value {
            font-size: 0.88rem;
            font-weight: 600;
            color: var(--text, #1e293b);
          }
          
          .ceo-mobile-card .grid-item .value.brand-name {
            color: var(--primary-light, #0284c7);
            font-size: 0.95rem;
          }
          
          .ceo-mobile-card .grid-item .value.text-block {
            background: #f8fafc;
            border: 1px solid #e2e8f0;
            border-radius: 6px;
            padding: 8px 10px;
            font-size: 0.8rem;
            font-weight: 500;
            line-height: 1.45;
            white-space: pre-wrap;
            word-break: break-word;
          }
          
          .ceo-mobile-card .card-actions {
            display: flex;
            justify-content: space-between;
            align-items: center;
            border-top: 1.5px solid #f1f5f9;
            padding-top: 12px;
            margin-top: 4px;
            flex-wrap: wrap;
            gap: 8px;
          }
          
          @media (max-width: 480px) {
            .ceo-mobile-card .card-actions {
              flex-direction: column;
              align-items: stretch;
            }
            .ceo-mobile-card .card-actions > div {
              justify-content: space-between;
              width: 100%;
            }
          }
        }

        /* Desktop Column Truncation and Tooltip prep */
        .ceo-dashboard-root .ceo-desktop-table-view .data-table th,
        .ceo-dashboard-root .ceo-desktop-table-view .data-table td {
          overflow: hidden !important;
          text-overflow: ellipsis !important;
          white-space: nowrap !important;
        }
        .ceo-dashboard-root .ceo-desktop-table-view .data-table td > div,
        .ceo-dashboard-root .ceo-desktop-table-view .data-table td > small {
          overflow: hidden !important;
          text-overflow: ellipsis !important;
          white-space: nowrap !important;
        }

        /* KPI cards wrapping and auto-sizing */
        .ceo-dashboard-root .analytics-kpi-grid,
        .ceo-dashboard-root .metrics-grid {
          display: grid !important;
          grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)) !important;
          gap: 16px !important;
          width: 100% !important;
        }

        /* Stack Overview split grids on Mobile */
        @media (max-width: 768px) {
          .ceo-dashboard-root .analytics-console div[style*="1fr 1fr"] {
            grid-template-columns: 1fr !important;
          }
        }

        /* Scoped filter bar overrides inside AnalyticsDashboard card */
        .ceo-dashboard-root .analytics-console .card > div:has(.form-input),
        .ceo-dashboard-root .analytics-console .card > div:has(.form-select),
        .ceo-dashboard-root .analytics-console .card > div[style*="margin-bottom: 16"],
        .ceo-dashboard-root .analytics-console .card > div[style*="margin-bottom:16"] {
          display: flex !important;
          flex-wrap: wrap !important;
          gap: 10px !important;
        }
        @media (min-width: 992px) {
          .ceo-dashboard-root .analytics-console .card > div:has(.form-input),
          .ceo-dashboard-root .analytics-console .card > div:has(.form-select),
          .ceo-dashboard-root .analytics-console .card > div[style*="margin-bottom: 16"],
          .ceo-dashboard-root .analytics-console .card > div[style*="margin-bottom:16"] {
            flex-direction: row !important;
            align-items: center !important;
          }
          .ceo-dashboard-root .analytics-console .card > div:has(.form-input) > *,
          .ceo-dashboard-root .analytics-console .card > div:has(.form-select) > *,
          .ceo-dashboard-root .analytics-console .card > div[style*="margin-bottom: 16"] > *,
          .ceo-dashboard-root .analytics-console .card > div[style*="margin-bottom:16"] > * {
            flex: 0 1 auto !important;
          }
        }
        @media (min-width: 768px) and (max-width: 991px) {
          .ceo-dashboard-root .analytics-console .card > div:has(.form-input),
          .ceo-dashboard-root .analytics-console .card > div:has(.form-select),
          .ceo-dashboard-root .analytics-console .card > div[style*="margin-bottom: 16"],
          .ceo-dashboard-root .analytics-console .card > div[style*="margin-bottom:16"] {
            display: grid !important;
            grid-template-columns: repeat(2, 1fr) !important;
            gap: 12px !important;
          }
          .ceo-dashboard-root .analytics-console .card > div:has(.form-input) > *,
          .ceo-dashboard-root .analytics-console .card > div:has(.form-select) > *,
          .ceo-dashboard-root .analytics-console .card > div[style*="margin-bottom: 16"] > *,
          .ceo-dashboard-root .analytics-console .card > div[style*="margin-bottom:16"] > * {
            width: 100% !important;
            max-width: 100% !important;
            flex: none !important;
          }
        }
        @media (max-width: 767px) {
          .ceo-dashboard-root .analytics-console .card > div:has(.form-input),
          .ceo-dashboard-root .analytics-console .card > div:has(.form-select),
          .ceo-dashboard-root .analytics-console .card > div[style*="margin-bottom: 16"],
          .ceo-dashboard-root .analytics-console .card > div[style*="margin-bottom:16"] {
            flex-direction: column !important;
            align-items: stretch !important;
          }
          .ceo-dashboard-root .analytics-console .card > div:has(.form-input) > *,
          .ceo-dashboard-root .analytics-console .card > div:has(.form-select) > *,
          .ceo-dashboard-root .analytics-console .card > div[style*="margin-bottom: 16"] > *,
          .ceo-dashboard-root .analytics-console .card > div[style*="margin-bottom:16"] > * {
            width: 100% !important;
            max-width: 100% !important;
            flex: none !important;
          }
        }

        /* Explicitly restore RankBar block layout and bar visibility */
        .ceo-dashboard-root .analytics-console .card > div[style*="margin-bottom: 10"],
        .ceo-dashboard-root .analytics-console .card > div[style*="margin-bottom:10"] {
          display: block !important;
        }
        .ceo-dashboard-root .analytics-console .card > div[style*="margin-bottom: 10"] > *,
        .ceo-dashboard-root .analytics-console .card > div[style*="margin-bottom:10"] > * {
          flex: none !important;
          width: auto !important;
          max-width: none !important;
        }

        /* Ensure card titles, modal footers and headers wrap action buttons */
        .ceo-dashboard-root .card-title,
        .ceo-dashboard-root .section-header {
          display: flex !important;
          flex-wrap: wrap !important;
          gap: 10px !important;
        }

        /* Notification text wrapping */
        .ceo-dashboard-root .notif-item {
          max-width: 100% !important;
          box-sizing: border-box !important;
        }
        .ceo-dashboard-root .notif-msg {
          word-break: break-word !important;
          white-space: normal !important;
          overflow-wrap: anywhere !important;
        }

        /* Responsive tables container rules */
        .ceo-dashboard-root .table-wrap {
          width: 100% !important;
          max-width: 100% !important;
          overflow-x: auto !important;
          -webkit-overflow-scrolling: touch !important;
          margin-bottom: 1rem !important;
          border-radius: 8px !important;
          border: 1px solid #e2e8f0 !important;
        }
        .ceo-dashboard-root table {
          width: 100% !important;
        }

        /* Workflow Tracker Mobile Card view shifted to 992px */
        @media (max-width: 991px) {
          .ceo-dashboard-root .tracker-desktop-table {
            display: none !important;
          }
          .ceo-dashboard-root .tracker-mobile-cards {
            display: block !important;
            width: 100% !important;
          }
          .ceo-dashboard-root .workflow-stepper {
            flex-direction: column !important;
            align-items: flex-start !important;
            gap: 16px !important;
            padding-left: 32px !important;
          }
          .ceo-dashboard-root .workflow-stepper::before {
            top: 32px !important;
            bottom: 32px !important;
            left: 36px !important;
            width: 2px !important;
            height: auto !important;
          }
          .ceo-dashboard-root .workflow-step {
            flex-direction: row !important;
            align-items: center !important;
            gap: 16px !important;
            width: 100% !important;
          }
          .ceo-dashboard-root .workflow-step::before,
          .ceo-dashboard-root .workflow-step::after {
            display: none !important;
          }
          .ceo-dashboard-root .workflow-step-dot {
            margin-bottom: 0 !important;
            flex-shrink: 0 !important;
          }
          .ceo-dashboard-root .workflow-step-label {
            text-align: left !important;
            max-width: none !important;
            font-size: 0.8rem !important;
          }
        }
        
        @media (min-width: 992px) {
          .ceo-dashboard-root .tracker-desktop-table {
            display: table !important;
            width: 100% !important;
          }
          .ceo-dashboard-root .tracker-mobile-cards {
            display: none !important;
          }
        }

        /* Premium Modal Overrides */
        .ceo-dashboard-root .modal-overlay {
          background: rgba(15, 23, 42, 0.4) !important;
          backdrop-filter: blur(4px) !important;
          display: flex !important;
          align-items: center !important;
          justify-content: center !important;
          overflow-y: auto !important;
          padding: 16px !important;
          position: fixed !important;
          inset: 0 !important;
          z-index: 1100 !important;
        }

        .ceo-dashboard-root .modal {
          border-radius: 16px !important;
          border: 1px solid #cbd5e1 !important;
          box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04) !important;
          padding: 24px !important;
          height: auto !important;
          width: 100% !important;
          max-height: 90vh !important;
          display: flex !important;
          flex-direction: column !important;
          margin: auto !important;
          background: #fff !important;
        }

        @media (min-width: 992px) {
          .ceo-dashboard-root .modal {
            max-width: 680px !important;
          }
          .ceo-dashboard-root .modal.view-detail-modal {
            max-width: 920px !important;
          }
          .ceo-dashboard-root .modal.generic-lookup-modal {
            max-width: 1000px !important;
          }
        }

        @media (max-width: 991px) {
          .ceo-dashboard-root .modal {
            max-width: 100% !important;
            width: 95vw !important;
            padding: 18px !important;
            border-radius: 12px !important;
            max-height: 95vh !important;
          }
        }

        .ceo-dashboard-root .modal .form-group {
          max-height: 65vh !important;
          overflow-y: auto !important;
        }

        /* Modal Footer Responsiveness */
        .ceo-dashboard-root .modal-footer {
          display: flex !important;
          flex-wrap: wrap !important;
          gap: 10px !important;
          margin-top: 16px !important;
        }

        @media (max-width: 767px) {
          .ceo-dashboard-root .modal-footer {
            flex-direction: column !important;
            align-items: stretch !important;
            gap: 12px !important;
          }
          .ceo-dashboard-root .modal-footer > div {
            display: flex !important;
            flex-direction: column !important;
            width: 100% !important;
            gap: 8px !important;
          }
          .ceo-dashboard-root .modal-footer button {
            width: 100% !important;
            justify-content: center !important;
          }
        }

        /* Comparison Sheet Scalable & Toolbar */
        .ceo-dashboard-root .mobile-only-toolbar {
          display: flex !important;
          flex-wrap: wrap !important;
          gap: 8px !important;
          justify-content: space-between !important;
          align-items: center !important;
          background: #2d3748 !important;
          padding: 10px 16px !important;
          border-radius: 8px !important;
          margin-bottom: 12px !important;
          width: 100% !important;
          box-sizing: border-box !important;
        }

        /* Training Center Layout */
        .ceo-training-container {
          display: flex !important;
          gap: 24px !important;
          width: 100% !important;
          margin-top: 10px !important;
          align-items: flex-start !important;
        }

        .ceo-training-sidebar {
          width: 240px !important;
          background: #fff !important;
          border: 1px solid #cbd5e1 !important;
          border-radius: 12px !important;
          padding: 16px !important;
          position: sticky !important;
          top: 20px !important;
          max-height: calc(100vh - 120px) !important;
          overflow-y: auto !important;
          flex-shrink: 0 !important;
          display: flex !important;
          flex-direction: column !important;
          gap: 6px !important;
          box-shadow: 0 1px 3px rgba(0,0,0,0.05) !important;
        }

        .ceo-training-sidebar-btn {
          display: flex !important;
          align-items: center !important;
          gap: 10px !important;
          width: 100% !important;
          padding: 8px 12px !important;
          border-radius: 8px !important;
          border: none !important;
          background: transparent !important;
          color: #64748b !important;
          font-size: 0.85rem !important;
          font-weight: 500 !important;
          text-align: left !important;
          cursor: pointer !important;
          transition: all 0.15s !important;
        }

        .ceo-training-sidebar-btn:hover {
          background: #f8fafc !important;
          color: #0ea5e9 !important;
        }

        .ceo-training-sidebar-btn.active {
          background: #e0f2fe !important;
          color: #0284c7 !important;
          font-weight: 700 !important;
        }

        .ceo-training-content-area {
          flex: 1 !important;
          min-width: 0 !important;
          display: flex !important;
          flex-direction: column !important;
          gap: 20px !important;
        }

        .ceo-video-card {
          background: #fff !important;
          border: 1px solid #cbd5e1 !important;
          border-radius: 12px !important;
          padding: 20px !important;
          box-shadow: 0 1px 3px rgba(0,0,0,0.05) !important;
        }

        .ceo-video-title {
          font-size: 1.05rem !important;
          font-weight: 700 !important;
          color: #1e293b !important;
          margin-bottom: 12px !important;
          display: flex !important;
          align-items: center !important;
          gap: 8px !important;
        }

        .ceo-video-player-wrapper {
          position: relative !important;
          padding-bottom: 56.25% !important; /* 16:9 Aspect Ratio */
          height: 0 !important;
          overflow: hidden !important;
          border-radius: 8px !important;
          border: 1px solid #cbd5e1 !important;
          background: #000 !important;
          margin-bottom: 12px !important;
        }

        .ceo-video-player-wrapper iframe {
          position: absolute !important;
          top: 0 !important;
          left: 0 !important;
          width: 100% !important;
          height: 100% !important;
          border: 0 !important;
        }

        .ceo-video-description {
          font-size: 0.85rem !important;
          line-height: 1.5 !important;
          color: #64748b !important;
        }

        .ceo-guide-search-card {
          background: #fff !important;
          border: 1px solid #cbd5e1 !important;
          border-radius: 12px !important;
          padding: 16px !important;
          display: flex !important;
          align-items: center !important;
          gap: 12px !important;
          box-shadow: 0 1px 3px rgba(0,0,0,0.05) !important;
        }

        .ceo-guide-search-input {
          flex: 1 !important;
          padding: 10px 14px !important;
          font-size: 0.88rem !important;
          border: 1px solid #cbd5e1 !important;
          border-radius: 8px !important;
          background: #f8fafc !important;
          color: #1e293b !important;
          outline: none !important;
          transition: border-color 0.15s !important;
        }

        .ceo-guide-search-input:focus {
          border-color: #0ea5e9 !important;
          background: #fff !important;
        }

        .ceo-guide-section-card {
          background: #fff !important;
          border: 1px solid #cbd5e1 !important;
          border-radius: 12px !important;
          overflow: hidden !important;
          transition: box-shadow 0.15s !important;
          box-shadow: 0 1px 3px rgba(0,0,0,0.05) !important;
        }

        .ceo-guide-section-card:hover {
          box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05) !important;
        }

        .ceo-guide-section-header {
          padding: 16px 20px !important;
          background: #f8fafc !important;
          border-bottom: 1px solid #cbd5e1 !important;
          display: flex !important;
          justify-content: space-between !important;
          align-items: center !important;
          cursor: pointer !important;
          user-select: none !important;
        }

        .ceo-guide-section-header:hover {
          background: #f1f5f9 !important;
        }

        .ceo-guide-section-title {
          font-size: 0.95rem !important;
          font-weight: 700 !important;
          color: #1e293b !important;
          display: flex !important;
          align-items: center !important;
          gap: 10px !important;
        }

        .ceo-guide-section-toggle-icon {
          font-size: 0.8rem !important;
          color: #64748b !important;
          transition: transform 0.15s !important;
        }

        .ceo-guide-section-body {
          padding: 20px !important;
          display: flex !important;
          flex-direction: column !important;
          gap: 12px !important;
        }

        .ceo-guide-paragraph {
          font-size: 0.88rem !important;
          line-height: 1.6 !important;
          color: #334155 !important;
          margin: 0 !important;
        }

        .guide-highlight {
          background: #fef08a !important;
          color: #1e293b !important;
          padding: 2px 4px !important;
          border-radius: 4px !important;
          font-weight: 700 !important;
        }

        @media (max-width: 991px) {
          .ceo-training-container {
            flex-direction: column !important;
            align-items: stretch !important;
            gap: 16px !important;
          }
          .ceo-training-sidebar {
            width: 100% !important;
            position: static !important;
            max-height: none !important;
            flex-direction: row !important;
            flex-wrap: nowrap !important;
            overflow-x: auto !important;
            padding: 8px !important;
            gap: 8px !important;
            -webkit-overflow-scrolling: touch !important;
          }
          .ceo-training-sidebar-btn {
            flex: 0 0 auto !important;
            width: auto !important;
            padding: 6px 12px !important;
          }
        }
      `}</style>

      {/* ---- Inner Tab Nav ---- */}
      <div className="inner-tabs">
        {['pending', 'dashboard', 'notifications', 'training'].map(v => (
          <button key={v} className={`inner-tab-btn ${view === v ? 'active' : ''}`} onClick={() => setView(v)}>
            {v === 'pending'
              ? `⏳ Awaiting Decision (${requests.length})`
              : v === 'dashboard'
                ? '📊 Dashboard'
                : v === 'notifications'
                  ? '🔔 Notifications'
                  : 'Tutorial'}
          </button>
        ))}
      </div>

      {alertMsg && (
        <div className={`alert alert-${alertMsg.type}`} style={{ marginBottom: 18 }}>
          {alertMsg.msg}
          <button
            style={{ float: 'right', background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', fontWeight: 700 }}
            onClick={() => setAlertMsg(null)}
          >✕</button>
        </div>
      )}

      {/* ======== PENDING REQUESTS ======== */}
      {view === 'pending' && (
        <div className="card">
          <div className="card-title" style={{ justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div className="icon">👔</div>
              Requests Awaiting CEO Decision
              <span className="badge badge-pending" style={{ marginLeft: 4 }}>Final Stage</span>
            </div>
            <button className="btn btn-ghost btn-sm" onClick={loadRequests}>↺ Refresh</button>
          </div>

          <div className="alert alert-warning" style={{ marginBottom: 18, fontSize: '0.82rem' }}>
            ⚠️ These requests have been reviewed and approved by both the Pharmacy Head and DTC Committee. Your decision is final and will update the hospital formulary.
          </div>

          {loading ? (
            <div style={{ textAlign: 'center', padding: 60 }}><div className="spinner" /></div>
          ) : requests.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 60, color: 'var(--text-subtle)' }}>
              <div style={{ fontSize: '3rem', marginBottom: 12 }}>📭</div>
              No requests awaiting your decision.
            </div>
          ) : (
            <>
              {/* Desktop Table View */}
              <div className="ceo-desktop-table-view">
                <div className="table-wrap">
                  <table className="data-table" style={{ tableLayout: 'fixed', width: '100%', minWidth: '1200px' }}>
                    <thead>
                      <tr>
                        <th className="sticky-col" style={{ width: '80px' }}>#ID</th>
                        <th style={{ width: '140px' }}>Brand Name</th>
                        <th style={{ width: '160px' }}>Generic Name</th>
                        <th style={{ width: '110px' }}>Category</th>
                        <th style={{ width: '90px' }}>Type</th>
                        <th style={{ width: '100px' }}>Formulary Type</th>
                        <th style={{ width: '110px' }}>Source</th>
                        <th style={{ width: '90px' }}>Submitted</th>
                        {/* <th style={{ width: '120px' }}>Effective Created</th> */}
                        <th style={{ width: '200px' }}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {requests.map(r => (
                        <tr key={r.REQUEST_ID}>
                          <td className="sticky-col" style={{ fontWeight: 700, color: 'var(--primary-light)' }}>#{r.REQUEST_ID}</td>
                          <td style={{ fontWeight: 600 }} title={r.BRAND_NAME}>{r.BRAND_NAME}</td>
                          <td style={{ color: 'var(--text-muted)' }} title={r.GENERIC_NAME}>
                            {r.GENERIC_NAME}
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm"
                              style={{ marginTop: 4, display: 'block', borderColor: 'var(--primary)', color: 'var(--primary)' }}
                              onClick={() => { getGenericDetails(r.GENERIC_NAME) }}
                            >
                              Check Existing
                            </button>
                          </td>
                          <td title={r.CATEGORY}>{r.CATEGORY}</td>
                          <td><span className="badge badge-info">{r.REQUEST_TYPE}</span></td>
                          <td>
                            {r.FORMULARY_REQUEST_TYPE === 'FORMULARY' ? (
                              <span className="badge" style={{ background: '#ecfdf5', color: '#065f46' }}>Formulary</span>
                            ) : r.FORMULARY_REQUEST_TYPE === 'NON_FORMULARY' ? (
                              <span className="badge" style={{ background: '#fef2f2', color: '#991b1b' }}>Non-Formulary</span>
                            ) : '—'}
                          </td>
                          <td>
                            {r.REQUEST_SOURCE_TYPE === 'NON_PROMOTIONAL' ? (
                              <span className="badge badge-non-promotional">Clinician initiated</span>
                            ) : (
                              <span className="badge badge-promotional">Via Medical Representative</span>
                            )}
                          </td>
                          <td style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                            {new Date(r.CREATED_AT).toLocaleDateString('en-IN')}
                          </td>
                          {/* <td style={{ fontSize: '0.8rem', color: 'var(--primary-light)' }}>
                            {r.EFFECTIVE_CREATED_AT
                              ? new Date(r.EFFECTIVE_CREATED_AT).toLocaleString('en-IN')
                              : new Date(r.CREATED_AT).toLocaleString('en-IN')}
                          </td> */}
                          <td>
                            <div style={{ display: 'flex', gap: 6 }}>
                              <button className="btn btn-ghost btn-sm" onClick={() => openModal(r, 'view')}>👁 View</button>
                              <button className="btn btn-success btn-sm" onClick={() => openModal(r, 'approve')}>🏆 Approve</button>
                              <button className="btn btn-danger btn-sm" onClick={() => openModal(r, 'reject')}>✕ Reject</button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Mobile Cards View (< 992px) */}
              <div className="ceo-mobile-cards-view">
                {requests.map(r => (
                  <div key={r.REQUEST_ID} className="ceo-mobile-card">
                    <div className="card-header">
                      <span className="request-id">Request #{r.REQUEST_ID}</span>
                      <span className="submitted-date">{new Date(r.CREATED_AT).toLocaleDateString('en-IN')}</span>
                    </div>
                    <div className="card-body-grid">
                      <div className="grid-item">
                        <span className="label">Brand Name</span>
                        <span className="value brand-name">{r.BRAND_NAME}</span>
                      </div>
                      <div className="grid-item">
                        <span className="label">Generic Name</span>
                        <span className="value">
                          {r.GENERIC_NAME}
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            style={{ marginTop: 4, width: '100%', borderColor: 'var(--primary)', color: 'var(--primary)', fontSize: '0.7rem', padding: '2px 6px' }}
                            onClick={() => { getGenericDetails(r.GENERIC_NAME) }}
                          >
                            Check Existing
                          </button>
                        </span>
                      </div>
                      <div className="grid-item">
                        <span className="label">Status</span>
                        <span className="value"><span className="badge badge-pending">Pending CEO Approval</span></span>
                      </div>
                      <div className="grid-item">
                        <span className="label">Category</span>
                        <span className="value">{r.CATEGORY}</span>
                      </div>
                      <div className="grid-item">
                        <span className="label">Type</span>
                        <span className="value"><span className="badge badge-info">{r.REQUEST_TYPE}</span></span>
                      </div>
                      <div className="grid-item">
                        <span className="label">Formulary Type</span>
                        <span className="value">
                          {r.FORMULARY_REQUEST_TYPE === 'FORMULARY' ? (
                            <span className="badge" style={{ background: '#ecfdf5', color: '#065f46' }}>Formulary</span>
                          ) : r.FORMULARY_REQUEST_TYPE === 'NON_FORMULARY' ? (
                            <span className="badge" style={{ background: '#fef2f2', color: '#991b1b' }}>Non-Formulary</span>
                          ) : '—'}
                        </span>
                      </div>
                      <div className="grid-item">
                        <span className="label">Source</span>
                        <span className="value">
                          {r.REQUEST_SOURCE_TYPE === 'NON_PROMOTIONAL' ? (
                            <span className="badge badge-non-promotional">Clinical</span>
                          ) : (
                            <span className="badge badge-promotional">MR</span>
                          )}
                        </span>
                      </div>
                      {r.EFFECTIVE_CREATED_AT && (
                        <div className="grid-item full-width">
                          <span className="label">Effective Created</span>
                          <span className="value">{new Date(r.EFFECTIVE_CREATED_AT).toLocaleString('en-IN')}</span>
                        </div>
                      )}
                    </div>
                    <div className="card-actions">
                      <button className="btn btn-ghost btn-sm" onClick={() => openModal(r, 'view')}>👁 View Details</button>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button className="btn btn-success btn-sm" onClick={() => openModal(r, 'approve')}>🏆 Approve</button>
                        <button className="btn btn-danger btn-sm" onClick={() => openModal(r, 'reject')}>✕ Reject</button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* ======== DASHBOARD ======== */}
      {view === 'dashboard' && (
        <AnalyticsDashboard role="CEO" />
      )}

      {/* ======== NOTIFICATIONS ======== */}
      {view === 'notifications' && (
        <Notifications userId={currentUser.USER_ID} onRead={onNotificationsRead} />
      )}

      {/* ======== TRAINING CENTER ======== */}
      {view === 'training' && (
        <CEOTrainingCenter />
      )}

      {/* ---- View Detail Modal ---- */}
      {selected && action === 'view' && (
        <div className="modal-overlay" onClick={closeModal}>
          <div className="modal view-detail-modal" style={{ maxWidth: '94vw' }} onClick={e => e.stopPropagation()}>
            <div className="modal-title">📋 Request #{selected.REQUEST_ID} — Complete Review File</div>

            <div style={{ maxHeight: '52vh', overflowY: 'auto' }}>
              <table className="details-table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
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
                    <td style={{ padding: '9px 12px', color: 'var(--text-muted)', fontWeight: 600, fontSize: '0.8rem', verticalAlign: 'top' }}>Requesting Doctor</td>
                    <td style={{ padding: '9px 12px', color: 'var(--text)' }}>
                      <div>{selected.DOCTOR_NAME}</div>
                      <small className="text-muted" style={{ display: 'block', fontSize: '0.75rem' }}>
                        {selected.CREATED_BY_ROLE || 'Doctor'} • {selected.DOCTOR_DEPT || ''}
                      </small>
                    </td>
                  </tr>
                  <tr style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '9px 12px', color: 'var(--text-muted)', fontWeight: 600, fontSize: '0.8rem', verticalAlign: 'top' }}>Clinical Justification</td>
                    <td style={{ padding: '9px 12px', color: 'var(--text)', lineHeight: 1.6 }}>{selected.CLINICAL_JUSTIFICATION}</td>
                  </tr>
                </tbody>
              </table>

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

              {loadingAlts ? (
                <div style={{ textAlign: 'center', padding: 24 }}><div className="spinner" /></div>
              ) : alternatives.length > 0 && alternatives[0] && (() => {
                const sel = alternatives[0];
                if (sel.type === 'multi') {
                  return (
                    <div style={{ marginTop: 20 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
                        <span style={{ fontSize: '1.1rem' }}>🏆</span>
                        <span style={{ fontWeight: 700, fontSize: '0.95rem', color: '#1e293b' }}>DTC Final Selected Recommendations ({sel.recommendations.length})</span>
                      </div>

                      {selected.DTC_FINAL_SELECTION_NOTES && (
                        <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderLeft: '4px solid #f59e0b', borderRadius: 8, padding: '10px 14px', fontSize: '0.82rem', color: '#78350f', marginBottom: 14 }}>
                          <strong>DTC Selection Notes:</strong> {selected.DTC_FINAL_SELECTION_NOTES}
                        </div>
                      )}

                      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                        {sel.recommendations.map((drug, index) => {
                          const isOriginal = drug.type === 'original';
                          return (
                            <div key={index} style={{ background: 'linear-gradient(135deg,#eff6ff,#f0fdf4)', border: '2px solid #2563eb', borderRadius: 12, padding: '18px 22px', boxShadow: '0 2px 12px rgba(37,99,235,0.1)' }}>
                              <div style={{ fontWeight: 800, fontSize: '1.05rem', color: '#1e40af', marginBottom: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <span>💊 {drug.brand_name}</span>
                                <div style={{ display: 'flex', gap: 6 }}>
                                  <span style={{ fontSize: '0.72rem', background: drug.category === 'FORMULARY' ? '#ecfdf5' : '#fef2f2', color: drug.category === 'FORMULARY' ? '#065f46' : '#991b1b', borderRadius: 10, padding: '2px 8px', fontWeight: 600 }}>
                                    {drug.category === 'FORMULARY' ? 'Formulary' : 'Non-Formulary'}
                                  </span>
                                  {isOriginal && (
                                    <span style={{ fontSize: '0.72rem', background: '#dcfce7', color: '#166534', borderRadius: 10, padding: '2px 8px', fontWeight: 600 }}>Original</span>
                                  )}
                                </div>
                              </div>
                              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: '10px 24px' }}>
                                {[
                                  ['Manufacturer', drug.manufacturer],
                                  ['Marketer', drug.marketer],
                                  ['MRP (₹)', drug.mrp ? `₹${drug.mrp}` : '—'],
                                  ['Net Rate (₹)', drug.net_rate ? `₹${drug.net_rate}` : '—'],
                                  ['Profit Margin', drug.profit_margin ? `${drug.profit_margin}%` : '—'],
                                  ['Stock', drug.stock],
                                  ['Purchase Qty', drug.purchase_qty],
                                ].map(([label, val]) => (
                                  <div key={label}>
                                    <div style={{ fontSize: '0.7rem', fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 2 }}>{label}</div>
                                    <div style={{ fontSize: '0.9rem', fontWeight: 600, color: '#1e293b' }}>{val || '—'}</div>
                                  </div>
                                ))}
                              </div>
                              {drug.reasons && drug.reasons.length > 0 && (
                                <div style={{ marginTop: 12, fontSize: '0.78rem', color: '#1e3a5f', borderTop: '1px solid #bfdbfe', paddingTop: 8 }}>
                                  <strong>Selection Reasons:</strong> {drug.reasons.join(', ')}
                                </div>
                              )}
                              {drug.notes && (
                                <div style={{ marginTop: 6, fontSize: '0.82rem', color: '#334155' }}>
                                  <strong>Notes:</strong> {drug.notes}
                                </div>
                              )}
                              {(drug.remarks || drug.remark) && (
                                <div style={{ marginTop: 6, fontSize: '0.82rem', color: '#475569' }}>
                                  <strong>Remarks:</strong> {drug.remarks || drug.remark}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                }

                // Legacy fallback card
                const drug = sel.data || sel;
                const isOriginal = sel.type === 'original';
                return (
                  <div style={{ marginTop: 20 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
                      <span style={{ fontSize: '1.1rem' }}>🏆</span>
                      <span style={{ fontWeight: 700, fontSize: '0.95rem', color: '#1e293b' }}>DTC Final Selected Drug</span>
                      <span style={{ fontSize: '0.72rem', background: '#dbeafe', color: '#1e40af', borderRadius: 20, padding: '2px 10px', fontWeight: 600 }}>
                        {isOriginal ? 'Original Requested Drug' : 'Pharmacist Alternative'}
                      </span>
                    </div>

                    {selected.DTC_FINAL_SELECTION_NOTES && (
                      <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderLeft: '4px solid #f59e0b', borderRadius: 8, padding: '10px 14px', fontSize: '0.82rem', color: '#78350f', marginBottom: 14 }}>
                        <strong>DTC Selection Notes:</strong> {selected.DTC_FINAL_SELECTION_NOTES}
                      </div>
                    )}

                    <div style={{ background: 'linear-gradient(135deg,#eff6ff,#f0fdf4)', border: '2px solid #2563eb', borderRadius: 12, padding: '18px 22px', boxShadow: '0 2px 12px rgba(37,99,235,0.1)' }}>
                      <div style={{ fontWeight: 800, fontSize: '1.05rem', color: '#1e40af', marginBottom: 10 }}>
                        💊 {drug.BRAND_NAME || drug.brand_name}
                        {isOriginal && <span style={{ marginLeft: 8, fontSize: '0.72rem', background: '#dcfce7', color: '#166534', borderRadius: 10, padding: '2px 8px', fontWeight: 600 }}>Original</span>}
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: '10px 24px' }}>
                        {[
                          ['Manufacturer', drug.MANUFACTURER || drug.manufacturer],
                          ['Marketer', drug.MARKETER || drug.marketer],
                          ['MRP (₹)', (drug.MRP || drug.mrp) ? `₹${drug.MRP || drug.mrp}` : '—'],
                          ['Net Rate (₹)', (drug.NET_RATE || drug.net_rate) ? `₹${drug.NET_RATE || drug.net_rate}` : '—'],
                          ['Profit Margin', (drug.PROFIT_MARGIN || drug.profit_margin) ? `${drug.PROFIT_MARGIN || drug.profit_margin}%` : '—'],
                          ['Stock', drug.STOCK || drug.stock],
                          ['Purchase Qty', drug.PURCHASE_QUANTITY || drug.PURCHASE_QTY || drug.purchase_qty],
                        ].map(([label, val]) => (
                          <div key={label}>
                            <div style={{ fontSize: '0.7rem', fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 2 }}>{label}</div>
                            <div style={{ fontSize: '0.9rem', fontWeight: 600, color: '#1e293b' }}>{val || '—'}</div>
                          </div>
                        ))}
                      </div>
                      {(drug.REMARK || drug.remark) && (
                        <div style={{ marginTop: 12, fontSize: '0.82rem', color: '#64748b', borderTop: '1px solid #bfdbfe', paddingTop: 10 }}>
                          💬 {drug.REMARK || drug.remark}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })()}

              {/* Ordered Workflow Remarks timeline */}
              {renderWorkflowRemarks()}
            </div>

            <div className="modal-footer" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn btn-ghost" onClick={closeModal}>Close</button>
                <button className="btn btn-danger" onClick={() => setAction('reject')}>✕ Reject</button>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  className="btn btn-primary"
                  style={{ background: '#7c3aed', border: 'none', fontWeight: 700, borderRadius: 10, padding: '8px 22px' }}
                  onClick={() => setShowCompSheet(true)}
                  disabled={loadingAlts}
                >
                  📊 View Comparison Sheet
                </button>
                <button className="btn btn-success" onClick={() => setAction('approve')}>🏆 Grant Final Approval</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ======== GENERIC POPUP ======== */}
      {showGenericPopup && (
        <div
          className="modal-overlay"
          style={{ animation: 'none' }}
          onClick={() => { setShowGenericPopup(false); setDosageFilter(''); setDosageFormFilter(''); }}
        >
          <div
            className="modal generic-lookup-modal"
            style={{ maxWidth: '92vw', width: '92vw', maxHeight: '80vh', display: 'flex', flexDirection: 'column' }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div className="modal-title" style={{ margin: 0 }}>
                🔍 Existing Drugs — Generic
              </div>
              <button
                onClick={() => { setShowGenericPopup(false); setDosageFilter(''); setDosageFormFilter(''); }}
                className="btn btn-ghost btn-sm"
                style={{ padding: '4px 10px', fontSize: '1rem', lineHeight: 1 }}
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

            {/* Modal Body */}
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
                          <th>Created Date</th>
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
                        {filtered.map((item, index) => (
                          <tr key={index}>
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
                            <td style={{ fontWeight: 600, color: 'var(--success)' }}>{item.MRP ? `₹${item.MRP}` : 'N/A'}</td>
                            <td style={{ color: 'var(--text-muted)' }}>
                              {item.CREATEDDATETIME ? new Date(item.CREATEDDATETIME).toLocaleDateString('en-IN') : '—'}
                            </td>
                            <td style={{ color: 'var(--text-muted)' }}>{item.MARKETTER_NAME || '—'}</td>
                            <td style={{ color: 'var(--text-muted)' }}>{item.MANUFACTURER_NAME || '—'}</td>
                            <td style={{ color: 'var(--text-muted)' }}>{item.FIRST_PURCHASE_RATE || '—'}</td>
                            <td style={{ color: 'var(--text-muted)' }}>{item.TOTAL_SALE_QTY || '—'}</td>
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
                        : 'No existing drugs found for this generic name.'}
                    </div>
                  </div>
                );
              })()}
            </div>

            {/* Modal Footer */}
            <div className="modal-footer" style={{ marginTop: 16 }}>
              {(dosageFilter || dosageFormFilter) && (
                <button className="btn btn-ghost btn-sm" onClick={() => { setDosageFilter(''); setDosageFormFilter(''); }}>↺ Clear All Filters</button>
              )}
              <button className="btn btn-primary btn-sm" onClick={() => { setShowGenericPopup(false); setDosageFilter(''); setDosageFormFilter(''); }}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ---- Approve / Reject Modal ---- */}
      {selected && (action === 'approve' || action === 'reject') && (
        <div className="modal-overlay">
          <div className="modal action-modal" style={{ maxWidth: action === 'reject' ? '92vw' : 600, width: '95vw' }}>
            <div className="modal-title" style={{ color: action === 'approve' ? 'var(--success)' : 'var(--danger)' }}>
              {action === 'approve' ? '🏆 Final Approval' : '❌ CEO Rejection'}
            </div>

            {action === 'approve' && (
              <div className="alert alert-success" style={{ marginBottom: 16, fontSize: '0.85rem' }}>
                This will <strong>finally approve</strong> the drug for addition to the hospital formulary. The Doctor will be notified immediately.
              </div>
            )}
            {action === 'reject' && (
              <div className="alert alert-error" style={{ marginBottom: 16, fontSize: '0.85rem' }}>
                Rejection at this stage will notify the <strong>Doctor, Pharmacy Head, and DTC Committee</strong>. Select reasons and/or add remarks.
              </div>
            )}

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
                  <label className="form-label">
                    CEO Remarks <span style={{ color: '#94a3b8', fontWeight: 400 }}>(optional)</span>
                  </label>
                  <ApprovalRemarksPanel
                    role="CEO"
                    value={approveRemarks}
                    onChange={setApproveRemarks}
                    placeholder="Optional CEO approval remarks…"
                    rows={3}
                  />
                  {remarkErr && <span className="form-error">{remarkErr}</span>}
                </>
              )}
            </div>

            <div className="modal-footer">
              <button className="btn btn-ghost" onClick={closeModal} disabled={submitting}>Cancel</button>
              <button
                className={`btn ${action === 'approve' ? 'btn-success' : 'btn-danger'}`}
                onClick={handleAction}
                disabled={submitting}
              >
                {submitting
                  ? <><div className="spinner" /> Processing…</>
                  : action === 'approve' ? '🏆 Confirm Final Approval' : '✕ Confirm Rejection'}
              </button>
            </div>
          </div>
        </div>
      )}
      {/* ── Read-Only Comparison Sheet Overlay for CEO ── */}
      {showCompSheet && selected && (
        <ComparisonSheet
          mode="readonly"
          compType={
            (ceoAltView.length > 0 && ceoAltView[0].comparison_type) ||
            (((selected.REQUEST_TYPE || selected.request_type || '').toLowerCase() === 'new molecule') ? 'new_generic' : 'existing_generic')
          }
          alternatives={ceoAltView}
          existingGenericData={ceoEgdView}
          existingDetails={ceoExistingDetails}
          pharmRemarks={selected.PHARMACIST_REMARKS || ''}
          phRemarks={selected.PH_REVIEW_REMARKS || selected.PH_REVIEW2_REMARKS || selected.PH_REMARKS2 || ''}
          requestInfo={selected}
          effectiveDrugEntries={effectiveDrugEntries}
          dtcSelectedBrand={selected.DTC_SELECTED_BRAND || ''}
          dtcSelectedCategory={selected.DTC_SELECTED_CATEGORY || selected.FORMULARY_REQUEST_TYPE || ''}
          dtcSelectionReasons={(() => {
            if (!selected.DTC_SELECTION_REASONS) return [];
            try {
              return typeof selected.DTC_SELECTION_REASONS === 'string'
                ? JSON.parse(selected.DTC_SELECTION_REASONS)
                : selected.DTC_SELECTION_REASONS;
            } catch {
              return selected.DTC_SELECTION_REASONS.split(',').map(r => r.trim()).filter(Boolean);
            }
          })()}
          dtcRecommendationNotes={selected.DTC_RECOMMENDATION_NOTES || selected.DTC_FINAL_SELECTION_NOTES || ''}
          dtcReviewedByName={selected.DTC_REVIEWED_BY_NAME || ''}
          dtcReviewSignature={selected.DTC_REVIEW_SIGNATURE || ''}
          dtcRemarks={selected.DTC_REMARKS || selected.DTC_FINAL_REMARKS || ''}
          dtcReviewedAt={selected.DTC_REVIEWED_AT || ''}
          dtcFinalRecommendations={(() => {
            if (!selected.DTC_FINAL_RECOMMENDATIONS) return [];
            try {
              return typeof selected.DTC_FINAL_RECOMMENDATIONS === 'string'
                ? JSON.parse(selected.DTC_FINAL_RECOMMENDATIONS)
                : selected.DTC_FINAL_RECOMMENDATIONS;
            } catch {
              return [];
            }
          })()}
          onBack={() => setShowCompSheet(false)}
        />
      )}
    </div>
  );
}

// =====================================================================
// CEOTrainingCenter — Built-in User Guide & Training Video Player
// =====================================================================
const doesSectionContainSearch = (section, term) => {
  if (!term || !term.trim()) return false;
  const q = term.toLowerCase();
  if (section.title.toLowerCase().includes(q)) return true;
  return section.paragraphs.some(p => p.toLowerCase().includes(q));
};

const escapeRegExp = (string) => {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
};

const highlightText = (text, search) => {
  if (!search || !search.trim()) return text;
  const regex = new RegExp(`(${escapeRegExp(search)})`, 'gi');
  const parts = text.split(regex);
  return (
    <>
      {parts.map((part, i) =>
        regex.test(part) ? <mark key={i} className="guide-highlight">{part}</mark> : part
      )}
    </>
  );
};

function CEOTrainingCenter() {
  const [search, setSearch] = useState('');
  const [collapsedSections, setCollapsedSections] = useState({});
  const [activeSection, setActiveSection] = useState('introduction');

  const toggleSection = (id) => {
    setCollapsedSections(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const scrollToSection = (id) => {
    setActiveSection(id);
    const el = document.getElementById(`guide-section-${id}`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  const isSectionCollapsed = (id, section) => {
    if (search && search.trim() && doesSectionContainSearch(section, search)) {
      return false;
    }
    return !!collapsedSections[id];
  };

  return (
    <div className="ceo-training-container">
      {/* Sidebar Navigation */}
      <div className="ceo-training-sidebar">
        <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em', padding: '0 12px 8px 12px', borderBottom: '1px solid #cbd5e1' }}>
          📖 Table of Contents
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 8 }}>
          {ceoGuideContent.map(sec => {
            const isMatch = search && search.trim() && doesSectionContainSearch(sec, search);
            return (
              <button
                key={sec.id}
                type="button"
                className={`ceo-training-sidebar-btn ${activeSection === sec.id ? 'active' : ''}`}
                onClick={() => scrollToSection(sec.id)}
                style={isMatch ? { borderLeft: '3px solid #eab308' } : {}}
              >
                <span>{sec.icon}</span>
                <span className="sidebar-title-text">{sec.title}</span>
                {isMatch && <span style={{ marginLeft: 'auto', background: '#fef08a', color: '#854d0e', fontSize: '0.65rem', padding: '1px 5px', borderRadius: 4, fontWeight: 700 }}>Match</span>}
              </button>
            );
          })}
        </div>
      </div>

      {/* Content Area */}
      <div className="ceo-training-content-area">
        {/* Video Card */}
        <div className="ceo-video-card">
          <div className="ceo-video-title">
            <span>🎥</span> CEO Module Training Video
          </div>
          <div className="ceo-video-player-wrapper">
            <iframe
              src="https://www.youtube.com/embed/bgkJ9VB03jE"
              title="CEO Module Training Video"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              allowFullScreen
            ></iframe>
          </div>
          <div className="ceo-video-description">
            Watch this complete CEO training video to understand request approvals, dashboard analytics, workflow monitoring, final recommendation review, procurement tracking, and executive decision-making within the Formulary Drug Indenting System.
          </div>
        </div>

        {/* Search Bar */}
        <div className="ceo-guide-search-card">
          <span style={{ fontSize: '1.2rem' }}>🔍</span>
          <input
            type="text"
            className="ceo-guide-search-input"
            placeholder="Search CEO Guide..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch('')}
              className="btn btn-ghost btn-sm"
              style={{ padding: '4px 10px', fontSize: '0.8rem' }}
            >
              Clear
            </button>
          )}
        </div>

        {/* Guide Content Cards */}
        {ceoGuideContent.map(sec => {
          const collapsed = isSectionCollapsed(sec.id, sec);
          return (
            <div
              key={sec.id}
              id={`guide-section-${sec.id}`}
              className="ceo-guide-section-card"
            >
              <div
                className="ceo-guide-section-header"
                onClick={() => toggleSection(sec.id)}
              >
                <div className="ceo-guide-section-title">
                  <span>{sec.icon}</span>
                  {highlightText(sec.title, search)}
                </div>
                <span className="ceo-guide-section-toggle-icon">
                  {collapsed ? '▼' : '▲'}
                </span>
              </div>

              {!collapsed && (
                <div className="ceo-guide-section-body">
                  {sec.paragraphs.map((p, idx) => (
                    <p key={idx} className="ceo-guide-paragraph">
                      {highlightText(p, search)}
                    </p>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
