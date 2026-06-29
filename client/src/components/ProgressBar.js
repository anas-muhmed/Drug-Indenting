import React from 'react';

// STAGE NORMALIZER maps both old and new backend/database stage strings to standard stage keys
const STAGE_NORMALIZER = {
  'submitted': 'submitted',
  'HOD': 'HOD',
  'PharmacistInitialReview': 'PharmacistReview1',
  'PharmacistCorrection': 'PharmacistReview1',
  'PharmacistReview1': 'PharmacistReview1',
  'PharmacyHead': 'PharmacyHeadReview1',
  'PharmacyHeadReview1': 'PharmacyHeadReview1',
  'DTCCommittee': 'DTCReview1',
  'DTCReview1': 'DTCReview1',
  'EmergencyDTC': 'DTCReview1',
  'Pharmacist': 'PharmacistReview2',
  'PharmacistReview2': 'PharmacistReview2',
  'PharmacistOrder': 'PharmacistReview2',
  'PharmacyHeadReview2': 'PharmacyHeadReview2',
  'DTCFinal': 'DTCFinalReview',
  'DTCFinalReview': 'DTCFinalReview',
  'CEO': 'CEO',
  'Final': 'Final',
  'OrderPlaced': 'OrderPlaced',
  'INVENTORY_RECEIVED': 'InventoryReceived',
  'INVENTORY_STOCKED': 'InventoryReceived',
  'ORDER_RECEIVED': 'InventoryReceived',
  'Completed': 'Completed'
};

export const FLOW_CONFIG = {
  DOCTOR: [
    { key: 'submitted', label: 'Submitted' },
    { key: 'HOD', label: 'HOD' },
    { key: 'PharmacistReview1', label: 'Pharmacist' },
    { key: 'PharmacyHeadReview1', label: 'Pharmacy Head' },
    { key: 'DTCReview1', label: 'DTC' },
    { key: 'PharmacistReview2', label: 'Pharmacist' },
    { key: 'PharmacyHeadReview2', label: 'Pharmacy Head' },
    { key: 'DTCFinalReview', label: 'DTC' },
    { key: 'CEO', label: 'CEO' },
    { key: 'Final', label: 'Approved' },
    { key: 'OrderPlaced', label: 'Order Placed' },
    { key: 'InventoryReceived', label: 'Inventory Received' },
    { key: 'Completed', label: 'Completed' }
  ],
  HOD: [
    { key: 'HOD', label: 'HOD' },
    { key: 'PharmacistReview1', label: 'Pharmacist' },
    { key: 'PharmacyHeadReview1', label: 'Pharmacy Head' },
    { key: 'DTCReview1', label: 'DTC' },
    { key: 'PharmacistReview2', label: 'Pharmacist' },
    { key: 'PharmacyHeadReview2', label: 'Pharmacy Head' },
    { key: 'DTCFinalReview', label: 'DTC' },
    { key: 'CEO', label: 'CEO' },
    { key: 'Final', label: 'Approved' },
    { key: 'OrderPlaced', label: 'Order Placed' },
    { key: 'InventoryReceived', label: 'Inventory Received' },
    { key: 'Completed', label: 'Completed' }
  ]
};

export const STAGE_INDEX_MAP = {
  DOCTOR: {
    'submitted': 0,
    'HOD': 1,
    'PharmacistReview1': 2,
    'PharmacyHeadReview1': 3,
    'DTCReview1': 4,
    'PharmacistReview2': 5,
    'PharmacyHeadReview2': 6,
    'DTCFinalReview': 7,
    'CEO': 8,
    'Final': 9,
    'OrderPlaced': 10,
    'InventoryReceived': 11,
    'Completed': 12
  },
  HOD: {
    'HOD': 0,
    'PharmacistReview1': 1,
    'PharmacyHeadReview1': 2,
    'DTCReview1': 3,
    'PharmacistReview2': 4,
    'PharmacyHeadReview2': 5,
    'DTCFinalReview': 6,
    'CEO': 7,
    'Final': 8,
    'OrderPlaced': 9,
    'InventoryReceived': 10,
    'Completed': 11
  }
};

export function buildStagesByRequestType(requestSource = 'DOCTOR') {
  const source = String(requestSource).toUpperCase() === 'HOD' ? 'HOD' : 'DOCTOR';
  return FLOW_CONFIG[source];
}

export function getRejectionStage(r) {
  if (!r) return 'submitted';
  if (r.CEO_REMARKS) return 'CEO';
  if (r.DTC_FINAL_REMARKS) return 'DTCFinalReview';
  if (r.PH_REMARKS2 || r.PH_REVIEW2_REMARKS) return 'PharmacyHeadReview2';
  if (r.PHARMACIST2_REMARKS) return 'PharmacistReview2';
  if (r.DTC_REMARKS) return 'DTCReview1';
  if (r.PH_REMARKS) return 'PharmacyHeadReview1';
  if (r.PHARMACIST_REMARKS) return 'PharmacistReview1';
  if (r.HOD_REMARKS) return 'HOD';
  return 'submitted';
}

