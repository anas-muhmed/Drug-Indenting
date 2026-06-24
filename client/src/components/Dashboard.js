// =====================================================================
// Dashboard.js — Metrics + filterable request table (all roles)
// =====================================================================
import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';

const API = '/api';

const STATUS_BADGE = {
  Pending               : <span className="badge badge-pending">⏳ Pending</span>,
  PENDING_HOD           : <span className="badge badge-pending">⏳ Pending HOD Approval</span>,
  Approved              : <span className="badge badge-approved">✅ Approved</span>,
  HOD_APPROVED          : <span className="badge badge-approved">✅ HOD Approved</span>,
  HOD_REJECTED          : <span className="badge badge-rejected">❌ Rejected by HOD</span>,
  Rejected              : <span className="badge badge-rejected">❌ Rejected by DTC Committee</span>,
  PHARMACIST_REJECTED   : <span className="badge badge-rejected">❌ Rejected by DTC Committee</span>,
  PHARMACY_HEAD_REJECTED: <span className="badge badge-rejected">❌ Rejected by DTC Committee</span>,
  CEO_REJECTED          : <span className="badge badge-rejected">❌ Rejected by DTC Committee</span>,
  EMERGENCY_PENDING_DTC : <span className="badge" style={{ background: '#fef3c7', color: '#92400e' }}>⏳ Emergency Pending</span>,
  EMERGENCY_APPROVED    : <span className="badge" style={{ background: '#dcfce7', color: '#166534' }}>✅ Emergency Approved</span>,
  EMERGENCY_REJECTED    : <span className="badge" style={{ background: '#fee2e2', color: '#991b1b' }}>❌ Emergency Rejected</span>,
  ORDER_PLACED          : <span className="badge" style={{ background: '#dbeafe', color: '#1e40af' }}>📦 Order Placed</span>,
  APPROVED_PENDING_ORDER: <span className="badge badge-approved">✅ Approved (Pending Order)</span>,
  PHARMACY_HEAD_REJECTED_PENDING_DTC: <span className="badge badge-pending" style={{ background: '#fef2f2', color: '#991b1b', border: '1px solid #fca5a5' }}>⏳ Pending DTC (PH Rejected)</span>,
};

const STAGE_LABEL = {
  submitted           : 'Submitted',
  HOD                 : 'HOD Review',
  PharmacistInitialReview: '💊 Pharmacist Initial Review',
  PharmacistCorrection: '💊 Pharmacist Correction',
  PharmacyHead        : 'Pharmacy Head Review 1',
  PharmacyHeadReview1 : 'Pharmacy Head Review 1',
  DTCCommittee        : 'DTC Review 1',
  DTCReview1          : 'DTC Review 1',
  Pharmacist          : '💊 Pharmacist Analysis',
  PharmacistReview2   : '💊 Pharmacist Analysis',
  PharmacyHeadReview2 : '🔁 Pharmacy Head Review 2',
  DTCFinal            : '🏛️ DTC Final',
  DTCFinalReview      : '🏛️ DTC Final',
  CEO                 : 'CEO Approval',
  Final               : '🏆 Final Approved',
  PharmacistOrder     : '📦 Pharmacist Order',
  OrderPlaced         : '📦 Order Placed',
  EmergencyDTC        : '🚨 Emergency DTC',
  Rejected            : '❌ Rejected',
};

const getDoctorHODStageLabel = (stage) => {
  const dtcReviewStages = [
    'PharmacistInitialReview',
    'PharmacistCorrection',
    'PharmacyHead',
    'PharmacyHeadReview1',
    'DTCCommittee',
    'DTCReview1',
    'Pharmacist',
    'PharmacistReview2',
    'PharmacyHeadReview2',
    'DTCFinal',
    'DTCFinalReview',
    'EmergencyDTC'
  ];
  if (dtcReviewStages.includes(stage)) {
    return 'Under DTC Review';
  }
  if (stage === 'submitted') return 'Submitted';
  if (stage === 'HOD') return 'HOD Review';
  if (stage === 'CEO') return 'CEO Approval';
  if (stage === 'Final' || stage === 'PharmacistOrder' || stage === 'OrderPlaced') return 'Approved';
  if (stage === 'Rejected') return 'Rejected';
  return stage;
};


function fmtDate(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' });
}
const DASHBOARD_TABS = [
  { key: 'overview', label: '📊 Overview' },
  { key: 'workflow', label: '🔄 Workflow Tracker' },
  { key: 'requests', label: '📋 Requests' },
  { key: 'audit_trail', label: '📜 Audit Trail' }
];

