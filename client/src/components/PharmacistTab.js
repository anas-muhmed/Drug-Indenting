// =PharmacistTab.js====================================================================
// PharmacistTab.js — Pharmacist Staff: analysis, alternatives, orders
// =====================================================================
import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import axios from 'axios';
import Dashboard from './Dashboard';
import Notifications from './Notifications';
import ComparisonSheet from './ComparisonSheet';

const API = '/api';

const EMPTY_ALT = {
  brand_name: '', manufacturer: '', marketer: '',
  mrp_per_pack: '', rate_per_pack: '', gst_percent: '',
  mrp: '', rate: '', qty: '', offer: '',
  net_rate: '', negorate: '', margin: '', markupmargin: '', profit_margin: '',
  stock: '', purchase_qty: '', remark: '',
  // Excel comparison sheet fields
  consultant: '', sale_qty: '', pack: '', introduced_on: 'New Item',
};

const EMPTY_EXISTING = {
  // Identity
  existing_brand_name: '', existing_manufacturer: '', existing_marketer: '',
  existing_pack: '', existing_scheme: '', existing_introduced_on: '',
  // NEW: formula-basis inputs (v2 comparison sheet)
  existing_mrp_per_pack: '', existing_rate_per_pack: '', existing_gst_percent: '',
  // Pricing (legacy / fallback for old records)
  existing_mrp: '', existing_rate: '', existing_qty: '', existing_offer: '',
  existing_net_rate: '', existing_negotiated_rate: '',
  // Margins
  existing_absolute_margin: '', existing_markup_margin: '', existing_profit_margin: '',
  // Stock & consumption
  existing_stock: '', existing_purchase_qty: '', existing_monthly_consumption: '',
  existing_sale_qty: '',
  // Comparison data (textareas)
  transaction_history: '', sales_data: '', stock_usage: '',
  margin_comparison: '', existing_drug_details: '',
};

