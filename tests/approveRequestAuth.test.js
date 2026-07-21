// PUT /api/requests/:id/approve previously had NO authorization check at
// all — literally anyone could approve any request at any workflow
// stage, and the audit-log "performed_by" was trusted straight from the
// request body (same impersonation pattern fixed in POST /api/requests).
//
// The stage-vs-role check itself requires reading the request row first
// (to know its current_stage), so only the pre-DB rejection path (no
// token) is safely testable without a live database — this is the same
// constraint we hit on the draftId-only routes and the notification
// read route.

import request from 'supertest';
import app from '../server.js';

beforeAll(() => {
  process.env.JWT_SECRET = 'test-secret-do-not-use-in-real-env';
});

describe('PUT /api/requests/:id/approve', () => {
  test('no token at all -> 401 (this used to succeed with zero auth)', async () => {
    const res = await request(app)
      .put('/api/requests/1/approve')
      .send({ remarks: 'looks good' });
    expect(res.status).toBe(401);
  });
});

describe('PUT /api/requests/:id/reject', () => {
  test('no token at all -> 401 (this used to succeed with zero auth)', async () => {
    const res = await request(app)
      .put('/api/requests/1/reject')
      .send({ remarks: 'not suitable' });
    expect(res.status).toBe(401);
  });
});

describe('PUT /api/requests/:id/initial-review-approve', () => {
  test('no token at all -> 401 (this used to succeed with zero auth)', async () => {
    const res = await request(app)
      .put('/api/requests/1/initial-review-approve')
      .send({ remarks: 'reviewed' });
    expect(res.status).toBe(401);
  });
});
