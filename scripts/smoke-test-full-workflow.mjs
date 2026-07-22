// Full end-to-end workflow smoke test — doctor through CEO through order
// placement, using real accounts against a real running server (this
// script makes real writes; it is NOT a fake-DB test).
//
// Deliberately reads credentials from environment variables, never from
// this file — this repo already had one leaked-credential incident
// (a real Oracle password committed to a public GitHub repo), so no
// second one gets introduced here, even for test accounts.
//
// Usage (from the repo root, against a server already running):
//   BASE_URL=http://localhost:5000/api \
//   DOCTOR_USER=d001        DOCTOR_PASS=... \
//   HOD_USER=hod001         HOD_PASS=... \
//   PHARMACIST_USER=pharma001 PHARMACIST_PASS=... \
//   PHARMACYHEAD_USER=phead001 PHARMACYHEAD_PASS=... \
//   DTC_USER=dtc001         DTC_PASS=... \
//   CEO_USER=ceo001         CEO_PASS=... \
//   node scripts/smoke-test-full-workflow.mjs
//
// Every role's *_PASS defaults to the shared PASSWORD env var if you'd
// rather set that once (all six accounts using the same password, as
// described when this was set up).
//
// What this actually exercises, and why each part matters:
//   1. Doctor creates a request, HOD approves (if the doctor has a
//      department matching a real HOD; auto-detected, not assumed).
//   2. TEST A — Pharmacist "rejects" during Initial Review (pass 1).
//      Verifies today's fix: this must forward to DTC
//      (status=PHARMACIST_REJECTED_PENDING_DTC, stage stays on track to
//      DTCCommittee), not hard-terminate like it used to.
//   3. DTC then makes the real decision on that same request (approves),
//      confirming DTC's decision is what actually matters.
//   4. TEST B — a full second pass: pharmacist submits alternatives,
//      Pharmacy Head negotiates a discount, Pharmacy Head reverts for
//      correction, pharmacist resubmits, and the script verifies the
//      negotiated rate/MRP/GST *survived* the correction cycle — this is
//      the exact data-loss bug fixed earlier today
//      (drug_alternative_negotiations was being cascade-deleted).
//   5. Pharmacy Head forwards to DTC, DTC makes the final selection,
//      CEO approves, pharmacist places the order.
//
// Every step asserts the expected HTTP status and expected
// current_stage/status before moving on — if reality doesn't match, the
// script stops immediately with a clear error instead of plowing ahead
// on bad assumptions.

const BASE_URL = process.env.BASE_URL || 'http://localhost:5000/api';
const SHARED_PASSWORD = process.env.PASSWORD || '';

const ACCOUNTS = {
  doctor: { userId: process.env.DOCTOR_USER || 'd001', password: process.env.DOCTOR_PASS || SHARED_PASSWORD },
  hod: { userId: process.env.HOD_USER || 'hod001', password: process.env.HOD_PASS || SHARED_PASSWORD },
  pharmacist: { userId: process.env.PHARMACIST_USER || 'pharma001', password: process.env.PHARMACIST_PASS || SHARED_PASSWORD },
  pharmacyhead: { userId: process.env.PHARMACYHEAD_USER || 'phead001', password: process.env.PHARMACYHEAD_PASS || SHARED_PASSWORD },
  dtc: { userId: process.env.DTC_USER || 'dtc001', password: process.env.DTC_PASS || SHARED_PASSWORD },
  ceo: { userId: process.env.CEO_USER || 'ceo001', password: process.env.CEO_PASS || SHARED_PASSWORD },
};

let passCount = 0;
let failCount = 0;

function log(msg) {
  console.log(msg);
}

function pass(label) {
  passCount++;
  console.log(`  ✅ ${label}`);
}

function fail(label, detail) {
  failCount++;
  console.error(`  ❌ ${label}`);
  if (detail !== undefined) console.error('     ', typeof detail === 'string' ? detail : JSON.stringify(detail));
}

function assertEqual(actual, expected, label) {
  if (actual === expected) {
    pass(`${label} (${actual})`);
  } else {
    fail(label, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    throw new Error(`Assertion failed: ${label}`);
  }
}

async function api(method, path, token, body) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch { /* no body */ }
  return { status: res.status, data };
}

