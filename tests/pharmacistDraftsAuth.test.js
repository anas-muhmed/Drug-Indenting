// Pharmacist drafts routes — three have pharmacistId directly in the
// URL/body (testable pre-DB, same as before), three only have a draftId,
// meaning ownership can only be confirmed by looking the draft up first
// (same constraint as the notifications PUT /read route) — for those,
// only the "no token at all" rejection is safely testable without a
// live database.

import request from 'supertest';
import app from '../server.js';
import { signToken } from '../utils/auth.js';

beforeAll(() => {
  process.env.JWT_SECRET = 'test-secret-do-not-use-in-real-env';
});

describe('POST /api/pharmacist/drafts', () => {
  test('no token -> 401', async () => {
    const res = await request(app)
      .post('/api/pharmacist/drafts')
      .send({ request_id: 1, pharmacist_id: 5 });
    expect(res.status).toBe(401);
  });

  test('valid token but pharmacist_id belongs to someone else -> 403', async () => {
    const token = signToken({ id: 5, role: 'pharmacist', type: 'user' });
    const res = await request(app)
      .post('/api/pharmacist/drafts')
      .set('Authorization', `Bearer ${token}`)
      .send({ request_id: 1, pharmacist_id: 999 });
    expect(res.status).toBe(403);
  });
});

describe('GET /api/pharmacist/drafts/for-request/:requestId/:pharmacistId', () => {
  test('no token -> 401', async () => {
    const res = await request(app).get('/api/pharmacist/drafts/for-request/1/5');
    expect(res.status).toBe(401);
  });

  test('valid token for a different pharmacist -> 403', async () => {
    const token = signToken({ id: 5, role: 'pharmacist', type: 'user' });
    const res = await request(app)
      .get('/api/pharmacist/drafts/for-request/1/999')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });
});

describe('GET /api/pharmacist/drafts/:pharmacistId', () => {
  test('no token -> 401', async () => {
    const res = await request(app).get('/api/pharmacist/drafts/5');
    expect(res.status).toBe(401);
  });

  test('valid token for a different pharmacist -> 403', async () => {
    const token = signToken({ id: 5, role: 'pharmacist', type: 'user' });
    const res = await request(app)
      .get('/api/pharmacist/drafts/999')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });
});

describe('draftId-only routes (ownership requires a DB lookup, so only the pre-DB rejection is testable)', () => {
  test('GET /api/pharmacist/drafts/detail/:draftId — no token -> 401', async () => {
    const res = await request(app).get('/api/pharmacist/drafts/detail/1');
    expect(res.status).toBe(401);
  });

  test('PUT /api/pharmacist/drafts/:draftId — no token -> 401', async () => {
    const res = await request(app).put('/api/pharmacist/drafts/1').send({ draft_name: 'x' });
    expect(res.status).toBe(401);
  });

  test('DELETE /api/pharmacist/drafts/:draftId — no token -> 401', async () => {
    const res = await request(app).delete('/api/pharmacist/drafts/1');
    expect(res.status).toBe(401);
  });
});
