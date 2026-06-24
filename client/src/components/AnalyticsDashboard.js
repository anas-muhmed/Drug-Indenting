// =====================================================================
// AnalyticsDashboard.js — Enterprise Analytics Console for DTC & CEO
// Read-only analytics. Zero workflow logic.
// =====================================================================
import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';

const API = '/api';

const fmtDate = (ts) => {
  if (!ts) return '—';
  return new Date(ts).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
};

const fmtDateTime = (ts) => {
  if (!ts) return '—';
  return new Date(ts).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};

const STAGE_DISPLAY = {
  submitted: 'Submitted',
  HOD: 'HOD Review',
  PharmacistInitialReview: 'Pharmacist Review 1',
  PharmacistCorrection: 'Pharmacist Correction',
  PharmacyHead: 'PH Review 1',
  PharmacyHeadReview1: 'PH Review 1',
  DTCCommittee: 'DTC Review 1',
  DTCReview1: 'DTC Review 1',
  Pharmacist: 'Pharmacist Analysis',
  PharmacistReview2: 'Pharmacist Analysis',
  PharmacyHeadReview2: 'PH Review 2',
  DTCFinal: 'DTC Final',
  DTCFinalReview: 'DTC Final',
  CEO: 'CEO Approval',
  Final: 'Final Approved',
  PharmacistOrder: 'Pharmacist Order',
  OrderPlaced: 'Order Placed',
  EmergencyDTC: 'Emergency DTC',
  Rejected: 'Rejected',
};

const STAGE_COLOR = {
  HOD: '#0ea5e9',
  PharmacistInitialReview: '#7c3aed',
  PharmacyHead: '#059669',
  DTCCommittee: '#d97706',
  Pharmacist: '#8b5cf6',
  PharmacyHeadReview2: '#10b981',
  DTCFinal: '#f59e0b',
  CEO: '#6366f1',
  Final: '#059669',
  PharmacistOrder: '#0284c7',
  OrderPlaced: '#1d4ed8',
  EmergencyDTC: '#dc2626',
  Rejected: '#ef4444',
  submitted: '#64748b',
};

const STATUS_COLOR = (status) => {
  if (!status) return '#94a3b8';
  const s = status.toLowerCase();
  if (s.includes('approved') || s === 'final') return '#059669';
  if (s.includes('rejected')) return '#dc2626';
  if (s.includes('pending') || s.includes('emergency_pending')) return '#d97706';
  if (s === 'order_placed') return '#1d4ed8';
  return '#64748b';
};

// ── Mini rank bar row ──
const RankBar = ({ name, count, max, color }) => {
  const pct = max > 0 ? Math.round((count / max) * 100) : 0;
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, fontSize: '0.82rem' }}>
        <span style={{ color: 'var(--text)', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '72%' }}>{name}</span>
        <span style={{ color, fontWeight: 700, flexShrink: 0, marginLeft: 8 }}>{count}</span>
      </div>
      <div style={{ height: 6, background: 'var(--bg-card2)', borderRadius: 99, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: 99, transition: 'width 0.6s ease' }} />
      </div>
    </div>
  );
};