export default function PharmacistTab({ currentUser, onNotificationsRead }) {
  const [view, setView] = useState('pending');
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [alertMsg, setAlertMsg] = useState(null);
  const [dashKey, setDashKey] = useState(0);
  const loadRequests = useCallback(async () => {

    if (!currentUser?.USER_ID) {
      console.log("USER NOT LOADED YET", currentUser);
      return;
    }

    setLoading(true);

    try {

      console.log("USER ID:", currentUser?.USER_ID);
      console.log("API URL:", `${API}/requests/pharmacist/${currentUser?.USER_ID}`);

      const res = await axios.get(
        `${API}/requests/pharmacist/${currentUser.USER_ID}`
      );

      console.log("API SUCCESS:", res.data);

      setRequests(res.data || []);

    } catch (err) {

      console.error('Failed to load requests:', err);

      console.log('API ERROR RESPONSE:', err.response);
      console.log('CURRENT USER:', currentUser);

      setAlertMsg({
        type: 'error',
        msg: err.response?.data?.error || 'Failed to load requests.'
      });

    } finally {
      setLoading(false);
    }

  }, [currentUser]);


  useEffect(() => {
    loadRequests();
  }, [loadRequests]);
  // Analysis modal state
  const [analysisReq, setAnalysisReq] = useState(null);
  const [compType, setCompType] = useState('new_generic');
  const [alternatives, setAlternatives] = useState([{ ...EMPTY_ALT }, { ...EMPTY_ALT }, { ...EMPTY_ALT }]);
  const [existingGenericData, setExistingGenericData] = useState({ ...EMPTY_EXISTING });
  const [existingDetails, setExistingDetails] = useState([]);
  const [pharmRemarks, setPharmRemarks] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [altErr, setAltErr] = useState('');
  const [showComparisonSheet, setShowComparisonSheet] = useState(false);

  // Draft management state
  const [draftId, setDraftId] = useState(null);
  const [draftName, setDraftName] = useState('');
  const [savingDraft, setSavingDraft] = useState(false);
  const [draftSaved, setDraftSaved] = useState(false);
  const [drafts, setDrafts] = useState([]);
  const [loadingDrafts, setLoadingDrafts] = useState(false);

  // View-only modal
  const [viewReq, setViewReq] = useState(null);
  const [existingAlts, setExistingAlts] = useState([]);

  // ── Inventory Add-to-HIS state ──────────────────────────────
  const [invNewItem, setInvNewItem] = useState(false);          // checkbox
  const [invModalOpen, setInvModalOpen] = useState(false);      // modal visibility
  const [invSubmitting, setInvSubmitting] = useState(false);
  const [invSuccess, setInvSuccess] = useState(false);          // already added
  const [invAlreadyExists, setInvAlreadyExists] = useState(false); // 409 duplicate
  const [invErr, setInvErr] = useState('');
  const EMPTY_INV = { brandName: '', genericName: '', manufacturerName: '', marketerName: '', mrp: '', rate: '', strength: '', drugForm: '' };
  const [invForm, setInvForm] = useState({ ...EMPTY_INV });

  // Reset inventory state when view modal opens/closes
  const openView = async (req) => {
    setViewReq(req);
    // reset inventory flags based on stored data
    const alreadyAdded = req.INVENTORY_ADDED === 1;
    setInvSuccess(alreadyAdded);
    setInvNewItem(alreadyAdded);
    setInvAlreadyExists(false);
    setInvErr('');
    setInvModalOpen(false);
    setInvForm({ ...EMPTY_INV });
    try {
      const isOrderStage = req.STATUS === 'APPROVED_PENDING_ORDER';
      if (isOrderStage) {
        const r = await axios.get(`${API}/alternatives/${req.REQUEST_ID}/selected`);
        setExistingAlts(r.data ? [r.data] : []);
      } else {
        const r = await axios.get(`${API}/alternatives/${req.REQUEST_ID}`);
        setExistingAlts(r.data?.alternatives || []);
      }
    } catch { setExistingAlts([]); }
  };

  // Prefill inventory form from final DTC drug data
  const prefillInvForm = (drug) => {
    setInvForm({
      brandName: drug.final_brand_name || '',
      genericName: drug.final_generic_name || '',
      manufacturerName: drug.final_manufacturer || '',
      marketerName: drug.final_marketer || '',
      mrp: drug.final_mrp != null ? String(drug.final_mrp) : '',
      rate: drug.final_rate != null ? String(drug.final_rate) : (drug.final_net_rate != null ? String(drug.final_net_rate) : ''),
      strength: '',
      drugForm: '',
    });
    setInvModalOpen(true);
    setInvErr('');
    setInvAlreadyExists(false);
  };

  const submitInventory = async () => {
    if (!invForm.brandName.trim() || !invForm.genericName.trim()) {
      setInvErr('Brand Name and Generic Name are required.');
      return;
    }
    setInvSubmitting(true);
    setInvErr('');
    setInvAlreadyExists(false);

    console.log({
      brandName: invForm.brandName.trim(),
      genericName: invForm.genericName.trim(),
      manufacturerName: invForm.manufacturerName.trim() || undefined,
      marketerName: invForm.marketerName.trim() || undefined,
      mrp: invForm.mrp ? Number(invForm.mrp) : undefined,
      rate: invForm.rate ? Number(invForm.rate) : undefined,
      strength: invForm.strength.trim() || undefined,
      drugForm: invForm.drugForm ? Number(invForm.drugForm) : undefined,
    });

    try {
      await axios.post(`${API}/saveGenericItem`, {
        brandName: invForm.brandName.trim(),
        genericName: invForm.genericName.trim(),
        manufacturerName: invForm.manufacturerName.trim() || undefined,
        marketerName: invForm.marketerName.trim() || undefined,
        mrp: invForm.mrp ? Number(invForm.mrp) : undefined,
        rate: invForm.rate ? Number(invForm.rate) : undefined,
        strength: invForm.strength.trim() || undefined,
        drugForm: invForm.drugForm ? Number(invForm.drugForm) : undefined,
      });
      // Mark on request record
      await axios.put(`${API}/requests/${viewReq.REQUEST_ID}/mark-inventory-added`, {
        performed_by: currentUser.USER_ID,
        inventory_item_name: invForm.brandName.trim(),
      });
      setInvSuccess(true);
      setInvModalOpen(false);
      // Refresh list so badge updates
      await loadRequests();
    } catch (err) {
      if (err.response?.status === 409) {
        setInvAlreadyExists(true);
        setInvErr(err.response?.data?.error || 'Drug already exists in inventory.');
        // Still mark request as handled
        try {
          await axios.put(`${API}/requests/${viewReq.REQUEST_ID}/mark-inventory-added`, {
            performed_by: currentUser.USER_ID,
            inventory_item_name: invForm.brandName.trim(),
          });
          setInvSuccess(true);
          await loadRequests();
        } catch { }
      } else {
        setInvErr(err.response?.data?.error || 'Failed to save to inventory.');
      }
    } finally {
      setInvSubmitting(false);
    }
  };

  // Form state
  const EMPTY_FORM = {
    category: '', brand_name: '', generic_name: '', dose_strength: '', dosage_form: '',
    manufacturer: '', marketer: '', existing_brands: '', clinical_justification: ''
  };
  const [form, setForm] = useState(EMPTY_FORM);
  const [formErrors, setFormErrors] = useState({});
  const [submittingForm, setSubmittingForm] = useState(false);

  const handleFormChange = e => {
    const { name, value } = e.target;
    setForm(f => ({ ...f, [name]: value }));
    if (formErrors[name]) setFormErrors(er => { const c = { ...er }; delete c[name]; return c; });
  };

  const handleFormSubmit = async e => {
    e.preventDefault();
    const required = ['category', 'brand_name', 'generic_name', 'dose_strength', 'dosage_form', 'manufacturer', 'marketer', 'clinical_justification'];
    const errs = {};
    required.forEach(k => {
      if (!form[k] || String(form[k]).trim() === '') errs[k] = 'This field is required.';
    });
    if (Object.keys(errs).length > 0) {
      setFormErrors(errs);
      return;
    }
    setSubmittingForm(true);
    try {
      const payload = { ...form, doctor_id: currentUser.USER_ID };
      await axios.post(`${API}/requests/pharmacist`, payload);
      setAlertMsg({ type: 'success', msg: '✅ Direct drug request submitted successfully! Forwarded to Pharmacy Head.' });
      setForm(EMPTY_FORM);
      setView('pending');
      await loadRequests();
    } catch (err) {
      const respData = err.response?.data;
      const msg = respData?.error || 'Submission failed.';
      const remarkStr = respData?.remarks ? `\nReason: ${respData.remarks}` : '';
      setAlertMsg({ type: 'error', msg: msg + remarkStr, preWrap: true });
    } finally {
      setSubmittingForm(false);
    }
  };


  // Helper: update a single existing-generic field
  const updateExisting = (field, val) =>
    setExistingGenericData(prev => ({ ...prev, [field]: val }));
  // calculation
  const updateAlternativeCalculations = (i, field, val) => {
    setAlternatives(prev => prev.map((alt, idx) => {
      if (idx !== i) return alt;
      
      const newAlt = { ...alt, [field]: val };
      const mrp = parseFloat(newAlt.mrp) || 0;
      const rate = parseFloat(newAlt.rate) || 0;
      const qty = parseFloat(newAlt.qty) || 0;
      const offer = parseFloat(newAlt.offer) || 0;

      if (!mrp || !rate) {
        return newAlt;
      }

      const netRate = (qty + offer) > 0 ? +(rate * qty / (qty + offer)).toFixed(4) : rate;
      const absolute_margin = +(mrp - netRate).toFixed(4);
      const profit_margin = mrp > 0 ? +(((mrp - netRate) / mrp) * 100).toFixed(2) : 0;
      const markup_margin = rate > 0 ? +(((mrp - rate) / rate) * 100).toFixed(2) : 0;
      const total_margin = netRate > 0 ? +(((mrp - netRate) / netRate) * 100).toFixed(2) : 0;

      return {
        ...newAlt,
        margin: total_margin,         // margin maps to: Total Margin (Mark Up) using Net Rate
        markupmargin: markup_margin, // markupmargin maps to: Mark Up Margin using Rate
        profit_margin: profit_margin,
        absolute_margin: absolute_margin,
        net_rate: netRate,
        refer: i === 0 ? 'doctor_recommended' : 'approved_by_ph'
      };
    }));
  };

  const [result, setResult] = useState("");
  const [alert, setAlert] = useState(null);

  const [showDrugProfilePopup, setShowDrugProfilePopup] = useState(false);

  //fetch  drug 
  const fetchDrug = async (brandname) => {

    setLoading(true);
    setResult('');
    try {
      const res = await fetch(`${API}/alternative-drug`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ drug_name: brandname })
      });
      const data = await res.json();
      console.log(data, "data")
      setForm(prev => ({ ...prev, ai_content: data.data }));
      setResult(data.data || 'No data returned.');
      setShowDrugProfilePopup(true);
    } catch (err) {
      setResult('Error fetching drug profile. Please try again.');
      setShowDrugProfilePopup(true);
    } finally {
      setLoading(false);
    }
  };
  const SECTION_ICONS = {
    '1': '📘', '2': '💰', '3': '🔁',
  };
  const SECTION_COLORS = {
    '1': '#0ea5e9', '2': '#059669', '3': '#7c3aed',
  };
  const SECTION_BG = {
    '1': 'rgba(14,165,233,0.06)', '2': 'rgba(5,150,105,0.06)', '3': 'rgba(124,58,237,0.06)',
  };
  function DrugProfileRenderer({ text }) {
    const lines = text.split('\n');
    const sections = [];
    let current = null;

    for (const line of lines) {
      const isSep = /━{3,}/.test(line);
      const sectionMatch = line.match(/SECTION\s+(\d+)[:\s]/i);

      if (isSep) continue;

      if (sectionMatch) {
        const num = sectionMatch[1];
        current = { num, title: line.trim(), lines: [] };
        sections.push(current);
      } else if (current) {
        current.lines.push(line);
      } else {
        if (!sections.length || sections[0].num !== '0') {
          sections.unshift({ num: '0', title: '', lines: [] });
        }
        sections[0].lines.push(line);
      }
    }

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {sections.map((sec, si) => {
          const color = SECTION_COLORS[sec.num] || 'var(--primary)';
          const bg = SECTION_BG[sec.num] || 'var(--bg-card)';
          const icon = SECTION_ICONS[sec.num] || '';
          const isPreamble = sec.num === '0';

          return (
            <div
              key={si}
              style={{
                background: isPreamble ? 'var(--bg-card)' : bg,
                border: `1px solid ${isPreamble ? 'var(--border)' : color + '33'}`,
                borderLeft: isPreamble ? '3px solid var(--border)' : `4px solid ${color}`,
                borderRadius: 10,
                overflow: 'hidden',
              }}
            >
              {!isPreamble && sec.title && (
                <div style={{ padding: '10px 16px', borderBottom: `1px solid ${color}22`, display: 'flex', alignItems: 'center', gap: 8 }}>
                  {icon && <span style={{ fontSize: '1rem' }}>{icon}</span>}
                  <span style={{ fontWeight: 700, fontSize: '0.85rem', color, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    {sec.title.replace(/^[📘💰🔁]\s*/, '')}
                  </span>
                </div>
              )}
              <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 4 }}>
                {sec.lines.map((line, li) => {
                  const trimmed = line.trim();
                  if (!trimmed) return <div key={li} style={{ height: 6 }} />;

                  const isSubHead = /^[A-Z\d]+[.)]\s+[A-Z]/.test(trimmed) && trimmed.length < 80;
                  const isBullet = /^[•\-–\*▸►]/.test(trimmed);
                  const isKV = /^[\w\s/()]+:/.test(trimmed) && trimmed.indexOf(':') < 40;

                  if (isSubHead) {
                    return (
                      <div key={li} style={{ fontWeight: 700, fontSize: '0.88rem', color: 'var(--text)', marginTop: 10, marginBottom: 2 }}>
                        {trimmed}
                      </div>
                    );
                  }
                  if (isBullet) {
                    return (
                      <div key={li} style={{ display: 'flex', gap: 8, fontSize: '0.875rem', color: 'var(--text)', lineHeight: 1.6, paddingLeft: 4 }}>
                        <span style={{ color, flexShrink: 0 }}>•</span>
                        <span>{trimmed.replace(/^[•\-–\*▸►]\s*/, '')}</span>
                      </div>
                    );
                  }
                  if (isKV) {
                    const colonIdx = trimmed.indexOf(':');
                    const key = trimmed.slice(0, colonIdx).trim();
                    const val = trimmed.slice(colonIdx + 1).trim();
                    return (
                      <div key={li} style={{ display: 'flex', gap: 6, fontSize: '0.875rem', lineHeight: 1.6 }}>
                        <span style={{ fontWeight: 600, color: 'var(--text)', minWidth: 160, flexShrink: 0 }}>{key}:</span>
                        <span style={{ color: 'var(--text-muted)' }}>{val}</span>
                      </div>
                    );
                  }
                  return (
                    <div key={li} style={{ fontSize: '0.875rem', color: 'var(--text-muted)', lineHeight: 1.7 }}>
                      {trimmed}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    );
  }
  const openAnalysis = async (req) => {
    setAnalysisReq(req);
    if (req.CURRENT_STAGE === 'PharmacistCorrection') {
      setIsCorrectionMode(true);
    } else {
      setIsCorrectionMode(false);
    }
    const ct = req.REQUEST_TYPE === 'New Molecule' ? 'new_generic' : 'existing_generic';
    setCompType(ct);
    // Default consultant = doctor name from request
    const defConsultant = req.DOCTOR_NAME || req.REQUESTED_BY_NAME || '';
    setAlternatives([
      { ...EMPTY_ALT, consultant: defConsultant },
      { ...EMPTY_ALT, consultant: defConsultant },
      { ...EMPTY_ALT, consultant: defConsultant },
    ]);
    setExistingGenericData({ ...EMPTY_EXISTING });
    setExistingDetails([]);
    setPharmRemarks('');
    setAltErr('');
    setDraftId(null);
    setDraftName('');
    setDraftSaved(false);
    setShowComparisonSheet(false);
    // Auto-load existing draft if present
    try {
      const r = await axios.get(`${API}/pharmacist/drafts/for-request/${req.REQUEST_ID}/${currentUser.USER_ID}`);
      if (r.data) {
        const { DRAFT_ID, DRAFT_NAME, DRAFT_DATA } = r.data;
        const d = DRAFT_DATA || {};
        if (d.alternatives && d.alternatives.length > 0) setAlternatives(d.alternatives);
        if (d.existing_generic_data) setExistingGenericData(d.existing_generic_data);
        if (d.existing_details) setExistingDetails(d.existing_details);
        if (d.comp_type) setCompType(d.comp_type);
        if (d.pharm_remarks) setPharmRemarks(d.pharm_remarks);
        setDraftId(DRAFT_ID);
        setDraftName(DRAFT_NAME || '');
        setDraftSaved(true);
      }
    } catch { /* no draft found, start fresh */ }
  };

  const closeAnalysis = () => {
    setAnalysisReq(null);
    setExistingGenericData({ ...EMPTY_EXISTING });
    setExistingDetails([]);
    setShowComparisonSheet(false);
    setDraftId(null); setDraftName(''); setDraftSaved(false);
    setIsCorrectionMode(false);
  };

  const saveDraft = async () => {
    if (!analysisReq) return;
    setSavingDraft(true);
    setDraftSaved(false);
    try {
      const r = await axios.post(`${API}/pharmacist/drafts`, {
        request_id: analysisReq.REQUEST_ID,
        pharmacist_id: currentUser.USER_ID,
        draft_name: draftName.trim() || undefined,
        alternatives,
        existing_generic_data: existingGenericData,
        existing_details: existingDetails,
        comp_type: compType,
        pharm_remarks: pharmRemarks,
      });
      setDraftId(r.data.draft_id);
      if (!draftName.trim()) setDraftName(r.data.draft_name);
      setDraftSaved(true);
      setTimeout(() => setDraftSaved(false), 3000);
    } catch (err) {
      setAltErr(err.response?.data?.error || 'Failed to save draft.');
    } finally {
      setSavingDraft(false);
    }
  };

  const loadDrafts = useCallback(async () => {
    setLoadingDrafts(true);
    try {
      const r = await axios.get(`${API}/pharmacist/drafts/${currentUser.USER_ID}`);
      setDrafts(r.data || []);
    } catch { setDrafts([]); } finally { setLoadingDrafts(false); }
  }, [currentUser]);

  const openDraftAnalysis = async (draft) => {
    try {
      const r = await axios.get(`${API}/pharmacist/drafts/detail/${draft.DRAFT_ID || draft.draft_id}`);
      const d = r.data;
      const parsed = d.DRAFT_DATA || {};
      const req = {
        REQUEST_ID: d.REQUEST_ID || draft.REQUEST_ID,
        BRAND_NAME: d.BRAND_NAME || draft.BRAND_NAME,
        GENERIC_NAME: d.GENERIC_NAME || draft.GENERIC_NAME,
        REQUEST_TYPE: d.REQUEST_TYPE || '',
      };
      setAnalysisReq(req);
      setCompType(parsed.comp_type || 'new_generic');
      setAlternatives(parsed.alternatives?.length ? parsed.alternatives : [{ ...EMPTY_ALT }, { ...EMPTY_ALT }, { ...EMPTY_ALT }]);
      setExistingGenericData(parsed.existing_generic_data || { ...EMPTY_EXISTING });
      setExistingDetails(parsed.existing_details || []);
      setPharmRemarks(parsed.pharm_remarks || '');
      setDraftId(d.DRAFT_ID);
      setDraftName(d.DRAFT_NAME || '');
      setAltErr('');
      setDraftSaved(true);
      setView('pending');
    } catch (err) {
      setAlertMsg({ type: 'error', msg: 'Could not load draft. Please try again.' });
    }
  };

  const deleteDraft = async (draftIdToDelete) => {
    if (!window.confirm('Delete this draft? This cannot be undone.')) return;
    try {
      await axios.delete(`${API}/pharmacist/drafts/${draftIdToDelete}`);
      setDrafts(prev => prev.filter(d => (d.DRAFT_ID || d.draft_id) !== draftIdToDelete));
    } catch {
      setAlertMsg({ type: 'error', msg: 'Failed to delete draft.' });
    }
  };

  const addAlt = () => setAlternatives(a => [...a, { ...EMPTY_ALT }]);
  const removeAlt = (i) => setAlternatives(a => a.filter((_, idx) => idx !== i));
  const updateAlt = (i, field, val) =>
    setAlternatives(a => a.map((alt, idx) => idx === i ? { ...alt, [field]: val } : alt));

  const submitAlternatives = async (currentExistingDetails = existingDetails) => {
    const filled = alternatives.filter(a => a.brand_name.trim() && a.manufacturer.trim());
    if (filled.length < 1) {
      setAltErr(isCorrectionMode
        ? 'Please fill in at least 1 alternative before resubmitting.'
        : 'Please fill in at least 3 alternatives (Brand Name + Manufacturer required).');
      return;
    }
    setSubmitting(true);
    try {
      if (compType === 'existing_generic') {
        await axios.put(`${API}/pharmacist/comparison/${analysisReq.REQUEST_ID}`, {
          existing_details: currentExistingDetails,
        });
      }
      const endpoint = isCorrectionMode
        ? `${API}/pharmacist/correction-submit/${analysisReq.REQUEST_ID}`
        : `${API}/alternatives/${analysisReq.REQUEST_ID}`;

      await axios.post(endpoint, {
        performed_by: currentUser.USER_ID,
        alternatives: filled,
        comparison_type: compType,
        remarks: pharmRemarks,
        existing_generic_data: compType === 'existing_generic' ? existingGenericData : null,
      });

      const successMsg = isCorrectionMode
        ? `✅ Corrected comparison sheet for Request #${analysisReq.REQUEST_ID} resubmitted to Pharmacy Head.`
        : `✅ Alternatives submitted for request #${analysisReq.REQUEST_ID}. Forwarded to Pharmacy Head.`;

      setAlertMsg({ type: 'success', msg: successMsg });
      setIsCorrectionMode(false);
      closeAnalysis();
      await loadRequests();
      setDashKey(k => k + 1);
    } catch (err) {
      setAltErr(err.response?.data?.error || 'Submission failed. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const normalPending = requests.filter(r => r.CURRENT_STAGE === 'Pharmacist');
  const emergencyView = requests.filter(r => r.IS_EMERGENCY === 1);
  const initialReview = requests.filter(r => r.CURRENT_STAGE === 'PharmacistInitialReview');
  const correctionRequests = requests.filter(r => r.CURRENT_STAGE === 'PharmacistCorrection');

  // ── Correction mode state ──
  const [isCorrectionMode, setIsCorrectionMode] = useState(false);
  const [correctionSubmitting, setCorrectionSubmitting] = useState(false);
  const [correctionErr, setCorrectionErr] = useState('');

  // ── Initial Review state ──
  const [irSelected, setIrSelected] = useState(null);
  const [irAction, setIrAction] = useState(''); // 'approve' | 'reject'
  const [irEffectiveDate, setIrEffectiveDate] = useState('');
  const [irRemarks, setIrRemarks] = useState('');
  const [irSubmitting, setIrSubmitting] = useState(false);
  const [irErr, setIrErr] = useState('');
  const EMPTY_EFFECTIVE_ENTRY = {
    drug_name: '',
    effective_created_at: '',
    remarks: '',
  };
  const [effectiveDrugEntries, setEffectiveDrugEntries] = useState([]);
  // Generic popup state for Initial Review (Explorer & Item Margin Report lookup)
  const [irShowGenericPopup, setIrShowGenericPopup] = useState(false);
  const [irGenericLoading, setIrGenericLoading] = useState(false);
  const [irSearchQuery, setIrSearchQuery] = useState('');
  const [irGenericSuggestions, setIrGenericSuggestions] = useState([]);
  const [irSelectedGeneric, setIrSelectedGeneric] = useState(null);
  const [irFromDate, setIrFromDate] = useState(() => {
    const d = new Date();
    d.setFullYear(d.getFullYear() - 1); // default 1 year ago
    return d.toISOString().split('T')[0];
  });
  const [irToDate, setIrToDate] = useState(() => {
    return new Date().toISOString().split('T')[0];
  });
  const [irReportRows, setIrReportRows] = useState([]);
  const [irLoadingReport, setIrLoadingReport] = useState(false);
  const [irReportError, setIrReportError] = useState('');
  const [irShowSuggestions, setIrShowSuggestions] = useState(false);
  const [irDosageFilter, setIrDosageFilter] = useState('');
  const [irDosageFormFilter, setIrDosageFormFilter] = useState('');

  const irLookupRef = useRef(null);

  // Close autocomplete suggestions on click outside
  useEffect(() => {
    function handleClickOutside(e) {
      if (irLookupRef.current && !irLookupRef.current.contains(e.target)) {
        setIrShowSuggestions(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Debounced search for initial review generic autocomplete suggestions
  useEffect(() => {
    if (!irSearchQuery.trim()) {
      setIrGenericSuggestions([]);
      return;
    }
    if (irSelectedGeneric && irSelectedGeneric.drug_gen_name === irSearchQuery) {
      return;
    }

    const handler = setTimeout(async () => {
      try {
        const res = await axios.get(`${API}/generics/search?q=${encodeURIComponent(irSearchQuery)}`);
        setIrGenericSuggestions(res.data || []);
        setIrShowSuggestions(true);
      } catch (err) {
        console.error('Error searching generics for IR:', err);
      }
    }, 300);

    return () => clearTimeout(handler);
  }, [irSearchQuery, irSelectedGeneric]);

  const irAvailableDosages = useMemo(() => {
    const set = new Set();
    irReportRows.forEach(row => {
      const dose = extractDosage(row.brand_name || row.BRAND_NAME);
      if (dose) set.add(dose);
    });
    return [...set].sort();
  }, [irReportRows]);

  const irAvailableDosageForms = useMemo(() => {
    const set = new Set();
    irReportRows.forEach(row => {
      const form = extractDosageForm(row.dosage_form || row.DOSAGE_FORM || row.brand_name || row.BRAND_NAME);
      if (form) set.add(form);
    });
    return [...set].sort();
  }, [irReportRows]);

  const irFilteredReportRows = useMemo(() => {
    return irReportRows.filter(row => {
      const rowDosage = extractDosage(row.brand_name || row.BRAND_NAME);
      const rowForm = extractDosageForm(row.dosage_form || row.DOSAGE_FORM || row.brand_name || row.BRAND_NAME);
      const dosageMatch = !irDosageFilter || rowDosage === irDosageFilter;
      const formMatch = !irDosageFormFilter || rowForm === irDosageFormFilter;
      return dosageMatch && formMatch;
    });
  }, [irReportRows, irDosageFilter, irDosageFormFilter]);

  const formatIntroducedDate = (val) => {
    if (!val) return '';
    try {
      const d = new Date(val);
      if (isNaN(d.getTime())) return String(val);
      const day = String(d.getDate()).padStart(2, '0');
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const year = d.getFullYear();
      return `${day}/${month}/${year}`;
    } catch (e) {
      return String(val);
    }
  };

  const extractDosage = (name = '') => {
    const match = name.match(/(\d+(?:\.\d+)?\s*(?:mg|ml|mcg|g|iu|meg|%|units?))/i);
    return match ? match[1].trim().toLowerCase().replace(/\s+/, '') : null;
  };

  const extractDosageForm = (value = '') => {
    if (!value) return null;
    const v = value.trim();
    const NORMALISE = [
      [/^inj(ection)?s?\.?$/i, 'Inj.'], [/^tab(let)?s?\.?$/i, 'Tab'],
      [/^cap(sule)?s?\.?$/i, 'Cap'], [/^syrup\.?$/i, 'Syrup'],
      [/^susp(ension)?n?\.?$/i, 'Suspn'], [/^oral\s*drops?\.?$/i, 'OralDrops'],
      [/^drops?\.?$/i, 'Drops'], [/^cream\.?$/i, 'Cream'],
      [/^ointment\.?$/i, 'Ointment'], [/^gel\.?$/i, 'Gel'],
      [/^lotion\.?$/i, 'Lotion'], [/^powder\.?$/i, 'Powder'],
      [/^granules?\.?$/i, 'Granules'], [/^sachet\.?$/i, 'Sachet'],
      [/^patch\.?$/i, 'Patch'], [/^inhaler?\.?$/i, 'Inhaler'],
      [/^spray\.?$/i, 'Spray'], [/^suppository\.?$/i, 'Suppository'],
      [/^solution\.?$/i, 'Solution'], [/^emulsion\.?$/i, 'Emulsion'],
    ];
    for (const [rx, label] of NORMALISE) { if (rx.test(v)) return label; }
    const SCAN = [
      [/\binjection\b/i, 'Inj.'], [/\binj\.?\b/i, 'Inj.'],
      [/\btablets?\b/i, 'Tab'], [/\btabs?\.?\b/i, 'Tab'],
      [/\bcapsules?\b/i, 'Cap'], [/\bcaps?\.?\b/i, 'Cap'],
      [/\bsyrup\b/i, 'Syrup'], [/\bsuspension\b/i, 'Suspn'],
      [/\bsuspn\b/i, 'Suspn'], [/\boral\s*drops?\b/i, 'OralDrops'],
      [/\bdrops?\b/i, 'Drops'], [/\bcream\b/i, 'Cream'],
      [/\bointment\b/i, 'Ointment'], [/\bgel\b/i, 'Gel'],
      [/\blotion\b/i, 'Lotion'], [/\bpowder\b/i, 'Powder'],
      [/\bsachet\b/i, 'Sachet'], [/\bpatch\b/i, 'Patch'],
      [/\binhaler?\b/i, 'Inhaler'], [/\bspray\b/i, 'Spray'],
      [/\bsolution\b/i, 'Solution'],
    ];
    for (const [rx, label] of SCAN) { if (rx.test(v)) return label; }
    return v.charAt(0).toUpperCase() + v.slice(1);
  };

  const getIrGenericDetails = async (genericName) => {
    setIrGenericLoading(true);
    setIrSearchQuery(genericName);
    setIrGenericSuggestions([]);
    setIrSelectedGeneric(null);
    setIrReportRows([]);
    setIrReportError('');
    setIrDosageFilter('');
    setIrDosageFormFilter('');
    setIrShowGenericPopup(true);
    
    try {
      const searchRes = await axios.get(`${API}/generics/search?q=${encodeURIComponent(genericName)}`);
      const suggestions = searchRes.data || [];
      setIrGenericSuggestions(suggestions);
      
      const match = suggestions.find(s => s.drug_gen_name.toLowerCase() === genericName.toLowerCase()) || suggestions[0];
      if (match) {
        setIrSelectedGeneric(match);
        setIrSearchQuery(match.drug_gen_name);
        
        const formattedFrom = irFromDate.split('-').reverse().join('/') + ' 00:00:00';
        const formattedTo = irToDate.split('-').reverse().join('/') + ' 23:59:59';
        setIrLoadingReport(true);
        const reportRes = await axios.post(`${API}/reports/item-margin-report`, {
          fromDate: formattedFrom,
          toDate: formattedTo,
          genericId: match.drug_gen_id
        });
        setIrReportRows(reportRes.data || []);
      }
    } catch (err) {
      console.error('Error auto-loading item margin report in IR:', err);
      setIrReportError('Failed to automatically fetch existing drugs report.');
    } finally {
      setIrGenericLoading(false);
      setIrLoadingReport(false);
    }
  };

  const handleIrSearchReport = async () => {
    if (!irSelectedGeneric) {
      alert('Please select a generic drug from the autocomplete dropdown list.');
      return;
    }
    setIrLoadingReport(true);
    setIrReportError('');
    setIrReportRows([]);
    try {
      const formattedFrom = irFromDate.split('-').reverse().join('/') + ' 00:00:00';
      const formattedTo = irToDate.split('-').reverse().join('/') + ' 23:59:59';
      const res = await axios.post(`${API}/reports/item-margin-report`, {
        fromDate: formattedFrom,
        toDate: formattedTo,
        genericId: irSelectedGeneric.drug_gen_id
      });
      setIrReportRows(res.data || []);
    } catch (err) {
      console.error('Error fetching item margin report for IR:', err);
      setIrReportError(err.response?.data?.error || err.response?.data?.detail || 'Failed to fetch report.');
    } finally {
      setIrLoadingReport(false);
    }
  };

  const openIrPanel = (req, act) => {
    setIrSelected(req);
    setIrAction(act);
    setIrErr('');
    // Default effective date from existing EFFECTIVE_CREATED_AT or CREATED_AT
    const baseDate = req.EFFECTIVE_CREATED_AT || req.CREATED_AT;
    let local = '';
    if (baseDate) {
      const d = new Date(baseDate);
      const pad = n => String(n).padStart(2, '0');
      local = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
      setIrEffectiveDate(local);
    } else {
      setIrEffectiveDate('');
    }
    setIrRemarks('');

    if (req.effective_drug_entries && req.effective_drug_entries.length > 0) {
      const mapped = req.effective_drug_entries.map(e => {
        let entryLocal = '';
        if (e.effective_created_at) {
          const d = new Date(e.effective_created_at);
          const pad = n => String(n).padStart(2, '0');
          entryLocal = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
        }
        return {
          drug_name: e.drug_name || '',
          effective_created_at: entryLocal,
          remarks: e.remarks || ''
        };
      });
      setEffectiveDrugEntries(mapped);
    } else {
      setEffectiveDrugEntries([
        {
          drug_name: '',
          effective_created_at: local,
          remarks: ''
        }
      ]);
    }
  };

  const closeIrPanel = () => {
    setIrSelected(null);
    setIrAction('');
    setIrEffectiveDate('');
    setIrRemarks('');
    setIrErr('');
    setEffectiveDrugEntries([]);
  };

  const submitIrApprove = async () => {
    if (!irSelected) return;
    setIrSubmitting(true);
    setIrErr('');
    try {
      await axios.put(`${API}/requests/${irSelected.REQUEST_ID}/initial-review-approve`, {
        performed_by: currentUser.USER_ID,
        effective_created_at: irEffectiveDate || null,
        remarks: irRemarks || null,
        effective_drug_entries: effectiveDrugEntries,
      });
      setAlertMsg({ type: 'success', msg: `✅ Request #${irSelected.REQUEST_ID} approved and forwarded to Pharmacy Head.` });
      closeIrPanel();
      await loadRequests();
      setDashKey(k => k + 1);
    } catch (err) {
      setIrErr(err.response?.data?.error || 'Approval failed.');
    } finally {
      setIrSubmitting(false);
    }
  };

  const submitIrReject = async () => {
    if (!irSelected) return;
    if (!irRemarks.trim()) { setIrErr('Rejection reason is required.'); return; }
    setIrSubmitting(true);
    setIrErr('');
    try {
      await axios.put(`${API}/requests/${irSelected.REQUEST_ID}/reject`, {
        performed_by: currentUser.USER_ID,
        remarks: irRemarks,
      });
      setAlertMsg({ type: 'error', msg: `❌ Request #${irSelected.REQUEST_ID} rejected and doctor has been notified.` });
      closeIrPanel();
      await loadRequests();
      setDashKey(k => k + 1);
    } catch (err) {
      setIrErr(err.response?.data?.error || 'Rejection failed.');
    } finally {
      setIrSubmitting(false);
    }
  };

  const placeOrder = async (reqId) => {
    if (!window.confirm(`Are you sure you want to place the order for Emergency Request #${reqId}?`)) return;
    try {
      await axios.post(`${API}/requests/${reqId}/place_order`, { performed_by: currentUser.USER_ID });
      setAlertMsg({ type: 'success', msg: `✅ Order placed successfully for Request #${reqId}.` });
      await loadRequests();
      setDashKey(k => k + 1);
    } catch (err) {
      setAlertMsg({ type: 'error', msg: err.response?.data?.error || 'Failed to place order.' });
    }
  };

  const handleTabChange = (key) => {
    setView(key);
    if (key === 'drafts') loadDrafts();
  };

  // Opens the analysis sheet preloaded with existing alternatives (Correction mode)
  const openCorrectionAnalysis = async (req) => {
    setIsCorrectionMode(true);
    setCorrectionErr('');
    setAnalysisReq(req);
    const ct = req.REQUEST_TYPE === 'New Molecule' ? 'new_generic' : 'existing_generic';
    setCompType(ct);
    setPharmRemarks(req.PHARMACIST_REMARKS || '');
    setAltErr('');
    setDraftId(null); setDraftName(''); setDraftSaved(false);
    try {
      const [altsRes, egdRes] = await Promise.all([
        axios.get(`${API}/alternatives/${req.REQUEST_ID}`),
        axios.get(`${API}/requests/${req.REQUEST_ID}/existing-generic-data`),
      ]);
      const altsRaw = altsRes.data?.alternatives || [];
      const existingDetailsRaw = altsRes.data?.existing_details || [];
      if (altsRaw.length > 0) {
        const mapped = altsRaw.map(a => ({
          brand_name: a.BRAND_NAME || '', manufacturer: a.MANUFACTURER || '',
          marketer: a.MARKETER || '',
          mrp_per_pack: a.MRP_PER_PACK ?? '', rate_per_pack: a.RATE_PER_PACK ?? '',
          gst_percent: a.GST_PERCENT ?? '',
          mrp: a.MRP ?? '', rate: a.RATE ?? '',
          qty: a.QTY ?? '', offer: a.OFFER ?? '', net_rate: a.NET_RATE ?? '',
          margin: a.ABSOLUTE_MARGIN ?? '', markupmargin: a.MARKUP_MARGIN ?? '',
          profit_margin: a.PROFIT_MARGIN ?? '', stock: a.STOCK || '',
          purchase_qty: a.PURCHASE_QUANTITY ?? '', remark: a.REMARK || '',
          consultant: a.CONSULTANT || '', sale_qty: a.SALE_QTY ?? '',
          pack: a.PACK || '', introduced_on: a.INTRODUCED_ON || 'New Item',
          negorate: a.NEGOTIATED_RATE ?? '', comparison_type: a.COMPARISON_TYPE || ct,
        }));
        setAlternatives(mapped);
      } else {
        const defConsultant = req.DOCTOR_NAME || '';
        setAlternatives([{ ...EMPTY_ALT, consultant: defConsultant }, { ...EMPTY_ALT, consultant: defConsultant }, { ...EMPTY_ALT, consultant: defConsultant }]);
      }
      setExistingDetails(existingDetailsRaw);
      const egd = egdRes.data?.existing_generic_data || null;
      setExistingGenericData(egd ? { ...EMPTY_EXISTING, ...egd } : { ...EMPTY_EXISTING });
    } catch {
      const defConsultant = req.DOCTOR_NAME || '';
      setAlternatives([{ ...EMPTY_ALT, consultant: defConsultant }, { ...EMPTY_ALT, consultant: defConsultant }, { ...EMPTY_ALT, consultant: defConsultant }]);
      setExistingGenericData({ ...EMPTY_EXISTING });
      setExistingDetails([]);
    }
    setShowComparisonSheet(true);
    setView('pending'); // reuses the analysis sheet UI
  };

  return (

    <div>
      {/* ---- Inner Tab Nav ---- */}
      <div className="inner-tabs">
        {[
          { key: 'initialReview', label: `🩺 Initial Review (${initialReview.length})` },
          { key: 'corrections', label: `🔁 Corrections (${correctionRequests.length})` },
          { key: 'pending', label: `💊 Analysis Queue (${normalPending.length})` },
          { key: 'emergency', label: `🚨 Emergency (${emergencyView.length})` },
          { key: 'orders', label: `📦 Pending Orders (${requests.filter(r => r.STATUS === 'APPROVED_PENDING_ORDER' || r.STATUS === 'EMERGENCY_APPROVED').length})` },
          { key: 'drafts', label: `📁 My Drafts (${drafts.length})` },
          { key: 'form', label: '📝 Create Drug Request' },
          { key: 'dashboard', label: '📊 Dashboard' },
          { key: 'notifications', label: '🔔 Notifications' },
        ].map(({ key, label }) => (
          <button key={key} className={`inner-tab-btn ${view === key ? 'active' : ''}`}
            onClick={() => handleTabChange(key)}>{label}</button>
        ))}
      </div>

      {alertMsg && (
        <div className={`alert alert-${alertMsg.type}`} style={{ marginBottom: 18 }}>
          {alertMsg.msg}
          <button style={{ float: 'right', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 700 }}
            onClick={() => setAlertMsg(null)}>✕</button>
        </div>
      )}

      {/* ======== INITIAL REVIEW (New Stage) ======== */}
      {view === 'initialReview' && (
        <div className="card">
          <div className="card-title" style={{ justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div className="icon">🩺</div>
              Pharmacist Initial Review
              <span className="badge badge-info">HOD Approved — Awaiting Pharmacist Screening</span>
            </div>
            <button className="btn btn-ghost btn-sm" onClick={loadRequests}>↺ Refresh</button>
          </div>
          <div className="alert alert-info" style={{ marginBottom: 18, fontSize: '0.82rem' }}>
            💡 These requests have been approved by HOD. Review formulary availability, check existing drugs, and optionally adjust the <strong>Effective Created Date</strong> before forwarding to Pharmacy Head.
          </div>

          {loading ? (
            <div style={{ textAlign: 'center', padding: 60 }}><div className="spinner" /></div>
          ) : initialReview.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 60, color: 'var(--text-subtle)' }}>
              <div style={{ fontSize: '3rem', marginBottom: 12 }}>✅</div>
              No requests pending initial review.
            </div>
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>#ID</th><th>Brand Name</th><th>Generic</th>
                    <th>Category</th><th>Type</th><th>Doctor</th><th>HOD Approved</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {initialReview.map(r => (
                    <tr key={r.REQUEST_ID} style={irSelected?.REQUEST_ID === r.REQUEST_ID ? { background: 'rgba(37,99,235,0.05)', borderLeft: '3px solid var(--primary)' } : {}}>
                      <td style={{ fontWeight: 700, color: 'var(--primary-light)' }}>#{r.REQUEST_ID}</td>
                      <td style={{ fontWeight: 600 }}>
                        {r.BRAND_NAME}
                      </td>
                      <td style={{ color: 'var(--text-muted)' }}>
                        {r.GENERIC_NAME}
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          style={{ marginTop: 4, borderColor: 'var(--primary)', color: 'var(--primary)' }}
                          onClick={() => getIrGenericDetails(r.GENERIC_NAME)}
                          disabled={irGenericLoading}
                        >
                          {irGenericLoading ? <><div className="spinner" style={{ width: 12, height: 12, borderWidth: 2 }} /> Fetching…</> : '🔍 Search Existing Drugs'}
                        </button>
                      </td>
                      <td>{r.CATEGORY}</td>
                      <td><span className="badge badge-info">{r.REQUEST_TYPE}</span></td>
                      <td>
                        <div>{r.DOCTOR_NAME}</div>
                        <small className="text-muted" style={{ display: 'block', fontSize: '0.75rem' }}>
                          {r.CREATED_BY_ROLE || 'Doctor'} • {r.DOCTOR_DEPT || ''}
                        </small>
                      </td>
                      <td style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                        {r.HOD_ACTION_TIMESTAMP
                          ? new Date(r.HOD_ACTION_TIMESTAMP).toLocaleDateString('en-IN')
                          : new Date(r.CREATED_AT).toLocaleDateString('en-IN')}
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button className="btn btn-success btn-sm" onClick={() => openIrPanel(r, 'approve')}>✓ Approve</button>
                          <button className="btn btn-danger btn-sm" onClick={() => openIrPanel(r, 'reject')}>✕ Reject</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* ── Inline Approve / Reject Panel ── */}
          {irSelected && (
            <div style={{
              marginTop: 24, border: '1.5px solid',
              borderColor: irAction === 'approve' ? '#16a34a' : '#dc2626',
              borderRadius: 12, padding: '20px 24px',
              background: irAction === 'approve' ? 'rgba(22,163,74,0.04)' : 'rgba(220,38,38,0.04)',
            }}>
              <div style={{ fontWeight: 700, fontSize: '1rem', marginBottom: 14, color: irAction === 'approve' ? '#15803d' : '#b91c1c' }}>
                {irAction === 'approve' ? '✓ Approve & Forward to Pharmacy Head' : '✕ Reject Request'} — #{irSelected.REQUEST_ID} ({irSelected.BRAND_NAME})
              </div>

              {irAction === 'approve' && (
                <>


                  <div style={{ marginTop: 20, marginBottom: 20 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                      <span style={{ fontWeight: 700, fontSize: '0.85rem', color: 'var(--text)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                        📅 Effective Created Date
                      </span>
                      <button
                        type="button"
                        onClick={() => setEffectiveDrugEntries(prev => [...prev, { ...EMPTY_EFFECTIVE_ENTRY, effective_created_at: irEffectiveDate }])}
                        style={{
                          background: 'none', border: '1px dashed #10b981', color: '#10b981',
                          padding: '4px 12px', borderRadius: 6, cursor: 'pointer', fontSize: '0.75rem',
                          fontWeight: 600
                        }}
                      >
                        + Add Drug Entry
                      </button>
                    </div>

                    {effectiveDrugEntries.length === 0 ? (
                      <div style={{
                        padding: '12px 16px', background: 'rgba(255,255,255,0.05)', border: '1px dashed var(--border)',
                        borderRadius: 8, color: 'var(--text-muted)', fontSize: '0.8rem', fontStyle: 'italic', textAlign: 'center'
                      }}>
                        No structured drug effective entries added. Adjust default effective date above if needed.
                      </div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                        {effectiveDrugEntries.map((entry, idx) => (
                          <div key={idx} style={{
                            background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8,
                            padding: '12px 16px', position: 'relative'
                          }}>
                            <button
                              type="button"
                              onClick={() => setEffectiveDrugEntries(prev => prev.filter((_, i) => i !== idx))}
                              style={{
                                position: 'absolute', right: 10, top: 10, background: 'none', border: 'none',
                                color: '#ef4444', cursor: 'pointer', fontSize: '1.2rem', fontWeight: 'bold',
                                lineHeight: 1
                              }}
                              title="Remove drug entry"
                            >
                              ×
                            </button>

                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 8 }}>
                              <div className="form-group" style={{ margin: 0 }}>
                                <label className="form-label" style={{ fontSize: '0.72rem', fontWeight: 600, marginBottom: 4 }}>
                                  Drug Name *
                                </label>
                                <input
                                  type="text"
                                  className="form-input"
                                  style={{ height: 32, fontSize: '0.78rem' }}
                                  value={entry.drug_name}
                                  onChange={e => {
                                    const val = e.target.value;
                                    setEffectiveDrugEntries(prev => prev.map((item, i) => i === idx ? { ...item, drug_name: val } : item));
                                  }}
                                  placeholder="Enter drug brand/generic name..."
                                  required
                                />
                              </div>

                              <div className="form-group" style={{ margin: 0 }}>
                                <label className="form-label" style={{ fontSize: '0.72rem', fontWeight: 600, marginBottom: 4 }}>
                                  Effective Date & Time
                                </label>
                                <input
                                  type="datetime-local"
                                  className="form-input"
                                  style={{ height: 32, fontSize: '0.78rem' }}
                                  value={entry.effective_created_at}
                                  onChange={e => {
                                    const val = e.target.value;
                                    setEffectiveDrugEntries(prev => prev.map((item, i) => i === idx ? { ...item, effective_created_at: val } : item));
                                  }}
                                />
                              </div>
                            </div>

                            <div className="form-group" style={{ margin: 0 }}>
                              <label className="form-label" style={{ fontSize: '0.72rem', fontWeight: 600, marginBottom: 4 }}>
                                Remarks (Optional)
                              </label>
                              <textarea
                                className="form-textarea"
                                rows={1}
                                style={{ fontSize: '0.78rem', minHeight: 32, padding: '4px 8px' }}
                                value={entry.remarks}
                                onChange={e => {
                                  const val = e.target.value;
                                  setEffectiveDrugEntries(prev => prev.map((item, i) => i === idx ? { ...item, remarks: val } : item));
                                }}
                                placeholder="Optional comments for this drug entry..."
                              />
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </>
              )}

              <div className="form-group" style={{ marginBottom: 14 }}>
                <label className="form-label" style={{ fontWeight: 600 }}>
                  {irAction === 'approve' ? 'Remarks (Optional)' : 'Rejection Reason *'}
                </label>
                <textarea
                  className="form-textarea"
                  rows={3}
                  placeholder={irAction === 'approve' ? 'Optional remarks for Pharmacy Head...' : 'State the reason for rejection (mandatory)...'}
                  value={irRemarks}
                  onChange={e => setIrRemarks(e.target.value)}
                />
              </div>

              {irErr && <div className="alert alert-error" style={{ marginBottom: 12 }}>{irErr}</div>}

              <div style={{ display: 'flex', gap: 10 }}>
                {irAction === 'approve' ? (
                  <button className="btn btn-success" onClick={submitIrApprove} disabled={irSubmitting}>
                    {irSubmitting ? '⏳ Forwarding…' : '✓ Confirm Approve & Forward'}
                  </button>
                ) : (
                  <button className="btn btn-danger" onClick={submitIrReject} disabled={irSubmitting}>
                    {irSubmitting ? '⏳ Rejecting…' : '✕ Confirm Reject'}
                  </button>
                )}
                <button className="btn btn-ghost" onClick={closeIrPanel} disabled={irSubmitting}>Cancel</button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ======== IR: CHECK EXISTING DRUGS POPUP ======== */}
      {irShowGenericPopup && (
        <div className="modal-overlay" onClick={() => { setIrShowGenericPopup(false); setIrDosageFilter(''); setIrDosageFormFilter(''); }}>
          <div className="modal" style={{ maxWidth: '92vw', width: '92vw', maxHeight: '88vh', display: 'flex', flexDirection: 'column', padding: 0, overflow: 'hidden' }}
            onClick={e => e.stopPropagation()}>
            <div style={{ padding: '16px 24px', borderBottom: '1px solid var(--border)', fontWeight: 700, fontSize: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>🔍 Search Existing Drugs in Formulary</span>
              <button className="btn btn-ghost btn-sm" onClick={() => { setIrShowGenericPopup(false); setIrDosageFilter(''); setIrDosageFormFilter(''); }}>✕ Close</button>
            </div>
            
            <div style={{ padding: '20px 24px', overflowY: 'auto', flex: 1, background: '#f8fafc' }}>
              {/* Explorer Panel */}
              <div style={{
                background: '#ffffff',
                border: '1.5px solid #cbd5e1',
                borderRadius: '12px',
                padding: '20px',
                marginBottom: '20px',
                boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.05)'
              }}>
                {/* Inputs Grid */}
                <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: '16px', alignItems: 'end', marginBottom: '16px' }}>
                  {/* Autocomplete Input */}
                  <div style={{ position: 'relative' }} ref={irLookupRef}>
                    <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: '#475569', marginBottom: '6px' }}>Search Generic Drug *</label>
                    <input
                      type="text"
                      placeholder="Type generic name (e.g. PARACETAMOL)..."
                      value={irSearchQuery}
                      onChange={e => {
                        setIrSearchQuery(e.target.value);
                        setIrShowSuggestions(true);
                        if (irSelectedGeneric && irSelectedGeneric.drug_gen_name !== e.target.value) {
                          setIrSelectedGeneric(null);
                        }
                      }}
                      onFocus={() => setIrShowSuggestions(true)}
                      style={{
                        width: '100%',
                        padding: '8px 12px',
                        fontSize: '0.82rem',
                        borderRadius: '8px',
                        border: '1.5px solid #cbd5e1',
                        outline: 'none',
                        background: '#fff',
                      }}
                    />

                    {/* Suggestions Autocomplete List */}
                    {irShowSuggestions && irGenericSuggestions.length > 0 && (
                      <div style={{
                        position: 'absolute',
                        top: '100%',
                        left: 0,
                        right: 0,
                        background: '#fff',
                        borderRadius: '8px',
                        border: '1px solid #cbd5e1',
                        boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1)',
                        zIndex: 100,
                        maxHeight: '180px',
                        overflowY: 'auto',
                        marginTop: '4px',
                      }}>
                        {irGenericSuggestions.map((item) => (
                          <div
                            key={item.drug_gen_id}
                            onClick={() => {
                              setIrSelectedGeneric(item);
                              setIrSearchQuery(item.drug_gen_name);
                              setIrShowSuggestions(false);
                            }}
                            style={{
                              padding: '8px 12px',
                              cursor: 'pointer',
                              fontSize: '0.8rem',
                              borderBottom: '1px solid #f1f5f9',
                              textAlign: 'left',
                            }}
                            onMouseEnter={e => { e.currentTarget.style.background = '#f1f5f9'; }}
                            onMouseLeave={e => { e.currentTarget.style.background = '#fff'; }}
                          >
                            <strong>{item.drug_gen_name}</strong> <span style={{ color: '#94a3b8', fontSize: '0.72rem', marginLeft: '6px' }}>(ID: {item.drug_gen_id})</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* From Date */}
                  <div>
                    <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: '#475569', marginBottom: '6px' }}>From Date</label>
                    <input
                      type="date"
                      value={irFromDate}
                      onChange={e => setIrFromDate(e.target.value)}
                      style={{
                        width: '100%',
                        padding: '8px 12px',
                        fontSize: '0.82rem',
                        borderRadius: '8px',
                        border: '1.5px solid #cbd5e1',
                        outline: 'none',
                        background: '#fff',
                      }}
                    />
                  </div>

                  {/* To Date */}
                  <div>
                    <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: '#475569', marginBottom: '6px' }}>To Date</label>
                    <input
                      type="date"
                      value={irToDate}
                      onChange={e => setIrToDate(e.target.value)}
                      style={{
                        width: '100%',
                        padding: '8px 12px',
                        fontSize: '0.82rem',
                        borderRadius: '8px',
                        border: '1.5px solid #cbd5e1',
                        outline: 'none',
                        background: '#fff',
                      }}
                    />
                  </div>
                </div>

                {/* Actions */}
                <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-start', marginBottom: '16px' }}>
                  <button
                    type="button"
                    onClick={handleIrSearchReport}
                    disabled={irLoadingReport}
                    style={{
                      background: '#1e3a5f',
                      color: '#fff',
                      border: 'none',
                      padding: '8px 18px',
                      borderRadius: '6px',
                      cursor: 'pointer',
                      fontSize: '0.8rem',
                      fontWeight: 600,
                    }}
                  >
                    {irLoadingReport ? '⏳ Fetching...' : '🔍 Search Existing Drugs'}
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setIrSearchQuery('');
                      setIrSelectedGeneric(null);
                      setIrReportRows([]);
                      setIrReportError('');
                      setIrDosageFilter('');
                      setIrDosageFormFilter('');
                    }}
                    style={{
                      background: '#f1f5f9',
                      color: '#475569',
                      border: '1px solid #cbd5e1',
                      padding: '8px 18px',
                      borderRadius: '6px',
                      cursor: 'pointer',
                      fontSize: '0.8rem',
                      fontWeight: 600,
                    }}
                  >
                    Clear
                  </button>
                </div>

                {/* Filters Row */}
                {irReportRows.length > 0 && (
                  <div style={{
                    display: 'flex',
                    gap: '20px',
                    alignItems: 'center',
                    padding: '12px 16px',
                    background: '#f8fafc',
                    borderRadius: '8px',
                    border: '1px solid #e2e8f0',
                    marginBottom: '16px',
                    flexWrap: 'wrap'
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <label style={{ fontSize: '0.78rem', fontWeight: 600, color: '#475569' }}>Dosage Form:</label>
                      <select
                        value={irDosageFormFilter}
                        onChange={e => setIrDosageFormFilter(e.target.value)}
                        style={{
                          padding: '6px 10px',
                          fontSize: '0.78rem',
                          borderRadius: '6px',
                          border: '1px solid #cbd5e1',
                          background: '#fff',
                          outline: 'none',
                        }}
                      >
                        <option value="">All</option>
                        {irAvailableDosageForms.map(form => (
                          <option key={form} value={form}>{form}</option>
                        ))}
                      </select>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <label style={{ fontSize: '0.78rem', fontWeight: 600, color: '#475569' }}>Dosage Size:</label>
                      <select
                        value={irDosageFilter}
                        onChange={e => setIrDosageFilter(e.target.value)}
                        style={{
                          padding: '6px 10px',
                          fontSize: '0.78rem',
                          borderRadius: '6px',
                          border: '1px solid #cbd5e1',
                          background: '#fff',
                          outline: 'none',
                        }}
                      >
                        <option value="">All</option>
                        {irAvailableDosages.map(dose => (
                          <option key={dose} value={dose}>{dose}</option>
                        ))}
                      </select>
                    </div>

                    {/* Summary */}
                    <div style={{ marginLeft: 'auto', fontSize: '0.78rem', fontWeight: 500, color: '#475569' }}>
                      Found <strong style={{ color: '#1e3a5f' }}>{irReportRows.length}</strong> brands
                      {(irDosageFilter || irDosageFormFilter) && (
                        <span>
                          {' '}• Showing <strong style={{ color: '#10b981' }}>{irFilteredReportRows.length}</strong> brands matching:
                          {irDosageFormFilter && ` Form = ${irDosageFormFilter}`}
                          {irDosageFilter && `${irDosageFormFilter ? ',' : ''} Dosage = ${irDosageFilter}`}
                        </span>
                      )}
                    </div>
                  </div>
                )}

                {/* Error / Loading State */}
                {irReportError && (
                  <div style={{ color: '#ef4444', background: '#fef2f2', padding: '10px 14px', borderRadius: '8px', fontSize: '0.8rem', marginBottom: '12px', border: '1px solid #fca5a5' }}>
                    ⚠️ {irReportError}
                  </div>
                )}

                {irLoadingReport && (
                  <div style={{ textAlign: 'center', padding: '24px 0', color: '#4b5563', fontSize: '0.85rem' }}>
                    ⏳ Loading formulary drugs from HIS report...
                  </div>
                )}

                {/* Results Table */}
                {!irLoadingReport && irReportRows.length > 0 && (
                  <div className="table-wrap" style={{ overflowX: 'auto', maxHeight: '420px', border: '1px solid #e2e8f0', borderRadius: '8px' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.72rem', textAlign: 'left' }}>
                      <thead style={{ position: 'sticky', top: 0, zIndex: 10, background: '#f8fafc', borderBottom: '2px solid #e2e8f0' }}>
                        <tr>
                          <th style={{ padding: '8px 10px', borderBottom: '1px solid #cbd5e1' }}>S.No.</th>
                          <th style={{ padding: '8px 10px', borderBottom: '1px solid #cbd5e1' }}>Introduced On</th>
                          <th style={{ padding: '8px 10px', borderBottom: '1px solid #cbd5e1' }}>Brand Name</th>
                          <th style={{ padding: '8px 10px', borderBottom: '1px solid #cbd5e1' }}>Manufacturer</th>
                          <th style={{ padding: '8px 10px', borderBottom: '1px solid #cbd5e1' }}>Marketer</th>
                          <th style={{ padding: '8px 10px', borderBottom: '1px solid #cbd5e1' }}>Consultant</th>
                          <th style={{ padding: '8px 10px', borderBottom: '1px solid #cbd5e1' }}>Present Stock</th>
                          <th style={{ padding: '8px 10px', borderBottom: '1px solid #cbd5e1' }}>Purchase Qty</th>
                          <th style={{ padding: '8px 10px', borderBottom: '1px solid #cbd5e1' }}>Sale Qty</th>
                          <th style={{ padding: '8px 10px', borderBottom: '1px solid #cbd5e1' }}>Pack</th>
                          <th style={{ padding: '8px 10px', borderBottom: '1px solid #cbd5e1' }}>MRP</th>
                          <th style={{ padding: '8px 10px', borderBottom: '1px solid #cbd5e1' }}>Rate</th>
                          <th style={{ padding: '8px 10px', borderBottom: '1px solid #cbd5e1' }}>Margin</th>
                          <th style={{ padding: '8px 10px', borderBottom: '1px solid #cbd5e1' }}>Scheme</th>
                          <th style={{ padding: '8px 10px', borderBottom: '1px solid #cbd5e1' }}>Net Rate</th>
                          <th style={{ padding: '8px 10px', borderBottom: '1px solid #cbd5e1' }}>Profit Margin</th>
                          <th style={{ padding: '8px 10px', borderBottom: '1px solid #cbd5e1' }}>Total Margin</th>
                        </tr>
                      </thead>
                      <tbody>
                        {irFilteredReportRows.length === 0 ? (
                          <tr>
                            <td colSpan={17} style={{ padding: '24px', textAlign: 'center', color: '#64748b', fontSize: '0.8rem', background: '#f8fafc' }}>
                              📭 No brands match the selected filter criteria.
                            </td>
                          </tr>
                        ) : (
                          irFilteredReportRows.map((row, idx) => (
                            <tr
                              key={idx}
                              style={{
                                background: idx % 2 === 0 ? '#ffffff' : '#f8fafc',
                                borderBottom: '1px solid #f1f5f9',
                              }}
                            >
                              <td style={{ padding: '8px 10px' }}>{row.sno}</td>
                              <td style={{ padding: '8px 10px' }}>{formatIntroducedDate(row.introduced_on)}</td>
                              <td style={{ padding: '8px 10px', fontWeight: 600 }}>{row.brand_name}</td>
                              <td style={{ padding: '8px 10px' }}>{row.manufacturer}</td>
                              <td style={{ padding: '8px 10px' }}>{row.marketer}</td>
                              <td style={{ padding: '8px 10px' }}>{row.consultant}</td>
                              <td style={{ padding: '8px 10px', textAlign: 'right' }}>{row.present_stock}</td>
                              <td style={{ padding: '8px 10px', textAlign: 'right' }}>{row.purchase_quantity}</td>
                              <td style={{ padding: '8px 10px', textAlign: 'right' }}>{row.sale_qty}</td>
                              <td style={{ padding: '8px 10px' }}>{row.pack}</td>
                              <td style={{ padding: '8px 10px', textAlign: 'right' }}>{row.mrp_incl_gst}</td>
                              <td style={{ padding: '8px 10px', textAlign: 'right' }}>{row.rate_incl_gst}</td>
                              <td style={{ padding: '8px 10px', textAlign: 'right' }}>{row.absolute_margin}</td>
                              <td style={{ padding: '8px 10px' }}>{row.scheme_qty && row.offer_qty ? `${row.scheme_qty}+${row.offer_qty}` : row.scheme_qty || '—'}</td>
                              <td style={{ padding: '8px 10px', textAlign: 'right' }}>{row.net_rate}</td>
                              <td style={{ padding: '8px 10px', textAlign: 'right' }}>{row.profit_margin}%</td>
                              <td style={{ padding: '8px 10px', textAlign: 'right' }}>{row.total_margin_markup}%</td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                )}

                {!irLoadingReport && irReportRows.length === 0 && irSelectedGeneric && (
                  <div style={{ textAlign: 'center', padding: '16px', background: '#f8fafc', color: '#64748b', fontSize: '0.8rem', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                    📭 No existing drugs found in the formulary report for "{irSelectedGeneric.drug_gen_name}" within the chosen date range.
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ======== ANALYSIS QUEUE ======== */}
      {view === 'pending' && (
        <div className="card">
          <div className="card-title" style={{ justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div className="icon">💊</div>
              Post-DTC Pharmacist Analysis Queue
              <span className="badge badge-info">Submit ≥3 Alternatives</span>
            </div>
            <button className="btn btn-ghost btn-sm" onClick={loadRequests}>↺ Refresh</button>
          </div>
          <div className="alert alert-info" style={{ marginBottom: 18, fontSize: '0.82rem' }}>
            💡 These requests were approved by DTC. You must submit at least 3 drug alternatives with quotation details before forwarding to Pharmacy Head.
          </div>
          {loading ? (
            <div style={{ textAlign: 'center', padding: 60 }}><div className="spinner" /></div>
          ) : normalPending.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 60, color: 'var(--text-subtle)' }}>
              <div style={{ fontSize: '3rem', marginBottom: 12 }}>✅</div>
              No requests pending your analysis.
            </div>
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>#ID</th><th>Brand Name</th><th>Generic</th>
                    <th>Category</th><th>Type</th><th>Formulary Type</th><th>Source</th><th>Doctor</th><th>Submitted</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {normalPending.map(r => (
                    <tr key={r.REQUEST_ID}>
                      <td style={{ fontWeight: 700, color: 'var(--primary-light)' }}>#{r.REQUEST_ID}</td>
                      <td style={{ fontWeight: 600 }}>{r.BRAND_NAME}

                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          style={{ marginTop: 4, borderColor: 'var(--primary)', color: 'var(--primary)' }}
                          onClick={() => { fetchDrug(r.BRAND_NAME) }}
                          disabled={loading}
                        >Show Alternatives</button>

                      </td>
                      <td style={{ color: 'var(--text-muted)' }}>{r.GENERIC_NAME}

                      </td>
                      <td>{r.CATEGORY}</td>
                      <td><span className="badge badge-info">{r.REQUEST_TYPE}</span></td>
                      <td>
                        {r.FORMULARY_REQUEST_TYPE === 'FORMULARY' ? (
                          <span className="badge" style={{ background: '#ecfdf5', color: '#065f46' }}>Formulary</span>
                        ) : r.FORMULARY_REQUEST_TYPE === 'NON_FORMULARY' ? (
                          <span className="badge" style={{ background: '#fef2f2', color: '#991b1b' }}>Non-Formulary</span>
                        ) : '—'}
                      </td>
                      <td>{r.REQUEST_SOURCE_TYPE === 'NON_PROMOTIONAL' ? <span className="badge badge-non-promotional">Clinical Initiated</span> : <span className="badge badge-promotional">Via Medical Representative</span>}</td>
                      <td>
                        <div>{r.DOCTOR_NAME}</div>
                        <small className="text-muted" style={{ display: 'block', fontSize: '0.75rem' }}>
                          {r.CREATED_BY_ROLE || 'Doctor'} • {r.DOCTOR_DEPT || ''}
                        </small>
                      </td>
                      <td style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                        {new Date(r.CREATED_AT).toLocaleDateString('en-IN')}
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button className="btn btn-ghost btn-sm" onClick={() => openView(r)}>👁 View</button>
                          <button className="btn btn-primary btn-sm" onClick={() => openAnalysis(r)}>
                            📋 Submit Quotation
                          </button>
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

      {/* ======== CORRECTIONS TAB ======== */}
      {view === 'corrections' && (
        <div className="card">
          <div className="card-title" style={{ justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div className="icon">🔁</div>
              Correction Requests
              <span className="badge" style={{ background: '#fef3c7', color: '#92400e' }}>
                Reverted by Pharmacy Head
              </span>
            </div>
            <button className="btn btn-ghost btn-sm" onClick={loadRequests}>↺ Refresh</button>
          </div>
          <div className="alert alert-warning" style={{ marginBottom: 18, fontSize: '0.82rem' }}>
            ⚠️ The Pharmacy Head has identified issues in the comparison sheet. Review the revert remarks, fix the sheet, and resubmit.
          </div>

          {correctionRequests.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 60, color: 'var(--text-subtle)' }}>
              <div style={{ fontSize: '3rem', marginBottom: 12 }}>✅</div>
              No correction requests pending.
            </div>
          ) : (
            correctionRequests.map(r => (
              <div key={r.REQUEST_ID} style={{
                border: '1.5px solid #f59e0b', borderRadius: 12,
                marginBottom: 20, overflow: 'hidden',
                boxShadow: '0 2px 12px rgba(217,119,6,0.10)',
              }}>
                {/* Amber revert banner */}
                <div style={{
                  background: 'linear-gradient(135deg, #fef3c7 0%, #fde68a 100%)',
                  borderBottom: '1px solid #f59e0b',
                  padding: '14px 20px',
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 10 }}>
                    <div>
                      <div style={{ fontWeight: 800, color: '#92400e', fontSize: '1rem', marginBottom: 4 }}>
                        ↩ Reverted by Pharmacy Head
                        {r.REVERT_COUNT > 1 && (
                          <span style={{ marginLeft: 8, fontSize: '0.78rem', fontWeight: 700, background: '#f97316', color: '#fff', borderRadius: 10, padding: '2px 8px' }}>
                            ×{r.REVERT_COUNT} times
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: '0.82rem', color: '#78350f', fontWeight: 600 }}>
                        Request #{r.REQUEST_ID} — {r.BRAND_NAME} ({r.GENERIC_NAME})
                      </div>
                    </div>
                    {r.REVERTED_AT && (
                      <div style={{ fontSize: '0.75rem', color: '#92400e', textAlign: 'right' }}>
                        <div style={{ fontWeight: 600 }}>Reverted at</div>
                        {new Date(r.REVERTED_AT).toLocaleString('en-IN')}
                      </div>
                    )}
                  </div>
                  {r.REVERT_REMARKS && (
                    <div style={{
                      marginTop: 12, padding: '10px 14px',
                      background: 'rgba(255,255,255,0.7)', borderRadius: 8,
                      border: '1px solid #fbbf24',
                    }}>
                      <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#92400e', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>
                        📋 Revert Reason from Pharmacy Head:
                      </div>
                      <div style={{ fontSize: '0.84rem', color: '#78350f', whiteSpace: 'pre-line', lineHeight: 1.65 }}>
                        {r.REVERT_REMARKS}
                      </div>
                    </div>
                  )}
                </div>

                {/* Request details */}
                <div style={{ padding: '14px 20px', background: 'var(--bg-card)' }}>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 24, marginBottom: 14, fontSize: '0.82rem' }}>
                    {[
                      ['Category', r.CATEGORY],
                      ['Type', r.REQUEST_TYPE],
                      ['Dose', r.DOSE_STRENGTH],
                      ['Form', r.DOSAGE_FORM],
                      ['Manufacturer', r.MANUFACTURER],
                      ['Doctor', r.DOCTOR_NAME],
                      ['Submitted', r.CREATED_AT ? new Date(r.CREATED_AT).toLocaleDateString('en-IN') : '—'],
                    ].map(([label, val]) => (
                      <div key={label}>
                        <div style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</div>
                        <div style={{ fontWeight: 600, color: 'var(--text)', marginTop: 2 }}>{val || '—'}</div>
                      </div>
                    ))}
                  </div>

                  {correctionErr && analysisReq?.REQUEST_ID === r.REQUEST_ID && (
                    <div className="alert alert-error" style={{ marginBottom: 10 }}>{correctionErr}</div>
                  )}

                  <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                    <button
                      className="btn btn-primary"
                      style={{ background: '#7c3aed', border: 'none', fontWeight: 700 }}
                      onClick={() => openCorrectionAnalysis(r)}
                    >
                      📝 Open &amp; Fix Comparison Sheet
                    </button>
                    <button className="btn btn-ghost btn-sm" onClick={() => openView(r)}>
                      👁 View Details
                    </button>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* ======== Alternative DRUG PROFILE MODAL ======== */}
      {showDrugProfilePopup && (
        <div
          className="modal-overlay"
          style={{ animation: 'none' }}
          onClick={() => setShowDrugProfilePopup(false)}
        >
          <div
            className="modal"
            style={{ maxWidth: '94vw', width: '94vw', maxHeight: '90vh', display: 'flex', flexDirection: 'column', padding: 0, overflow: 'hidden' }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* ── Sticky Header ── */}
            <div style={{ padding: '20px 24px 16px', borderBottom: '1px solid var(--border)', background: 'var(--bg-card)', flexShrink: 0 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
                    <div style={{ width: 36, height: 36, borderRadius: 8, background: 'rgba(14,165,233,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.2rem' }}>💊</div>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: '1.05rem', color: 'var(--text)' }}>Drug Profile Report</div>
                      <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: 1 }}>
                        {form.brand_name && <><span style={{ background: 'var(--info-light)', color: 'var(--info)', borderRadius: 4, padding: '1px 8px', fontWeight: 600 }}>{form.brand_name}</span> &nbsp;·&nbsp;</>}
                        AI Knowledge Base &nbsp;·&nbsp; Indian Market Data
                      </div>
                    </div>
                  </div>
                </div>
                <button
                  onClick={() => setShowDrugProfilePopup(false)}
                  className="btn btn-ghost btn-sm"
                  style={{ padding: '4px 10px', fontSize: '1rem', flexShrink: 0 }}
                >✕</button>
              </div>
              <div className="alert alert-warning" style={{ marginBottom: 0, marginTop: 12, fontSize: '0.76rem', padding: '8px 12px' }}>
                ⚠️ AI-generated content — verify all pricing and clinical data against official NPPA / CDSCO sources before use.
              </div>
            </div>

            {/* ── Scrollable Body ── */}
            <div style={{ overflowY: 'auto', flex: 1, padding: '20px 24px', background: 'var(--bg)' }}>
              {result ? (
                <DrugProfileRenderer text={result} />
              ) : (
                <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-subtle)' }}>
                  <div style={{ fontSize: '2rem', marginBottom: 8 }}>⏳</div>
                  <div>Loading drug profile…</div>
                </div>
              )}
            </div>

            {/* ── Footer ── */}
            <div style={{ padding: '14px 24px', borderTop: '1px solid var(--border)', background: 'var(--bg-card)', display: 'flex', justifyContent: 'flex-end', flexShrink: 0 }}>
              <button className="btn btn-primary btn-sm" onClick={() => setShowDrugProfilePopup(false)}>
                Close Report
              </button>
            </div>
          </div>
        </div>
      )}





      {/* ======== EMERGENCY VIEW-ONLY ======== */}
      {view === 'emergency' && (
        <div className="card">
          <div className="card-title" style={{ justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div className="icon">🚨</div>
              Emergency Requests
              <span className="badge" style={{ background: '#fef3c7', color: '#92400e' }}>DTC Decides & Pharmacist Orders</span>
            </div>
            <button className="btn btn-ghost btn-sm" onClick={loadRequests}>↺ Refresh</button>
          </div>
          <div className="alert alert-warning" style={{ marginBottom: 18, fontSize: '0.82rem' }}>
            ⚠️ Emergency requests require IMMEDIATE DTC decision. Once approved, you can place the order here.
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
                      <td style={{ fontWeight: 700, color: '#dc2626' }}>
                        🚨 #{r.REQUEST_ID}
                      </td>
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
                      <td style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                        {new Date(r.CREATED_AT).toLocaleDateString('en-IN')}
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button className="btn btn-ghost btn-sm" onClick={() => openView(r)}>👁 View</button>
                          {r.STATUS === 'EMERGENCY_APPROVED' && (
                            <button className="btn btn-primary btn-sm" onClick={() => placeOrder(r.REQUEST_ID)}>
                              📦 Place Order
                            </button>
                          )}
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


      {/* ======== PENDING ORDERS ======== */}
      {view === 'orders' && (
        <div className="card">
          <div className="card-title" style={{ justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div className="icon">📦</div>Pending Orders
            </div>
            <button className="btn btn-ghost btn-sm" onClick={loadRequests}>↺ Refresh</button>
          </div>
          <div className="alert alert-info" style={{ marginBottom: 18, fontSize: '0.82rem' }}>
            💡 Requests here have received Final/CEO approval and require order placement.
          </div>
          {requests.filter(r => r.STATUS === 'APPROVED_PENDING_ORDER' || r.STATUS === 'EMERGENCY_APPROVED').length === 0 ? (
            <div style={{ textAlign: 'center', padding: 60, color: 'var(--text-subtle)' }}>
              <div style={{ fontSize: '3rem', marginBottom: 12 }}>✅</div>No pending orders.
            </div>
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>#ID</th>
                    <th>Drug</th>
                    <th>Source</th>
                    <th>Status</th>
                    <th>Inventory Status</th>
                    <th>Submitted</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {requests.filter(r => r.STATUS === 'APPROVED_PENDING_ORDER' || r.STATUS === 'EMERGENCY_APPROVED').map(r => {
                    const invAdded = r.INVENTORY_ADDED === 1;
                    return (
                      <tr key={r.REQUEST_ID}>
                        <td style={{ fontWeight: 700 }}>#{r.REQUEST_ID}</td>
                        <td>
                          <div style={{ fontWeight: 700, color: '#166534' }}>
                            🏆 {r.FINAL_SELECTED_BRAND || r.DTC_SELECTED_BRAND || r.BRAND_NAME}
                          </div>
                          <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{r.GENERIC_NAME}</div>
                        </td>
                        <td>{r.REQUEST_SOURCE_TYPE === 'PHARMACIST' ? 'Pharmacist Direct' : 'Doctor Emergency'}</td>
                        <td>
                          <span className="badge" style={{ background: '#dcfce7', color: '#166534' }}>{r.STATUS}</span>
                        </td>
                        <td>
                          {invAdded ? (
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: '#dcfce7', color: '#166534', borderRadius: 20, padding: '3px 10px', fontSize: '0.75rem', fontWeight: 700 }}>
                              ✅ Added to Inventory
                            </span>
                          ) : (
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: '#f1f5f9', color: '#64748b', borderRadius: 20, padding: '3px 10px', fontSize: '0.75rem', fontWeight: 600 }}>
                              ⬜ Not Added
                            </span>
                          )}
                        </td>
                        <td style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{new Date(r.CREATED_AT).toLocaleDateString()}</td>
                        <td>
                          <div style={{ display: 'flex', gap: 6 }}>
                            <button className="btn btn-ghost btn-sm" onClick={() => openView(r)}>👁 View Details</button>
                            <button className="btn btn-primary btn-sm" onClick={() => placeOrder(r.REQUEST_ID)}>📦 Place Order</button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ======== CREATE DRUG REQUEST ======== */}
      {/* ======== CREATE DRUG REQUEST ======== */}
      {view === 'form' && (
        <>
          <style>
            {`
        .drug-request-wrapper {
          background: #f1f5f9;
          padding: 30px;
          min-height: 100vh;
        }

        .drug-request-card {
          background: #ffffff;
          border-radius: 22px;
          padding: 36px;
          max-width: 1450px;
          margin: auto;
          border: 1px solid #e2e8f0;
          box-shadow:
            0 4px 20px rgba(15, 23, 42, 0.05),
            0 1px 3px rgba(15, 23, 42, 0.08);
          animation: fadeIn 0.35s ease;
        }

        @keyframes fadeIn {
          from {
            opacity: 0;
            transform: translateY(10px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        .card-header-modern {
          display: flex;
          align-items: center;
          gap: 16px;
          margin-bottom: 28px;
        }

        .header-icon {
          width: 58px;
          height: 58px;
          border-radius: 18px;
          background: linear-gradient(135deg, #dbeafe, #bfdbfe);
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 1.5rem;
        }

        .header-title {
          font-size: 1.7rem;
          font-weight: 700;
          color: #0f172a;
          margin-bottom: 4px;
        }

        .header-subtitle {
          font-size: 0.92rem;
          color: #64748b;
        }

        .modern-alert {
          background: linear-gradient(
            135deg,
            #eff6ff,
            #f8fbff
          );
          border: 1px solid #bfdbfe;
          color: #1d4ed8;
          padding: 18px;
          border-radius: 14px;
          margin-bottom: 28px;
          font-size: 0.92rem;
          line-height: 1.5;
        }

        .section-title {
          font-size: 1rem;
          font-weight: 700;
          color: #0f172a;
          margin-bottom: 20px;
          padding-bottom: 10px;
          border-bottom: 1px solid #e2e8f0;
        }

        .modern-form-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
          gap: 24px;
        }

        .form-group-modern {
          display: flex;
          flex-direction: column;
        }

        .form-group-modern label {
          margin-bottom: 10px;
          font-size: 0.92rem;
          font-weight: 600;
          color: #334155;
        }

        .required {
          color: #dc2626;
        }

        .modern-input,
        .modern-select,
        .modern-textarea {
          width: 100%;
          border: 1px solid #dbe2ea;
          background: #f8fafc;
          border-radius: 14px;
          transition: all 0.25s ease;
          font-size: 0.95rem;
          color: #0f172a;
        }

        .modern-input,
        .modern-select {
          height: 56px;
          padding: 0 16px;
        }

        .modern-textarea {
          min-height: 150px;
          padding: 16px;
          resize: vertical;
        }

        .modern-input:focus,
        .modern-select:focus,
        .modern-textarea:focus {
          outline: none;
          border-color: #2563eb;
          background: white;
          box-shadow: 0 0 0 4px rgba(37, 99, 235, 0.12);
        }

        .modern-input:hover,
        .modern-select:hover,
        .modern-textarea:hover {
          border-color: #94a3b8;
        }

        .error-input {
          border-color: #dc2626 !important;
          background: #fff5f5;
        }

        .error-text {
          color: #dc2626;
          font-size: 0.82rem;
          margin-top: 6px;
        }

        .full-width {
          grid-column: 1 / -1;
        }

        .submit-btn-modern {
          width: 100%;
          height: 60px;
          border: none;
          border-radius: 16px;
          background: linear-gradient(
            135deg,
            #2563eb,
            #1d4ed8
          );
          color: white;
          font-size: 1rem;
          font-weight: 700;
          cursor: pointer;
          transition: all 0.25s ease;
          box-shadow: 0 12px 22px rgba(37, 99, 235, 0.22);
        }

        .submit-btn-modern:hover {
          transform: translateY(-2px);
          box-shadow: 0 16px 28px rgba(37, 99, 235, 0.3);
        }

        .submit-btn-modern:disabled {
          opacity: 0.7;
          cursor: not-allowed;
          transform: none;
        }

        @media (max-width: 768px) {
          .drug-request-wrapper {
            padding: 16px;
          }

          .drug-request-card {
            padding: 22px;
          }

          .modern-form-grid {
            grid-template-columns: 1fr;
            gap: 18px;
          }

          .header-title {
            font-size: 1.35rem;
          }
        }
      `}
          </style>

          <div className="drug-request-wrapper">
            <div className="drug-request-card">

              {/* HEADER */}
              <div className="card-header-modern">
                <div className="header-icon">💊</div>

                <div>
                  <div className="header-title">
                    Pharmacist Direct Drug Request
                  </div>

                  <div className="header-subtitle">
                    Submit new drug requests directly for Pharmacy Head review
                  </div>
                </div>
              </div>

              {/* INFO ALERT */}
              <div className="modern-alert">
                💡 Use this form to directly submit a drug addition request.
                This process bypasses the Doctor / HOD / Alternatives workflow
                and goes directly to Pharmacy Head approval.
              </div>

              <form onSubmit={handleFormSubmit}>

                {/* SECTION 1 */}
                <div className="section-title">
                  Drug Information
                </div>

                <div className="modern-form-grid">

                  {/* CATEGORY */}
                  <div className="form-group-modern">
                    <label>
                      Category <span className="required">*</span>
                    </label>

                    <select
                      name="category"
                      value={form.category}
                      onChange={handleFormChange}
                      className={`modern-select ${formErrors.category ? 'error-input' : ''
                        }`}
                    >
                      <option value="">Select category...</option>
                      <option value="Vital">Vital</option>
                      <option value="Essential">Essential</option>
                      <option value="Desirable">Desirable</option>
                    </select>

                    {formErrors.category && (
                      <div className="error-text">
                        {formErrors.category}
                      </div>
                    )}
                  </div>

                  {/* BRAND NAME */}
                  <div className="form-group-modern">
                    <label>
                      Brand Name <span className="required">*</span>
                    </label>

                    <input
                      type="text"
                      name="brand_name"
                      value={form.brand_name}
                      onChange={handleFormChange}
                      placeholder="e.g. Crocin"
                      className={`modern-input ${formErrors.brand_name ? 'error-input' : ''
                        }`}
                    />

                    {formErrors.brand_name && (
                      <div className="error-text">
                        {formErrors.brand_name}
                      </div>
                    )}
                  </div>

                  {/* GENERIC NAME */}
                  <div className="form-group-modern">
                    <label>
                      Generic Name <span className="required">*</span>
                    </label>

                    <input
                      type="text"
                      name="generic_name"
                      value={form.generic_name}
                      onChange={handleFormChange}
                      placeholder="e.g. Paracetamol"
                      className={`modern-input ${formErrors.generic_name ? 'error-input' : ''
                        }`}
                    />

                    {formErrors.generic_name && (
                      <div className="error-text">
                        {formErrors.generic_name}
                      </div>
                    )}
                  </div>

                  {/* STRENGTH */}
                  <div className="form-group-modern">
                    <label>
                      Dose / Strength <span className="required">*</span>
                    </label>

                    <input
                      type="text"
                      name="dose_strength"
                      value={form.dose_strength}
                      onChange={handleFormChange}
                      placeholder="e.g. 500mg"
                      className={`modern-input ${formErrors.dose_strength ? 'error-input' : ''
                        }`}
                    />

                    {formErrors.dose_strength && (
                      <div className="error-text">
                        {formErrors.dose_strength}
                      </div>
                    )}
                  </div>

                  {/* DOSAGE FORM */}
                  <div className="form-group-modern">
                    <label>
                      Dosage Form <span className="required">*</span>
                    </label>

                    <select
                      name="dosage_form"
                      value={form.dosage_form}
                      onChange={handleFormChange}
                      className={`modern-select ${formErrors.dosage_form ? 'error-input' : ''
                        }`}
                    >
                      <option value="">Select form...</option>
                      <option value="Tablet">Tablet</option>
                      <option value="Capsule">Capsule</option>
                      <option value="Injection">Injection</option>
                      <option value="Syrup">Syrup</option>
                      <option value="Ointment">Ointment</option>
                      <option value="Drops">Drops</option>
                      <option value="Other">Other</option>
                    </select>

                    {formErrors.dosage_form && (
                      <div className="error-text">
                        {formErrors.dosage_form}
                      </div>
                    )}
                  </div>

                </div>

                {/* SECTION 2 */}
                <div
                  className="section-title"
                  style={{ marginTop: 34 }}
                >
                  Manufacturer Details
                </div>

                <div className="modern-form-grid">

                  {/* MANUFACTURER */}
                  <div className="form-group-modern">
                    <label>
                      Manufacturer <span className="required">*</span>
                    </label>

                    <input
                      type="text"
                      name="manufacturer"
                      value={form.manufacturer}
                      onChange={handleFormChange}
                      placeholder="Manufacturer company"
                      className={`modern-input ${formErrors.manufacturer ? 'error-input' : ''
                        }`}
                    />

                    {formErrors.manufacturer && (
                      <div className="error-text">
                        {formErrors.manufacturer}
                      </div>
                    )}
                  </div>

                  {/* MARKETER */}
                  <div className="form-group-modern">
                    <label>
                      Marketer <span className="required">*</span>
                    </label>

                    <input
                      type="text"
                      name="marketer"
                      value={form.marketer}
                      onChange={handleFormChange}
                      placeholder="Marketing company"
                      className={`modern-input ${formErrors.marketer ? 'error-input' : ''
                        }`}
                    />

                    {formErrors.marketer && (
                      <div className="error-text">
                        {formErrors.marketer}
                      </div>
                    )}
                  </div>

                  {/* EXISTING BRANDS */}
                  <div className="form-group-modern full-width">
                    <label>
                      Existing Brands
                    </label>

                    <input
                      type="text"
                      name="existing_brands"
                      value={form.existing_brands}
                      onChange={handleFormChange}
                      placeholder="Comma separated brand names..."
                      className="modern-input"
                    />
                  </div>

                </div>

                {/* SECTION 3 */}
                <div
                  className="section-title"
                  style={{ marginTop: 34 }}
                >
                  Clinical Justification
                </div>

                <div className="modern-form-grid">

                  <div className="form-group-modern full-width">
                    <label>
                      Clinical Justification / Notes
                      <span className="required"> *</span>
                    </label>

                    <textarea
                      name="clinical_justification"
                      value={form.clinical_justification}
                      onChange={handleFormChange}
                      rows="6"
                      placeholder="Explain why this drug is needed, expected clinical benefits, special use cases, formulary gaps, or procurement justification..."
                      className={`modern-textarea ${formErrors.clinical_justification
                        ? 'error-input'
                        : ''
                        }`}
                    />

                    {formErrors.clinical_justification && (
                      <div className="error-text">
                        {formErrors.clinical_justification}
                      </div>
                    )}
                  </div>

                </div>

                {/* SUBMIT BUTTON */}
                <div style={{ marginTop: 36 }}>
                  <button
                    type="submit"
                    disabled={submittingForm}
                    className="submit-btn-modern"
                  >
                    {submittingForm
                      ? 'Submitting Request...'
                      : '🚀 Submit Direct Drug Request'}
                  </button>
                </div>

              </form>
            </div>
          </div>
        </>
      )}

      {/* ======== CREATE DRUG REQUEST ======== */}
      {view === 'form' && (
        <div className="card">
          <div className="card-title">
            <div className="icon">📝</div>
            Pharmacist Direct Drug Request
          </div>
          <div className="alert alert-info" style={{ marginBottom: 18, fontSize: '0.82rem' }}>
            💡 Use this form to directly submit a drug addition request. This will bypass the Doctor/HOD/Alternatives flow and go straight to Pharmacy Head review.
          </div>
          <form onSubmit={handleFormSubmit}>
            <div className="form-grid">
              <div className="form-group">
                <label>Category <span className="text-danger">*</span></label>
                <select name="category" value={form.category} onChange={handleFormChange} className={`form-control ${formErrors.category ? 'error' : ''}`}>
                  <option value="">Select category...</option>
                  <option value="Vital">Vital</option>
                  <option value="Essential">Essential</option>
                  <option value="Desirable">Desirable</option>
                </select>
                {formErrors.category && <div className="text-danger mt-1" style={{ fontSize: '0.8rem' }}>{formErrors.category}</div>}
              </div>
              <div className="form-group">
                <label>Brand Name <span className="text-danger">*</span></label>
                <input type="text" name="brand_name" value={form.brand_name} onChange={handleFormChange} className={`form-control ${formErrors.brand_name ? 'error' : ''}`} placeholder="e.g. Crocin" />
                {formErrors.brand_name && <div className="text-danger mt-1" style={{ fontSize: '0.8rem' }}>{formErrors.brand_name}</div>}
              </div>
              <div className="form-group">
                <label>Generic Name <span className="text-danger">*</span></label>
                <input type="text" name="generic_name" value={form.generic_name} onChange={handleFormChange} className={`form-control ${formErrors.generic_name ? 'error' : ''}`} placeholder="e.g. Paracetamol" />
                {formErrors.generic_name && <div className="text-danger mt-1" style={{ fontSize: '0.8rem' }}>{formErrors.generic_name}</div>}
              </div>
              <div className="form-group">
                <label>Dose / Strength <span className="text-danger">*</span></label>
                <input type="text" name="dose_strength" value={form.dose_strength} onChange={handleFormChange} className={`form-control ${formErrors.dose_strength ? 'error' : ''}`} placeholder="e.g. 500mg" />
                {formErrors.dose_strength && <div className="text-danger mt-1" style={{ fontSize: '0.8rem' }}>{formErrors.dose_strength}</div>}
              </div>
              <div className="form-group">
                <label>Dosage Form <span className="text-danger">*</span></label>
                <select name="dosage_form" value={form.dosage_form} onChange={handleFormChange} className={`form-control ${formErrors.dosage_form ? 'error' : ''}`}>
                  <option value="">Select form...</option>
                  <option value="Tablet">Tablet</option>
                  <option value="Capsule">Capsule</option>
                  <option value="Injection">Injection</option>
                  <option value="Syrup">Syrup</option>
                  <option value="Ointment">Ointment</option>
                  <option value="Drops">Drops</option>
                  <option value="Other">Other</option>
                </select>
                {formErrors.dosage_form && <div className="text-danger mt-1" style={{ fontSize: '0.8rem' }}>{formErrors.dosage_form}</div>}
              </div>
              <div className="form-group">
                <label>Manufacturer <span className="text-danger">*</span></label>
                <input type="text" name="manufacturer" value={form.manufacturer} onChange={handleFormChange} className={`form-control ${formErrors.manufacturer ? 'error' : ''}`} />
                {formErrors.manufacturer && <div className="text-danger mt-1" style={{ fontSize: '0.8rem' }}>{formErrors.manufacturer}</div>}
              </div>
              <div className="form-group">
                <label>Marketer <span className="text-danger">*</span></label>
                <input type="text" name="marketer" value={form.marketer} onChange={handleFormChange} className={`form-control ${formErrors.marketer ? 'error' : ''}`} />
                {formErrors.marketer && <div className="text-danger mt-1" style={{ fontSize: '0.8rem' }}>{formErrors.marketer}</div>}
              </div>
              <div className="form-group">
                <label>Existing Brands</label>
                <input type="text" name="existing_brands" value={form.existing_brands} onChange={handleFormChange} className="form-control" placeholder="Comma separated..." />
              </div>
              <div className="form-group full-width">
                <label>Clinical Justification / Notes <span className="text-danger">*</span></label>
                <textarea name="clinical_justification" value={form.clinical_justification} onChange={handleFormChange} className={`form-control ${formErrors.clinical_justification ? 'error' : ''}`} rows="4" placeholder="Why is this drug needed..."></textarea>
                {formErrors.clinical_justification && <div className="text-danger mt-1" style={{ fontSize: '0.8rem' }}>{formErrors.clinical_justification}</div>}
              </div>
              <div className="form-group full-width mt-3">
                <button type="submit" className="btn btn-primary" disabled={submittingForm} style={{ width: '100%', padding: '12px', fontSize: '1rem', fontWeight: 600 }}>
                  {submittingForm ? 'Submitting...' : '🚀 Submit Direct Request'}
                </button>
              </div>
            </div>
          </form>
        </div>
      )}

      {/* ======== DASHBOARD ======== */}
      {view === 'dashboard' && (
        <Dashboard role="Pharmacist" userId={currentUser.USER_ID} refresh={dashKey} />
      )}

      {/* ======== NOTIFICATIONS ======== */}
      {view === 'notifications' && (
        <Notifications userId={currentUser.USER_ID} onRead={onNotificationsRead} />
      )}

      {/* ======== MY DRAFTS TAB ======== */}
      {view === 'drafts' && (
        <div className="card">
          <div className="card-title" style={{ justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div className="icon">📁</div>
              My Analysis Drafts
              <span className="badge badge-info">Saved Progress</span>
            </div>
            <button className="btn btn-ghost btn-sm" onClick={loadDrafts}>↺ Refresh</button>
          </div>
          <div className="alert alert-info" style={{ marginBottom: 18, fontSize: '0.82rem' }}>
            💡 Drafts are automatically saved when you click <strong>Save Draft</strong> in the analysis modal. Click <strong>Continue</strong> to resume where you left off.
          </div>
          {loadingDrafts ? (
            <div style={{ textAlign: 'center', padding: 60 }}><div className="spinner" /></div>
          ) : drafts.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 60, color: 'var(--text-subtle)' }}>
              <div style={{ fontSize: '3rem', marginBottom: 12 }}>📁</div>
              <div style={{ fontWeight: 600, marginBottom: 8 }}>No saved drafts yet</div>
              <div style={{ fontSize: '0.85rem' }}>Start a quotation analysis and click <strong>Save Draft</strong> to save your progress.</div>
            </div>
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Draft Name</th><th>Req #</th><th>Brand Name</th>
                    <th>Generic Name</th><th>Category</th><th>Last Updated</th><th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {drafts.map(d => {
                    const did = d.DRAFT_ID || d.draft_id;
                    const updatedAt = d.UPDATED_AT || d.updated_at;
                    return (
                      <tr key={did}>
                        <td style={{ fontWeight: 600 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span style={{ fontSize: '0.9rem' }}>📝</span>
                            {d.DRAFT_NAME || d.draft_name || `Draft #${did}`}
                          </div>
                        </td>
                        <td style={{ fontWeight: 700, color: 'var(--primary-light)' }}>#{d.REQUEST_ID || d.request_id}</td>
                        <td style={{ fontWeight: 500 }}>{d.BRAND_NAME || d.brand_name || '—'}</td>
                        <td style={{ color: 'var(--text-muted)' }}>{d.GENERIC_NAME || d.generic_name || '—'}</td>
                        <td>{d.CATEGORY || d.category || '—'}</td>
                        <td style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                          {updatedAt ? new Date(updatedAt).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'}
                        </td>
                        <td>
                          <div style={{ display: 'flex', gap: 6 }}>
                            <button
                              className="btn btn-primary btn-sm"
                              onClick={() => openDraftAnalysis(d)}
                              style={{ fontWeight: 600 }}
                            >
                              ▶ Continue
                            </button>
                            <button
                              className="btn btn-danger btn-sm"
                              onClick={() => deleteDraft(did)}
                              style={{ padding: '4px 10px' }}
                            >
                              🗑 Delete
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ======== VIEW DETAIL MODAL ======== */}

      {viewReq && (

        <div className="modal-overlay" onClick={() => setViewReq(null)}>
          <div className="modal" style={{ maxWidth: '94vw', width: '94vw', maxHeight: '85vh', display: 'flex', flexDirection: 'column', padding: 0, overflow: 'hidden' }}
            onClick={e => e.stopPropagation()}>
            <div style={{ padding: '20px 24px 16px', borderBottom: '1px solid var(--border)', background: 'var(--bg-card)', flexShrink: 0 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ fontWeight: 700, fontSize: '1.05rem' }}>
                  📋 Request #{viewReq.REQUEST_ID} — {viewReq.BRAND_NAME}
                  {viewReq.IS_EMERGENCY === 1 && <span className="badge" style={{ marginLeft: 8, background: '#fee2e2', color: '#991b1b' }}>🚨 Emergency</span>}
                </div>
                <button className="btn btn-ghost btn-sm" onClick={() => setViewReq(null)}>✕</button>
              </div>
            </div>
            <div style={{ overflowY: 'auto', flex: 1, padding: '20px 24px' }}>
              {(() => {
                const isOrderStage = viewReq?.STATUS === 'APPROVED_PENDING_ORDER' || viewReq?.STATUS === 'EMERGENCY_APPROVED';
                if (isOrderStage) {
                  if (existingAlts.length === 0) {
                    return (
                      <div style={{ textAlign: 'center', padding: '30px 0', color: 'var(--text-subtle)' }}>
                        Final approved drug details are not available yet.
                      </div>
                    );
                  }

                  const sel = existingAlts[0];
                  const drug = sel?.data || sel;

                  if (!drug || sel?.error || (sel && Object.keys(sel).length === 0)) {
                    return (
                      <div style={{ textAlign: 'center', padding: '30px 0', color: 'var(--text-subtle)' }}>
                        Final approved drug details are not available yet.
                      </div>
                    );
                  }

                  const reasons = Array.isArray(drug.dtc_selection_reasons)
                    ? drug.dtc_selection_reasons
                    : [];

                  return (
                    <div>
                      {/* ── Final DTC Approved Drug Card ── */}
                      <div style={{
                        background: 'linear-gradient(135deg,#f0fdf4,#eff6ff)',
                        border: '2px solid #16a34a',
                        borderRadius: 12,
                        padding: '20px 24px',
                        boxShadow: '0 4px 12px rgba(22,163,74,0.1)',
                        marginBottom: 16
                      }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                          <span style={{ fontSize: '1.2rem' }}>🏆</span>
                          <span style={{ fontWeight: 800, fontSize: '1.1rem', color: '#166534' }}>Final DTC Approved Drug</span>
                          <span style={{ fontSize: '0.72rem', background: '#dcfce7', color: '#166534', borderRadius: 20, padding: '2px 10px', fontWeight: 600 }}>
                            {drug.dtc_selected_category || 'Formulary'}
                          </span>
                        </div>

                        <div style={{ fontWeight: 800, fontSize: '1.2rem', color: '#0f172a', marginBottom: 12 }}>💊 {drug.final_brand_name || '—'}</div>

                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: '12px 24px', marginBottom: 16 }}>
                          {[
                            ['Generic Name', drug.final_generic_name],
                            ['Manufacturer', drug.final_manufacturer],
                            ['Marketer', drug.final_marketer],
                            ['Pack', drug.final_pack],
                            ['MRP', drug.final_mrp ? `₹${drug.final_mrp}` : '—'],
                            ['Rate', drug.final_rate ? `₹${drug.final_rate}` : '—'],
                            ['Net Rate', drug.final_net_rate ? `₹${drug.final_net_rate}` : '—'],
                            ['Profit Margin', drug.final_profit_margin ? `${drug.final_profit_margin}%` : '—'],
                            ['Absolute Margin', drug.final_absolute_margin ? `₹${drug.final_absolute_margin}` : '—'],
                            ['Scheme', (drug.final_scheme_qty || drug.final_scheme_offer) ? `${drug.final_scheme_qty} + ${drug.final_scheme_offer}` : '—'],
                          ].map(([label, val]) => (
                            <div key={label}>
                              <div style={{ fontSize: '0.7rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</div>
                              <div style={{ fontSize: '0.9rem', fontWeight: 600, color: '#1e293b', marginTop: 2 }}>{val || '—'}</div>
                            </div>
                          ))}
                        </div>

                        {reasons.length > 0 && (
                          <div style={{ marginBottom: 12 }}>
                            <div style={{ fontSize: '0.7rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>Selection Reasons</div>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                              {reasons.map((rsn, i) => (
                                <span key={i} style={{ fontSize: '0.75rem', background: '#e2e8f0', color: '#334155', padding: '2px 8px', borderRadius: 4, fontWeight: 500 }}>{rsn}</span>
                              ))}
                            </div>
                          </div>
                        )}

                        {drug.dtc_recommendation_notes && (
                          <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, padding: 12, marginBottom: 12 }}>
                            <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#475569', marginBottom: 4 }}>DTC Recommendation Notes</div>
                            <div style={{ fontSize: '0.85rem', color: '#334155', lineHeight: 1.5 }}>{drug.dtc_recommendation_notes}</div>
                          </div>
                        )}

                        {drug.ph_final_recommendation && (
                          <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, padding: 12, marginBottom: 12 }}>
                            <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#475569', marginBottom: 4 }}>Pharmacy Head Final Recommendation</div>
                            <div style={{ fontSize: '0.85rem', color: '#334155', lineHeight: 1.5 }}>{drug.ph_final_recommendation}</div>
                          </div>
                        )}

                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, borderTop: '1px dashed #cbd5e1', paddingTop: 12, marginTop: 12 }}>
                          <div>
                            <div style={{ fontSize: '0.7rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>DTC Reviewed By</div>
                            <div style={{ fontSize: '0.875rem', fontWeight: 600, color: '#334155', marginTop: 2 }}>{drug.dtc_reviewed_by_name || '—'}</div>
                          </div>
                          <div>
                            <div style={{ fontSize: '0.7rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>DTC Signature</div>
                            <div style={{ fontSize: '0.875rem', fontFamily: 'cursive', color: '#0284c7', marginTop: 2 }}>{drug.dtc_review_signature || '—'}</div>
                          </div>
                        </div>
                      </div>

                      {/* ── Inventory Section ── */}
                      <div style={{
                        background: invSuccess ? 'linear-gradient(135deg,#f0fdf4,#dcfce7)' : '#f8fafc',
                        border: invSuccess ? '2px solid #16a34a' : '2px dashed #cbd5e1',
                        borderRadius: 12,
                        padding: '18px 20px',
                        marginBottom: 4
                      }}>
                        <div style={{ fontWeight: 700, fontSize: '0.95rem', color: '#0f172a', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
                          🏥 Inventory Management
                          {invSuccess && (
                            <span style={{ fontSize: '0.72rem', background: '#dcfce7', color: '#166534', borderRadius: 20, padding: '2px 10px', fontWeight: 700 }}>✅ Added to HIS Inventory</span>
                          )}
                          {invAlreadyExists && !invSuccess && (
                            <span style={{ fontSize: '0.72rem', background: '#fef3c7', color: '#92400e', borderRadius: 20, padding: '2px 10px', fontWeight: 700 }}>⚠ Already Exists in Inventory</span>
                          )}
                        </div>

                        {invSuccess ? (
                          <div style={{ fontSize: '0.85rem', color: '#166534', display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span style={{ fontSize: '1.3rem' }}>✔</span>
                            <div>
                              <div style={{ fontWeight: 700 }}>Already Added to HIS Inventory</div>
                              {viewReq?.INVENTORY_ITEM_NAME && (
                                <div style={{ fontSize: '0.78rem', color: '#15803d', marginTop: 2 }}>Item: {viewReq.INVENTORY_ITEM_NAME}</div>
                              )}
                            </div>
                          </div>
                        ) : (
                          <>
                            <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', userSelect: 'none', marginBottom: 12 }}>
                              <input
                                type="checkbox"
                                checked={invNewItem}
                                onChange={e => { setInvNewItem(e.target.checked); setInvErr(''); setInvAlreadyExists(false); }}
                                style={{ width: 18, height: 18, accentColor: '#16a34a', cursor: 'pointer' }}
                              />
                              <span style={{ fontWeight: 600, color: '#1e293b', fontSize: '0.9rem' }}>This is a New Inventory Item</span>
                            </label>

                            <button
                              disabled={!invNewItem}
                              onClick={() => prefillInvForm(drug)}
                              style={{
                                display: 'inline-flex', alignItems: 'center', gap: 6,
                                padding: '8px 18px', borderRadius: 8, border: 'none',
                                fontWeight: 700, fontSize: '0.875rem', cursor: invNewItem ? 'pointer' : 'not-allowed',
                                background: invNewItem ? 'linear-gradient(135deg,#16a34a,#15803d)' : '#e2e8f0',
                                color: invNewItem ? '#fff' : '#94a3b8',
                                transition: 'all 0.2s',
                                boxShadow: invNewItem ? '0 2px 8px rgba(22,163,74,0.3)' : 'none'
                              }}
                            >
                              ➕ Add Details to Inventory
                            </button>

                            {invAlreadyExists && (
                              <div style={{ marginTop: 10, padding: '8px 12px', background: '#fef3c7', border: '1px solid #f59e0b', borderRadius: 8, fontSize: '0.82rem', color: '#92400e', fontWeight: 600 }}>
                                ⚠ {invErr}
                              </div>
                            )}
                          </>
                        )}
                      </div>

                      {/* ── Inventory Form Modal (inline overlay) ── */}
                      {invModalOpen && (
                        <div style={{
                          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)',
                          zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center',
                          padding: 16
                        }} onClick={() => setInvModalOpen(false)}>
                          <div style={{
                            background: '#fff', borderRadius: 16, width: '100%', maxWidth: 780,
                            boxShadow: '0 20px 60px rgba(0,0,0,0.25)', overflow: 'hidden'
                          }} onClick={e => e.stopPropagation()}>
                            {/* Modal Header */}
                            <div style={{ background: 'linear-gradient(135deg,#1e3a5f,#0ea5e9)', padding: '18px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                              <div>
                                <div style={{ color: '#fff', fontWeight: 800, fontSize: '1.05rem' }}>🏥 Add New Drug to HIS Inventory</div>
                                <div style={{ color: '#bae6fd', fontSize: '0.78rem', marginTop: 3 }}>Prefilled from Final DTC Recommendation — Edit before saving</div>
                              </div>
                              <button onClick={() => setInvModalOpen(false)} style={{ background: 'rgba(255,255,255,0.15)', border: 'none', color: '#fff', borderRadius: 8, width: 32, height: 32, cursor: 'pointer', fontSize: '1rem', fontWeight: 700 }}>✕</button>
                            </div>

                            {/* Modal Body */}
                            <div style={{ padding: '20px 24px', maxHeight: '65vh', overflowY: 'auto' }}>
                              {[['brandName', 'Brand Name *', 'e.g. DOLO 650 Tab.'],
                              ['genericName', 'Generic Name *', 'e.g. PARACETAMOL'],
                              ['manufacturerName', 'Manufacturer', 'e.g. Micro Labs Ltd'],
                              ['marketerName', 'Marketer', 'e.g. Micro Labs'],
                              ['mrp', 'MRP (₹)', 'e.g. 30.00'],
                              ['rate', 'Purchase Rate (₹)', 'e.g. 25.00'],
                              ['strength', 'Strength', 'e.g. 650mg'],
                              ].map(([field, label, ph]) => (
                                <div key={field} style={{ marginBottom: 14 }}>
                                  <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 5 }}>{label}</label>
                                  <input
                                    type={(field === 'mrp' || field === 'rate') ? 'number' : 'text'}
                                    step={(field === 'mrp' || field === 'rate') ? '0.01' : undefined}
                                    value={invForm[field]}
                                    onChange={e => setInvForm(f => ({ ...f, [field]: e.target.value }))}
                                    placeholder={ph}
                                    style={{
                                      width: '100%', padding: '9px 12px', borderRadius: 8,
                                      border: '1.5px solid #e2e8f0', fontSize: '0.9rem',
                                      outline: 'none', boxSizing: 'border-box',
                                      transition: 'border-color 0.15s'
                                    }}
                                    onFocus={e => e.target.style.borderColor = '#0ea5e9'}
                                    onBlur={e => e.target.style.borderColor = '#e2e8f0'}
                                  />
                                </div>
                              ))}

                              {invErr && !invAlreadyExists && (
                                <div style={{ padding: '8px 12px', background: '#fee2e2', border: '1px solid #fca5a5', borderRadius: 8, fontSize: '0.82rem', color: '#991b1b', fontWeight: 600 }}>
                                  ❌ {invErr}
                                </div>
                              )}
                              {invAlreadyExists && (
                                <div style={{ padding: '8px 12px', background: '#fef3c7', border: '1px solid #f59e0b', borderRadius: 8, fontSize: '0.82rem', color: '#92400e', fontWeight: 600 }}>
                                  ⚠ {invErr}
                                </div>
                              )}
                            </div>

                            {/* Modal Footer */}
                            <div style={{ padding: '14px 24px', borderTop: '1px solid #e2e8f0', display: 'flex', justifyContent: 'flex-end', gap: 10, background: '#f8fafc' }}>
                              <button onClick={() => setInvModalOpen(false)} style={{ padding: '8px 18px', borderRadius: 8, border: '1.5px solid #e2e8f0', background: '#fff', cursor: 'pointer', fontWeight: 600 }}>Cancel</button>
                              <button
                                onClick={submitInventory}
                                disabled={invSubmitting}
                                style={{
                                  padding: '8px 22px', borderRadius: 8, border: 'none',
                                  background: invSubmitting ? '#94a3b8' : 'linear-gradient(135deg,#16a34a,#15803d)',
                                  color: '#fff', fontWeight: 700, cursor: invSubmitting ? 'not-allowed' : 'pointer',
                                  boxShadow: '0 2px 8px rgba(22,163,74,0.3)'
                                }}
                              >
                                {invSubmitting ? '⏳ Saving…' : '💾 Save to Inventory'}
                              </button>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                }

                return (
                  <>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem', marginBottom: 16 }}>
                      <tbody>
                        {[['Brand Name', 'BRAND_NAME'], ['Generic Name', 'GENERIC_NAME'], ['Dose / Strength', 'DOSE_STRENGTH'],
                        ['Dosage Form', 'DOSAGE_FORM'], ['Category', 'CATEGORY'], ['Manufacturer', 'MANUFACTURER'],
                        ['Marketer', 'MARKETER'],
                        ['Expected Patients/Month', 'EXPECTED_PATIENTS_PM'],
                        ['Medicine Quantity', 'MEDICINE_QUANTITY'],
                        ].map(([l, k]) => (
                          <tr key={k} style={{ borderBottom: '1px solid var(--border)' }}>
                            <td style={{ padding: '8px 4px', width: '35%', color: 'var(--text-muted)' }}>{l}</td>
                            <td style={{ padding: '8px 4px', fontWeight: 500 }}>{viewReq[k] || '—'} </td>
                          </tr>
                        ))}
                        <tr style={{ borderBottom: '1px solid var(--border)' }}>
                          <td style={{ padding: '8px 4px', width: '35%', color: 'var(--text-muted)' }}>Creator</td>
                          <td style={{ padding: '8px 4px', fontWeight: 500 }}>
                            {viewReq.DOCTOR_NAME} ({viewReq.CREATED_BY_ROLE || 'Doctor'} - {viewReq.DOCTOR_DEPT || ''})
                          </td>
                        </tr>
                        <tr style={{ borderBottom: '1px solid var(--border)' }}>
                          <td style={{ padding: '8px 12px', color: 'var(--text-muted)', fontWeight: 600, fontSize: '0.8rem', verticalAlign: 'top' }}>Clinical Justification</td>
                          <td style={{ padding: '8px 12px', color: 'var(--text)', lineHeight: 1.6 }}>{viewReq.CLINICAL_JUSTIFICATION}</td>
                        </tr>
                      </tbody>
                    </table>
                    {existingAlts.length > 0 && (
                      <div>
                        <div style={{ fontWeight: 700, marginBottom: 12, color: 'var(--text)' }}>📊 Previously Submitted Alternatives</div>
                        <AlternativesTable alts={existingAlts} />
                      </div>
                    )}
                  </>
                );
              })()}
            </div>
            <div className="modal-footer" style={{ borderTop: '1px solid var(--border)', margin: 0, padding: '14px 24px' }}>
              <button className="btn btn-ghost" onClick={() => setViewReq(null)}>Close</button>
            </div>
          </div>
        </div>
      )}

      {/* ======== QUOTATION / ANALYSIS MODAL ======== */}
      {analysisReq && (
        <div className="modal-overlay" onClick={closeAnalysis}>
          <div className="modal"
            style={{ maxWidth: '95vw', width: '95vw', maxHeight: '92vh', display: 'flex', flexDirection: 'column', padding: 0, overflow: 'hidden' }}
            onClick={e => e.stopPropagation()}>

            {/* Header */}
            <div style={{ padding: '18px 24px 14px', borderBottom: '1px solid var(--border)', background: 'var(--bg-card)', flexShrink: 0 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: '1.05rem' }}>
                    {isCorrectionMode ? '🔁 Correction Mode — ' : '📋 Submit Quotation Analysis — '}#{analysisReq.REQUEST_ID}
                  </div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: 3 }}>
                    <span style={{ background: 'var(--info-light)', color: 'var(--info)', borderRadius: 4, padding: '1px 8px', fontWeight: 600 }}>
                      {analysisReq.BRAND_NAME}
                    </span>
                    &nbsp;·&nbsp;{analysisReq.GENERIC_NAME}
                  </div>
                </div>
                <button className="btn btn-ghost btn-sm" onClick={closeAnalysis}>✕</button>
              </div>
              {/* Correction mode banner showing PH revert reason */}
              {isCorrectionMode && analysisReq.REVERT_REMARKS && (
                <div style={{
                  marginTop: 12, padding: '10px 14px',
                  background: '#fef3c7', border: '1px solid #f59e0b',
                  borderLeft: '4px solid #d97706', borderRadius: 8,
                }}>
                  <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#92400e', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>
                    ↩ Pharmacy Head Revert Reason:
                  </div>
                  <div style={{ fontSize: '0.83rem', color: '#78350f', whiteSpace: 'pre-line', lineHeight: 1.6 }}>
                    {analysisReq.REVERT_REMARKS}
                  </div>
                </div>
              )}
            </div>

            {/* Body */}
            <div style={{ overflowY: 'auto', flex: 1, padding: '20px 24px', background: 'var(--bg)' }}>

              {/* Comparison Type */}
              <div className="card" style={{ marginBottom: 20, padding: 16 }}>
                <div style={{ fontWeight: 600, marginBottom: 10, fontSize: '0.9rem' }}>📂 Comparison Sheet Type</div>
                <div className="toggle-group">
                  <button className={`toggle-btn ${compType === 'new_generic' ? 'active' : ''}`}
                    onClick={() => setCompType('new_generic')}>📄 New Generic</button>
                  <button className={`toggle-btn ${compType === 'existing_generic' ? 'active' : ''}`}
                    onClick={() => setCompType('existing_generic')}>📁 Existing Generic</button>
                </div>
                <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: 8 }}>
                  {compType === 'new_generic'
                    ? 'Use when the generic is completely new to the formulary. Fill pricing and margin fields.'
                    : 'Use when the generic already exists in the formulary. Include comparison with existing drug.'}
                </div>
              </div>

              {/* ── MASTER: Existing Generic Reference (shown ONCE, above alternatives) ── */}
              {compType === 'existing_generic' && (
                <div className="card" style={{ marginBottom: 20, padding: 0, border: '2px solid #0ea5e9', borderRadius: 12, overflow: 'hidden' }}>
                  {/* Header */}
                  <div style={{ background: 'linear-gradient(90deg,#0ea5e9,#6366f1)', padding: '12px 20px', display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ fontSize: '1.1rem' }}>📋</span>
                    <div>
                      <div style={{ fontWeight: 700, color: '#fff', fontSize: '0.95rem' }}>Existing Generic Drug — Reference Details</div>
                      <div style={{ fontSize: '0.72rem', color: 'rgba(255,255,255,0.8)', marginTop: 2 }}>Enter existing formulary drug details once. These will be used as the comparison baseline for all alternatives below.</div>
                    </div>
                  </div>
                  <div style={{ padding: '16px 20px' }}>

                    {/* Row A: Identity */}
                    <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#0ea5e9', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 8 }}>Drug Identity</div>
                    <div className="form-grid" style={{ marginBottom: 14 }}>
                      <div className="form-group">
                        <label className="form-label">Existing Brand Name</label>
                        <input className="form-input" value={existingGenericData.existing_brand_name} onChange={e => updateExisting('existing_brand_name', e.target.value)} placeholder="Current formulary brand" />
                      </div>
                      <div className="form-group">
                        <label className="form-label">Manufacturer</label>
                        <input className="form-input" value={existingGenericData.existing_manufacturer} onChange={e => updateExisting('existing_manufacturer', e.target.value)} placeholder="Existing manufacturer" />
                      </div>
                      <div className="form-group">
                        <label className="form-label">Marketer</label>
                        <input className="form-input" value={existingGenericData.existing_marketer} onChange={e => updateExisting('existing_marketer', e.target.value)} placeholder="Existing marketer" />
                      </div>
                      <div className="form-group">
                        <label className="form-label">Pack / Pack Size</label>
                        <input className="form-input" value={existingGenericData.existing_pack} onChange={e => updateExisting('existing_pack', e.target.value)} placeholder="e.g. 10×10 Blister" />
                      </div>
                      <div className="form-group">
                        <label className="form-label">Scheme</label>
                        <input className="form-input" value={existingGenericData.existing_scheme} onChange={e => updateExisting('existing_scheme', e.target.value)} placeholder="e.g. 10+2, 5% off" />
                      </div>
                    </div>

                    {/* Row B: Pricing */}
                    <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#059669', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 8 }}>Pricing</div>
                    <div className="form-grid" style={{ marginBottom: 14 }}>
                      <div className="form-group">
                        <label className="form-label">MRP (₹)</label>
                        <input className="form-input" type="number" value={existingGenericData.existing_mrp} onChange={e => updateExisting('existing_mrp', e.target.value)} placeholder="0.00" />
                      </div>
                      <div className="form-group">
                        <label className="form-label">Rate (₹)</label>
                        <input className="form-input" type="number" value={existingGenericData.existing_rate} onChange={e => updateExisting('existing_rate', e.target.value)} placeholder="0.00" />
                      </div>
                      <div className="form-group">
                        <label className="form-label">Quantity</label>
                        <input className="form-input" type="number" value={existingGenericData.existing_qty} onChange={e => updateExisting('existing_qty', e.target.value)} placeholder="0" />
                      </div>
                      <div className="form-group">
                        <label className="form-label">Offer</label>
                        <input className="form-input" type="number" value={existingGenericData.existing_offer} onChange={e => updateExisting('existing_offer', e.target.value)} placeholder="0" />
                      </div>
                      <div className="form-group">
                        <label className="form-label">Net Rate (₹)</label>
                        <input className="form-input" type="number" value={existingGenericData.existing_net_rate} onChange={e => updateExisting('existing_net_rate', e.target.value)} placeholder="0.00" />
                      </div>
                      <div className="form-group">
                        <label className="form-label">Negotiated Rate (₹)</label>
                        <input className="form-input" type="number" value={existingGenericData.existing_negotiated_rate} onChange={e => updateExisting('existing_negotiated_rate', e.target.value)} placeholder="0.00" />
                      </div>
                    </div>

                    {/* Row C: Margins */}
                    <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#7c3aed', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 8 }}>Margins</div>
                    <div className="form-grid" style={{ marginBottom: 14 }}>
                      <div className="form-group">
                        <label className="form-label">Absolute Margin (₹)</label>
                        <input className="form-input" type="number" value={existingGenericData.existing_absolute_margin} onChange={e => updateExisting('existing_absolute_margin', e.target.value)} placeholder="0.00" />
                      </div>
                      <div className="form-group">
                        <label className="form-label">Markup Margin (₹)</label>
                        <input className="form-input" type="number" value={existingGenericData.existing_markup_margin} onChange={e => updateExisting('existing_markup_margin', e.target.value)} placeholder="0.00" />
                      </div>
                      <div className="form-group">
                        <label className="form-label">Profit Margin (%)</label>
                        <input className="form-input" type="number" value={existingGenericData.existing_profit_margin} onChange={e => updateExisting('existing_profit_margin', e.target.value)} placeholder="%" />
                      </div>
                    </div>

                    {/* Row D: Stock */}
                    <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#d97706', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 8 }}>Stock & Consumption</div>
                    <div className="form-grid" style={{ marginBottom: 14 }}>
                      <div className="form-group">
                        <label className="form-label">Present Stock</label>
                        <input className="form-input" value={existingGenericData.existing_stock} onChange={e => updateExisting('existing_stock', e.target.value)} placeholder="e.g. 500 units" />
                      </div>
                      <div className="form-group">
                        <label className="form-label">Purchase Qty</label>
                        <input className="form-input" type="number" value={existingGenericData.existing_purchase_qty} onChange={e => updateExisting('existing_purchase_qty', e.target.value)} placeholder="0" />
                      </div>
                      <div className="form-group">
                        <label className="form-label">Monthly Consumption</label>
                        <input className="form-input" type="number" value={existingGenericData.existing_monthly_consumption} onChange={e => updateExisting('existing_monthly_consumption', e.target.value)} placeholder="Avg monthly units" />
                      </div>
                    </div>

                    {/* Row E: Comparison analysis (textareas) */}
                    <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#dc2626', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 8 }}>Comparison Analysis</div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                      <div className="form-group">
                        <label className="form-label">Transaction History</label>
                        <textarea className="form-input" rows={3} value={existingGenericData.transaction_history} onChange={e => updateExisting('transaction_history', e.target.value)} placeholder="Past purchase history, supplier details, frequency…" style={{ resize: 'vertical' }} />
                      </div>
                      <div className="form-group">
                        <label className="form-label">Sales Data</label>
                        <textarea className="form-input" rows={3} value={existingGenericData.sales_data} onChange={e => updateExisting('sales_data', e.target.value)} placeholder="Monthly / quarterly sales figures…" style={{ resize: 'vertical' }} />
                      </div>
                      <div className="form-group">
                        <label className="form-label">Stock & Usage</label>
                        <textarea className="form-input" rows={3} value={existingGenericData.stock_usage} onChange={e => updateExisting('stock_usage', e.target.value)} placeholder="Stock movement, expiry details, wastage…" style={{ resize: 'vertical' }} />
                      </div>
                      <div className="form-group">
                        <label className="form-label">Margin Comparison</label>
                        <textarea className="form-input" rows={3} value={existingGenericData.margin_comparison} onChange={e => updateExisting('margin_comparison', e.target.value)} placeholder="Comparison vs new alternative margins…" style={{ resize: 'vertical' }} />
                      </div>
                      <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                        <label className="form-label">Additional Drug Details / Notes</label>
                        <textarea className="form-input" rows={2} value={existingGenericData.existing_drug_details} onChange={e => updateExisting('existing_drug_details', e.target.value)} placeholder="Any other relevant formulary details, clinical notes…" style={{ resize: 'vertical' }} />
                      </div>
                    </div>

                  </div>
                </div>
              )}

              {/* Alternatives Form */}
              <div style={{ marginBottom: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                  <div style={{ fontWeight: 700, fontSize: '0.95rem' }}>
                    💊 Drug Alternatives
                    <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)', fontWeight: 400, marginLeft: 8 }}>
                      ({alternatives.length} added, minimum 3 required)
                    </span>
                  </div>
                  <button className="btn btn-ghost btn-sm" onClick={addAlt}>+ Add Alternative</button>
                </div>

                {alternatives.map((alt, i) => (
                  <div key={i} className="card" style={{ marginBottom: 14, padding: 16, border: '1px solid var(--border)', position: 'relative' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                      <div style={{ fontWeight: 600, fontSize: '0.85rem', color: 'var(--primary)' }}>

                        {i == 0 ? `Doctor Recommended:${i + 1}` : `Alternative:${i + 1}`}
                      </div>
                      {alternatives.length > 1 && (
                        <button className="btn btn-danger btn-sm" style={{ padding: '3px 8px' }} onClick={() => removeAlt(i)}>✕ Remove</button>
                      )}
                    </div>

                    {/* Row 1: Basic info */}
                    <div className="form-grid" style={{ marginBottom: 10 }}>
                      <div className="form-group">
                        <label className="form-label">Brand Name <span className="req">*</span></label>
                        <input className="form-input" value={alt.brand_name} onChange={e => updateAlt(i, 'brand_name', e.target.value)} placeholder="e.g. Augmentin 625mg" />
                        {i == 0 ? <input type="hidden" value="doctor" name="doc_ID" /> : null}
                      </div>
                      <div className="form-group">
                        <label className="form-label">Manufacturer <span className="req">*</span></label>
                        <input className="form-input" value={alt.manufacturer} onChange={e => updateAlt(i, 'manufacturer', e.target.value)} placeholder="e.g. GSK India" />
                      </div>
                      <div className="form-group">
                        <label className="form-label">Marketer</label>
                        <input className="form-input" value={alt.marketer} onChange={e => updateAlt(i, 'marketer', e.target.value)} placeholder="Marketer / Distributor" />
                      </div>
                      <div className="form-group">
                        <label className="form-label">MRP (₹)</label>
                        <input className="form-input" type="number" value={alt.mrp} onChange={e => {
                          updateAlternativeCalculations(i, 'mrp', e.target.value);
                        }} placeholder="0.00" />
                      </div>
                      <div className="form-group">
                        <label className="form-label">Rate(₹)</label>
                        <input
                          className="form-input"
                          type="number"
                          value={alt.rate}
                          onChange={e => {
                            updateAlternativeCalculations(i, 'rate', e.target.value);
                          }}
                          placeholder="0.00"
                        />
                      </div>

                      <div className="form-group">
                        <label className="form-label">Quantity</label>
                        <input
                          className="form-input"
                          type="number"
                          value={alt.qty}
                          onChange={e => {
                            updateAlternativeCalculations(i, 'qty', e.target.value);
                          }}
                          placeholder="0.00"
                        />
                      </div>
                      <div className="form-group">
                        <label className="form-label">Offer</label>
                        <input className="form-input" type="number" value={alt.offer} onChange={e => {
                          updateAlternativeCalculations(i, 'offer', e.target.value);
                        }} placeholder="0.00" />
                      </div>
                      <div className="form-group">
                        <label className="form-label">Absolute Margin (₹)</label>
                        <input className="form-input" type="number" value={alt.margin} onChange={e => updateAlt(i, 'margin', e.target.value)} placeholder="0.00" />
                      </div>
                      <div className="form-group">
                        <label className="form-label">MarkUp Margin (₹)</label>
                        <input className="form-input" type="number" value={alt.markupmargin} onChange={e => updateAlt(i, 'markupmargin', e.target.value)} placeholder="0.00" />
                      </div>
                      <div className="form-group">
                        <label className="form-label">Net Rate (₹)</label>
                        <input className="form-input" type="number" value={alt.net_rate} onChange={e => updateAlt(i, 'net_rate', e.target.value)} placeholder="0.00" />
                      </div>
                      <div className="form-group">
                        <label className="form-label">Stock</label>
                        <input className="form-input" value={alt.stock} onChange={e => updateAlt(i, 'stock', e.target.value)} placeholder="e.g. In Stock / Limited" />
                      </div>
                      <div className="form-group">
                        <label className="form-label">Negotiated Rate(₹)</label>
                        <input className="form-input" type="number" value={alt.negorate} onChange={e => updateAlt(i, 'negorate', e.target.value)} placeholder="Units" />
                      </div>
                      <div className="form-group">
                        <label className="form-label">Profit Margin (%)</label>
                        <input className="form-input" type="number" value={alt.profit_margin} onChange={e => updateAlt(i, 'profit_margin', e.target.value)} placeholder="%" />
                      </div>
                      <div className="form-group">
                        <label className="form-label">Purchase Qty</label>
                        <input
                          className="form-input"
                          type="number"
                          value={alt.purchase_qty}
                          onChange={e => updateAlt(i, 'purchase_qty', e.target.value)}
                          placeholder="Units"
                        />
                      </div>
                      <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                        <label className="form-label">Remarks (for this alternative)</label>
                        <textarea
                          className="form-input"
                          value={alt.remark}
                          onChange={e => updateAlt(i, 'remark', e.target.value)}
                          placeholder="Pricing notes, availability, suitability, or any specific remarks for this alternative..."
                          rows={2}
                          style={{ resize: 'vertical', minHeight: 56 }}
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Pharmacist Remarks */}
              <div className="card" style={{ padding: 16 }}>
                <div className="form-group">
                  <label className="form-label">Pharmacist Analysis Remarks</label>
                  <textarea
                    className="form-textarea"
                    value={pharmRemarks}
                    onChange={e => setPharmRemarks(e.target.value)}
                    placeholder="Add your clinical/pricing analysis observations, recommendations…"
                    rows={3}
                  />
                </div>
              </div>

              {altErr && (
                <div className="alert alert-error" style={{ marginTop: 12 }}>{altErr}</div>
              )}
            </div>

            {/* Draft resume indicator strip */}
            {draftSaved && draftId && (
              <div style={{
                padding: '8px 24px', background: 'linear-gradient(90deg,#f0fdf4,#eff6ff)',
                borderTop: '1px solid #bbf7d0', display: 'flex', alignItems: 'center', gap: 8,
                fontSize: '0.8rem', color: '#15803d', flexShrink: 0,
              }}>
                <span>✅</span>
                <strong>Draft saved</strong> — your progress is safe.
                <span style={{ color: '#64748b', marginLeft: 4 }}>Name: {draftName || 'Auto-named'}</span>
              </div>
            )}

            {/* Footer */}
            <div style={{ padding: '14px 24px', borderTop: '1px solid var(--border)', background: 'var(--bg-card)', flexShrink: 0 }}>
              {/* Draft name row */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                <span style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>📝 Draft Name:</span>
                <input
                  className="form-input"
                  style={{ flex: 1, fontSize: '0.82rem', padding: '5px 10px', height: 32 }}
                  value={draftName}
                  onChange={e => setDraftName(e.target.value)}
                  placeholder={`Auto: first brand name entered`}
                />
                <button
                  onClick={saveDraft}
                  disabled={savingDraft || submitting}
                  style={{
                    padding: '6px 16px', borderRadius: 8, border: '1.5px solid #0ea5e9',
                    background: savingDraft ? '#f1f5f9' : '#f0f9ff',
                    color: '#0369a1', fontWeight: 700, fontSize: '0.82rem',
                    cursor: savingDraft ? 'wait' : 'pointer',
                    whiteSpace: 'nowrap', flexShrink: 0,
                    transition: 'all 0.15s',
                  }}
                >
                  {savingDraft ? '⏳ Saving…' : '💾 Save Draft'}
                </button>
              </div>
              {/* Action row */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                  {alternatives.filter(a => a.brand_name.trim()).length} / {alternatives.length} alternatives filled
                </div>
                <div style={{ display: 'flex', gap: 10 }}>
                  <button className="btn btn-ghost" onClick={closeAnalysis} disabled={submitting}>Cancel</button>
                  <button
                    className="btn btn-primary"
                    onClick={() => setShowComparisonSheet(true)}
                    disabled={submitting}
                    style={{ background: 'linear-gradient(135deg,#1e3a5f,#0ea5e9)', border: 'none' }}
                  >
                    📊 View Comparison Sheet
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Comparison Sheet Overlay (Pharmacist edit) ── */}
      {showComparisonSheet && analysisReq && (
        <ComparisonSheet
          mode="pharmacist"
          compType={compType}
          alternatives={alternatives}
          existingGenericData={existingGenericData}
          existingDetails={existingDetails}
          onExistingDetailsChange={setExistingDetails}
          pharmRemarks={pharmRemarks}
          requestInfo={{ ...analysisReq, PREPARED_BY: currentUser.USERNAME || currentUser.NAME }}
          isCorrectionMode={isCorrectionMode}
          onAlternativesChange={setAlternatives}
          onExistingChange={setExistingGenericData}
          onRemarksChange={setPharmRemarks}
          onSubmit={submitAlternatives}
          submitting={submitting}
          altErr={altErr}
          correctionErr={altErr}
          onAddAlt={addAlt}
          onBack={() => { setShowComparisonSheet(false); if (isCorrectionMode) setView('corrections'); }}
        />
      )}

    </div>
  );
}

// ── Reusable alternatives display table ──
export function AlternativesTable({ alts }) {
  if (!alts || alts.length === 0) return (
    <div style={{ textAlign: 'center', padding: 30, color: 'var(--text-subtle)' }}>No alternatives submitted yet.</div>
  );

  // ── Normalise field access (DB returns UPPER_CASE, local state uses lower_case) ──
  const g = (a, upper, lower) => { const v = a[upper] ?? a[lower]; return (v !== undefined && v !== null) ? v : null; };
  const fmt = (v, prefix = '') => (v !== null && v !== undefined && v !== '') ? `${prefix}${v}` : '—';
  const fmtPct = v => (v !== null && v !== undefined && v !== '') ? `${v}%` : '—';

  // ── Separate doctor-recommended from the rest ──
  const docRec = alts.find(a => (a.REFER || a.refer || '').toString().toLowerCase() === 'doctor_recommended') || alts[0];
  const others = alts.filter(a => a !== docRec);
  const ordered = [docRec, ...others]; // doctor-rec always first column

  const isExisting = (alts[0]?.COMPARISON_TYPE || alts[0]?.comparison_type) === 'existing_generic';

  // ── Field definitions: [label, accessor fn] ──
  const FIELDS = [
    ['Brand Name', a => fmt(g(a, 'BRAND_NAME', 'brand_name'))],
    ['Manufacturer', a => fmt(g(a, 'MANUFACTURER', 'manufacturer'))],
    ['Marketer', a => fmt(g(a, 'MARKETER', 'marketer'))],
    ['MRP (₹)', a => fmt(g(a, 'MRP', 'mrp'), '₹')],
    ['Rate (₹)', a => fmt(g(a, 'RATE', 'rate'), '₹')],
    ['Qty', a => fmt(g(a, 'QTY', 'qty'))],
    ['Offer', a => fmt(g(a, 'OFFER', 'offer'))],
    ['Net Rate (₹)', a => fmt(g(a, 'NET_RATE', 'net_rate'), '₹')],
    ['Negotiated Rate (₹)', a => fmt(g(a, 'NEGOTIATED_RATE', 'negotiated_rate') ?? g(a, 'NEGOTIATED_RATE', 'negorate'), '₹')],
    ['Absolute Margin (₹)', a => fmt(g(a, 'ABSOLUTE_MARGIN', 'absolute_margin') ?? g(a, 'MARGIN', 'margin'), '₹')],
    ['Markup Margin', a => fmtPct(g(a, 'MARKUP_MARGIN', 'markup_margin') ?? g(a, 'MARKUP_MARGIN', 'markupmargin'))],
    ['Profit Margin', a => fmtPct(g(a, 'PROFIT_MARGIN', 'profit_margin'))],
    ['Stock', a => fmt(g(a, 'STOCK', 'stock'))],
    ['Purchase Qty', a => fmt(g(a, 'PURCHASE_QUANTITY', 'purchase_quantity') ?? g(a, 'PURCHASE_QTY', 'purchase_qty'))],
    ...(isExisting ? [
      ['Existing Drug Details', a => fmt(g(a, 'EXISTING_DRUG_DETAILS', 'existing_drug_details'))],
      ['Transaction History', a => fmt(g(a, 'TRANSACTION_HISTORY', 'transaction_history'))],
      ['Margin Comparison', a => fmt(g(a, 'MARGIN_COMPARISON', 'margin_comparison'))],
      ['Sales Data', a => fmt(g(a, 'SALES_DATA', 'sales_data'))],
      ['Stock Usage', a => fmt(g(a, 'STOCK_USAGE', 'stock_usage'))],
    ] : []),
    ['Remark', a => fmt(g(a, 'REMARK', 'remark'))],
  ];

  const cellBase = {
    padding: '7px 12px',
    fontSize: '0.82rem',
    borderRight: '1px solid #e2e8f0',
    borderBottom: '1px solid #e2e8f0',
    verticalAlign: 'top',
    lineHeight: 1.45,
  };

  const thBase = {
    padding: '10px 12px',
    fontSize: '0.78rem',
    fontWeight: 700,
    borderRight: '1px solid #cbd5e1',
    borderBottom: '2px solid #94a3b8',
    whiteSpace: 'nowrap',
    textAlign: 'center',
    letterSpacing: '0.02em',
  };

  return (
    <div>
      {/* ── Legend ── */}
      <div style={{ display: 'flex', gap: 16, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.8rem', fontWeight: 600 }}>
          <span style={{ width: 14, height: 14, background: '#dcfce7', border: '2px solid #16a34a', borderRadius: 3, display: 'inline-block' }} />
          Doctor Recommended
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.8rem', color: 'var(--text-muted)' }}>
          <span style={{ width: 14, height: 14, background: '#f0f9ff', border: '1px solid #bae6fd', borderRadius: 3, display: 'inline-block' }} />
          Other Alternatives
        </span>
        <span style={{ marginLeft: 'auto', fontSize: '0.75rem', color: 'var(--text-subtle)' }}>
          {ordered.length} alternative{ordered.length !== 1 ? 's' : ''} compared
        </span>
      </div>

      {/* ── Comparison Matrix ── */}
      <div style={{ overflowX: 'auto', borderRadius: 10, border: '1px solid #e2e8f0', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
        <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: ordered.length * 160 + 180, tableLayout: 'fixed' }}>
          <colgroup>
            <col style={{ width: 170, minWidth: 170 }} />
            {ordered.map((_, ci) => (
              <col key={ci} style={{ minWidth: 150 }} />
            ))}
          </colgroup>

          {/* ── Column headers ── */}
          <thead>
            <tr>
              <th style={{ ...thBase, background: '#1e293b', color: '#f1f5f9', textAlign: 'left', borderRight: '2px solid #334155', borderBottom: '2px solid #334155', position: 'sticky', left: 0, zIndex: 3 }}>
                Field
              </th>
              {ordered.map((a, ci) => {
                const isDoc = a === docRec;
                return (
                  <th key={ci} style={{
                    ...thBase,
                    background: isDoc ? '#15803d' : '#1e40af',
                    color: '#fff',
                    borderRight: isDoc ? '3px solid #14532d' : '1px solid #1e3a8a',
                    borderBottom: isDoc ? '3px solid #14532d' : '2px solid #1e3a8a',
                    minWidth: 150,
                  }}>
                    {isDoc && (
                      <div style={{ fontSize: '0.65rem', fontWeight: 700, background: '#bbf7d0', color: '#14532d', borderRadius: 4, padding: '1px 6px', marginBottom: 4, display: 'inline-block', letterSpacing: '0.04em' }}>
                        ★ DOCTOR RECOMMENDED
                      </div>
                    )}
                    <div>{g(a, 'BRAND_NAME', 'brand_name') || `Alt ${ci + 1}`}</div>
                    {!isDoc && <div style={{ fontWeight: 400, fontSize: '0.7rem', opacity: 0.8, marginTop: 2 }}>Alternative {ci + 1}</div>}
                  </th>
                );
              })}
            </tr>
          </thead>

          {/* ── Data rows ── */}
          <tbody>
            {FIELDS.map(([label, accessor], ri) => {
              const isEvenRow = ri % 2 === 0;
              const rowBg = isEvenRow ? '#ffffff' : '#f8fafc';
              return (
                <tr key={label}>
                  {/* Sticky field label column */}
                  <td style={{
                    ...cellBase,
                    background: isEvenRow ? '#f1f5f9' : '#e2e8f0',
                    fontWeight: 700,
                    fontSize: '0.78rem',
                    color: '#334155',
                    borderRight: '2px solid #94a3b8',
                    position: 'sticky',
                    left: 0,
                    zIndex: 1,
                    whiteSpace: 'nowrap',
                  }}>
                    {label}
                  </td>

                  {/* Value cells */}
                  {ordered.map((a, ci) => {
                    const isDoc = a === docRec;
                    const val = accessor(a);
                    const isEmpty = val === '—';
                    return (
                      <td key={ci} style={{
                        ...cellBase,
                        background: isDoc
                          ? (isEvenRow ? '#f0fdf4' : '#dcfce7')
                          : rowBg,
                        borderLeft: isDoc ? '3px solid #16a34a' : undefined,
                        borderRight: isDoc ? '3px solid #16a34a' : '1px solid #e2e8f0',
                        color: isEmpty ? '#94a3b8' : isDoc ? '#14532d' : '#1e293b',
                        fontWeight: isDoc && !isEmpty ? 600 : 400,
                        textAlign: 'center',
                      }}>
                        {val}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* ── Summary strip ── */}
      <div style={{ marginTop: 14, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        {ordered.map((a, ci) => {
          const isDoc = a === docRec;
          const pm = g(a, 'PROFIT_MARGIN', 'profit_margin');
          const mr = g(a, 'MRP', 'mrp');
          const nr = g(a, 'NET_RATE', 'net_rate');
          return (
            <div key={ci} style={{
              background: isDoc ? '#dcfce7' : '#f8fafc',
              border: isDoc ? '2px solid #16a34a' : '1px solid #e2e8f0',
              borderRadius: 10,
              padding: '10px 16px',
              flex: '1 1 160px',
              minWidth: 150,
            }}>
              <div style={{ fontWeight: 700, fontSize: '0.82rem', color: isDoc ? '#14532d' : '#334155', marginBottom: 4 }}>
                {isDoc ? '★ ' : ''}{g(a, 'BRAND_NAME', 'brand_name') || `Alt ${ci + 1}`}
              </div>
              <div style={{ fontSize: '0.75rem', color: '#64748b' }}>
                MRP: <strong>₹{mr ?? '—'}</strong> · Net: <strong>₹{nr ?? '—'}</strong> · Margin: <strong>{pm ? `${pm}%` : '—'}</strong>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

