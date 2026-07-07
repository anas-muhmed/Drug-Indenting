// =====================================================================
// DoctorTab.js — Drug request submission + status tracking + notifications
// =====================================================================
import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import Notifications from './Notifications';

const API = '/api';

import { ProgressBar, getStatusBadge, getRejectedLabel } from './ProgressBar';


const EMPTY_FORM = {
  request_source_type: '', formulary_request_type: '',
  med_rep_name: '', med_rep_email: '', med_rep_phone: '',
  request_type: '', category: '',
  brand_name: '', generic_name: '', dose_strength: '', dosage_form: '',
  manufacturer: '', marketer: '', existing_brands: '',
  selected_existing_brands: [],
  clinical_justification: '', expected_patients_pm: '', medicine_quantity: '',
  cost_reduction_benefit: false, ai_content: '',
  // Emergency patient detail fields
  patient_mrno: '', patient_name: '', patient_age: '',
  patient_diagnosis: '', patient_department: '', patient_visit_id: '',
};

// ── Existing-brands serialization helpers ────────────────────────────────────
const serializeExistingBrands = (list) => {
  if (!list || list.length === 0) return '';
  const items = list.map(item => {
    const parts = [];
    if (item.NAME) parts.push(item.NAME);
    if (item.DRUG_GEN_NAME) parts.push(item.DRUG_GEN_NAME);
    if (item.MRP) parts.push(`MRP: ${item.MRP}`);
    if (item.MANUFACTURER_NAME) parts.push(`Mfr: ${item.MANUFACTURER_NAME}`);
    if (item.MARKETTER_NAME) parts.push(`Mkt: ${item.MARKETTER_NAME}`);
    return parts.join(' — ');
  });
  let result = items.join(', ');
  if (result.length > 495) result = result.substring(0, 492) + '...';
  return result;
};

const parseExistingBrands = (str) => {
  if (!str || !str.trim()) return [];
  return str.split(/,\s*(?=[A-Z])/).map(item => {
    const parts = item.split(/\s*—\s*/);
    let name = parts[0] || '';
    let generic = parts[1] || '';
    let mrp = '', manufacturer = '', marketer = '';
    parts.slice(2).forEach(p => {
      const t = p.trim();
      if (t.startsWith('MRP:')) mrp = t.replace('MRP:', '').trim();
      else if (t.startsWith('Mfr:')) manufacturer = t.replace('Mfr:', '').trim();
      else if (t.startsWith('Mkt:')) marketer = t.replace('Mkt:', '').trim();
      else if (!manufacturer) manufacturer = t;
    });
    return { name: name.trim(), generic: generic.trim(), mrp, manufacturer, marketer };
  }).filter(item => item.name);
};