// ── KPI Card ──
const KpiCard = ({ icon, label, value, color, sub, onClick }) => (
  <div style={{
    background: 'var(--bg-card)',
    border: `1px solid var(--border)`,
    borderTop: `3px solid ${color}`,
    borderRadius: 'var(--radius)',
    padding: '16px 18px',
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    transition: 'var(--transition)',
    minWidth: 0,
    cursor: onClick ? 'pointer' : 'default',
  }}
    onClick={onClick}
    className="analytics-kpi-card"
  >
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div style={{ width: 32, height: 32, borderRadius: 8, background: color + '1a', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.05rem', flexShrink: 0 }}>{icon}</div>
      <span style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</span>
    </div>
    <div style={{ fontSize: '2rem', fontWeight: 800, color, lineHeight: 1, paddingLeft: 2 }}>{value ?? '—'}</div>
    {sub && <div style={{ fontSize: '0.72rem', color: 'var(--text-subtle)', paddingLeft: 2 }}>{sub}</div>}
  </div>
);

// ── Stage tile ──
const StageTile = ({ label, count, color, emoji, onClick }) => (
  <div style={{
    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
    minWidth: 110, padding: '12px 10px', borderRadius: 10,
    background: color + '0d', border: `1px solid ${color}33`,
    gap: 4, flexShrink: 0,
    cursor: onClick ? 'pointer' : 'default',
    transition: 'all 0.2s ease',
  }}
    onClick={onClick}
    className="analytics-stage-tile"
  >
    <div style={{ fontSize: '1.2rem' }}>{emoji}</div>
    <div style={{ fontSize: '1.4rem', fontWeight: 800, color }}>{count}</div>
    <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', fontWeight: 600, textAlign: 'center', lineHeight: 1.3 }}>{label}</div>
  </div>
);

export default function AnalyticsDashboard({ role }) {
  const [activeTab, setActiveTab] = useState('overview');
  const [summary, setSummary] = useState(null);
  const [stages, setStages] = useState([]);
  const [doctors, setDoctors] = useState([]);
  const [drugs, setDrugs] = useState(null);
  const [rejections, setRejections] = useState(null);
  const [history, setHistory] = useState({ data: [], total: 0, page: 1, total_pages: 1 });
  const [audit, setAudit] = useState([]);
  const [expandedReqId, setExpandedReqId] = useState(null);

  // New state variables for Workflow Tracker & global Audit Trail
  const [trackerData, setTrackerData] = useState([]);
  const [trackerSearch, setTrackerSearch] = useState('');
  const [expandedWorkflowId, setExpandedWorkflowId] = useState(null);
  const [expandedDoctorName, setExpandedDoctorName] = useState(null);
  const [auditTrailData, setAuditTrailData] = useState([]);
  const [auditTrailLoading, setAuditTrailLoading] = useState(false);

  // Drilldown modal state
  const [drilldownOpen, setDrilldownOpen] = useState(false);
  const [drilldownTitle, setDrilldownTitle] = useState('');
  const [drilldownKey, setDrilldownKey] = useState(null);
  const [drilldownType, setDrilldownType] = useState(null); // 'metric' or 'stage'
  const [drilldownData, setDrilldownData] = useState([]);
  const [drilldownLoading, setDrilldownLoading] = useState(false);
  const [drilldownSearch, setDrilldownSearch] = useState('');
  const [drilldownSort, setDrilldownSort] = useState('newest'); // 'newest' | 'oldest' | 'stage'
  const [drilldownExpandedId, setDrilldownExpandedId] = useState(null);
  const [drilldownAudit, setDrilldownAudit] = useState([]);
  const [drilldownAuditLoading, setDrilldownAuditLoading] = useState(false);

  const openDrilldown = useCallback(async (type, key, label) => {
    setDrilldownType(type);
    setDrilldownKey(key);
    setDrilldownTitle(label);
    setDrilldownOpen(true);
    setDrilldownLoading(true);
    setDrilldownSearch('');
    setDrilldownSort('newest');
    setDrilldownExpandedId(null);
    setDrilldownAudit([]);
    try {
      const res = await axios.get(`${API}/analytics/drilldown`, { params: { type, key } });
      setDrilldownData(res.data || []);
    } catch (err) {
      console.error('Failed to fetch drilldown data:', err);
      setDrilldownData([]);
    } finally {
      setDrilldownLoading(false);
    }
  }, []);

  const loadDrilldownAudit = async (requestId) => {
    if (drilldownExpandedId === requestId) {
      setDrilldownExpandedId(null);
      return;
    }
    setDrilldownAuditLoading(true);
    setDrilldownExpandedId(requestId);
    setDrilldownAudit([]);
    try {
      const r = await axios.get(`${API}/audit/${requestId}?role=${role}`);
      setDrilldownAudit(r.data || []);
    } catch (err) {
      console.error('Failed to load audit:', err);
    } finally {
      setDrilldownAuditLoading(false);
    }
  };

  const [loading, setLoading] = useState({});
  const [histSearch, setHistSearch] = useState('');
  const [histStage, setHistStage] = useState('');
  const [histPage, setHistPage] = useState(1);
  const [docSearch, setDocSearch] = useState('');
  const [docRole, setDocRole] = useState('');
  const [docSort, setDocSort] = useState({ col: 'total_requests', dir: 'desc' });
  const [lastRefresh, setLastRefresh] = useState(null);

  const setLoad = (key, val) => setLoading(prev => ({ ...prev, [key]: val }));

  const loadWorkflowTracker = useCallback(async () => {
    setLoad('tracker', true);
    try {
      const params = { role };
      const storedUserId = localStorage.getItem('userid');
      if (storedUserId) params.userId = storedUserId;
      const r = await axios.get(`${API}/analytics/workflow-tracker`, { params });
      setTrackerData(r.data || []);
    } catch (err) {
      console.error('loadWorkflowTracker error:', err);
    } finally {
      setLoad('tracker', false);
    }
  }, [role]);

  const loadAuditTrail = useCallback(async () => {
    setAuditTrailLoading(true);
    try {
      const params = { role };
      const storedUserId = localStorage.getItem('userid');
      if (storedUserId) params.userId = storedUserId;
      const r = await axios.get(`${API}/analytics/audit-trail`, { params });
      setAuditTrailData(r.data || []);
    } catch (err) {
      console.error('loadAuditTrail error:', err);
    } finally {
      setAuditTrailLoading(false);
    }
  }, [role]);

  const loadSummary = useCallback(async () => {
    setLoad('summary', true);
    try {
      const r = await axios.get(`${API}/analytics/summary`);
      setSummary(r.data);
    } catch { setSummary(null); } finally { setLoad('summary', false); }
  }, []);

  const loadStages = useCallback(async () => {
    setLoad('stages', true);
    try {
      const r = await axios.get(`${API}/analytics/workflow-stages`);
      setStages(r.data || []);
    } catch { } finally { setLoad('stages', false); }
  }, []);

  const loadDoctors = useCallback(async () => {
    setLoad('doctors', true);
    try {
      const r = await axios.get(`${API}/analytics/doctor-performance`);
      setDoctors(r.data || []);
    } catch { } finally { setLoad('doctors', false); }
  }, []);

  const loadDrugs = useCallback(async () => {
    setLoad('drugs', true);
    try {
      const r = await axios.get(`${API}/analytics/drug-analytics`);
      setDrugs(r.data);
    } catch { } finally { setLoad('drugs', false); }
  }, []);

  const loadRejections = useCallback(async () => {
    setLoad('rejections', true);
    try {
      const r = await axios.get(`${API}/analytics/rejection-breakdown`);
      setRejections(r.data);
    } catch { } finally { setLoad('rejections', false); }
  }, []);

  // Rejections and Orders tab detailed request states
  const [rejectedRequests, setRejectedRequests] = useState([]);
  const [rejectedLoading, setRejectedLoading] = useState(false);
  const [rejectedSearch, setRejectedSearch] = useState('');
  const [rejectedSort, setRejectedSort] = useState('newest');
  const [rejectedExpandedId, setRejectedExpandedId] = useState(null);
  const [rejectedAudit, setRejectedAudit] = useState([]);
  const [rejectedAuditLoading, setRejectedAuditLoading] = useState(false);

  const [orderedRequests, setOrderedRequests] = useState([]);
  const [orderedLoading, setOrderedLoading] = useState(false);
  const [orderedSearch, setOrderedSearch] = useState('');
  const [orderedSort, setOrderedSort] = useState('newest');
  const [orderedExpandedId, setOrderedExpandedId] = useState(null);
  const [orderedAudit, setOrderedAudit] = useState([]);
  const [orderedAuditLoading, setOrderedAuditLoading] = useState(false);

  const loadRejectedRequests = useCallback(async () => {
    setRejectedLoading(true);
    try {
      const res = await axios.get(`${API}/analytics/drilldown`, { params: { type: 'metric', key: 'total_rejected' } });
      setRejectedRequests(res.data || []);
    } catch (err) {
      console.error('Failed to load rejected requests:', err);
    } finally {
      setRejectedLoading(false);
    }
  }, []);

  const loadOrderedRequests = useCallback(async () => {
    setOrderedLoading(true);
    try {
      const res = await axios.get(`${API}/analytics/drilldown`, { params: { type: 'metric', key: 'total_order_placed' } });
      setOrderedRequests(res.data || []);
    } catch (err) {
      console.error('Failed to load ordered requests:', err);
    } finally {
      setOrderedLoading(false);
    }
  }, []);

  const loadRejectedAudit = async (requestId) => {
    if (rejectedExpandedId === requestId) {
      setRejectedExpandedId(null);
      return;
    }
    setRejectedAuditLoading(true);
    setRejectedExpandedId(requestId);
    setRejectedAudit([]);
    try {
      const r = await axios.get(`${API}/audit/${requestId}?role=${role}`);
      setRejectedAudit(r.data || []);
    } catch (err) {
      console.error('Failed to load audit:', err);
    } finally {
      setRejectedAuditLoading(false);
    }
  };

  const loadOrderedAudit = async (requestId) => {
    if (orderedExpandedId === requestId) {
      setOrderedExpandedId(null);
      return;
    }
    setOrderedAuditLoading(true);
    setOrderedExpandedId(requestId);
    setOrderedAudit([]);
    try {
      const r = await axios.get(`${API}/audit/${requestId}?role=${role}`);
      setOrderedAudit(r.data || []);
    } catch (err) {
      console.error('Failed to load audit:', err);
    } finally {
      setOrderedAuditLoading(false);
    }
  };

  const loadHistory = useCallback(async (page = 1, search = '', stage = '') => {
    setLoad('history', true);
    try {
      const params = { page, limit: 20 };
      if (search) params.search = search;
      if (stage) params.stage = stage;
      const r = await axios.get(`${API}/analytics/request-history`, { params });
      setHistory(r.data);
    } catch { } finally { setLoad('history', false); }
  }, []);

  const loadAudit = async (requestId) => {
    if (expandedReqId === requestId) { setExpandedReqId(null); return; }
    try {
      const r = await axios.get(`${API}/audit/${requestId}?role=${role}`);
      setAudit(r.data);
      setExpandedReqId(requestId);
    } catch { }
  };

  // Load data lazily when tab is activated
  useEffect(() => {
    if (activeTab === 'overview') { loadSummary(); loadStages(); }
    if (activeTab === 'workflow') { loadWorkflowTracker(); }
    if (activeTab === 'doctors') { loadDoctors(); }
    if (activeTab === 'requests') { loadHistory(histPage, histSearch, histStage); }
    if (activeTab === 'rejections') { loadRejections(); loadRejectedRequests(); }
    if (activeTab === 'procurement') { loadDrugs(); }
    if (activeTab === 'orders') { loadSummary(); loadOrderedRequests(); }
    if (activeTab === 'audit_trail') { loadAuditTrail(); }
  }, [activeTab, loadWorkflowTracker, loadAuditTrail, loadSummary, loadStages, loadDoctors, loadHistory, histPage, histSearch, histStage, loadRejections, loadRejectedRequests, loadDrugs, loadOrderedRequests]);

  const handleRefresh = async () => {
    await Promise.all([
      loadSummary(), loadStages(), loadDoctors(), loadDrugs(), loadRejections(),
      loadHistory(histPage, histSearch, histStage), loadWorkflowTracker(), loadAuditTrail(),
      loadRejectedRequests(), loadOrderedRequests()
    ]);
    setLastRefresh(new Date());
  };

  // Doctor table sort + filter
  const filteredDoctors = doctors.filter(d => {
    const matchSearch = !docSearch || d.name.toLowerCase().includes(docSearch.toLowerCase()) || (d.department || '').toLowerCase().includes(docSearch.toLowerCase());
    const matchRole = !docRole || d.role.toLowerCase() === docRole.toLowerCase();
    return matchSearch && matchRole;
  }).sort((a, b) => {
    const mul = docSort.dir === 'asc' ? 1 : -1;
    if (typeof a[docSort.col] === 'number') return (a[docSort.col] - b[docSort.col]) * mul;
    return String(a[docSort.col] || '').localeCompare(String(b[docSort.col] || '')) * mul;
  });

  const sortToggle = (col) => setDocSort(prev =>
    prev.col === col ? { col, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { col, dir: 'desc' }
  );

  const sortIcon = (col) => docSort.col === col ? (docSort.dir === 'asc' ? ' ▲' : ' ▼') : ' ⇅';

  // Stage map for tiles
  const stageMap = {};
  stages.forEach(s => { stageMap[s.stage] = s.count; });

  const STAGE_TILES = [
    { key: 'HOD', label: 'HOD Review', emoji: '👤', color: '#0ea5e9' },
    { key: 'PharmacistInitialReview', label: 'Pharm Initial', emoji: '💊', color: '#7c3aed' },
    { key: 'PharmacyHead', label: 'PH Review 1', emoji: '🏥', color: '#059669' },
    { key: 'DTCCommittee', label: 'DTC Review 1', emoji: '🏛️', color: '#d97706' },
    { key: 'Pharmacist', label: 'Pharm Analysis', emoji: '🔬', color: '#8b5cf6' },
    { key: 'PharmacyHeadReview2', label: 'PH Review 2', emoji: '🔁', color: '#10b981' },
    { key: 'DTCFinal', label: 'DTC Final', emoji: '✅', color: '#f59e0b' },
    { key: 'CEO', label: 'CEO Approval', emoji: '👔', color: '#6366f1' },
    { key: 'PharmacistOrder', label: 'Pharm Order', emoji: '📋', color: '#0284c7' },
    { key: 'OrderPlaced', label: 'Order Placed', emoji: '📦', color: '#1d4ed8' },
    { key: 'Final', label: 'Final Approved', emoji: '🏆', color: '#059669' },
    { key: 'EmergencyDTC', label: 'Emergency', emoji: '🚨', color: '#dc2626' },
    { key: 'Rejected', label: 'Rejected', emoji: '❌', color: '#ef4444' },
  ];

  const TABS = [
    { key: 'overview', label: '📊 Overview' },
    { key: 'workflow', label: '🔄 Workflow Tracker' },
    { key: 'doctors', label: '👨‍⚕️ Doctors & HODs' },
    { key: 'requests', label: '📋 Requests' },
    { key: 'rejections', label: '❌ Rejections' },
    { key: 'procurement', label: '💊 Procurement' },
    { key: 'orders', label: '📦 Orders' },
    { key: 'audit_trail', label: '📜 Audit Trail' }
  ];

  const filteredAndSortedDrilldown = drilldownData.filter(r => {
    const q = (drilldownSearch || '').toLowerCase();
    return (
      String(r.request_id || '').includes(q) ||
      String(r.doctor_name || '').toLowerCase().includes(q) ||
      String(r.department || '').toLowerCase().includes(q) ||
      String(r.brand_name || '').toLowerCase().includes(q) ||
      String(r.generic_name || '').toLowerCase().includes(q) ||
      String(r.current_stage || '').toLowerCase().includes(q) ||
      String(r.status || '').toLowerCase().includes(q)
    );
  }).sort((a, b) => {
    if (drilldownSort === 'newest') {
      return new Date(b.created_at) - new Date(a.created_at);
    }
    if (drilldownSort === 'oldest') {
      return new Date(a.created_at) - new Date(b.created_at);
    }
    if (drilldownSort === 'stage') {
      return String(a.current_stage || '').localeCompare(String(b.current_stage || ''));
    }
    return 0;
  });

  return (
    <div className="analytics-console">

      {/* ── Console Header ── */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        marginBottom: 20, flexWrap: 'wrap', gap: 12,
      }}>
        <div>
          <div style={{ fontWeight: 800, fontSize: '1.15rem', color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ width: 36, height: 36, borderRadius: 10, background: 'rgba(14,165,233,0.15)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.1rem' }}>🏥</span>
            Hospital Formulary Intelligence Console
          </div>
          <div style={{ fontSize: '0.78rem', color: 'var(--text-subtle)', marginTop: 3, marginLeft: 44 }}>
            {role === 'Admin' ? 'Admin Analytics Control' : (role === 'DTCCommittee' ? 'DTC Committee Analytics' : 'CEO Executive Analytics')} &nbsp;·&nbsp;
            {lastRefresh ? `Last refreshed ${fmtDateTime(lastRefresh)}` : 'Live data'}
          </div>
        </div>
        <button
          className="btn btn-ghost btn-sm"
          onClick={handleRefresh}
          style={{ flexShrink: 0, borderColor: 'var(--primary)', color: 'var(--primary)' }}
        >
          ↻ Refresh All
        </button>
      </div>

      {/* ── Analytics Tab Nav ── */}
      <div className="analytics-tab-nav" style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 20 }}>
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            style={{
              padding: '7px 14px', borderRadius: 8, border: activeTab === t.key ? 'none' : '1px solid var(--border)',
              background: activeTab === t.key ? 'var(--primary)' : 'transparent',
              color: activeTab === t.key ? '#fff' : 'var(--text-muted)',
              fontWeight: activeTab === t.key ? 700 : 500,
              fontSize: '0.82rem', cursor: 'pointer', fontFamily: 'inherit',
              transition: 'var(--transition)', whiteSpace: 'nowrap',
            }}
          >{t.label}</button>
        ))}
      </div>

      {/* ===================== OVERVIEW TAB ===================== */}
      {activeTab === 'overview' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>

          {/* KPI Grid */}
          <div>
            <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 12 }}>
              📊 System-Wide KPIs
            </div>
            {loading.summary ? (
              <div style={{ textAlign: 'center', padding: 40 }}><div className="spinner" /></div>
            ) : (
              <div className="analytics-kpi-grid">
                <KpiCard icon="📋" label="Total Requests" value={summary?.total_requests} color="#0ea5e9" onClick={() => openDrilldown('metric', 'total_requests', 'Total Requests')} />
                <KpiCard icon="⏳" label="Pending" value={summary?.total_pending} color="#d97706" onClick={() => openDrilldown('metric', 'total_pending', 'Pending Requests')} />
                <KpiCard icon="✅" label="Approved" value={summary?.total_approved} color="#059669" onClick={() => openDrilldown('metric', 'total_approved', 'Approved Requests')} />
                <KpiCard icon="❌" label="Rejected" value={summary?.total_rejected} color="#dc2626" onClick={() => openDrilldown('metric', 'total_rejected', 'Rejected Requests')} />
                <KpiCard icon="🚨" label="Emergency" value={summary?.total_emergency} color="#ef4444" onClick={() => openDrilldown('metric', 'total_emergency', 'Emergency Requests')} />
                <KpiCard icon="📦" label="Orders Placed" value={summary?.total_order_placed} color="#1d4ed8" onClick={() => openDrilldown('metric', 'total_order_placed', 'Orders Placed')} />
                <KpiCard icon="🏆" label="Final Approved" value={summary?.total_final_approved} color="#059669" sub="Stage: Final" onClick={() => openDrilldown('metric', 'total_final_approved', 'Final Approved Requests')} />
                <KpiCard icon="🏛️" label="Under DTC Review" value={summary?.total_dtc_review} color="#f59e0b" onClick={() => openDrilldown('metric', 'total_dtc_review', 'Under DTC Review')} />
                <KpiCard icon="👔" label="Under CEO Review" value={summary?.total_ceo_review} color="#6366f1" onClick={() => openDrilldown('metric', 'total_ceo_review', 'Under CEO Review')} />
                <KpiCard icon="🩺" label="Clinical Initiated" value={summary?.total_clinical} color="#7c3aed" sub="Non-Promotional" onClick={() => openDrilldown('metric', 'total_clinical', 'Clinical Initiated')} />
              </div>
            )}
          </div>

          {/* Source + Formulary Split */}
          {summary && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <div className="card" style={{ padding: '18px 20px' }}>
                <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 14 }}>Request Source Split</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <RankBar name="🩺 Clinical Initiated" count={summary.total_clinical} max={summary.total_requests} color="#7c3aed" />
                  <RankBar name="📋 Via Medical Representative" count={summary.total_via_rep} max={summary.total_requests} color="#0ea5e9" />
                </div>
              </div>
              <div className="card" style={{ padding: '18px 20px' }}>
                <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 14 }}>Formulary Type Split</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <RankBar name="📗 Formulary" count={summary.total_formulary} max={summary.total_requests} color="#059669" />
                  <RankBar name="📕 Non-Formulary" count={summary.total_non_formulary} max={summary.total_requests} color="#dc2626" />
                </div>
              </div>
            </div>
          )}

          {/* Workflow Stage Strip */}
          <div>
            <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 12 }}>
              🔄 Current Workflow Distribution
            </div>
            <div style={{ display: 'flex', gap: 10, overflowX: 'auto', paddingBottom: 8, WebkitOverflowScrolling: 'touch' }}>
              {STAGE_TILES.map(tile => (
                <StageTile key={tile.key} label={tile.label} count={stageMap[tile.key] || 0} color={tile.color} emoji={tile.emoji} onClick={() => openDrilldown('stage', tile.key, tile.label)} />
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ===================== WORKFLOW TAB ===================== */}
      {activeTab === 'workflow' && (() => {
        const STAGES_LIST = [
          { key: 'doctor', label: 'Doctor/HOD' },
          { key: 'pharmacist_initial', label: 'Pharmacist Initial Review' },
          { key: 'pharmacy_head_review1', label: 'Pharmacy Head Review 1' },
          { key: 'dtc_review1', label: 'DTC Review 1' },
          { key: 'pharmacist_analysis', label: 'Pharmacist Analysis' },
          { key: 'pharmacy_head_review2', label: 'Pharmacy Head Review 2' },
          { key: 'dtc_final', label: 'DTC Final Selection' },
          { key: 'ceo', label: 'CEO Approval' },
          { key: 'order_placed', label: 'Pharmacist Order Placement' },
          { key: 'completed', label: 'Completed' }
        ];

        const formatStageLocal = (stage) => {
          if (!stage) return '—';
          const m = {
            'HOD': 'HOD Review',
            'PHARMACIST_INITIAL': 'Pharmacist Initial',
            'PHARMACY_HEAD': 'Pharmacy Head',
            'PHARMACY_HEAD_REVIEW1': 'Pharmacy Head',
            'DTC_REVIEW1': 'DTC Review 1',
            'PHARMACIST_ANALYSIS': 'Pharmacist Analysis',
            'PHARMACY_HEAD_REVIEW2': 'Pharmacy Head Review 2',
            'DTC_FINAL': 'DTC Final',
            'CEO': 'CEO Approval',
            'ORDER_PLACED': 'Order Placement',
            'COMPLETED': 'Completed'
          };
          return m[stage] || stage;
        };

        const getStageIndexKey = (stage, status) => {
          const s = String(stage).toUpperCase();
          const statusLower = (status || '').toLowerCase();
          if (s === 'HOD') return 0;
          if (s === 'PHARMACIST_INITIAL') return 1;
          if (s === 'PHARMACY_HEAD' || s === 'PHARMACY_HEAD_REVIEW1') return 2;
          if (s === 'DTC_REVIEW1') return 3;
          if (s === 'PHARMACIST_ANALYSIS') return 4;
          if (s === 'PHARMACY_HEAD_REVIEW2') return 5;
          if (s === 'DTC_FINAL') return 6;
          if (s === 'CEO') return 7;
          if (s === 'ORDER_PLACED' || s === 'COMPLETED' || statusLower === 'approved' || statusLower === 'order_placed') {
            if (statusLower === 'approved' || statusLower === 'order_placed') return 9;
            return 8;
          }
          return 2;
        };

        const getOwnerBadgeStyle = (owner) => {
          const base = { padding: '3px 8px', borderRadius: 99, fontSize: '0.72rem', fontWeight: 700 };
          switch (owner) {
            case 'HOD':
              return { ...base, background: 'rgba(14,165,233,0.12)', color: '#0284c7' };
            case 'Pharmacist':
              return { ...base, background: 'rgba(124,58,237,0.12)', color: '#7c3aed' };
            case 'Pharmacy Head':
              return { ...base, background: 'rgba(16,185,129,0.12)', color: '#059669' };
            case 'DTC':
              return { ...base, background: 'rgba(245,158,11,0.12)', color: '#d97706' };
            case 'CEO':
              return { ...base, background: 'rgba(99,102,241,0.12)', color: '#4f46e5' };
            case 'Completed':
              return { ...base, background: 'rgba(16,185,129,0.12)', color: '#16a34a' };
            case 'Rejected':
              return { ...base, background: 'rgba(220,38,38,0.12)', color: '#dc2626' };
            default:
              return base;
          }
        };

        const countHOD = trackerData.filter(r => r.current_owner === 'HOD').length;
        const countPharm = trackerData.filter(r => r.current_owner === 'Pharmacist').length;
        const countPH = trackerData.filter(r => r.current_owner === 'Pharmacy Head').length;
        const countDTC = trackerData.filter(r => r.current_owner === 'DTC').length;
        const countCEO = trackerData.filter(r => r.current_owner === 'CEO').length;
        const countCompleted = trackerData.filter(r => r.current_owner === 'Completed').length;

        const filteredTracker = trackerData.filter(r => {
          const q = trackerSearch.toLowerCase();
          return (
            String(r.request_id).includes(q) ||
            String(r.requester_name).toLowerCase().includes(q) ||
            String(r.department).toLowerCase().includes(q) ||
            String(r.brand_name).toLowerCase().includes(q) ||
            String(r.generic_name).toLowerCase().includes(q) ||
            String(r.current_stage).toLowerCase().includes(q) ||
            String(r.current_owner).toLowerCase().includes(q) ||
            String(r.status).toLowerCase().includes(q)
          );
        });

        // Doctor Journey calculations
        const doctorJourneyMap = {};
        trackerData.forEach(r => {
          const docName = r.requester_name || 'Unknown Doctor';
          if (!doctorJourneyMap[docName]) {
            doctorJourneyMap[docName] = {
              name: docName,
              active: 0,
              approved: 0,
              rejected: 0,
              completed: 0,
              requests: []
            };
          }
          
          const statusLower = (r.status || '').toLowerCase();
          const isCompleted = r.current_owner === 'Completed' || statusLower === 'approved' || statusLower === 'order_placed';
          const isRejected = statusLower.includes('rejected') || statusLower === 'rejected';
          const isActive = !isCompleted && !isRejected;
          const isApproved = statusLower === 'approved' || statusLower.includes('approved') || statusLower === 'order_placed' || r.current_stage === 'ORDER_PLACED';

          if (isCompleted) {
            doctorJourneyMap[docName].completed++;
          } else if (isRejected) {
            doctorJourneyMap[docName].rejected++;
          } else if (isActive) {
            doctorJourneyMap[docName].active++;
          }

          if (isApproved && !isCompleted) {
            doctorJourneyMap[docName].approved++;
          }

          let friendlyStage = formatStageLocal(r.current_stage);
          if (isCompleted) friendlyStage = 'Completed';
          else if (isRejected) friendlyStage = 'Rejected';

          doctorJourneyMap[docName].requests.push({
            id: r.request_id,
            brand: r.brand_name,
            stage: friendlyStage
          });
        });

        const doctorJourneyList = Object.values(doctorJourneyMap);

        const renderTimelineStepper = (r) => {
          const statusLower = (r.status || '').toLowerCase();
          const isRejected = statusLower.includes('rejected') || statusLower === 'rejected';
          const currIdx = getStageIndexKey(r.current_stage, r.status);

          return (
            <div className="workflow-stepper">
              {STAGES_LIST.map((step, i) => {
                let stepClass = 'step-future';
                let icon = i + 1;

                if (i < currIdx) {
                  stepClass = 'step-completed';
                  icon = '✓';
                } else if (i === currIdx) {
                  if (isRejected) {
                    stepClass = 'step-rejected';
                    icon = '✕';
                  } else if (r.is_reverted) {
                    stepClass = 'step-reverted';
                    icon = '↺';
                  } else if (currIdx === 9) {
                    stepClass = 'step-completed';
                    icon = '✓';
                  } else {
                    stepClass = 'step-active';
                    icon = '●';
                  }
                }

                return (
                  <div key={step.key} className={`workflow-step ${stepClass}`}>
                    <div className="workflow-step-dot">{icon}</div>
                    <div className="workflow-step-label">{step.label}</div>
                  </div>
                );
              })}
            </div>
          );
        };

        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            
            {/* KPI Grid */}
            <div className="analytics-kpi-grid">
              <KpiCard icon="👤" label="Pending at HOD" value={countHOD} color="#0ea5e9" onClick={() => openDrilldown('stage', 'HOD', 'Pending at HOD')} />
              <KpiCard icon="💊" label="Pending at Pharmacist" value={countPharm} color="#7c3aed" onClick={() => openDrilldown('stage', 'PharmacistInitialReview', 'Pending at Pharmacist')} />
              <KpiCard icon="🏥" label="Pending at Pharmacy Head" value={countPH} color="#059669" onClick={() => openDrilldown('stage', 'PharmacyHead', 'Pending at Pharmacy Head')} />
              <KpiCard icon="🏛️" label="Pending at DTC" value={countDTC} color="#d97706" onClick={() => openDrilldown('stage', 'DTCCommittee', 'Pending at DTC')} />
              <KpiCard icon="👔" label="Pending at CEO" value={countCEO} color="#6366f1" onClick={() => openDrilldown('stage', 'CEO', 'Pending at CEO')} />
              <KpiCard icon="✅" label="Completed" value={countCompleted} color="#10b981" onClick={() => openDrilldown('stage', 'Final', 'Completed Requests')} />
            </div>

            {/* Workflow Tracker Card */}
            <div className="card" style={{ padding: '20px 24px' }}>
              <div className="card-title"><div className="icon">🔄</div>Workflow Tracker</div>

              {/* Filters */}
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
                <input
                  className="form-input"
                  placeholder="Search by ID, doctor, department, drug, generic…"
                  value={trackerSearch}
                  onChange={e => setTrackerSearch(e.target.value)}
                  style={{ flex: '1 1 300px', maxWidth: 400 }}
                />
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center' }}>
                  {filteredTracker.length} request{filteredTracker.length !== 1 ? 's' : ''} monitored
                </div>
              </div>

              {loading.tracker ? (
                <div style={{ textAlign: 'center', padding: 40 }}><div className="spinner" /></div>
              ) : (
                <>
                  {/* Desktop Table View */}
                  <div className="table-wrap tracker-desktop-table">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>Request ID</th>
                          <th>Doctor/HOD</th>
                          <th>Department</th>
                          <th>Drug</th>
                          <th>Generic</th>
                          <th>Current Stage</th>
                          <th>Current Owner</th>
                          <th>Status</th>
                          <th>Days</th>
                          <th>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredTracker.length === 0 ? (
                          <tr className="empty-row"><td colSpan={10}>No requests found.</td></tr>
                        ) : filteredTracker.map(r => (
                          <React.Fragment key={r.request_id}>
                            <tr>
                              <td style={{ fontWeight: 700, color: 'var(--primary-light)' }}>DR-{r.request_id}</td>
                              <td style={{ fontWeight: 600 }}>{r.requester_name}</td>
                              <td style={{ fontSize: '0.82rem' }}>{r.department}</td>
                              <td style={{ fontWeight: 600 }}>{r.brand_name}</td>
                              <td style={{ color: 'var(--text-muted)' }}>{r.generic_name}</td>
                              <td style={{ fontSize: '0.82rem' }}>{formatStageLocal(r.current_stage)}</td>
                              <td>
                                <span style={getOwnerBadgeStyle(r.current_owner)}>{r.current_owner}</span>
                              </td>
                              <td>
                                <span style={{
                                  padding: '3px 8px', borderRadius: 99, fontSize: '0.72rem', fontWeight: 700,
                                  background: STATUS_COLOR(r.status) + '1a',
                                  color: STATUS_COLOR(r.status),
                                  border: `1px solid ${STATUS_COLOR(r.status)}40`
                                }}>{r.status}</span>
                              </td>
                              <td>
                                <span style={{
                                  padding: '2px 8px', borderRadius: 6, fontSize: '0.75rem', fontWeight: 700,
                                  background: r.days_in_stage > 7 ? 'rgba(220,38,38,0.1)' : r.days_in_stage > 3 ? 'rgba(217,119,6,0.1)' : 'rgba(5,150,105,0.1)',
                                  color: r.days_in_stage > 7 ? '#dc2626' : r.days_in_stage > 3 ? '#d97706' : '#059669'
                                }}>{r.days_in_stage} d</span>
                              </td>
                              <td>
                                <button className="btn btn-ghost btn-sm" onClick={() => setExpandedWorkflowId(expandedWorkflowId === r.request_id ? null : r.request_id)}>
                                  {expandedWorkflowId === r.request_id ? '▲ Hide' : '▼ View'}
                                </button>
                              </td>
                            </tr>
                            {expandedWorkflowId === r.request_id && (
                              <tr>
                                <td colSpan={10} style={{ background: 'var(--bg-card2)', padding: '20px 24px' }}>
                                  <div style={{ fontWeight: 700, fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: 12 }}>
                                    WORKFLOW STAGE PROGRESS — DR-{r.request_id}
                                  </div>
                                  {renderTimelineStepper(r)}
                                </td>
                              </tr>
                            )}
                          </React.Fragment>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Mobile Cards View */}
                  <div className="tracker-mobile-cards">
                    {filteredTracker.length === 0 ? (
                      <div style={{ textAlign: 'center', padding: 20, color: 'var(--text-subtle)' }}>No requests found.</div>
                    ) : filteredTracker.map(r => (
                      <div key={r.request_id} className="card" style={{ padding: 16, marginBottom: 12, borderLeft: `4px solid ${r.days_in_stage > 7 ? '#dc2626' : r.days_in_stage > 3 ? '#d97706' : '#059669'}` }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                          <span style={{ fontWeight: 700 }}>DR-{r.request_id}</span>
                          <span style={{ fontSize: '0.72rem', fontWeight: 700, padding: '2px 8px', borderRadius: 4, background: r.days_in_stage > 7 ? 'rgba(220,38,38,0.1)' : r.days_in_stage > 3 ? 'rgba(217,119,6,0.1)' : 'rgba(5,150,105,0.1)', color: r.days_in_stage > 7 ? '#dc2626' : r.days_in_stage > 3 ? '#d97706' : '#059669' }}>
                            {r.days_in_stage} day{r.days_in_stage !== 1 ? 's' : ''}
                          </span>
                        </div>
                        <div style={{ fontSize: '0.82rem', marginBottom: 6 }}>
                          <strong>Doctor:</strong> {r.requester_name} ({r.department})
                        </div>
                        <div style={{ fontSize: '0.82rem', marginBottom: 8 }}>
                          <strong>Drug:</strong> {r.brand_name} ({r.generic_name})
                        </div>
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
                          <span className="badge" style={{ fontSize: '0.72rem' }}>Stage: {formatStageLocal(r.current_stage)}</span>
                          <span style={getOwnerBadgeStyle(r.current_owner)}>{r.current_owner}</span>
                          <span className="badge" style={{ fontSize: '0.72rem' }}>Status: {r.status}</span>
                        </div>
                        <button className="btn btn-ghost btn-sm" style={{ width: '100%' }} onClick={() => setExpandedWorkflowId(expandedWorkflowId === r.request_id ? null : r.request_id)}>
                          {expandedWorkflowId === r.request_id ? '▲ Hide Timeline' : '▼ View Workflow'}
                        </button>
                        {expandedWorkflowId === r.request_id && (
                          <div style={{ marginTop: 16, background: 'var(--bg-card)', padding: 12, borderRadius: 8 }}>
                            {renderTimelineStepper(r)}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>

            {/* Doctor Request Journey */}
            <div className="card" style={{ padding: '20px 24px' }}>
              <div className="card-title"><div className="icon">👨‍⚕️</div>Doctor Request Journey</div>
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Doctor</th>
                      <th>Active Requests</th>
                      <th>Approved</th>
                      <th>Rejected</th>
                      <th>Completed</th>
                    </tr>
                  </thead>
                  <tbody>
                    {doctorJourneyList.length === 0 ? (
                      <tr className="empty-row"><td colSpan={5}>No journeys recorded.</td></tr>
                    ) : doctorJourneyList.map(doc => (
                      <React.Fragment key={doc.name}>
                        <tr style={{ cursor: 'pointer' }} onClick={() => setExpandedDoctorName(expandedDoctorName === doc.name ? null : doc.name)}>
                          <td style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span>{expandedDoctorName === doc.name ? '▼' : '▶'}</span>
                            <span>{doc.name}</span>
                          </td>
                          <td><span className="badge" style={{ background: '#dbeafe', color: '#1d4ed8', fontSize: '0.75rem', fontWeight: 700 }}>{doc.active}</span></td>
                          <td><span className="badge" style={{ background: '#d1fae5', color: '#065f46', fontSize: '0.75rem', fontWeight: 700 }}>{doc.approved}</span></td>
                          <td><span className="badge" style={{ background: '#fee2e2', color: '#991b1b', fontSize: '0.75rem', fontWeight: 700 }}>{doc.rejected}</span></td>
                          <td><span className="badge" style={{ background: '#dcfce7', color: '#166534', fontSize: '0.75rem', fontWeight: 700 }}>{doc.completed}</span></td>
                        </tr>
                        {expandedDoctorName === doc.name && (
                          <tr>
                            <td colSpan={5} style={{ background: 'var(--bg-card2)', padding: '14px 20px' }}>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                                <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 4 }}>
                                  Individual Request Stage Details:
                                </div>
                                {doc.requests.map(req => (
                                  <div key={req.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
                                    <span><strong>DR-{req.id}</strong> — {req.brand}</span>
                                    <span style={{ fontWeight: 700, color: 'var(--primary)' }}>Stage: {req.stage}</span>
                                  </div>
                                ))}
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

          </div>
        );
      })()}

      {/* ===================== DOCTORS & HODS TAB ===================== */}
      {activeTab === 'doctors' && (
        <div className="card" style={{ padding: '20px 24px' }}>
          <div className="card-title"><div className="icon">👨‍⚕️</div>Doctor & HOD Performance Analytics</div>

          {/* Filters */}
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
            <input
              className="form-input"
              placeholder="Search by name or department…"
              value={docSearch}
              onChange={e => setDocSearch(e.target.value)}
              style={{ flex: '1 1 200px', maxWidth: 300 }}
            />
            <select
              className="form-select"
              value={docRole}
              onChange={e => setDocRole(e.target.value)}
              style={{ flex: '0 0 140px' }}
            >
              <option value="">All Roles</option>
              <option value="Doctor">Doctor</option>
              <option value="HOD">HOD</option>
            </select>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center' }}>
              {filteredDoctors.length} record{filteredDoctors.length !== 1 ? 's' : ''}
            </div>
          </div>

          {loading.doctors ? (
            <div style={{ textAlign: 'center', padding: 40 }}><div className="spinner" /></div>
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    {[
                      ['Name', 'name'],
                      ['Role', 'role'],
                      ['Department', 'department'],
                      ['Total', 'total_requests'],
                      ['✅ Approved', 'approved'],
                      ['❌ Rejected', 'rejected'],
                      ['⏳ Pending', 'pending'],
                      ['🚨 Emergency', 'emergency_count'],
                    ].map(([label, col]) => (
                      <th key={col} style={{ cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }} onClick={() => sortToggle(col)}>
                        {label}{sortIcon(col)}
                      </th>
                    ))}
                    <th>Last Request</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredDoctors.length === 0 ? (
                    <tr className="empty-row"><td colSpan={9}>No records found.</td></tr>
                  ) : filteredDoctors.map(d => (
                    <tr key={d.user_id}>
                      <td style={{ fontWeight: 600 }}>{d.name}</td>
                      <td>
                        <span style={{
                          padding: '2px 8px', borderRadius: 99, fontSize: '0.72rem', fontWeight: 700,
                          background: d.role?.toLowerCase() === 'hod' ? 'rgba(124,58,237,0.12)' : 'rgba(14,165,233,0.12)',
                          color: d.role?.toLowerCase() === 'hod' ? '#7c3aed' : '#0ea5e9',
                        }}>{d.role}</span>
                      </td>
                      <td style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>{d.department}</td>
                      <td style={{ fontWeight: 700, color: 'var(--primary)' }}>{d.total_requests}</td>
                      <td style={{ color: '#059669', fontWeight: 600 }}>{d.approved}</td>
                      <td style={{ color: '#dc2626', fontWeight: 600 }}>{d.rejected}</td>
                      <td style={{ color: '#d97706', fontWeight: 600 }}>{d.pending}</td>
                      <td style={{ color: '#ef4444', fontWeight: 600 }}>{d.emergency_count}</td>
                      <td style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>{fmtDate(d.latest_request)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ===================== REQUEST HISTORY TAB ===================== */}
      {activeTab === 'requests' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="card" style={{ padding: '20px 24px' }}>
            <div className="card-title"><div className="icon">📋</div>
              Request History
              <span style={{ marginLeft: 'auto', fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 400 }}>
                Total: {history.total} records
              </span>
            </div>

            {/* Filters */}
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
              <input
                className="form-input"
                placeholder="Search brand, generic, doctor…"
                value={histSearch}
                onChange={e => setHistSearch(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { setHistPage(1); loadHistory(1, histSearch, histStage); } }}
                style={{ flex: '1 1 220px', maxWidth: 320 }}
              />
              <select
                className="form-select"
                value={histStage}
                onChange={e => { setHistStage(e.target.value); setHistPage(1); loadHistory(1, histSearch, e.target.value); }}
                style={{ flex: '0 0 180px' }}
              >
                <option value="">All Stages</option>
                {Object.entries(STAGE_DISPLAY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
              <button
                className="btn btn-primary btn-sm"
                onClick={() => { setHistPage(1); loadHistory(1, histSearch, histStage); }}
              >🔍 Search</button>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => { setHistSearch(''); setHistStage(''); setHistPage(1); loadHistory(1, '', ''); }}
              >↺ Reset</button>
            </div>

            {loading.history ? (
              <div style={{ textAlign: 'center', padding: 40 }}><div className="spinner" /></div>
            ) : (
              <>
                <div className="table-wrap">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th className="sticky-col">#ID</th>
                        <th>Doctor</th>
                        <th>Brand Name</th>
                        <th>Generic</th>
                        <th>Form</th>
                        <th>Source</th>
                        <th>Stage</th>
                        <th>Status</th>
                        <th>Submitted</th>
                        <th>DTC Brand</th>
                        <th>Audit</th>
                      </tr>
                    </thead>
                    <tbody>
                      {history.data.length === 0 ? (
                        <tr className="empty-row"><td colSpan={11}>No requests found.</td></tr>
                      ) : history.data.map(r => (
                        <React.Fragment key={r.request_id}>
                          <tr>
                            <td className="sticky-col" style={{ fontWeight: 700, color: 'var(--primary-light)' }}>#{r.request_id}</td>
                            <td>
                              <div style={{ fontWeight: 500, fontSize: '0.85rem' }}>{r.doctor_name}</div>
                              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{r.department}</div>
                            </td>
                            <td style={{ fontWeight: 600 }}>{r.brand_name}</td>
                            <td style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>{r.generic_name}</td>
                            <td style={{ fontSize: '0.78rem' }}>{r.dosage_form}{r.dose_strength ? ` · ${r.dose_strength}` : ''}</td>
                            <td>
                              {r.request_source_type === 'NON_PROMOTIONAL'
                                ? <span className="badge badge-non-promotional" style={{ fontSize: '0.68rem' }}>Clinical</span>
                                : <span className="badge badge-promotional" style={{ fontSize: '0.68rem' }}>Via Rep</span>}
                            </td>
                            <td>
                              <span style={{
                                padding: '2px 8px', borderRadius: 99, fontSize: '0.7rem', fontWeight: 700, whiteSpace: 'nowrap',
                                background: (STAGE_COLOR[r.current_stage] || '#94a3b8') + '1a',
                                color: STAGE_COLOR[r.current_stage] || '#64748b',
                              }}>
                                {STAGE_DISPLAY[r.current_stage] || r.current_stage}
                              </span>
                            </td>
                            <td>
                              <span style={{ fontSize: '0.72rem', fontWeight: 700, color: STATUS_COLOR(r.status) }}>{r.status}</span>
                            </td>
                            <td style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{fmtDate(r.created_at)}</td>
                            <td style={{ fontSize: '0.78rem', color: 'var(--primary)', fontWeight: 600 }}>{r.dtc_selected_brand || '—'}</td>
                            <td>
                              <button
                                className="btn btn-ghost btn-sm"
                                style={{ fontSize: '0.72rem', padding: '4px 8px' }}
                                onClick={() => loadAudit(r.request_id)}
                              >
                                {expandedReqId === r.request_id ? '▲ Hide' : '▼ Trail'}
                              </button>
                            </td>
                          </tr>
                          {expandedReqId === r.request_id && (
                            <tr>
                              <td colSpan={11} style={{ background: 'var(--bg-card2)', padding: '16px 24px' }}>
                                <div style={{ fontWeight: 600, fontSize: '0.78rem', marginBottom: 10, color: 'var(--text-muted)' }}>
                                  AUDIT TRAIL — Request #{r.request_id}
                                </div>
                                {audit.length === 0 ? (
                                  <div style={{ color: 'var(--text-subtle)', fontSize: '0.85rem' }}>No audit entries yet.</div>
                                ) : (
                                  <div className="audit-timeline">
                                    {audit.map(a => (
                                      <div key={a.LOG_ID} className="audit-item">
                                        <div>
                                          <div className="audit-action">{a.ACTION}</div>
                                          <div className="audit-meta">
                                            By <strong>{a.PERFORMER_NAME}</strong> ({a.PERFORMER_ROLE})
                                            {a.FROM_STAGE && ` · ${a.FROM_STAGE} → ${a.TO_STAGE}`}
                                            {' · '}{new Date(a.LOGGED_AT).toLocaleString('en-IN')}
                                          </div>
                                          {a.REMARKS && <div className="audit-remark">"{a.REMARKS}"</div>}
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Pagination */}
                {history.total_pages > 1 && (
                  <div style={{ display: 'flex', gap: 6, justifyContent: 'center', alignItems: 'center', marginTop: 14, flexWrap: 'wrap' }}>
                    <button
                      className="btn btn-ghost btn-sm"
                      disabled={histPage <= 1}
                      onClick={() => { const p = histPage - 1; setHistPage(p); loadHistory(p, histSearch, histStage); }}
                    >← Prev</button>
                    {Array.from({ length: Math.min(history.total_pages, 7) }, (_, i) => {
                      const p = i + 1;
                      return (
                        <button
                          key={p}
                          className="btn btn-sm"
                          style={{
                            background: histPage === p ? 'var(--primary)' : 'transparent',
                            color: histPage === p ? '#fff' : 'var(--text-muted)',
                            border: histPage === p ? 'none' : '1px solid var(--border)',
                          }}
                          onClick={() => { setHistPage(p); loadHistory(p, histSearch, histStage); }}
                        >{p}</button>
                      );
                    })}
                    <button
                      className="btn btn-ghost btn-sm"
                      disabled={histPage >= history.total_pages}
                      onClick={() => { const p = histPage + 1; setHistPage(p); loadHistory(p, histSearch, histStage); }}
                    >Next →</button>
                    <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                      Page {histPage} of {history.total_pages} ({history.total} total)
                    </span>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* ===================== PROCUREMENT (DRUGS) TAB ===================== */}
      {activeTab === 'procurement' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {loading.drugs ? (
            <div style={{ textAlign: 'center', padding: 60 }}><div className="spinner" /></div>
          ) : drugs ? (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px,1fr))', gap: 16 }}>

                {/* Top Requested Brands */}
                <div className="card" style={{ padding: '18px 20px' }}>
                  <div style={{ fontWeight: 700, fontSize: '0.85rem', color: 'var(--text)', marginBottom: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ width: 26, height: 26, borderRadius: 6, background: 'rgba(14,165,233,0.15)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.9rem' }}>📋</span>
                    Top Requested Brands
                  </div>
                  {drugs.top_brands.length === 0
                    ? <div style={{ color: 'var(--text-subtle)', fontSize: '0.85rem' }}>No data yet.</div>
                    : drugs.top_brands.map((d, i) => (
                      <RankBar key={i} name={`${i + 1}. ${d.name}`} count={d.count} max={drugs.top_brands[0]?.count || 1} color="#0ea5e9" />
                    ))}
                </div>

                {/* Top Generics */}
                <div className="card" style={{ padding: '18px 20px' }}>
                  <div style={{ fontWeight: 700, fontSize: '0.85rem', color: 'var(--text)', marginBottom: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ width: 26, height: 26, borderRadius: 6, background: 'rgba(124,58,237,0.15)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.9rem' }}>🔬</span>
                    Top Requested Generics
                  </div>
                  {drugs.top_generics.length === 0
                    ? <div style={{ color: 'var(--text-subtle)', fontSize: '0.85rem' }}>No data yet.</div>
                    : drugs.top_generics.map((d, i) => (
                      <RankBar key={i} name={`${i + 1}. ${d.name}`} count={d.count} max={drugs.top_generics[0]?.count || 1} color="#7c3aed" />
                    ))}
                </div>

                {/* Most Rejected Drugs */}
                <div className="card" style={{ padding: '18px 20px' }}>
                  <div style={{ fontWeight: 700, fontSize: '0.85rem', color: 'var(--text)', marginBottom: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ width: 26, height: 26, borderRadius: 6, background: 'rgba(220,38,38,0.12)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.9rem' }}>❌</span>
                    Most Rejected Brands
                  </div>
                  {drugs.top_rejected.length === 0
                    ? <div style={{ color: 'var(--text-subtle)', fontSize: '0.85rem' }}>No rejections yet.</div>
                    : drugs.top_rejected.map((d, i) => (
                      <RankBar key={i} name={`${i + 1}. ${d.name}`} count={d.count} max={drugs.top_rejected[0]?.count || 1} color="#dc2626" />
                    ))}
                </div>

                {/* Most Approved Drugs */}
                <div className="card" style={{ padding: '18px 20px' }}>
                  <div style={{ fontWeight: 700, fontSize: '0.85rem', color: 'var(--text)', marginBottom: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ width: 26, height: 26, borderRadius: 6, background: 'rgba(5,150,105,0.12)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.9rem' }}>✅</span>
                    Most Approved Brands
                  </div>
                  {drugs.top_approved.length === 0
                    ? <div style={{ color: 'var(--text-subtle)', fontSize: '0.85rem' }}>No approvals yet.</div>
                    : drugs.top_approved.map((d, i) => (
                      <RankBar key={i} name={`${i + 1}. ${d.name}`} count={d.count} max={drugs.top_approved[0]?.count || 1} color="#059669" />
                    ))}
                </div>
              </div>
            </>
          ) : (
            <div style={{ textAlign: 'center', padding: 60, color: 'var(--text-subtle)' }}>Failed to load drug analytics.</div>
          )}
        </div>
      )}

      {/* ===================== REJECTIONS TAB ===================== */}
      {activeTab === 'rejections' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {loading.rejections ? (
            <div style={{ textAlign: 'center', padding: 60 }}><div className="spinner" /></div>
          ) : rejections ? (
            <>
              {/* Breakdown cards */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px,1fr))', gap: 14 }}>
                {[
                  { label: 'Rejected by HOD', value: rejections.rejected_by_hod, color: '#0ea5e9', emoji: '👤' },
                  { label: 'Rejected by Pharmacy Head', value: rejections.rejected_by_ph, color: '#059669', emoji: '🏥' },
                  { label: 'Rejected by DTC', value: rejections.rejected_by_dtc, color: '#d97706', emoji: '🏛️' },
                  { label: 'Rejected by CEO', value: rejections.rejected_by_ceo, color: '#6366f1', emoji: '👔' },
                  { label: 'Emergency Rejected', value: rejections.rejected_emergency, color: '#dc2626', emoji: '🚨' },
                ].map(item => (
                  <div key={item.label} className="card" style={{ padding: '18px', borderTop: `3px solid ${item.color}` }}>
                    <div style={{ fontSize: '1.4rem', marginBottom: 6 }}>{item.emoji}</div>
                    <div style={{ fontSize: '1.8rem', fontWeight: 800, color: item.color, lineHeight: 1 }}>{item.value ?? 0}</div>
                    <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginTop: 6 }}>{item.label}</div>
                  </div>
                ))}
              </div>

              {/* Top Rejection Remarks */}
              <div className="card" style={{ padding: '20px 24px', marginBottom: 16 }}>
                <div className="card-title"><div className="icon">📝</div>Top Rejection Remarks</div>
                {rejections.top_remarks?.length === 0 ? (
                  <div style={{ color: 'var(--text-subtle)', fontSize: '0.85rem' }}>No rejection remarks data yet.</div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {(rejections.top_remarks || []).map((r, i) => (
                      <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '10px 14px', background: 'var(--bg-card2)', borderRadius: 8 }}>
                        <div style={{ fontWeight: 800, color: '#dc2626', fontSize: '0.9rem', minWidth: 24, flexShrink: 0 }}>#{i + 1}</div>
                        <div style={{ flex: 1, fontSize: '0.85rem', color: 'var(--text)', lineHeight: 1.5 }}>{r.remark}</div>
                        <div style={{ fontWeight: 700, color: '#dc2626', fontSize: '0.85rem', flexShrink: 0 }}>{r.count}×</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Detailed Rejections Table */}
              <div className="card" style={{ padding: '20px 24px' }}>
                <div className="card-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div className="icon">📋</div>Rejected Requests Details
                  </div>
                  <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 400 }}>
                    Total: {rejectedRequests.length} rejections
                  </span>
                </div>

                {/* Filters */}
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
                  <input
                    className="form-input"
                    placeholder="Search by ID, doctor, brand, generic..."
                    value={rejectedSearch}
                    onChange={e => setRejectedSearch(e.target.value)}
                    style={{ flex: '1 1 200px', maxWidth: 300 }}
                  />
                  <select
                    className="form-select"
                    value={rejectedSort}
                    onChange={e => setRejectedSort(e.target.value)}
                    style={{ flex: '0 0 150px' }}
                  >
                    <option value="newest">Newest First</option>
                    <option value="oldest">Oldest First</option>
                  </select>
                </div>

                {rejectedLoading ? (
                  <div style={{ textAlign: 'center', padding: 30 }}><div className="spinner" /></div>
                ) : rejectedRequests.length === 0 ? (
                  <div style={{ color: 'var(--text-subtle)', fontSize: '0.85rem', textAlign: 'center', padding: 20 }}>No rejected requests found.</div>
                ) : (
                  <div className="table-wrap">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>#ID</th>
                          <th>Doctor</th>
                          <th>Brand Name</th>
                          <th>Generic</th>
                          <th>Specs</th>
                          <th>Source</th>
                          <th>Stage</th>
                          <th>Rejection Remarks</th>
                          <th>Date</th>
                          <th>Audit</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rejectedRequests
                          .filter(r => {
                            const q = (rejectedSearch || '').toLowerCase();
                            return (
                              String(r.request_id || '').includes(q) ||
                              String(r.doctor_name || '').toLowerCase().includes(q) ||
                              String(r.brand_name || '').toLowerCase().includes(q) ||
                              String(r.generic_name || '').toLowerCase().includes(q)
                            );
                          })
                          .sort((a, b) => {
                            if (rejectedSort === 'newest') return new Date(b.created_at) - new Date(a.created_at);
                            if (rejectedSort === 'oldest') return new Date(a.created_at) - new Date(b.created_at);
                            return 0;
                          })
                          .map(r => (
                            <React.Fragment key={r.request_id}>
                              <tr>
                                <td style={{ fontWeight: 700, color: 'var(--primary-light)' }}>DR-{r.request_id}</td>
                                <td>
                                  <div style={{ fontWeight: 600, fontSize: '0.85rem' }}>{r.doctor_name}</div>
                                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{r.department}</div>
                                </td>
                                <td style={{ fontWeight: 600 }}>{r.brand_name}</td>
                                <td style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>{r.generic_name}</td>
                                <td style={{ fontSize: '0.78rem' }}>{r.dosage_form}{r.dose_strength ? ` · ${r.dose_strength}` : ''}</td>
                                <td>
                                  {r.request_source_type === 'NON_PROMOTIONAL'
                                    ? <span className="badge badge-non-promotional" style={{ fontSize: '0.68rem' }}>Clinical</span>
                                    : <span className="badge badge-promotional" style={{ fontSize: '0.68rem' }}>Via Rep</span>}
                                </td>
                                <td>
                                  <span style={{
                                    padding: '2px 8px', borderRadius: 99, fontSize: '0.7rem', fontWeight: 700, whiteSpace: 'nowrap',
                                    background: (STAGE_COLOR[r.current_stage] || '#94a3b8') + '1a',
                                    color: STAGE_COLOR[r.current_stage] || '#64748b',
                                  }}>
                                    {STAGE_DISPLAY[r.current_stage] || r.current_stage}
                                  </span>
                                </td>
                                <td style={{ color: 'var(--danger)', fontSize: '0.82rem', fontStyle: 'italic', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.rejection_remarks}>
                                  {r.rejection_remarks || '—'}
                                </td>
                                <td style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{fmtDate(r.created_at)}</td>
                                <td>
                                  <button
                                    className="btn btn-ghost btn-sm"
                                    style={{ fontSize: '0.72rem', padding: '4px 8px' }}
                                    onClick={() => loadRejectedAudit(r.request_id)}
                                  >
                                    {rejectedExpandedId === r.request_id ? '▲ Hide' : '▼ Details'}
                                  </button>
                                </td>
                              </tr>
                              {rejectedExpandedId === r.request_id && (
                                <tr>
                                  <td colSpan={10} style={{ background: 'var(--bg-card2)', padding: '16px 24px' }}>
                                    <div style={{ marginBottom: 12 }}>
                                      <div style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--danger)', textTransform: 'uppercase', marginBottom: 4 }}>Full Rejection Remarks</div>
                                      <div style={{ fontSize: '0.85rem', color: 'var(--danger)', fontStyle: 'italic' }}>"{r.rejection_remarks || '—'}"</div>
                                    </div>

                                    <div style={{ fontWeight: 600, fontSize: '0.78rem', marginBottom: 10, color: 'var(--text-muted)' }}>
                                      AUDIT TRAIL — Request DR-{r.request_id}
                                    </div>
                                    {rejectedAuditLoading ? (
                                      <div style={{ padding: 10 }}><div className="spinner" /></div>
                                    ) : rejectedAudit.length === 0 ? (
                                      <div style={{ color: 'var(--text-subtle)', fontSize: '0.85rem' }}>No audit entries yet.</div>
                                    ) : (
                                      <div className="audit-timeline">
                                        {rejectedAudit.map(a => (
                                          <div key={a.LOG_ID} className="audit-item">
                                            <div>
                                              <div className="audit-action">{a.ACTION}</div>
                                              <div className="audit-meta">
                                                By <strong>{a.PERFORMER_NAME}</strong> ({a.PERFORMER_ROLE})
                                                {a.FROM_STAGE && ` · ${a.FROM_STAGE} → ${a.TO_STAGE}`}
                                                {' · '}{new Date(a.LOGGED_AT).toLocaleString('en-IN')}
                                              </div>
                                              {a.REMARKS && <div className="audit-remark">"{a.REMARKS}"</div>}
                                            </div>
                                          </div>
                                        ))}
                                      </div>
                                    )}
                                  </td>
                                </tr>
                              )}
                            </React.Fragment>
                          ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </>
          ) : (
            <div style={{ textAlign: 'center', padding: 60, color: 'var(--text-subtle)' }}>Failed to load rejection data.</div>
          )}
        </div>
      )}

      {/* ===================== ORDERS TAB ===================== */}
      {activeTab === 'orders' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {summary ? (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px,1fr))', gap: 14 }}>
                <KpiCard icon="📦" label="Orders Placed" value={summary.total_order_placed} color="#1d4ed8" onClick={() => openDrilldown('metric', 'total_order_placed', 'Orders Placed')} />
                <KpiCard icon="🏆" label="Final Approved" value={summary.total_final_approved} color="#059669" sub="Stage: Final" onClick={() => openDrilldown('metric', 'total_final_approved', 'Final Approved Requests')} />
                <KpiCard icon="✅" label="Total Approved" value={summary.total_approved} color="#059669" onClick={() => openDrilldown('metric', 'total_approved', 'Approved Requests')} />
                <KpiCard icon="⏳" label="Approved (Pending Order)" value={Math.max(0, (summary.total_approved || 0) - (summary.total_order_placed || 0))} color="#d97706" sub="Awaiting order placement" />
              </div>

              <div className="card" style={{ padding: '20px 24px', marginBottom: 16 }}>
                <div className="card-title"><div className="icon">📊</div>Order Pipeline Overview</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
                    <div style={{ flex: 1, minWidth: 220 }}>
                      <div style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: 8 }}>Order Fulfillment Rate</div>
                      <div style={{ height: 24, background: 'var(--bg-card2)', borderRadius: 8, overflow: 'hidden', position: 'relative' }}>
                        <div style={{
                          height: '100%',
                          width: `${summary.total_approved > 0 ? Math.round((summary.total_order_placed / summary.total_approved) * 100) : 0}%`,
                          background: 'linear-gradient(90deg, #059669, #10b981)',
                          borderRadius: 8, transition: 'width 0.7s ease',
                          display: 'flex', alignItems: 'center', paddingLeft: 10,
                        }}>
                          {summary.total_order_placed > 0 && (
                            <span style={{ fontSize: '0.72rem', fontWeight: 700, color: '#fff' }}>
                              {Math.round((summary.total_order_placed / summary.total_approved) * 100)}%
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                      {summary.total_order_placed} of {summary.total_approved} approved requests have been ordered
                    </div>
                  </div>
                </div>
              </div>

              {/* Detailed Orders Table */}
              <div className="card" style={{ padding: '20px 24px' }}>
                <div className="card-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div className="icon">📦</div>Ordered Requests Details
                  </div>
                  <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 400 }}>
                    Total: {orderedRequests.length} orders
                  </span>
                </div>

                {/* Filters */}
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
                  <input
                    className="form-input"
                    placeholder="Search by ID, doctor, brand, generic..."
                    value={orderedSearch}
                    onChange={e => setOrderedSearch(e.target.value)}
                    style={{ flex: '1 1 200px', maxWidth: 300 }}
                  />
                  <select
                    className="form-select"
                    value={orderedSort}
                    onChange={e => setOrderedSort(e.target.value)}
                    style={{ flex: '0 0 150px' }}
                  >
                    <option value="newest">Newest First</option>
                    <option value="oldest">Oldest First</option>
                  </select>
                </div>

                {orderedLoading ? (
                  <div style={{ textAlign: 'center', padding: 30 }}><div className="spinner" /></div>
                ) : orderedRequests.length === 0 ? (
                  <div style={{ color: 'var(--text-subtle)', fontSize: '0.85rem', textAlign: 'center', padding: 20 }}>No ordered requests found.</div>
                ) : (
                  <div className="table-wrap">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>#ID</th>
                          <th>Doctor</th>
                          <th>Brand Name</th>
                          <th>Generic</th>
                          <th>Specs</th>
                          <th>Source</th>
                          <th>Stage</th>
                          <th>Order Remarks</th>
                          <th>Date</th>
                          <th>Audit</th>
                        </tr>
                      </thead>
                      <tbody>
                        {orderedRequests
                          .filter(r => {
                            const q = (orderedSearch || '').toLowerCase();
                            return (
                              String(r.request_id || '').includes(q) ||
                              String(r.doctor_name || '').toLowerCase().includes(q) ||
                              String(r.brand_name || '').toLowerCase().includes(q) ||
                              String(r.generic_name || '').toLowerCase().includes(q)
                            );
                          })
                          .sort((a, b) => {
                            if (orderedSort === 'newest') return new Date(b.created_at) - new Date(a.created_at);
                            if (orderedSort === 'oldest') return new Date(a.created_at) - new Date(b.created_at);
                            return 0;
                          })
                          .map(r => (
                            <React.Fragment key={r.request_id}>
                              <tr>
                                <td style={{ fontWeight: 700, color: 'var(--primary-light)' }}>DR-{r.request_id}</td>
                                <td>
                                  <div style={{ fontWeight: 600, fontSize: '0.85rem' }}>{r.doctor_name}</div>
                                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{r.department}</div>
                                </td>
                                <td style={{ fontWeight: 600 }}>{r.brand_name}</td>
                                <td style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>{r.generic_name}</td>
                                <td style={{ fontSize: '0.78rem' }}>{r.dosage_form}{r.dose_strength ? ` · ${r.dose_strength}` : ''}</td>
                                <td>
                                  {r.request_source_type === 'NON_PROMOTIONAL'
                                    ? <span className="badge badge-non-promotional" style={{ fontSize: '0.68rem' }}>Clinical</span>
                                    : <span className="badge badge-promotional" style={{ fontSize: '0.68rem' }}>Via Rep</span>}
                                </td>
                                <td>
                                  <span style={{
                                    padding: '2px 8px', borderRadius: 99, fontSize: '0.7rem', fontWeight: 700, whiteSpace: 'nowrap',
                                    background: (STAGE_COLOR[r.current_stage] || '#94a3b8') + '1a',
                                    color: STAGE_COLOR[r.current_stage] || '#64748b',
                                  }}>
                                    {STAGE_DISPLAY[r.current_stage] || r.current_stage}
                                  </span>
                                </td>
                                <td style={{ color: 'var(--primary)', fontSize: '0.82rem', fontStyle: 'italic', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.order_remarks}>
                                  {r.order_remarks || '—'}
                                </td>
                                <td style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{fmtDate(r.created_at)}</td>
                                <td>
                                  <button
                                    className="btn btn-ghost btn-sm"
                                    style={{ fontSize: '0.72rem', padding: '4px 8px' }}
                                    onClick={() => loadOrderedAudit(r.request_id)}
                                  >
                                    {orderedExpandedId === r.request_id ? '▲ Hide' : '▼ Details'}
                                  </button>
                                </td>
                              </tr>
                              {orderedExpandedId === r.request_id && (
                                <tr>
                                  <td colSpan={10} style={{ background: 'var(--bg-card2)', padding: '16px 24px' }}>
                                    <div style={{ marginBottom: 12 }}>
                                      <div style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--primary)', textTransform: 'uppercase', marginBottom: 4 }}>Full Order Remarks</div>
                                      <div style={{ fontSize: '0.85rem', color: 'var(--primary)', fontStyle: 'italic' }}>"{r.order_remarks || '—'}"</div>
                                    </div>

                                    <div style={{ fontWeight: 600, fontSize: '0.78rem', marginBottom: 10, color: 'var(--text-muted)' }}>
                                      AUDIT TRAIL — Request DR-{r.request_id}
                                    </div>
                                    {orderedAuditLoading ? (
                                      <div style={{ padding: 10 }}><div className="spinner" /></div>
                                    ) : orderedAudit.length === 0 ? (
                                      <div style={{ color: 'var(--text-subtle)', fontSize: '0.85rem' }}>No audit entries yet.</div>
                                    ) : (
                                      <div className="audit-timeline">
                                        {orderedAudit.map(a => (
                                          <div key={a.LOG_ID} className="audit-item">
                                            <div>
                                              <div className="audit-action">{a.ACTION}</div>
                                              <div className="audit-meta">
                                                By <strong>{a.PERFORMER_NAME}</strong> ({a.PERFORMER_ROLE})
                                                {a.FROM_STAGE && ` · ${a.FROM_STAGE} → ${a.TO_STAGE}`}
                                                {' · '}{new Date(a.LOGGED_AT).toLocaleString('en-IN')}
                                              </div>
                                              {a.REMARKS && <div className="audit-remark">"{a.REMARKS}"</div>}
                                            </div>
                                          </div>
                                        ))}
                                      </div>
                                    )}
                                  </td>
                                </tr>
                              )}
                            </React.Fragment>
                          ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </>
          ) : (
            <div style={{ textAlign: 'center', padding: 60 }}><div className="spinner" /></div>
          )}
        </div>
      )}

      {/* ===================== AUDIT TRAIL TAB ===================== */}
      {activeTab === 'audit_trail' && (
        <div className="card" style={{ padding: '20px 24px' }}>
          <div className="card-title"><div className="icon">📜</div>Hospital-Wide Action Audit Trail</div>
          <div style={{ fontSize: '0.78rem', color: 'var(--text-subtle)', marginBottom: 16 }}>
            Displaying the 100 most recent system-wide actions and state transitions.
          </div>
          {auditTrailLoading ? (
            <div style={{ textAlign: 'center', padding: 40 }}><div className="spinner" /></div>
          ) : auditTrailData.length === 0 ? (
            <div style={{ color: 'var(--text-subtle)', fontSize: '0.85rem', padding: 20, textAlign: 'center' }}>No audit entries logged yet.</div>
          ) : (
            <div className="global-audit-timeline">
              {auditTrailData.map(a => (
                <div key={a.LOG_ID} className="global-audit-item">
                  <div className="global-audit-content">
                    <div className="global-audit-header">
                      <span className="global-audit-action">{a.ACTION}</span>
                      <span className="global-audit-time">{new Date(a.LOGGED_AT).toLocaleString('en-IN')}</span>
                    </div>
                    <div className="global-audit-body">
                      Request <strong>DR-{a.REQUEST_ID}</strong> ({a.BRAND_NAME} / {a.GENERIC_NAME}) by <strong>{a.PERFORMER_NAME}</strong> ({a.PERFORMER_ROLE})
                      {a.FROM_STAGE && ` moved from ${a.FROM_STAGE} → ${a.TO_STAGE}`}
                    </div>
                    {a.REMARKS && <div className="global-audit-remarks">"{a.REMARKS}"</div>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Drilldown Modal ── */}
      {drilldownOpen && (
        <div className="modal-overlay" onClick={() => setDrilldownOpen(false)}>
          <div className="modal drilldown-modal" onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div>
                <h3 style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--text)', margin: 0 }}>
                  🔍 {drilldownTitle}
                </h3>
                <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                  Showing {filteredAndSortedDrilldown.length} of {drilldownData.length} requests
                </span>
              </div>
              <button className="btn btn-ghost btn-sm" onClick={() => setDrilldownOpen(false)} style={{ fontSize: '1.2rem', padding: '4px 10px', borderRadius: 8 }}>
                ✕
              </button>
            </div>

            {/* Filter and Sort Toolbar */}
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
              <input
                className="form-input"
                placeholder="Search by ID, doctor, brand, generic..."
                value={drilldownSearch}
                onChange={e => setDrilldownSearch(e.target.value)}
                style={{ flex: '1 1 200px', maxWidth: 300 }}
              />
              <select
                className="form-select"
                value={drilldownSort}
                onChange={e => setDrilldownSort(e.target.value)}
                style={{ flex: '0 0 150px' }}
              >
                <option value="newest">Newest First</option>
                <option value="oldest">Oldest First</option>
                <option value="stage">Sort by Stage</option>
              </select>
            </div>

            {/* Modal Body / Table */}
            <div style={{ flex: 1, overflowY: 'auto' }}>
              {drilldownLoading ? (
                <div style={{ textAlign: 'center', padding: 50 }}><div className="spinner" /></div>
              ) : filteredAndSortedDrilldown.length === 0 ? (
                <div style={{ textAlign: 'center', padding: 50, color: 'var(--text-subtle)' }}>No requests found matching criteria.</div>
              ) : (
                <div className="table-wrap">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th className="sticky-col">#ID</th>
                        <th>Doctor</th>
                        <th>Brand Name</th>
                        <th>Generic</th>
                        <th>Details</th>
                        <th>Source</th>
                        <th>Stage</th>
                        <th>Status</th>
                        <th>Submitted</th>
                        <th>DTC Brand</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredAndSortedDrilldown.map(r => (
                        <React.Fragment key={r.request_id}>
                          <tr>
                            <td className="sticky-col" style={{ fontWeight: 700, color: 'var(--primary-light)' }}>DR-{r.request_id}</td>
                            <td>
                              <div style={{ fontWeight: 600, fontSize: '0.85rem' }}>{r.doctor_name}</div>
                              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{r.department}</div>
                            </td>
                            <td style={{ fontWeight: 600 }}>{r.brand_name}</td>
                            <td style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>{r.generic_name}</td>
                            <td style={{ fontSize: '0.78rem' }}>{r.dosage_form}{r.dose_strength ? ` · ${r.dose_strength}` : ''}</td>
                            <td>
                              {r.request_source_type === 'NON_PROMOTIONAL'
                                ? <span className="badge badge-non-promotional" style={{ fontSize: '0.68rem' }}>Clinical</span>
                                : <span className="badge badge-promotional" style={{ fontSize: '0.68rem' }}>Via Rep</span>}
                            </td>
                            <td>
                              <span style={{
                                padding: '2px 8px', borderRadius: 99, fontSize: '0.7rem', fontWeight: 700, whiteSpace: 'nowrap',
                                background: (STAGE_COLOR[r.current_stage] || '#94a3b8') + '1a',
                                color: STAGE_COLOR[r.current_stage] || '#64748b',
                              }}>
                                {STAGE_DISPLAY[r.current_stage] || r.current_stage}
                              </span>
                            </td>
                            <td>
                              <span style={{
                                padding: '3px 8px', borderRadius: 99, fontSize: '0.72rem', fontWeight: 700,
                                background: STATUS_COLOR(r.status) + '1a',
                                color: STATUS_COLOR(r.status),
                                border: `1px solid ${STATUS_COLOR(r.status)}40`
                              }}>{r.status}</span>
                            </td>
                            <td style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{fmtDate(r.created_at)}</td>
                            <td style={{ fontSize: '0.78rem', color: 'var(--primary)', fontWeight: 600 }}>{r.dtc_selected_brand || '—'}</td>
                            <td>
                              <button
                                className="btn btn-ghost btn-sm"
                                style={{ fontSize: '0.72rem', padding: '4px 8px' }}
                                onClick={() => loadDrilldownAudit(r.request_id)}
                              >
                                {drilldownExpandedId === r.request_id ? '▲ Hide' : '▼ Details'}
                              </button>
                            </td>
                          </tr>
                          {drilldownExpandedId === r.request_id && (
                            <tr>
                              <td colSpan={11} style={{ background: 'var(--bg-card2)', padding: '16px 24px' }}>
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16, marginBottom: 16 }}>
                                  <div>
                                    <div style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 4 }}>Brand & Generic</div>
                                    <div style={{ fontSize: '0.85rem', color: 'var(--text)' }}><strong>{r.brand_name}</strong> ({r.generic_name})</div>
                                  </div>
                                  <div>
                                    <div style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 4 }}>Form & Strength</div>
                                    <div style={{ fontSize: '0.85rem', color: 'var(--text)' }}>{r.dosage_form} · {r.dose_strength || '—'}</div>
                                  </div>
                                  {r.rejection_remarks && r.rejection_remarks !== '—' && (
                                    <div>
                                      <div style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--danger)', textTransform: 'uppercase', marginBottom: 4 }}>Rejection Remarks</div>
                                      <div style={{ fontSize: '0.85rem', color: 'var(--danger)', fontStyle: 'italic' }}>"{r.rejection_remarks}"</div>
                                    </div>
                                  )}
                                  {r.order_remarks && r.order_remarks !== '—' && (
                                    <div>
                                      <div style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--primary)', textTransform: 'uppercase', marginBottom: 4 }}>Order Remarks</div>
                                      <div style={{ fontSize: '0.85rem', color: 'var(--primary)', fontStyle: 'italic' }}>"{r.order_remarks}"</div>
                                    </div>
                                  )}
                                </div>

                                <div style={{ fontWeight: 600, fontSize: '0.78rem', marginBottom: 10, color: 'var(--text-muted)' }}>
                                  AUDIT TRAIL — Request DR-{r.request_id}
                                </div>
                                {drilldownAuditLoading ? (
                                  <div style={{ padding: 10 }}><div className="spinner" /></div>
                                ) : drilldownAudit.length === 0 ? (
                                  <div style={{ color: 'var(--text-subtle)', fontSize: '0.85rem' }}>No audit entries yet.</div>
                                ) : (
                                  <div className="audit-timeline">
                                    {drilldownAudit.map(a => (
                                      <div key={a.LOG_ID} className="audit-item">
                                        <div>
                                          <div className="audit-action">{a.ACTION}</div>
                                          <div className="audit-meta">
                                            By <strong>{a.PERFORMER_NAME}</strong> ({a.PERFORMER_ROLE})
                                            {a.FROM_STAGE && ` · ${a.FROM_STAGE} → ${a.TO_STAGE}`}
                                            {' · '}{new Date(a.LOGGED_AT).toLocaleString('en-IN')}
                                          </div>
                                          {a.REMARKS && <div className="audit-remark">"{a.REMARKS}"</div>}
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="modal-footer" style={{ marginTop: 16 }}>
              <button className="btn btn-ghost" onClick={() => setDrilldownOpen(false)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