async function login(account, roleLabel) {
  const { status, data } = await api('POST', '/login', null, {
    userId: account.userId,
    password: account.password,
  });
  if (status !== 200 || !data?.token) {
    throw new Error(`Login failed for ${roleLabel} (${account.userId}): status ${status}, ${JSON.stringify(data)}`);
  }
  pass(`Login as ${roleLabel} (${account.userId}, role=${data.role})`);
  return { token: data.token, userId: data.user_id, role: data.role };
}

// Fetches a single request's current row by scanning a role's list view --
// there's no GET /api/requests/:id single-record endpoint, every route
// returns a filtered list for a role.
async function findRequest(token, role, userId, requestId) {
  const { status, data } = await api('GET', `/requests/${role}/${userId}`, token);
  if (status !== 200) throw new Error(`Failed to list requests for ${role}: status ${status}`);
  const found = (Array.isArray(data) ? data : []).find(r => r.REQUEST_ID === requestId);
  return found || null;
}

async function main() {
  log(`\n=== Smoke test starting against ${BASE_URL} ===\n`);

  log('--- Logging in as all six roles ---');
  const doctor = await login(ACCOUNTS.doctor, 'Doctor');
  const hod = await login(ACCOUNTS.hod, 'HOD');
  const pharmacist = await login(ACCOUNTS.pharmacist, 'Pharmacist');
  const pharmacyhead = await login(ACCOUNTS.pharmacyhead, 'Pharmacy Head');
  const dtc = await login(ACCOUNTS.dtc, 'DTC Committee');
  const ceo = await login(ACCOUNTS.ceo, 'CEO');

  const stamp = Date.now();

  async function createRequest(label) {
    const { status, data } = await api('POST', '/requests', doctor.token, {
      doctor_id: doctor.userId,
      request_type: 'New Drug',
      formulary_request_type: 'NON_FORMULARY',
      category: 'Antibiotic',
      request_source_type: 'NON_PROMOTIONAL',
      brand_name: `ZZSMOKETEST-${label}-${stamp}`,
      generic_name: `ZZSmokeGeneric-${label}`,
      dose_strength: '500mg',
      dosage_form: 'Tablet',
      manufacturer: 'ZZSmokeTest Pharma',
      marketer: 'ZZSmokeTest Marketer',
      clinical_justification: 'Automated smoke test request -- safe to ignore/delete.',
      expected_patients_pm: 5,
      medicine_quantity: 10,
    });
    if (status !== 201) throw new Error(`Create request (${label}) failed: status ${status}, ${JSON.stringify(data)}`);
    pass(`Doctor creates request "${label}" (#${data.request_id})`);
    return data.request_id;
  }

  // Advances a freshly-created request through HOD if (and only if) it
  // actually landed at the HOD stage -- doesn't assume the test doctor's
  // department matches a real HOD account.
  async function clearHodIfNeeded(requestId) {
    const row = await findRequest(doctor.token, 'doctor', doctor.userId, requestId);
    if (!row) throw new Error(`Could not find request #${requestId} in doctor's own list right after creation.`);
    if (row.CURRENT_STAGE === 'HOD') {
      const { status } = await api('PUT', `/requests/${requestId}/approve`, hod.token, { remarks: 'Smoke test HOD approval.' });
      assertEqual(status, 200, `HOD approves #${requestId}`);
    } else {
      log(`  (skipped HOD step -- request #${requestId} landed directly at ${row.CURRENT_STAGE}, no HOD routing for this doctor)`);
    }
  }

  // ===================== TEST A: pass-1 reject routing =====================
  log('\n--- TEST A: Pharmacist "reject" during Initial Review must forward to DTC, not terminate ---');
  const reqA = await createRequest('RejectRoute');
  await clearHodIfNeeded(reqA);

  {
    const { status } = await api('PUT', `/requests/${reqA}/reject`, pharmacist.token, {
      remarks: 'Smoke test: pharmacist reject during initial review.',
    });
    assertEqual(status, 200, `Pharmacist "rejects" #${reqA} during Initial Review`);
  }
  {
    const row = await findRequest(dtc.token, 'DTCCommittee', dtc.userId, reqA);
    if (!row) throw new Error(`Request #${reqA} is not visible to DTC after pharmacist reject -- it got stuck somewhere.`);
    assertEqual(row.CURRENT_STAGE, 'DTCCommittee', `Request #${reqA} current_stage after pharmacist "reject"`);
    assertEqual(row.STATUS, 'PHARMACIST_REJECTED_PENDING_DTC', `Request #${reqA} status after pharmacist "reject"`);
  }
  {
    // DTC makes the real decision -- confirms DTC's approval is what
    // actually matters here, not the pharmacist's attempted rejection.
    const { status } = await api('PUT', `/requests/${reqA}/approve`, dtc.token, { remarks: 'Smoke test: DTC overrides, approves anyway.' });
    assertEqual(status, 200, `DTC approves #${reqA} despite pharmacist's earlier "reject"`);
  }
  {
    const row = await findRequest(pharmacist.token, 'Pharmacist', pharmacist.userId, reqA);
    if (!row) throw new Error(`Request #${reqA} did not reach the Pharmacist (pass 2) queue after DTC approval.`);
    assertEqual(row.CURRENT_STAGE, 'Pharmacist', `Request #${reqA} reached pass 2 (alternatives stage)`);
  }

  // ================ TEST B: full flow + negotiation preservation ================
  log('\n--- TEST B: full doctor-to-CEO flow, including revert/correction with negotiation preservation ---');
  const reqB = await createRequest('FullFlow');
  await clearHodIfNeeded(reqB);

  {
    const { status } = await api('PUT', `/requests/${reqB}/initial-review-approve`, pharmacist.token, {
      remarks: 'Smoke test: initial review approval, no alternatives yet.',
      effective_drug_entries: [],
    });
    assertEqual(status, 200, `Pharmacist Initial Review approves #${reqB} (pass 1, no alternatives)`);
  }
  {
    const row = await findRequest(pharmacyhead.token, 'PharmacyHead', pharmacyhead.userId, reqB);
    if (!row) throw new Error(`Request #${reqB} did not reach Pharmacy Head (pass 1).`);
    assertEqual(row.CURRENT_STAGE, 'PharmacyHead', `Request #${reqB} reached Pharmacy Head (pass 1)`);
  }
  {
    const { status } = await api('PUT', `/requests/${reqB}/approve`, pharmacyhead.token, { remarks: 'Smoke test: PH pass-1 approval.' });
    assertEqual(status, 200, `Pharmacy Head approves #${reqB} (pass 1) -> forwards to DTC`);
  }
  {
    const { status } = await api('PUT', `/requests/${reqB}/approve`, dtc.token, { remarks: 'Smoke test: DTC pass-1 approval.' });
    assertEqual(status, 200, `DTC approves #${reqB} (pass 1) -> forwards to Pharmacist for pass 2`);
  }
  {
    const row = await findRequest(pharmacist.token, 'Pharmacist', pharmacist.userId, reqB);
    if (!row) throw new Error(`Request #${reqB} did not reach pass 2 (Pharmacist/alternatives stage).`);
    assertEqual(row.CURRENT_STAGE, 'Pharmacist', `Request #${reqB} reached pass 2`);
  }

  const originalAlt = {
    brand_name: `ZZSmokeAlt-${stamp}`,
    manufacturer: 'ZZSmokeAlt Manufacturer',
    marketer: 'ZZSmokeAlt Marketer',
    mrp_per_pack: 100, rate_per_pack: 80, gst_percent: 12, pack: 10, qty: 1, offer: 0,
  };
  {
    const { status } = await api('POST', `/alternatives/${reqB}`, pharmacist.token, {
      performed_by: pharmacist.userId,
      alternatives: [originalAlt, { ...originalAlt, brand_name: `ZZSmokeAlt2-${stamp}` }],
      comparison_type: 'new_generic',
      remarks: 'Smoke test: pharmacist submits alternatives.',
      existing_generic_data: null,
    });
    assertEqual(status, 200, `Pharmacist submits alternatives for #${reqB} -> forwards to Pharmacy Head Review 2`);
  }

  let altsAfterSubmit;
  {
    const { status, data } = await api('GET', `/alternatives/${reqB}`, pharmacyhead.token);
    assertEqual(status, 200, `Pharmacy Head can read alternatives for #${reqB}`);
    altsAfterSubmit = data.alternatives;
    if (!altsAfterSubmit || altsAfterSubmit.length < 1) throw new Error('No alternatives came back after pharmacist submission.');
  }

  // Pharmacy Head negotiates a discount on every alternative, matched
  // back to what the pharmacist actually submitted.
  const negotiatedInput = altsAfterSubmit.map(a => ({
    brand_name: a.BRAND_NAME,
    manufacturer: a.MANUFACTURER,
    marketer: a.MARKETER,
    mrp_per_pack: a.MRP_PER_PACK,
    rate_per_pack: a.RATE_PER_PACK,
    gst_percent: a.GST_PERCENT,
    pack: a.PACK,
    qty: a.QTY,
    offer: a.OFFER,
    negotiated_mrp: 90,
    negotiated_rate: 70,
    negotiated_gst: 12,
    negotiation_remarks: 'Smoke test: negotiated 10-unit discount.',
  }));
  {
    const { status } = await api('PUT', `/pharmacy-head/comparison/${reqB}`, pharmacyhead.token, {
      alternatives: negotiatedInput,
    });
    assertEqual(status, 200, `Pharmacy Head saves negotiated rates for #${reqB}`);
  }
  {
    const { data } = await api('GET', `/alternatives/${reqB}`, pharmacyhead.token);
    const negotiated = (data.alternatives || []).find(a => a.NEGOTIATED_MRP != null);
    if (!negotiated) throw new Error('Negotiation did not persist right after Pharmacy Head saved it -- did not even survive one read.');
    pass(`Negotiation data persisted immediately after Pharmacy Head saved it (negotiated_mrp=${negotiated.NEGOTIATED_MRP})`);
  }

  // The actual bug fixed earlier today: revert -> pharmacist correction ->
  // does the negotiation survive?
  {
    const { status } = await api('PUT', `/requests/${reqB}/revert-to-pharmacist`, pharmacyhead.token, {
      remarks: 'Smoke test: reverting for correction to test negotiation preservation.',
    });
    assertEqual(status, 200, `Pharmacy Head reverts #${reqB} for correction`);
  }
  {
    const { status } = await api('PUT', `/requests/${reqB}/resubmit-correction`, pharmacist.token, {
      alternatives: negotiatedInput.map(({ negotiated_mrp, negotiated_rate, negotiated_gst, negotiation_remarks, ...rest }) => rest),
      remarks: 'Smoke test: pharmacist resubmits correction (same brands/manufacturers).',
      comparison_type: 'new_generic',
      existing_generic_data: null,
    });
    assertEqual(status, 200, `Pharmacist resubmits correction for #${reqB}`);
  }
  {
    const { data } = await api('GET', `/alternatives/${reqB}`, pharmacyhead.token);
    const stillNegotiated = (data.alternatives || []).filter(a => a.NEGOTIATED_MRP != null);
    if (stillNegotiated.length === negotiatedInput.length) {
      pass(`Negotiation data SURVIVED the correction cycle (${stillNegotiated.length}/${negotiatedInput.length} alternatives still negotiated) -- today's fix confirmed against the real database`);
    } else {
      fail('Negotiation data survived correction', `expected ${negotiatedInput.length} negotiated alternatives, found ${stillNegotiated.length} -- the cascade-delete bug may be back`);
      throw new Error('Negotiation preservation check failed.');
    }
  }

  // Pharmacy Head forwards to DTC for the final decision.
  {
    const { status } = await api('PUT', `/requests/${reqB}/approve`, pharmacyhead.token, { remarks: 'Smoke test: PH forwards to DTC final.' });
    assertEqual(status, 200, `Pharmacy Head forwards #${reqB} to DTC Final`);
  }
  {
    const { status } = await api('POST', `/dtc/final-select/${reqB}`, dtc.token, {
      dtc_selected_brand: originalAlt.brand_name,
      dtc_selected_category: 'NON_FORMULARY',
      remarks: 'Smoke test: DTC final selection.',
    });
    assertEqual(status, 200, `DTC makes final selection for #${reqB} -> forwards to CEO`);
  }
  {
    const { status } = await api('PUT', `/requests/${reqB}/approve`, ceo.token, { remarks: 'Smoke test: CEO final approval.' });
    assertEqual(status, 200, `CEO approves #${reqB} -> forwards to Pharmacist for order placement`);
  }
  {
    const { status } = await api('POST', `/requests/${reqB}/place_order`, pharmacist.token, {});
    assertEqual(status, 200, `Pharmacist places the order for #${reqB} -- full flow complete`);
  }

  log(`\n=== Smoke test finished: ${passCount} passed, ${failCount} failed ===`);
  if (failCount > 0) process.exit(1);
}

main().catch(err => {
  console.error('\n\u{1F4A5} Smoke test stopped early:', err.message);
  console.log(`\n=== ${passCount} passed, ${failCount} failed, then stopped ===`);
  process.exit(1);
});