const KpiCardLocal = ({ icon, label, value, color, sub }) => (
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
  }}
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
export default function Dashboard({ role, userId, refresh }) {
  const [metrics,  setMetrics]  = useState(null);
  const [requests, setRequests] = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [filters,  setFilters]  = useState({ status:'', category:'', from_date:'', to_date:'', source_type:'', formulary_type:'' });
  const [expanded, setExpanded] = useState(null); // request_id for audit trail
  const [audit,    setAudit]    = useState([]);

  // New tab-based states for Dashboard.js
  const [activeTab, setActiveTab] = useState('overview');
  const [trackerData, setTrackerData] = useState([]);
  const [trackerSearch, setTrackerSearch] = useState('');
  const [trackerLoading, setTrackerLoading] = useState(false);
  const [expandedWorkflowId, setExpandedWorkflowId] = useState(null);
  const [expandedDoctorName, setExpandedDoctorName] = useState(null);
  const [auditTrailData, setAuditTrailData] = useState([]);
  const [auditTrailLoading, setAuditTrailLoading] = useState(false);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const params = {};
      if (filters.status)      params.status      = filters.status;
      if (filters.category)    params.category    = filters.category;
      if (filters.from_date)   params.from_date   = filters.from_date;
      if (filters.to_date)     params.to_date     = filters.to_date;
      if (filters.source_type) params.source_type = filters.source_type;
      if (filters.formulary_type) params.formulary_type = filters.formulary_type;

      const [mRes, rRes] = await Promise.all([
        axios.get(`${API}/dashboard/${role}`, { params: { userId, source_type: filters.source_type || undefined, formulary_type: filters.formulary_type || undefined } }),
        axios.get(`${API}/requests/${role}/${userId}`, { params }),
      ]);
      setMetrics(mRes.data);
      setRequests(rRes.data);
    } catch {
    } finally {
      setLoading(false);
    }
  }, [role, userId, filters]);

  const loadWorkflowTracker = useCallback(async () => {
    setTrackerLoading(true);
    try {
      const r = await axios.get(`${API}/analytics/workflow-tracker`, { params: { role, userId } });
      setTrackerData(r.data || []);
    } catch (err) {
      console.error('loadWorkflowTracker error:', err);
    } finally {
      setTrackerLoading(false);
    }
  }, [role, userId]);

  const loadAuditTrail = useCallback(async () => {
    setAuditTrailLoading(true);
    try {
      const r = await axios.get(`${API}/analytics/audit-trail`, { params: { role, userId } });
      setAuditTrailData(r.data || []);
    } catch (err) {
      console.error('loadAuditTrail error:', err);
    } finally {
      setAuditTrailLoading(false);
    }
  }, [role, userId]);

  useEffect(() => { loadAll(); }, [loadAll, refresh]);

  useEffect(() => {
    if (activeTab === 'workflow') {
      loadWorkflowTracker();
    } else if (activeTab === 'audit_trail') {
      loadAuditTrail();
    }
  }, [activeTab, loadWorkflowTracker, loadAuditTrail, refresh]);

  const loadAudit = async (requestId) => {
    if (expanded === requestId) { setExpanded(null); return; }
    try {
      const r = await axios.get(`${API}/audit/${requestId}?role=${role}`);
      setAudit(r.data);
      setExpanded(requestId);
    } catch {}
  };

  return (
    <div className="analytics-console">
      {/* ---- Tab Navigation ---- */}
      <div className="analytics-tab-nav" style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 20 }}>
        {DASHBOARD_TABS.map(t => (
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
        <>
          {/* ---- Metric Cards ---- */}
          <div className="metrics-grid">
            <div className="metric-card total">
              <div className="metric-label">Total Requests</div>
              <div className="metric-value">{metrics ? metrics.total : '—'}</div>
            </div>
            <div className="metric-card pending">
              <div className="metric-label">Pending</div>
              <div className="metric-value">{metrics ? metrics.pending : '—'}</div>
            </div>
            <div className="metric-card approved">
              <div className="metric-label">Approved</div>
              <div className="metric-value">{metrics ? metrics.approved : '—'}</div>
            </div>
            <div className="metric-card rejected">
              <div className="metric-label">Rejected</div>
              <div className="metric-value">{metrics ? metrics.rejected : '—'}</div>
            </div>
            <div className="metric-card" style={{ background: 'linear-gradient(135deg, rgba(14,165,233,0.12), rgba(14,165,233,0.04))', border: '1px solid rgba(14,165,233,0.25)' }}>
              <div className="metric-label" style={{ color: '#0ea5e9' }}>📋 Via Medical Representative</div>
              <div className="metric-value" style={{ color: '#0ea5e9' }}>{metrics ? metrics.promotional : '—'}</div>
            </div>
            <div className="metric-card" style={{ background: 'linear-gradient(135deg, rgba(124,58,237,0.12), rgba(124,58,237,0.04))', border: '1px solid rgba(124,58,237,0.25)' }}>
              <div className="metric-label" style={{ color: '#7c3aed' }}>🩺 Clinical Initiated</div>
              <div className="metric-value" style={{ color: '#7c3aed' }}>{metrics ? metrics.non_promotional : '—'}</div>
            </div>
          </div>
          <div style={{ marginTop: 24, padding: 20, background: 'var(--bg-card)', borderRadius: 'var(--radius)', border: '1px solid var(--border)' }}>
            <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text)', marginBottom: 8 }}>💡 Welcome to your Dashboard Console</div>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>
              Use the tabs above to toggle between the Summary Overview, the real-time hospital-wide <strong>Workflow Tracker</strong>, your filtered list of active <strong>Requests</strong>, and the logged <strong>Audit Trail</strong>.
            </div>
          </div>
        </>
      )}

      {/* ===================== WORKFLOW TRACKER TAB ===================== */}
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

        const getStatusColorLocal = (status) => {
          if (!status) return '#94a3b8';
          const s = status.toLowerCase();
          if (s.includes('approved') || s === 'final') return '#059669';
          if (s.includes('rejected')) return '#dc2626';
          if (s.includes('pending') || s.includes('emergency_pending')) return '#d97706';
          if (s === 'order_placed') return '#1d4ed8';
          return '#64748b';
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
              <KpiCardLocal icon="👤" label="Pending at HOD" value={countHOD} color="#0ea5e9" />
              <KpiCardLocal icon="💊" label="Pending at Pharmacist" value={countPharm} color="#7c3aed" />
              <KpiCardLocal icon="🏥" label="Pending at Pharmacy Head" value={countPH} color="#059669" />
              <KpiCardLocal icon="🏛️" label="Pending at DTC" value={countDTC} color="#d97706" />
              <KpiCardLocal icon="👔" label="Pending at CEO" value={countCEO} color="#6366f1" />
              <KpiCardLocal icon="✅" label="Completed" value={countCompleted} color="#10b981" />
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

              {trackerLoading ? (
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
                                  background: getStatusColorLocal(r.status) + '1a',
                                  color: getStatusColorLocal(r.status),
                                  border: `1px solid ${getStatusColorLocal(r.status)}40`
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

      {/* ===================== REQUESTS LIST TAB ===================== */}
      {activeTab === 'requests' && (
        <>
          {/* ---- Filters ---- */}
          <div className="filters-bar">
            <div className="form-group">
              <label className="form-label">Status</label>
              <select
                className="form-select"
                value={filters.status}
                onChange={e => setFilters(f => ({ ...f, status: e.target.value }))}
              >
                <option value="">All Statuses</option>
                <option value="Pending">Pending</option>
                <option value="Approved">Approved</option>
                <option value="Rejected">Rejected</option>
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Category</label>
              <input
                className="form-input"
                placeholder="Search category…"
                value={filters.category}
                onChange={e => setFilters(f => ({ ...f, category: e.target.value }))}
              />
            </div>
            <div className="form-group">
              <label className="form-label">From Date</label>
              <input
                type="date"
                className="form-input"
                value={filters.from_date}
                onChange={e => setFilters(f => ({ ...f, from_date: e.target.value }))}
              />
            </div>
            <div className="form-group">
              <label className="form-label">To Date</label>
              <input
                type="date"
                className="form-input"
                value={filters.to_date}
                onChange={e => setFilters(f => ({ ...f, to_date: e.target.value }))}
              />
            </div>
            <div className="form-group">
              <label className="form-label">Request Source</label>
              <select
                className="form-select"
                value={filters.source_type}
                onChange={e => setFilters(f => ({ ...f, source_type: e.target.value }))}
              >
                <option value="">All Sources</option>
                <option value="PROMOTIONAL">📋 Via Medical Representative</option>
                <option value="NON_PROMOTIONAL">🩺 Clinical Initiated</option>
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Formulary Type</label>
              <select
                className="form-select"
                value={filters.formulary_type}
                onChange={e => setFilters(f => ({ ...f, formulary_type: e.target.value }))}
              >
                <option value="">All Types</option>
                <option value="FORMULARY">Formulary</option>
                <option value="NON_FORMULARY">Non-Formulary</option>
              </select>
            </div>
            <div className="form-group" style={{ justifyContent:'flex-end' }}>
              <label className="form-label">&nbsp;</label>
              <button className="btn btn-ghost" onClick={() => setFilters({ status:'', category:'', from_date:'', to_date:'', source_type:'', formulary_type:'' })}>
                ↺ Reset
              </button>
            </div>
          </div>

          {/* ---- Requests Table ---- */}
          <div className="table-wrap">
            {loading ? (
              <div style={{ textAlign:'center', padding:40 }}><div className="spinner" /></div>
            ) : (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>#ID</th>
                    <th>Brand Name</th>
                    <th>Generic Name</th>
                    <th>Category</th>
                    <th>Type</th>
                    <th>Formulary Type</th>
                    <th>Source</th>
                    <th>Doctor</th>
                    <th>Status</th>
                    <th>Stage</th>
                    <th>Submitted</th>
                    <th>Audit</th>
                  </tr>
                </thead>
                <tbody>
                  {requests.length === 0 ? (
                    <tr className="empty-row"><td colSpan={12}>No requests found.</td></tr>
                  ) : requests.map(r => (
                    <React.Fragment key={r.REQUEST_ID}>
                      <tr>
                        <td style={{ fontWeight:700, color:'var(--primary-light)' }}>#{r.REQUEST_ID}</td>
                        <td style={{ fontWeight:600 }}>{r.BRAND_NAME}</td>
                        <td style={{ color:'var(--text-muted)' }}>{r.GENERIC_NAME}</td>
                        <td>{r.CATEGORY}</td>
                        <td>{r.REQUEST_TYPE}</td>
                        <td>
                          {r.FORMULARY_REQUEST_TYPE === 'FORMULARY' ? (
                            <span className="badge" style={{ background: '#ecfdf5', color: '#065f46' }}>Formulary</span>
                          ) : r.FORMULARY_REQUEST_TYPE === 'NON_FORMULARY' ? (
                            <span className="badge" style={{ background: '#fef2f2', color: '#991b1b' }}>Non-Formulary</span>
                          ) : '—'}
                        </td>
                        <td>
                          {r.REQUEST_SOURCE_TYPE === 'NON_PROMOTIONAL'
                            ? <span className="badge badge-non-promotional">Clinical Initiated</span>
                            : <span className="badge badge-promotional">Via Medical Representative</span>}
                        </td>
                        <td>{r.DOCTOR_NAME || '—'}</td>
                        <td>
                          {
                            (role === 'DOCTOR' || role === 'HOD' || role === 'Doctor' || role === 'HOD') && r.STATUS === 'PHARMACY_HEAD_REJECTED_PENDING_DTC'
                              ? <span className="badge badge-pending" style={{ background: '#e0f2fe', color: '#0369a1', border: '1px solid #bae6fd' }}>⏳ Under DTC Review</span>
                              : (STATUS_BADGE[r.STATUS] || r.STATUS)
                          }
                        </td>
                        <td style={{ fontSize:'0.8rem', color:'var(--text-muted)' }}>
                          {
                            (role === 'DOCTOR' || role === 'HOD' || role === 'Doctor' || role === 'HOD')
                              ? getDoctorHODStageLabel(r.CURRENT_STAGE)
                              : (STAGE_LABEL[r.CURRENT_STAGE] || r.CURRENT_STAGE)
                          }
                        </td>
                        <td style={{ fontSize:'0.8rem', color:'var(--text-muted)' }}>{fmtDate(r.CREATED_AT)}</td>
                        <td>
                          <button
                            className="btn btn-ghost btn-sm"
                            onClick={() => loadAudit(r.REQUEST_ID)}
                          >
                            {expanded === r.REQUEST_ID ? '▲ Hide' : '▼ Trail'}
                          </button>
                        </td>
                      </tr>
                      {expanded === r.REQUEST_ID && (
                        <tr>
                          <td colSpan={12} style={{ background:'var(--bg-card2)', padding:'16px 24px' }}>
                            <div style={{ fontWeight:600, fontSize:'0.8rem', marginBottom:10, color:'var(--text-muted)' }}>
                              AUDIT TRAIL — Request #{r.REQUEST_ID}
                            </div>
                            {audit.length === 0 ? (
                              <div style={{ color:'var(--text-subtle)', fontSize:'0.85rem' }}>No audit entries yet.</div>
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
            )}
          </div>
        </>
      )}

      {/* ===================== AUDIT TRAIL TAB ===================== */}
      {activeTab === 'audit_trail' && (
        <div className="card" style={{ padding: '20px 24px' }}>
          <div className="card-title"><div className="icon">📜</div>Action Audit Trail</div>
          <div style={{ fontSize: '0.78rem', color: 'var(--text-subtle)', marginBottom: 16 }}>
            Displaying the 100 most recent system-wide actions for requests in your scope.
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
    </div>
  );
}
