import { ROLES, STAGES, STAGE_APPROVER_ROLE, getApproverRoleForStage } from './workflow.js';

describe('getApproverRoleForStage', () => {
  test('maps each stage in the approval workflow to the correct role', () => {
    expect(getApproverRoleForStage(STAGES.HOD)).toBe(ROLES.HOD);
    expect(getApproverRoleForStage(STAGES.PHARMACIST_INITIAL_REVIEW)).toBe(ROLES.PHARMACIST);
    expect(getApproverRoleForStage(STAGES.PHARMACY_HEAD)).toBe(ROLES.PHARMACY_HEAD);
    expect(getApproverRoleForStage(STAGES.DTC_COMMITTEE)).toBe(ROLES.DTC_COMMITTEE);
    expect(getApproverRoleForStage(STAGES.PHARMACIST_CORRECTION)).toBe(ROLES.PHARMACIST);
    expect(getApproverRoleForStage(STAGES.PHARMACY_HEAD_REVIEW_2)).toBe(ROLES.PHARMACY_HEAD);
    expect(getApproverRoleForStage(STAGES.DTC_FINAL)).toBe(ROLES.DTC_COMMITTEE);
    expect(getApproverRoleForStage(STAGES.CEO)).toBe(ROLES.CEO);
    expect(getApproverRoleForStage(STAGES.PHARMACIST_ORDER)).toBe(ROLES.PHARMACIST);
    expect(getApproverRoleForStage(STAGES.EMERGENCY_DTC)).toBe(ROLES.DTC_COMMITTEE);
  });

  test('returns null for terminal stages with no further approver', () => {
    expect(getApproverRoleForStage(STAGES.FINAL)).toBeNull();
    expect(getApproverRoleForStage(STAGES.REJECTED)).toBeNull();
    expect(getApproverRoleForStage(STAGES.ORDER_PLACED)).toBeNull();
  });

  test('returns null for an unrecognized stage', () => {
    expect(getApproverRoleForStage('SomeUnknownStage')).toBeNull();
  });
});

describe('STAGES values match what is already stored in drug_requests.current_stage', () => {
  test('spot-check exact spellings against the existing NEXT_STAGE map in server.js', () => {
    expect(STAGES.HOD).toBe('HOD');
    expect(STAGES.PHARMACIST_INITIAL_REVIEW).toBe('PharmacistInitialReview');
    expect(STAGES.PHARMACY_HEAD).toBe('PharmacyHead');
    expect(STAGES.DTC_COMMITTEE).toBe('DTCCommittee');
    expect(STAGES.PHARMACY_HEAD_REVIEW_2).toBe('PharmacyHeadReview2');
    expect(STAGES.DTC_FINAL).toBe('DTCFinal');
    expect(STAGES.CEO).toBe('CEO');
    expect(STAGES.PHARMACIST_ORDER).toBe('PharmacistOrder');
  });
});
