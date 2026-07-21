// Canonical role/stage vocabulary, plus the core workflow rule Bucket B
// needs: which role is responsible for a request while it sits at a given
// stage. Defined once here so new code (starting with the approve/reject
// routes) references named constants instead of scattered raw strings.
//
// Existing comparisons elsewhere in server.js are untouched — these are
// exactly the values already in use (see the NEXT_STAGE/STAGE_LABELS maps
// in server.js), not new spellings, so introducing this file changes
// nothing about current behavior.

// Lowercase, matching the convention normalizeRole() (utils/auth.js)
// already uses, and what most of the codebase already normalizes to
// before comparing.
export const ROLES = {
  DOCTOR: 'doctor',
  HOD: 'hod',
  PHARMACIST: 'pharmacist',
  PHARMACY_HEAD: 'pharmacyhead',
  DTC_COMMITTEE: 'dtccommittee',
  CEO: 'ceo',
  ADMIN: 'admin',
};

// Mixed-case, matching exactly what's stored in drug_requests.current_stage.
export const STAGES = {
  HOD: 'HOD',
  PHARMACIST_INITIAL_REVIEW: 'PharmacistInitialReview',
  PHARMACIST_CORRECTION: 'PharmacistCorrection',
  PHARMACY_HEAD: 'PharmacyHead',
  PHARMACY_HEAD_REVIEW_2: 'PharmacyHeadReview2',
  DTC_COMMITTEE: 'DTCCommittee',
  DTC_FINAL: 'DTCFinal',
  EMERGENCY_DTC: 'EmergencyDTC',
  CEO: 'CEO',
  PHARMACIST_ORDER: 'PharmacistOrder',
  FINAL: 'Final',
  REJECTED: 'Rejected',
  ORDER_PLACED: 'OrderPlaced',
};

// The core Bucket B rule: which role may act on a request while it sits
// at a given stage. Derived from the existing NEXT_STAGE workflow map and
// confirmed against the actual approval process (HOD -> Pharmacist initial
// review -> Pharmacy Head -> DTC first pass -> Pharmacist alternatives ->
// Pharmacy Head review 2 -> DTC final -> CEO -> Pharmacist order placement).
export const STAGE_APPROVER_ROLE = {
  [STAGES.HOD]: ROLES.HOD,
  [STAGES.PHARMACIST_INITIAL_REVIEW]: ROLES.PHARMACIST,
  [STAGES.PHARMACIST_CORRECTION]: ROLES.PHARMACIST,
  [STAGES.PHARMACY_HEAD]: ROLES.PHARMACY_HEAD,
  [STAGES.PHARMACY_HEAD_REVIEW_2]: ROLES.PHARMACY_HEAD,
  [STAGES.DTC_COMMITTEE]: ROLES.DTC_COMMITTEE,
  [STAGES.DTC_FINAL]: ROLES.DTC_COMMITTEE,
  [STAGES.EMERGENCY_DTC]: ROLES.DTC_COMMITTEE,
  [STAGES.CEO]: ROLES.CEO,
  [STAGES.PHARMACIST_ORDER]: ROLES.PHARMACIST,
};

// Returns the role allowed to act on a request currently at `stage`, or
// null if the stage doesn't require stage-specific approval (e.g. Final/
// Rejected — terminal states nobody "approves" anymore).
export function getApproverRoleForStage(stage) {
  return STAGE_APPROVER_ROLE[stage] || null;
}

// Where an approval sends a request next — moved here from server.js
// unchanged (same keys/values), so route files can import it instead of
// server.js defining it locally.
export const NEXT_STAGE = {
  HOD: 'PharmacistInitialReview',          // HOD approve → Pharmacist Initial Review
  PharmacistInitialReview: 'PharmacyHead', // Pharmacist Initial Review approve → PharmacyHead
  PharmacyHead: 'DTCCommittee',
  DTCCommittee: 'Pharmacist',              // DTC first-pass → Pharmacist analysis
  Pharmacist: 'PharmacyHeadReview2',       // Pharmacist submits alternatives → PH review
  PharmacyHeadReview2: 'DTCFinal',         // PH approves → DTC final
  PharmacistCorrection: 'PharmacyHeadReview2', // Pharmacist resubmits corrected sheet → PH
  DTCFinal: 'CEO',                         // DTC final → CEO
  CEO: 'PharmacistOrder',                  // CEO final → Pharmacist Order Placement
  EmergencyDTC: 'PharmacistOrder',         // Emergency DTC approve → Pharmacist
};

export const STAGE_LABELS = {
  HOD: 'Head of Department',
  PharmacistInitialReview: 'Pharmacist (Initial Review)',
  PharmacyHead: 'Pharmacy Head',
  DTCCommittee: 'DTC Committee',
  Pharmacist: 'Pharmacist',
  PharmacyHeadReview2: 'Pharmacy Head (Review 2)',
  PharmacistCorrection: 'Pharmacist (Correction Required)',
  DTCFinal: 'DTC Committee (Final)',
  CEO: 'CEO',
  Final: 'Final Approval',
  Rejected: 'Rejected',
  EmergencyDTC: 'DTC Committee (Emergency)',
  PharmacistOrder: 'Pharmacist (Order Placement)',
  OrderPlaced: 'Order Placed',
};