export function getStageIndex(stage, status, requestSource = 'DOCTOR', request = null) {
  const source = String(requestSource).toUpperCase() === 'HOD' ? 'HOD' : 'DOCTOR';

  // Identify rejection statuses
  const isRejected = ['Rejected', 'HOD_REJECTED', 'PHARMACIST_REJECTED', 'PHARMACY_HEAD_REJECTED', 'CEO_REJECTED', 'EMERGENCY_REJECTED'].includes(status);

  let targetStage = stage;
  if (isRejected || stage === 'Rejected') {
    if (request) {
      targetStage = getRejectionStage(request);
    } else {
      // Safe fallback: default based on status
      if (status === 'HOD_REJECTED') targetStage = 'HOD';
      else if (status === 'PHARMACIST_REJECTED') targetStage = 'PharmacistReview1';
      else if (status === 'PHARMACY_HEAD_REJECTED') targetStage = 'PharmacyHeadReview1';
      else if (status === 'CEO_REJECTED') targetStage = 'CEO';
      else targetStage = 'CEO';
    }
  } else {
    if (status === 'ORDER_PLACED') {
      targetStage = 'OrderPlaced';
    } else if (status === 'INVENTORY_RECEIVED' || status === 'INVENTORY_STOCKED' || status === 'ORDER_RECEIVED') {
      targetStage = 'Completed';
    }
  }

  const normalizedKey = STAGE_NORMALIZER[targetStage] || targetStage;
  const index = STAGE_INDEX_MAP[source][normalizedKey];
  return index !== undefined ? index : 0;
}

export function getRejectedLabel(status) {
  if (status === 'HOD_REJECTED') {
    return 'Rejected by HOD';
  }
  return 'Rejected by DTC Committee';
}

export const STATUS_BADGE_MAP = {
  Pending: <span className="badge badge-pending">⏳ Pending</span>,
  PENDING_HOD: <span className="badge badge-pending">⏳ Pending HOD Approval</span>,
  Approved: <span className="badge badge-approved">✅ Approved</span>,
  HOD_APPROVED: <span className="badge badge-approved">✅ HOD Approved</span>,
  HOD_REJECTED: <span className="badge badge-rejected">❌ Rejected by HOD</span>,
  Rejected: <span className="badge badge-rejected">❌ Rejected by DTC Committee</span>,
  PHARMACIST_REJECTED: <span className="badge badge-rejected">❌ Rejected by DTC Committee</span>,
  PHARMACY_HEAD_REJECTED: <span className="badge badge-rejected">❌ Rejected by DTC Committee</span>,
  CEO_REJECTED: <span className="badge badge-rejected">❌ Rejected by DTC Committee</span>,
  PHARMACY_HEAD_REJECTED_PENDING_DTC: <span className="badge badge-pending" style={{ background: '#fef2f2', color: '#991b1b', border: '1px solid #fca5a5' }}>⏳ Pending DTC (PH Rejected)</span>,
  EMERGENCY_PENDING_DTC: <span className="badge" style={{ background: '#fef3c7', color: '#92400e' }}>⏳ Emergency Pending</span>,
  EMERGENCY_APPROVED: <span className="badge" style={{ background: '#dcfce7', color: '#166534' }}>✅ Emergency Approved</span>,
  EMERGENCY_REJECTED: <span className="badge" style={{ background: '#fee2e2', color: '#991b1b' }}>❌ Emergency Rejected</span>,
  ORDER_PLACED: <span className="badge" style={{ background: '#dbeafe', color: '#1e40af' }}>📦 Order Placed</span>,
  APPROVED_PENDING_ORDER: <span className="badge badge-approved">✅ Approved (Pending Order)</span>,
  INVENTORY_RECEIVED: <span className="badge badge-approved" style={{ background: '#dcfce7', color: '#15803d', border: '1px solid #bbf7d0' }}>🏁 Completed</span>,
  INVENTORY_STOCKED: <span className="badge badge-approved" style={{ background: '#dcfce7', color: '#15803d', border: '1px solid #bbf7d0' }}>🏁 Completed</span>,
};

export function getStatusBadge(status, role) {
  const normRole = String(role || '').toUpperCase();
  if ((normRole === 'DOCTOR' || normRole === 'HOD') && status === 'PHARMACY_HEAD_REJECTED_PENDING_DTC') {
    return <span className="badge badge-pending" style={{ background: '#e0f2fe', color: '#0369a1', border: '1px solid #bae6fd' }}>⏳ Under DTC Review</span>;
  }
  return STATUS_BADGE_MAP[status] || <span className="badge badge-info">{status}</span>;
}

export function ProgressBar({ stage, status, requestSource = 'DOCTOR', request = null }) {
  const source = String(requestSource).toUpperCase() === 'HOD' ? 'HOD' : 'DOCTOR';
  const stages = buildStagesByRequestType(source);
  const idx = getStageIndex(stage, status, source, request);
  const isRejected = ['Rejected', 'HOD_REJECTED', 'PHARMACIST_REJECTED', 'PHARMACY_HEAD_REJECTED', 'CEO_REJECTED', 'EMERGENCY_REJECTED'].includes(status);

  return (
    <div className="progress-track">
      {stages.map((s, i) => {
        let cls = '';
        const isCurrent = i === idx;
        const isPassed = i < idx;

        if (isRejected && isCurrent) {
          cls = 'rejected';
        } else if (isPassed) {
          cls = 'done';
        } else if (isCurrent) {
          cls = 'active';
        }

        return (
          <div key={s.key || i} className={`progress-step ${cls}`}>
            <div className="step-dot">
              {isRejected && isCurrent ? '✕' : isPassed ? '✓' : i + 1}
            </div>
            <div className="step-label">{s.label}</div>
          </div>
        );
      })}
    </div>
  );
}