const RenderExistingBrandsTable = ({ text }) => {
  const parsed = parseExistingBrands(text);
  if (!parsed || parsed.length === 0) return null;
  return (
    <div style={{ marginTop: 16 }}>
      <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#0891b2', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>🏷️ Existing Brands on Formulary</div>
      <div style={{ border: '1px solid #bae6fd', borderRadius: 8, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
          <thead style={{ background: '#e0f2fe' }}>
            <tr>
              <th style={{ padding: '6px 10px', textAlign: 'left', color: '#0369a1', fontWeight: 700 }}>Brand</th>
              <th style={{ padding: '6px 10px', textAlign: 'left', color: '#0369a1', fontWeight: 700 }}>Generic</th>
              <th style={{ padding: '6px 10px', textAlign: 'left', color: '#0369a1', fontWeight: 700 }}>Manufacturer</th>
              <th style={{ padding: '6px 10px', textAlign: 'left', color: '#0369a1', fontWeight: 700 }}>MRP</th>
            </tr>
          </thead>
          <tbody>
            {parsed.map((item, idx) => (
              <tr key={idx} style={{ background: idx % 2 === 0 ? '#f0f9ff' : '#fff' }}>
                <td style={{ padding: '6px 10px', fontWeight: 600, color: '#0c4a6e' }}>{item.name}</td>
                <td style={{ padding: '6px 10px', color: '#0c4a6e' }}>{item.generic || '—'}</td>
                <td style={{ padding: '6px 10px', color: '#0c4a6e' }}>{item.manufacturer || '—'}</td>
                <td style={{ padding: '6px 10px', fontWeight: 600, color: '#16a34a' }}>{item.mrp ? `₹${item.mrp}` : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

const REQUIRED_FIELDS_BASE = [
  'request_source_type',
  'formulary_request_type',
  'request_type',
  'category',
  'brand_name',
  'generic_name',
  'dose_strength',
  'dosage_form',
  'manufacturer',
  'marketer',
  'clinical_justification'
];
const REQUIRED_FIELDS_REP = ['med_rep_name', 'med_rep_email', 'med_rep_phone'];

function validate(form, isEmergency = false) {
  const errs = {};

  const isPromotional =
    form.request_source_type === 'PROMOTIONAL';

  const isNonPromotional =
    form.request_source_type === 'NON_PROMOTIONAL';

  // request source type required only for normal workflow
  if (!isEmergency && !form.request_source_type) {
    errs.request_source_type =
      'Please select a request source type.';
  }

  // =========================
  // EMERGENCY WORKFLOW
  // =========================
  if (isEmergency) {

    // only generic name mandatory
    if (
      !form.generic_name ||
      String(form.generic_name).trim() === ''
    ) {
      errs.generic_name = 'This field is required.';
    }

  } else {

    // =========================
    // NORMAL WORKFLOW
    // =========================
    REQUIRED_FIELDS_BASE.forEach(f => {

      // brand name optional for NON_PROMOTIONAL
      if (
        f === 'brand_name' &&
        isNonPromotional
      ) {
        return;
      }

      if (
        !form[f] ||
        String(form[f]).trim() === ''
      ) {
        errs[f] = 'This field is required.';
      }
    });

    // promotional med rep validation
    if (isPromotional) {

      REQUIRED_FIELDS_REP.forEach(f => {
        if (
          !form[f] ||
          String(form[f]).trim() === ''
        ) {
          errs[f] = 'This field is required.';
        }
      });

      if (
        form.med_rep_email &&
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.med_rep_email)
      ) {
        errs.med_rep_email = 'Invalid email address.';
      }

      if (
        form.med_rep_phone &&
        !/^[0-9+\-\s]{7,15}$/.test(form.med_rep_phone)
      ) {
        errs.med_rep_phone = 'Invalid phone number.';
      }
    }

    // expected patients validation
    if (!isEmergency) {
      if (!form.expected_patients_pm || String(form.expected_patients_pm).trim() === '') {
        errs.expected_patients_pm = 'This field is required.';
      } else if (isNaN(Number(form.expected_patients_pm)) || Number(form.expected_patients_pm) <= 0) {
        errs.expected_patients_pm = 'Must be a positive number.';
      }
    }

    // medicine quantity validation
    if (!isEmergency) {
      if (!form.medicine_quantity || String(form.medicine_quantity).trim() === '') {
        errs.medicine_quantity = 'This field is required.';
      } else if (isNaN(Number(form.medicine_quantity)) || Number(form.medicine_quantity) <= 0) {
        errs.medicine_quantity = 'Must be a positive number.';
      }
    }
  }

  return errs;
}


const SECTION_ICONS = {
  '1': '📘', '2': '💰', '3': '🔁',
};
const SECTION_COLORS = {
  '1': '#0ea5e9', '2': '#059669', '3': '#1f350eff',
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

export default function DoctorTab({ currentUser, onNotificationsRead }) {
  const [view, setView] = useState('form');
  const [form, setForm] = useState(EMPTY_FORM);
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [alert, setAlert] = useState(null);
  const [requests, setRequests] = useState([]);
  const [loadingReq, setLoadingReq] = useState(false);
  const [quotaLimit, setQuotaLimit] = useState(10);
  const [usedQuota, setUsedQuota] = useState(0);
  const [remainingQuota, setRemainingQuota] = useState(10);
  const [genericlist, setGenericlist] = useState([]);
  const [showGenericPopup, setShowGenericPopup] = useState(false);
  const [selectedGenericDrugs, setSelectedGenericDrugs] = useState([]);
  const [popupError, setPopupError] = useState('');
  const [result, setResult] = useState("");
  const [drugLoading, setDrugLoading] = useState(false);
  const [genericLoading, setGenericLoading] = useState(false);
  const [showDrugProfilePopup, setShowDrugProfilePopup] = useState(false);
  const [dosageFilter, setDosageFilter] = useState('');
  const [dosageFormFilter, setDosageFormFilter] = useState('');

  // ─── no mousedown refs needed ───

  const fetchDrug = async () => {
    if (!form.brand_name || form.brand_name.trim() === '') {
      setAlert({ type: 'error', msg: 'Please enter a Brand Name first.' });
      return;
    }
    setDrugLoading(true);
    setResult('');
    try {
      const res = await fetch(`${API}/drug-profile`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ drug_name: form.brand_name })
      });
      const data = await res.json();
      setForm(prev => ({ ...prev, ai_content: data.data }));
      setResult(data.data || 'No data returned.');
      setShowDrugProfilePopup(true);
    } catch (err) {
      setResult('Error fetching drug profile. Please try again.');
      setShowDrugProfilePopup(true);
    } finally {
      setDrugLoading(false);
    }
  };

  const getGenericDetails = async () => {
    try {
      setGenericLoading(true);

      const generic = form.generic_name;

      if (!generic || generic.trim() === '') {
        setAlert({ type: 'error', msg: 'Please enter a generic name first.' });
        return;
      }

      const res = await axios.post(`${API}/getGeneric`, { search: generic });

      const record = res.data;

      const list = (record.list || []).map((item, idx) => ({
        ...item,
        uiKey: `${item.ID || 'item'}_${idx}`
      }));

      setGenericlist(list);
      setSelectedGenericDrugs(form.selected_existing_brands || []);
      setPopupError('');
      setShowGenericPopup(true);

    } catch (err) {
      console.error(err);
      setGenericlist([]);
      setSelectedGenericDrugs(form.selected_existing_brands || []);
      setPopupError('');
      setShowGenericPopup(true);

    } finally {
      setGenericLoading(false);
    }
  };

  const extractDosage = (name = '') => {
    const match = name.match(/(\d+(?:\.\d+)?\s*(?:mg|ml|mcg|g|iu|meg|%|units?))/i);
    return match ? match[1].trim().toLowerCase().replace(/\s+/, '') : null;
  };

  const extractDosageForm = (value = '') => {
    if (!value) return null;
    const v = value.trim();
    const mappings = [
      [/\binj(?:ection)?s?\.?\b/i, 'Inj.'],
      [/\btab(?:let)?s?\.?\b/i, 'Tab'],
      [/\bcap(?:sule)?s?\.?\b/i, 'Cap'],
      [/\bsyrup\b/i, 'Syrup'],
      [/\bsusp(?:ension)?n?\.?\b/i, 'Suspn'],
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
    for (const [regex, label] of mappings) {
      if (regex.test(v)) return label;
    }
    return v.charAt(0).toUpperCase() + v.slice(1);
  };
  const loadRequests = useCallback(async () => {
    setLoadingReq(true);
    try {
      const r = await axios.get(`${API}/requests/Doctor/${currentUser.USER_ID}`);
      setRequests(r.data);
      const qRes = await axios.get(`${API}/user/quota/${currentUser.USER_ID}`);
      setQuotaLimit(qRes.data.quarterly_limit);
      setUsedQuota(qRes.data.used_this_quarter);
      setRemainingQuota(qRes.data.remaining_quota);
    } catch (err) {
      console.error('Failed to load doctor requests or quota:', err);
    } finally {
      setLoadingReq(false);
    }
  }, [currentUser]);

  useEffect(() => { loadRequests(); }, [loadRequests]);

  const handleChange = e => {
    const { name, value, type, checked } = e.target;
    setForm(f => ({ ...f, [name]: type === 'checkbox' ? checked : value }));
    if (errors[name]) setErrors(er => { const c = { ...er }; delete c[name]; return c; });
  };

  const [isEmergency, setIsEmergency] = React.useState(false);
  const [patientFetching, setPatientFetching] = React.useState(false);
  const [patientFetchError, setPatientFetchError] = React.useState('');

  const fetchPatientDetails = async () => {
    const mrno = form.patient_mrno?.trim();
    if (!mrno) {
      setPatientFetchError('Please enter an MRNO first.');
      return;
    }
    setPatientFetching(true);
    setPatientFetchError('');
    try {
      const res = await axios.post(`${API}/getPatientInfo`, { mrno });
      const d = res.data.data || res.data;
      setForm(f => ({
        ...f,
        patient_mrno: d.MRNO || f.patient_mrno,
        patient_name: d.PATIENTNAME || '',
        patient_age: d.AGE != null ? String(d.AGE) : '',
        patient_diagnosis: d.FINALDIAGNOSIS || '',
        patient_department: d.SERVICE_CENTER_NAME || '',
        patient_visit_id: d.VISITID != null ? String(d.VISITID) : '',

      }));
    } catch (err) {
      const msg = err.response?.data?.error || 'Failed to fetch patient details.';
      setPatientFetchError(msg);
    } finally {
      setPatientFetching(false);
    }
  };

  const handleSubmit = async e => {
    e.preventDefault();
    if (!isEmergency && remainingQuota <= 0) {
      setAlert({
        type: 'error',
        msg: 'Quarterly request limit exceeded. Please contact DTC Committee.'
      });
      return;
    }
    const errs = validate(form, isEmergency);
    if (Object.keys(errs).length) { setErrors(errs); return; }
    setSubmitting(true);
    setAlert(null);
    try {
      const payload = { ...form, doctor_id: currentUser.USER_ID };
      const endpoint = isEmergency ? `${API}/requests/emergency` : `${API}/requests`;
      await axios.post(endpoint, payload);
      setAlert({
        type: 'success',
        msg: isEmergency
          ? '🚨 Emergency drug request submitted! DTC has been notified for immediate decision.'
          : '✅ Drug request submitted successfully! Forwarded to HOD.',
      });
      setForm(EMPTY_FORM);
      setErrors({});
      setIsEmergency(false);
      await loadRequests();
    } catch (err) {
      const respData = err.response?.data;
      const msg = respData?.error || 'Submission failed. Please try again.';
      const remarkStr = respData?.remarks ? `\nReason: ${respData.remarks}` : '';
      setAlert({ type: 'error', msg: '❌ ' + msg + remarkStr, preWrap: true });
    } finally {
      setSubmitting(false);
    }
  };

  const fld = (name) => ({
    name,
    value: form[name],
    onChange: handleChange,
    className: `form-input${errors[name] ? ' error' : ''}`,
  });

  const QuotaBar = () => {
    const pct = quotaLimit > 0 ? Math.min((usedQuota / quotaLimit) * 100, 100) : 0;

    let color = 'var(--success)';
    if (usedQuota >= quotaLimit) {
      color = 'var(--danger)';
    } else if (pct > 80) {
      color = 'var(--warning)';
    }

    return (
      <div className="quota-bar-wrap">
        <div className="quota-bar-label">
          <span>Quarterly Request Usage</span>
          <span style={{ color, fontWeight: 700 }}>Used: {usedQuota} / {quotaLimit} (Remaining: {remainingQuota})</span>
        </div>
        <div className="quota-bar-track">
          <div className="quota-bar-fill" style={{ width: `${pct}%`, background: color }} />
        </div>
        {!isEmergency && remainingQuota <= 0 && (
          <div className="alert alert-warning" style={{ marginTop: 10, marginBottom: 0, fontSize: '0.8rem' }}>
            Quarterly request limit exceeded. Please contact DTC Committee.
          </div>
        )}
      </div>
    );
  };

  return (
    <div>
      {/* ---- Inner Tab Nav ---- */}
      <div className="inner-tabs">
        {['form', 'requests', 'notifications', 'tutorial'].map(v => (
          <button
            key={v}
            className={`inner-tab-btn ${view === v ? 'active' : ''}`}
            onClick={() => setView(v)}
          >
            {v === 'form'
              ? '📝 New Request'
              : v === 'requests'
                ? '📋 My Requests'
                : v === 'notifications'
                  ? '🔔 Notifications'
                  : '📘 Tutorial'}
          </button>
        ))}
      </div>

      {/* ======== SUBMISSION FORM ======== */}
      {view === 'form' && (
        <div className="card">
          <div className="card-title" style={{ justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div className="icon">💊</div>
              {isEmergency ? '🚨 Emergency Drug Request' : 'Drug Addition Request Form'}
            </div>
            <button
              type="button"
              className={`btn btn-sm ${isEmergency ? 'btn-danger' : 'btn-ghost'}`}
              style={isEmergency ? { background: '#dc2626', color: '#fff' } : { borderColor: '#dc2626', color: '#dc2626' }}
              onClick={() => setIsEmergency(e => !e)}
            >
              {isEmergency ? '🚨 Emergency Mode ON — Click to Cancel' : '🚨 Emergency Request'}
            </button>
          </div>
          {isEmergency && (
            <div className="alert alert-error" style={{ marginBottom: 16, fontSize: '0.85rem' }}
            >
              ⚠️ <strong>Emergency Mode:</strong> This request will bypass the standard workflow and go directly to DTC for immediate decision. Use only for urgent clinical situations.
            </div>
          )}

          <QuotaBar />

          {alert && (
            <div className={`alert alert-${alert.type}`} style={alert.preWrap ? { whiteSpace: 'pre-wrap' } : {}}>{alert.msg}</div>
          )}

          <form onSubmit={handleSubmit} noValidate>

            {/* ── Request Source Type ── */}
            {!isEmergency && (
              <div style={{ marginBottom: 24 }}>
                <div style={{ fontSize: '0.78rem', fontWeight: 700, color: form.request_source_type === 'PROMOTIONAL' ? '#0ea5e9' : form.request_source_type === 'NON_PROMOTIONAL' ? '#7c3aed' : 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span>🔖</span> Request Source Type <span style={{ color: 'var(--danger)', marginLeft: 2 }}>*</span>
                </div>
                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    onClick={() => { setForm(f => ({ ...f, request_source_type: 'PROMOTIONAL' })); if (errors.request_source_type) setErrors(er => { const c = { ...er }; delete c.request_source_type; return c; }); }}
                    style={{
                      flex: 1, minWidth: 240, padding: '14px 18px', borderRadius: 10, cursor: 'pointer',
                      border: `2px solid ${form.request_source_type === 'PROMOTIONAL' ? '#0ea5e9' : 'var(--border)'}`,
                      background: form.request_source_type === 'PROMOTIONAL' ? 'rgba(14,165,233,0.08)' : 'var(--bg-card2)',
                      textAlign: 'left', fontFamily: 'inherit', transition: 'all 0.2s',
                    }}
                  >
                    <div style={{ fontWeight: 700, fontSize: '0.9rem', color: form.request_source_type === 'PROMOTIONAL' ? '#0ea5e9' : 'var(--text)', marginBottom: 4 }}>
                      📋 DRUG Request
                    </div>
                    <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>Via Medical Representative</div>
                  </button>
                  <button
                    type="button"
                    onClick={() => { setForm(f => ({ ...f, request_source_type: 'NON_PROMOTIONAL', med_rep_name: '', med_rep_email: '', med_rep_phone: '' })); if (errors.request_source_type) setErrors(er => { const c = { ...er }; delete c.request_source_type; return c; }); }}
                    style={{
                      flex: 1, minWidth: 240, padding: '14px 18px', borderRadius: 10, cursor: 'pointer',
                      border: `2px solid ${form.request_source_type === 'NON_PROMOTIONAL' ? '#7c3aed' : 'var(--border)'}`,
                      background: form.request_source_type === 'NON_PROMOTIONAL' ? 'rgba(124,58,237,0.08)' : 'var(--bg-card2)',
                      textAlign: 'left', fontFamily: 'inherit', transition: 'all 0.2s',
                    }}
                  >
                    <div style={{ fontWeight: 700, fontSize: '0.9rem', color: form.request_source_type === 'NON_PROMOTIONAL' ? '#7c3aed' : 'var(--text)', marginBottom: 4 }}>
                      🩺 DRUG Request
                    </div>
                    <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>Clinician-Initiated — self-requested by doctor</div>
                  </button>
                </div>
                {errors.request_source_type && <span className="form-error" style={{ marginTop: 6, display: 'block' }}>{errors.request_source_type}</span>}
              </div>
            )}

            {/* ── Formulary Request Type ── */}
            {!isEmergency && (
              <div style={{ marginBottom: 24 }}>
                <div style={{ fontSize: '0.78rem', fontWeight: 700, color: form.formulary_request_type === 'FORMULARY' ? '#059669' : form.formulary_request_type === 'NON_FORMULARY' ? '#d97706' : 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span>📑</span> Formulary Request Type <span style={{ color: 'var(--danger)', marginLeft: 2 }}>*</span>
                </div>
                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    onClick={() => { setForm(f => ({ ...f, formulary_request_type: 'FORMULARY' })); if (errors.formulary_request_type) setErrors(er => { const c = { ...er }; delete c.formulary_request_type; return c; }); }}
                    style={{
                      flex: 1, minWidth: 240, padding: '14px 18px', borderRadius: 10, cursor: 'pointer',
                      border: `2px solid ${form.formulary_request_type === 'FORMULARY' ? '#059669' : 'var(--border)'}`,
                      background: form.formulary_request_type === 'FORMULARY' ? 'rgba(5,150,105,0.08)' : 'var(--bg-card2)',
                      textAlign: 'left', fontFamily: 'inherit', transition: 'all 0.2s',
                    }}
                  >
                    <div style={{ fontWeight: 700, fontSize: '0.9rem', color: form.formulary_request_type === 'FORMULARY' ? '#059669' : 'var(--text)', marginBottom: 4 }}>
                      🏥 Formulary Drug Addition Request
                    </div>
                    <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>Requesting addition of a new drug to the hospital formulary</div>
                  </button>
                  <button
                    type="button"
                    onClick={() => { setForm(f => ({ ...f, formulary_request_type: 'NON_FORMULARY' })); if (errors.formulary_request_type) setErrors(er => { const c = { ...er }; delete c.formulary_request_type; return c; }); }}
                    style={{
                      flex: 1, minWidth: 240, padding: '14px 18px', borderRadius: 10, cursor: 'pointer',
                      border: `2px solid ${form.formulary_request_type === 'NON_FORMULARY' ? '#d97706' : 'var(--border)'}`,
                      background: form.formulary_request_type === 'NON_FORMULARY' ? 'rgba(217,119,6,0.08)' : 'var(--bg-card2)',
                      textAlign: 'left', fontFamily: 'inherit', transition: 'all 0.2s',
                    }}
                  >
                    <div style={{ fontWeight: 700, fontSize: '0.9rem', color: form.formulary_request_type === 'NON_FORMULARY' ? '#d97706' : 'var(--text)', marginBottom: 4 }}>
                      ⚠️ Non-Formulary Drug Request
                    </div>
                    <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>Requesting a drug that will not be added to the formulary</div>
                  </button>
                </div>
                {errors.formulary_request_type && <span className="form-error" style={{ marginTop: 6, display: 'block' }}>{errors.formulary_request_type}</span>}
              </div>
            )}

            {/* Medical Rep Info — only for PROMOTIONAL */}
            {!isEmergency && form.request_source_type === 'PROMOTIONAL' && (
              <div style={{ marginBottom: 24 }}>
                <div style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--primary-light)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span>👔</span> Medical Representative Information
                </div>
                <div className="form-grid">
                  <div className="form-group">
                    <label className="form-label">Rep Name <span className="req">*</span></label>
                    <input {...fld('med_rep_name')} placeholder="Full name" />
                    {errors.med_rep_name && <span className="form-error">{errors.med_rep_name}</span>}
                  </div>
                  <div className="form-group">
                    <label className="form-label">Rep Email <span className="req">*</span></label>
                    <input {...fld('med_rep_email')} type="email" placeholder="rep@company.com" />
                    {errors.med_rep_email && <span className="form-error">{errors.med_rep_email}</span>}
                  </div>
                  <div className="form-group">
                    <label className="form-label">Rep Phone <span className="req">*</span></label>
                    <input {...fld('med_rep_phone')} placeholder="+91 XXXXXXXXXX" />
                    {errors.med_rep_phone && <span className="form-error">{errors.med_rep_phone}</span>}
                  </div>
                </div>
              </div>
            )}

            {/* ── Patient Information (Emergency Only) ── */}
            {isEmergency && (
              <div style={{ marginBottom: 24 }}>
                <div style={{
                  fontSize: '0.78rem', fontWeight: 700, color: '#dc2626',
                  textTransform: 'uppercase', letterSpacing: '0.08em',
                  marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6
                }}>
                  <span>🧑</span> Patient Information
                </div>
                <div style={{
                  background: 'rgba(220,38,38,0.04)', border: '1px solid rgba(220,38,38,0.2)',
                  borderLeft: '4px solid #dc2626', borderRadius: 10, padding: '16px 18px'
                }}>
                  {/* MRNO + Fetch Row */}
                  <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', marginBottom: 14 }}>
                    <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
                      <label className="form-label">MRNO <span style={{ fontSize: '0.72rem', color: 'var(--text-subtle)', fontWeight: 400 }}>(optional — enter to auto-fetch)</span></label>
                      <input
                        id="patient_mrno"
                        name="patient_mrno"
                        value={form.patient_mrno}
                        onChange={e => {
                          handleChange(e);
                          setPatientFetchError('');
                        }}
                        className="form-input"
                        placeholder="e.g. MR00123456"
                        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); fetchPatientDetails(); } }}
                      />
                    </div>
                    <button
                      type="button"
                      id="btn-fetch-patient"
                      className="btn btn-sm"
                      style={{
                        background: '#dc2626', color: '#fff', border: 'none',
                        borderRadius: 8, padding: '9px 16px', fontWeight: 700,
                        cursor: patientFetching ? 'not-allowed' : 'pointer',
                        whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 6,
                        opacity: patientFetching ? 0.7 : 1, transition: 'opacity 0.2s',
                      }}
                      onClick={fetchPatientDetails}
                      disabled={patientFetching}
                    >
                      {patientFetching ? (
                        <><div className="spinner" style={{ width: 13, height: 13, borderWidth: 2, borderColor: '#fff3', borderTopColor: '#fff' }} /> Fetching…</>
                      ) : (
                        <>🔍 Fetch Patient Details</>
                      )}
                    </button>
                  </div>

                  {/* Fetch error / success feedback */}
                  {patientFetchError && (
                    <div className="alert alert-error" style={{ marginBottom: 12, fontSize: '0.82rem', padding: '8px 12px' }}>
                      {patientFetchError}
                    </div>
                  )}
                  {patientFetching && (
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
                      <div className="spinner" style={{ width: 12, height: 12, borderWidth: 2 }} />
                      Fetching patient details…
                    </div>
                  )}

                  {/* Patient detail fields */}
                  <div className="form-grid cols-3">
                    <div className="form-group">
                      <label className="form-label">Patient Name</label>
                      <input
                        id="patient_name" name="patient_name"
                        value={form.patient_name} onChange={handleChange}
                        className="form-input" placeholder="Auto-filled or enter manually"
                      />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Age</label>
                      <input
                        id="patient_age" name="patient_age"
                        value={form.patient_age} onChange={handleChange}
                        className="form-input" placeholder="e.g. 45"
                      />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Visit ID</label>
                      <input
                        id="patient_visit_id" name="patient_visit_id"
                        value={form.patient_visit_id} onChange={handleChange}
                        className="form-input" placeholder="Auto-filled or enter manually"
                      />
                    </div>
                    <div className="form-group form-full">
                      <label className="form-label">Diagnosis</label>
                      <input
                        id="patient_diagnosis" name="patient_diagnosis"
                        value={form.patient_diagnosis} onChange={handleChange}
                        className="form-input" placeholder="Auto-filled or enter manually"
                      />
                    </div>
                    <div className="form-group form-full">
                      <label className="form-label">Department / Ward</label>
                      <input
                        id="patient_department" name="patient_department"
                        value={form.patient_department} onChange={handleChange}
                        className="form-input" placeholder="Auto-filled or enter manually"
                      />
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Drug Classification */}
            <div style={{ marginBottom: 24 }}>
              <div style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--primary-light)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
                <span>🔬</span> Drug Classification
              </div>
              <div className="form-grid">
                <div className="form-group">
                  <label className="form-label">Request Type <span className="req">*</span></label>
                  <select
                    name="request_type" value={form.request_type}
                    onChange={handleChange}
                    className={`form-select${errors.request_type ? ' error' : ''}`}
                  >
                    <option value="">Select type…</option>
                    <option>New Brand</option>
                    <option>New Molecule</option>
                    <option>Combination</option>
                    <option>Other</option>
                  </select>
                  {errors.request_type && <span className="form-error">{errors.request_type}</span>}
                </div>
                <div className="form-group">
                  <label className="form-label">Category <span className="req">*</span></label>
                  <input {...fld('category')} placeholder="e.g. Antibiotics, Cardiovascular…" />
                  {errors.category && <span className="form-error">{errors.category}</span>}
                </div>
              </div>
            </div>

            {/* Drug Details */}
            <div style={{ marginBottom: 24 }}>
              <div style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--primary-light)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
                <span>💉</span> Drug Details
              </div>
              <div className="form-grid cols-3">
                <div className="form-group">
                  <label className="form-label">Brand Name <span className="req">*</span></label>
                  <input {...fld('brand_name')} placeholder="Trade/brand name" />
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    style={{ marginTop: 4, borderColor: 'var(--primary)', color: 'var(--primary)' }}
                    onClick={fetchDrug}
                    disabled={drugLoading}
                  >
                    {drugLoading ? (
                      <>
                        <div
                          className="spinner"
                          style={{ width: 12, height: 12, borderWidth: 2 }}
                        />
                        {' '}Fetching…
                      </>
                    ) : (
                      '🔍 Get Brand Info'
                    )}
                  </button>
                  {errors.brand_name && <span className="form-error">{errors.brand_name}</span>}
                </div>
                <div className="form-group">
                  <label className="form-label">Generic Name <span className="req">*</span></label>
                  <input {...fld('generic_name')} placeholder="INN / generic name" />
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    style={{ marginTop: 4, borderColor: 'var(--primary)', color: 'var(--primary)' }}
                    onClick={getGenericDetails}
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
                  {errors.generic_name && <span className="form-error">{errors.generic_name}</span>}
                </div>
                <div className="form-group">
                  <label className="form-label">Dose / Strength <span className="req">*</span></label>
                  <input {...fld('dose_strength')} placeholder="e.g. 500mg" />
                  {errors.dose_strength && <span className="form-error">{errors.dose_strength}</span>}
                </div>
                <div className="form-group">
                  <label className="form-label">Dosage Form <span className="req">*</span></label>
                  <input {...fld('dosage_form')} placeholder="e.g. Tablet, Syrup, Injection" />
                  {errors.dosage_form && <span className="form-error">{errors.dosage_form}</span>}
                </div>
                <div className="form-group">
                  <label className="form-label">Manufacturer <span className="req">*</span></label>
                  <input {...fld('manufacturer')} placeholder="Manufacturing company" />
                  {errors.manufacturer && <span className="form-error">{errors.manufacturer}</span>}
                </div>
                <div className="form-group">
                  <label className="form-label">Marketer <span className="req">*</span></label>
                  <input {...fld('marketer')} placeholder="Marketing company" />
                  {errors.marketer && <span className="form-error">{errors.marketer}</span>}
                </div>
                <div className="form-group form-full" style={{ border: '1px solid #cbd5e1', borderRadius: 12, padding: 16, background: 'var(--bg-card2, #f8fafc)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                    <label className="form-label" style={{ margin: 0, fontWeight: 700 }}>Existing Brands on Formulary</label>
                    <button
                      type="button"
                      onClick={getGenericDetails}
                      disabled={genericLoading}
                      style={{ background: 'linear-gradient(135deg,#2563eb,#1d4ed8)', color: '#fff', border: 'none', borderRadius: 7, padding: '5px 12px', fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5, opacity: genericLoading ? 0.6 : 1 }}
                    >
                      {genericLoading ? '⏳ Loading…' : '🔍 Check & Add Existing Drugs'}
                    </button>
                  </div>

                  {(!form.selected_existing_brands || form.selected_existing_brands.length === 0) ? (
                    <div style={{ textAlign: 'center', padding: '14px 8px', color: '#64748b', fontSize: '0.82rem', border: '1px dashed #cbd5e1', borderRadius: 8, background: '#fff' }}>
                      No existing brands selected. Click the button above to search the formulary.
                    </div>
                  ) : (
                    <div style={{ border: '1px solid #cbd5e1', borderRadius: 8, overflow: 'hidden' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
                        <thead style={{ background: '#f1f5f9' }}>
                          <tr>
                            <th style={{ padding: '6px 10px', textAlign: 'left', color: '#334155', fontWeight: 700 }}>Brand</th>
                            <th style={{ padding: '6px 10px', textAlign: 'left', color: '#334155', fontWeight: 700 }}>Generic</th>
                            <th style={{ padding: '6px 10px', textAlign: 'left', color: '#334155', fontWeight: 700 }}>Manufacturer</th>
                            <th style={{ padding: '6px 10px', textAlign: 'left', color: '#334155', fontWeight: 700 }}>MRP</th>
                            <th style={{ padding: '6px 10px', textAlign: 'center', color: '#334155', fontWeight: 700, width: 60 }}>Remove</th>
                          </tr>
                        </thead>
                        <tbody>
                          {form.selected_existing_brands.map((item) => (
                            <tr key={item.uiKey} style={{ borderTop: '1px solid #e2e8f0' }}>
                              <td style={{ padding: '6px 10px', fontWeight: 600 }}>{item.NAME}</td>
                              <td style={{ padding: '6px 10px', color: 'var(--text-muted)' }}>{item.DRUG_GEN_NAME || '—'}</td>
                              <td style={{ padding: '6px 10px', color: 'var(--text-muted)' }}>{item.MANUFACTURER_NAME || '—'}</td>
                              <td style={{ padding: '6px 10px', fontWeight: 600, color: 'var(--success)' }}>{item.MRP ? `₹${item.MRP}` : '—'}</td>
                              <td style={{ padding: '6px 10px', textAlign: 'center' }}>
                                <button
                                  type="button"
                                  onClick={() => {
                                    const updatedList = form.selected_existing_brands.filter(s => s.uiKey !== item.uiKey);
                                    setForm(f => ({
                                      ...f,
                                      selected_existing_brands: updatedList,
                                      existing_brands: serializeExistingBrands(updatedList)
                                    }));
                                  }}
                                  style={{ border: 'none', background: 'transparent', cursor: 'pointer', fontSize: '1rem', color: '#ef4444', lineHeight: 1 }}
                                  title="Remove this brand"
                                >❌</button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Market & Financial Info */}
            <div style={{ marginBottom: 24 }}>
              <div style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--primary-light)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
                <span>📊</span> Expected Impact
              </div>
              <div className="form-grid">
                <div className="form-group form-full">
                  <label className="form-label">Clinical Justification <span className="req">*</span></label>
                  <textarea
                    name="clinical_justification" value={form.clinical_justification}
                    onChange={handleChange}
                    className={`form-textarea${errors.clinical_justification ? ' error' : ''}`}
                    placeholder="Describe the clinical need, evidence base, therapeutic advantage over existing formulary drugs…"
                    rows={4}
                  />
                  {errors.clinical_justification && <span className="form-error">{errors.clinical_justification}</span>}
                </div>
                {!isEmergency && (
                  <>
                    <div className="form-group">
                      <label className="form-label">
                        Expected Patients / Month <span className="req">*</span>
                      </label>
                      <input {...fld('expected_patients_pm')} type="number" min="1" placeholder="Estimated patient count" />
                      {errors.expected_patients_pm && <span className="form-error">{errors.expected_patients_pm}</span>}
                    </div>
                    <div className="form-group">
                      <label className="form-label">
                        Medicine Quantity /Month <span className="req">*</span>
                      </label>
                      <input
                        {...fld('medicine_quantity')}
                        type="number"
                        min="1"
                        placeholder="Estimated procurement quantity"
                      />
                      {errors.medicine_quantity && <span className="form-error">{errors.medicine_quantity}</span>}
                    </div>
                    <div className="form-group" style={{ justifyContent: 'flex-end', paddingTop: 8 }}>
                      <label className="form-label">Cost Reduction Benefit</label>
                      <div className="toggle-group">
                        <button
                          type="button"
                          className={`toggle-btn ${form.cost_reduction_benefit ? 'active' : ''}`}
                          onClick={() => setForm(f => ({ ...f, cost_reduction_benefit: true }))}
                        >
                          ✅ Yes
                        </button>
                        <button
                          type="button"
                          className={`toggle-btn ${!form.cost_reduction_benefit ? 'active' : ''}`}
                          onClick={() => setForm(f => ({ ...f, cost_reduction_benefit: false }))}
                        >
                          ❌ No
                        </button>
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* Submit */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, paddingTop: 8, borderTop: '1px solid var(--border)' }}>
              <button type="button" className="btn btn-ghost" onClick={() => { setForm(EMPTY_FORM); setErrors({}); setAlert(null); }}>
                ↺ Reset
              </button>
              <button type="submit" className="btn btn-primary" disabled={submitting || (!isEmergency && remainingQuota <= 0)}>
                {submitting ? <><div className="spinner" />  Submitting…</> : '🚀 Submit Request'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ======== MY REQUESTS ======== */}
      {view === 'requests' && (
        <div>
          <div className="section-header">
            <div>
              <div className="section-title">My Drug Requests</div>
              <div className="section-sub">Track approval progress for each submission</div>
            </div>
            <button className="btn btn-ghost" onClick={loadRequests}>↺ Refresh</button>
          </div>

          {loadingReq ? (
            <div style={{ textAlign: 'center', padding: 60 }}><div className="spinner" /></div>
          ) : requests.length === 0 ? (
            <div className="card" style={{ textAlign: 'center', padding: 60, color: 'var(--text-subtle)' }}>
              <div style={{ fontSize: '3rem', marginBottom: 12 }}>💊</div>
              <div>No drug requests submitted yet.</div>
              <button className="btn btn-primary" style={{ marginTop: 16 }} onClick={() => setView('form')}>
                + Submit First Request
              </button>
            </div>
          ) : requests.map(r => (
            <div key={r.REQUEST_ID} className="card" style={{ marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4, flexWrap: 'wrap' }}>
                    <span style={{ fontWeight: 800, fontSize: '1.05rem' }}>{r.BRAND_NAME}</span>
                    <span className="badge badge-info">{r.REQUEST_TYPE}</span>
                    {r.REQUEST_SOURCE_TYPE === 'NON_PROMOTIONAL'
                      ? <span className="badge badge-non-promotional">🩺 Clinician initiated</span>
                      : <span className="badge badge-promotional">📋 Via Medical Representative</span>}
                    {getStatusBadge(r.STATUS, 'DOCTOR')}
                  </div>
                  <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                    Request #{r.REQUEST_ID} · {r.GENERIC_NAME} · {r.DOSE_STRENGTH} · {r.DOSAGE_FORM}
                  </div>
                </div>
                <div style={{ fontSize: '0.78rem', color: 'var(--text-subtle)', textAlign: 'right' }}>
                  {new Date(r.CREATED_AT).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                </div>
              </div>

              <ProgressBar stage={r.CURRENT_STAGE} status={r.STATUS} requestSource={r.REQUEST_SOURCE || r.CREATED_BY_ROLE || 'DOCTOR'} request={r} />

              {['Rejected', 'HOD_REJECTED', 'PHARMACIST_REJECTED', 'PHARMACY_HEAD_REJECTED', 'CEO_REJECTED'].includes(r.STATUS) && (
                <div className="alert alert-error" style={{ marginTop: 12, marginBottom: 0 }}>
                  <div style={{ fontWeight: 700, marginBottom: 6 }}>❌ {getRejectedLabel(r.STATUS)}</div>
                  <div style={{ fontSize: '0.875rem' }}>
                    {r.CEO_REMARKS || r.DTC_FINAL_REMARKS || r.PH_REMARKS2 || r.PH_REVIEW2_REMARKS || r.PHARMACIST2_REMARKS || r.DTC_REMARKS || r.PH_REMARKS || r.PHARMACIST_REMARKS || r.HOD_REMARKS}
                  </div>
                </div>
              )}
              {r.STATUS === 'Approved' && (
                <div className="alert alert-success" style={{ marginTop: 12, marginBottom: 0 }}>
                  🏆 This drug has been <strong>Finally Approved</strong> for addition to the hospital formulary!
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ======== GENERIC POPUP ======== */}
      {showGenericPopup && (() => {
        const filtered = genericlist.filter(item => {
          const dosageMatch = !dosageFilter || extractDosage(item.NAME) === dosageFilter;
          const formMatch = !dosageFormFilter || extractDosageForm(item.DOSAGE_FORM || item.NAME) === dosageFormFilter;
          return dosageMatch && formMatch;
        });

        const allSelected = filtered.length > 0 && filtered.every(item => selectedGenericDrugs.some(selected => selected.uiKey === item.uiKey));

        return (
          <div
            className="modal-overlay"
            style={{ animation: 'none' }}
            onClick={() => {
              setShowGenericPopup(false);
              setDosageFilter('');
              setDosageFormFilter('');
              setSelectedGenericDrugs([]);
              setPopupError('');
            }}
          >
            <div
              className="modal"
              style={{ maxWidth: '92vw', width: '92vw', maxHeight: '80vh', display: 'flex', flexDirection: 'column' }}
              onClick={(e) => e.stopPropagation()}
            >
              {/* Modal Header */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, padding: '20px 24px 0', flexShrink: 0 }}>
                <div className="modal-title" style={{ margin: 0 }}>
                  🔍 Existing Drugs — <span style={{ color: 'var(--primary)', fontStyle: 'italic' }}>{form.generic_name}</span>
                </div>
                <button
                  onClick={() => {
                    setShowGenericPopup(false);
                    setDosageFilter('');
                    setDosageFormFilter('');
                    setSelectedGenericDrugs([]);
                    setPopupError('');
                  }}
                  className="btn btn-ghost btn-sm"
                  style={{ padding: '4px 10px', fontSize: '1rem', lineHeight: 1 }}
                >
                  ✕
                </button>
              </div>

              {/* Validation Warning Alert */}
              {popupError && (
                <div className="alert alert-error" style={{ margin: '0 24px 12px', fontSize: '0.82rem', padding: '8px 14px', flexShrink: 0 }}>
                  ⚠️ {popupError}
                </div>
              )}

              {/* Scrollable Container for Filters and Body */}
              <div style={{ overflowY: 'auto', flex: 1, padding: '0 24px' }}>
                {/* Filter Bars — only when there are results */}
                {genericlist.length > 0 && (() => {
                  const dosages = [...new Set(
                    genericlist.map(item => extractDosage(item.NAME)).filter(Boolean)
                  )].sort((a, b) => parseFloat(a) - parseFloat(b));

                  const dosageForms = [...new Set(
                    genericlist
                      .map(item => extractDosageForm(item.DOSAGE_FORM || item.NAME))
                      .filter(Boolean)
                  )].sort((a, b) => a.localeCompare(b));

                  const CHIP_BASE = {
                    padding: '4px 13px', fontSize: '0.78rem', fontWeight: 600,
                    borderRadius: 20, border: '1.5px solid', cursor: 'pointer', transition: 'all 0.15s',
                  };

                  return (
                    <div style={{ marginBottom: 12 }}>
                      {/* Dosage Strength filter */}
                      {dosages.length > 0 && (
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
                            <button
                              onClick={() => setDosageFilter('')}
                              style={{
                                ...CHIP_BASE, fontWeight: 700,
                                borderColor: !dosageFilter ? '#2563eb' : '#cbd5e1',
                                background: !dosageFilter ? '#2563eb' : '#fff',
                                color: !dosageFilter ? '#fff' : '#64748b',
                              }}
                            >
                              All ({genericlist.length})
                            </button>
                            {dosages.map(d => {
                              const count = genericlist.filter(i => extractDosage(i.NAME) === d).length;
                              const isActive = dosageFilter === d;
                              return (
                                <button key={d} onClick={() => setDosageFilter(isActive ? '' : d)}
                                  style={{
                                    ...CHIP_BASE,
                                    borderColor: isActive ? '#7c3aed' : '#cbd5e1',
                                    background: isActive ? '#7c3aed' : '#fff',
                                    color: isActive ? '#fff' : '#475569',
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
                      )}

                      {/* Dosage Form filter */}
                      {dosageForms.length > 0 && (
                        <div style={{
                          background: '#f8fafc', border: '1px solid #e2e8f0',
                          borderRadius: 10, padding: '12px 16px'
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
                            <button
                              onClick={() => setDosageFormFilter('')}
                              style={{
                                ...CHIP_BASE, fontWeight: 700,
                                borderColor: !dosageFormFilter ? '#059669' : '#cbd5e1',
                                background: !dosageFormFilter ? '#059669' : '#fff',
                                color: !dosageFormFilter ? '#fff' : '#64748b',
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
                                <button key={form} onClick={() => setDosageFormFilter(isActive ? '' : form)}
                                  style={{
                                    ...CHIP_BASE,
                                    borderColor: isActive ? '#059669' : '#cbd5e1',
                                    background: isActive ? '#059669' : '#fff',
                                    color: isActive ? '#fff' : '#475569',
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
                      )}
                    </div>
                  );
                })()}

                {filtered.length > 0 ? (
                  <div className="table-wrap">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th style={{ width: 50, textAlign: 'center' }}>
                            <input
                              type="checkbox"
                              checked={allSelected}
                              onChange={(e) => {
                                setPopupError('');
                                if (e.target.checked) {
                                  setSelectedGenericDrugs(prev => {
                                    const added = [...prev];
                                    filtered.forEach(item => {
                                      if (!added.some(selected => selected.uiKey === item.uiKey)) {
                                        added.push(item);
                                      }
                                    });
                                    return added;
                                  });
                                } else {
                                  setSelectedGenericDrugs(prev => prev.filter(selected => !filtered.some(item => item.uiKey === selected.uiKey)));
                                }
                              }}
                              style={{ cursor: 'pointer', transform: 'scale(1.1)' }}
                            />
                          </th>
                          <th>Brand Name</th>
                          <th>Generic Name</th>
                          <th>Status</th>
                          <th>Manufacturer</th>
                          <th>Marketer</th>
                          <th>MRP</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filtered.map((item) => {
                          const isSelected = selectedGenericDrugs.some(selected => selected.uiKey === item.uiKey);
                          return (
                            <tr
                              key={item.uiKey}
                              onClick={() => {
                                setPopupError('');
                                setSelectedGenericDrugs(prev => {
                                  if (prev.some(selected => selected.uiKey === item.uiKey)) {
                                    return prev.filter(selected => selected.uiKey !== item.uiKey);
                                  } else {
                                    return [...prev, item];
                                  }
                                });
                              }}
                              style={{
                                cursor: 'pointer',
                                background: isSelected ? 'rgba(37,99,235,0.06)' : 'inherit',
                                transition: 'background 0.15s'
                              }}
                            >
                              <td style={{ textAlign: 'center' }} onClick={(e) => e.stopPropagation()}>
                                <input
                                  type="checkbox"
                                  checked={isSelected}
                                  onChange={() => {
                                    setPopupError('');
                                    setSelectedGenericDrugs(prev => {
                                      if (prev.some(selected => selected.uiKey === item.uiKey)) {
                                        return prev.filter(selected => selected.uiKey !== item.uiKey);
                                      } else {
                                        return [...prev, item];
                                      }
                                    });
                                  }}
                                  style={{ cursor: 'pointer', transform: 'scale(1.1)' }}
                                />
                              </td>
                              <td style={{ fontWeight: 500 }}>
                                {item.NAME}
                                {extractDosage(item.NAME) && (
                                  <span style={{
                                    marginLeft: 6,
                                    fontSize: '0.68rem',
                                    fontWeight: 700,
                                    background: '#ede9fe',
                                    color: '#6d28d9',
                                    borderRadius: 8,
                                    padding: '1px 7px',
                                  }}>
                                    {extractDosage(item.NAME)}
                                  </span>
                                )}
                              </td>
                              <td style={{ color: 'var(--text-muted)' }}>
                                {item.DRUG_GEN_NAME}
                              </td>
                              <td>
                                <span
                                  style={{
                                    padding: '3px 10px',
                                    borderRadius: '12px',
                                    fontSize: '0.75rem',
                                    fontWeight: 600,
                                    background: item.STATUS === 'Active✅' ? '#dcfce7' : '#fee2e2',
                                    color: item.STATUS === 'Active✅' ? '#166534' : '#991b1b'
                                  }}
                                >
                                  {item.STATUS || 'Unknown'}
                                </span>
                              </td>
                              <td>{item.MANUFACTURER_NAME || 'N/A'}</td>
                              <td>{item.MARKETTER_NAME || 'N/A'}</td>
                              <td style={{ fontWeight: 600, color: 'var(--success)' }}>
                                {item.MRP ? `₹${item.MRP}` : 'N/A'}
                              </td>
                            </tr>
                          );
                        })}
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
                )}
              </div>

              {/* Modal Footer */}
              <div className="modal-footer" style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                borderTop: '1px solid var(--border)',
                padding: '16px 24px',
                background: 'var(--bg-card)',
                flexShrink: 0
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-muted)' }}>
                    Selected: <strong style={{ color: 'var(--primary)' }}>{selectedGenericDrugs.length}</strong>
                  </span>
                  {filtered.length > 0 && (
                    <>
                      <button
                        className="btn btn-ghost btn-xs"
                        onClick={() => {
                          setPopupError('');
                          setSelectedGenericDrugs(prev => {
                            const added = [...prev];
                            filtered.forEach(item => {
                              if (!added.some(selected => selected.uiKey === item.uiKey)) {
                                added.push(item);
                              }
                            });
                            return added;
                          });
                        }}
                        style={{ fontSize: '0.75rem', padding: '3px 8px' }}
                      >
                        ☑ Select All Visible
                      </button>
                      <button
                        className="btn btn-ghost btn-xs"
                        onClick={() => {
                          setPopupError('');
                          setSelectedGenericDrugs([]);
                        }}
                        style={{ fontSize: '0.75rem', padding: '3px 8px' }}
                      >
                        ☒ Clear Selection
                      </button>
                    </>
                  )}
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  {(dosageFilter || dosageFormFilter) && (
                    <button className="btn btn-ghost btn-sm" onClick={() => { setDosageFilter(''); setDosageFormFilter(''); }}>↺ Clear Filters</button>
                  )}
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => {
                      setShowGenericPopup(false);
                      setDosageFilter('');
                      setDosageFormFilter('');
                      setSelectedGenericDrugs([]);
                      setPopupError('');
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    className="btn btn-primary btn-sm"
                    onClick={() => {
                      if (selectedGenericDrugs.length === 0) {
                        setPopupError('Please select at least one drug first.');
                        return;
                      }
                      setPopupError('');

                      const currentList = form.selected_existing_brands || [];
                      const updatedList = [...currentList];
                      selectedGenericDrugs.forEach(item => {
                        if (!updatedList.some(existing => existing.uiKey === item.uiKey)) {
                          updatedList.push(item);
                        }
                      });

                      setForm(f => ({
                        ...f,
                        selected_existing_brands: updatedList,
                        existing_brands: serializeExistingBrands(updatedList)
                      }));
                      setShowGenericPopup(false);
                      setDosageFilter('');
                      setDosageFormFilter('');
                      setSelectedGenericDrugs([]);
                    }}
                    style={{
                      background: 'linear-gradient(135deg, var(--primary), var(--primary-dark))',
                      boxShadow: '0 2px 6px rgba(37,99,235,0.2)'
                    }}
                  >
                    📥 Add Selected to Existing Brands
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ======== NOTIFICATIONS ======== */}
      {view === 'notifications' && (
        <Notifications userId={currentUser.USER_ID} onRead={onNotificationsRead} />
      )}

      {/* ======== TUTORIAL ======== */}
      {view === 'tutorial' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {/* Video player card */}
          <div className="card">
            <div className="card-title">
              <div className="icon">🎥</div>
              System Workflow Tutorial
            </div>
            <div style={{ position: 'relative', paddingBottom: '56.25%', height: 0, overflow: 'hidden', borderRadius: 12, boxShadow: 'var(--shadow-sm)', background: '#000' }}>
              <iframe
                style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', border: 0 }}
                src="https://www.youtube.com/embed/88qCqi4eQXk"
                title="System Workflow Tutorial"
                allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
                loading="lazy"
              />
            </div>
          </div>

          {/* Written guide card */}
          <div className="card" style={{ padding: '20px 24px' }}>
            <div className="card-title">
              <div className="icon">📝</div>
              Quick Written Guide — Doctor Drug Request Workflow
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20, marginTop: 12 }}>

              <div style={{ borderLeft: '4px solid #94a3b8', paddingLeft: 16 }}>
                <h3 style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--text)', marginBottom: 4 }}>Step 1 — Login to the System</h3>
                <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>
                  First, log in using your registered hospital email ID and password. After successful login, the Doctor Dashboard will open. There are 3 main tabs available: <strong>📝 New Request</strong>, <strong>📋 My Requests</strong>, and <strong>🔔 Notifications</strong>. To create a new drug request, select the <strong>📝 New Request</strong> tab.
                </p>
              </div>

              <div style={{ borderLeft: '4px solid var(--primary)', paddingLeft: 16 }}>
                <h3 style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--text)', marginBottom: 4 }}>Step 2 — Choose Request Source</h3>
                <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>
                  There are two request submission methods:
                </p>
                <div style={{ marginTop: 6, fontSize: '0.82rem', color: 'var(--text-muted)', display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div><strong>👨‍⚕️ Clinician Direct Request:</strong> Used when the doctor directly initiates the request based on clinical need.</div>
                  <div>
                    <strong>💼 Medical Representative Request:</strong> Used when the request is submitted through a Medical Representative. If selecting Medical Representative mode, enter: Rep Name, Contact Number, Email ID, and Company Details.
                  </div>
                </div>
              </div>

              <div style={{ borderLeft: '4px solid var(--info)', paddingLeft: 16 }}>
                <h3 style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--text)', marginBottom: 4 }}>Step 3 — Enter Drug Details</h3>
                <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>
                  Complete all required drug information fields carefully: Brand Name, Generic Name, Dosage / Strength, Dosage Form, Manufacturer, Marketer, Estimated Patients Per Month, Target Procurement Quantity, and Clinical Justification.
                </p>
              </div>

              <div style={{ borderLeft: '4px solid #06b6d4', paddingLeft: 16 }}>
                <h3 style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--text)', marginBottom: 4 }}>Step 4 — Get Brand Information (AI Feature)</h3>
                <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>
                  The system includes an AI-powered drug information assistant. Click <strong id="ccx8zu">Get Brand Info</strong> to automatically fetch general drug information, brand overview, manufacturer details, basic therapeutic information, and drug-related reference details. This helps users verify the medicine before submission.
                </p>
              </div>

              <div style={{ borderLeft: '4px solid var(--success)', paddingLeft: 16 }}>
                <h3 style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--text)', marginBottom: 4 }}>Step 5 — Check Existing Drugs</h3>
                <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>
                  Use <strong id="0sn3e6">Check ExistingDrugs</strong> to open the hospital formulary database showing medicines already available with the same generic. Users can filter using Dosage Strength and Dosage Form to prevent duplicate formulary requests.
                </p>
              </div>

              <div style={{ borderLeft: '4px solid #10b981', paddingLeft: 16 }}>
                <h3 style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--text)', marginBottom: 4 }}>Step 6 — Submit Request</h3>
                <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>
                  After entering all details, click <strong id="mq0ny4">🚀 Submit Request</strong>. The request will automatically be forwarded to the next authorized reviewer in the workflow.
                  <br />
                  <span style={{ fontSize: '0.8rem', display: 'inline-block', marginTop: 4, padding: '3px 8px', borderRadius: 4, background: 'var(--bg-card2)' }}>
                    Workflow: Doctor &rarr; HOD &rarr; Pharmacist &rarr; Pharmacy Head &rarr; DTC &rarr; CEO
                  </span>
                </p>
              </div>

              <div style={{ borderLeft: '4px solid #7c3aed', paddingLeft: 16 }}>
                <h3 style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--text)', marginBottom: 4 }}>Step 7 — Track Request Status</h3>
                <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>
                  Open the <strong id="1zyxuq">📋 My Requests</strong> tab to monitor request progress. The system displays: current review stage, approval status, workflow progress bar, reviewer remarks, and final decision status.
                </p>
              </div>

              <div style={{ borderLeft: '4px solid var(--danger)', paddingLeft: 16 }}>
                <h3 style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--text)', marginBottom: 4 }}>Step 8 — Emergency Drug Request</h3>
                <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>
                  For urgent patient requirements, use the <strong id="l8a5f7">🚨 Emergency Request</strong> button located at the top-right corner of the request page. In Emergency Mode, enter the patient MRNO number to auto-fetch details from HIS, complete emergency drug details, and submit immediately for priority review.
                </p>
              </div>

              <div style={{ borderLeft: '4px solid var(--warning)', paddingLeft: 16 }}>
                <h3 style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--text)', marginBottom: 4 }}>Step 9 — Notifications</h3>
                <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>
                  Use the <strong id="qylqq5">🔔 Notifications</strong> tab to view automatic workflow updates. Notifications are generated when a request is approved, rejected, moves to DTC, or has final CEO approval completed. Remarks will also appear here.
                </p>
              </div>

              <div style={{ borderTop: '1px solid var(--border)', paddingTop: 14, marginTop: 6 }}>
                <h3 style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--text)', marginBottom: 4 }}>📞 Support</h3>
                <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                  If you face any issue while using the system or require assistance, please contact the Hospital IT Department.
                </p>
              </div>

            </div>
          </div>
        </div>
      )}


      {/* ======== DRUG PROFILE MODAL ======== */}
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
    </div>
  );
}