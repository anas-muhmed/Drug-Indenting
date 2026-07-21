// Last Bucket B group: Pharmacy Head reverting a request back to the
// pharmacist for correction, and the pharmacist resubmitting the
// corrected sheet. Both previously had zero role restriction and
// trusted a client-supplied performed_by.

import request from 'supertest';
import app from '../server.js';
import { signToken } from '../utils/auth.js';

beforeAll(() => {
  process.env.JWT_SECRET = 'test-secret-do-not-use-in-real-env';
});

describe('PUT /api/requests/:id/revert-to-pharmacist', () => {
  test('no token -> 401', async () => {
    const res = await request(app)
      .put('/api/requests/1/revert-to-pharmacist')
      .send({ remarks: 'needs correction' });
    expect(res.status).toBe(401);
  });

  test('a non-pharmacyhead role -> 403', async () => {
    const token = signToken({ id: 5, role: 'pharmacist', type: 'user' });
    const res = await request(app)
      .put('/api/requests/1/revert-to-pharmacist')
      .set('Authorization', `Bearer ${token}`)
      .send({ remarks: 'needs correction' });
    expect(res.status).toBe(403);
  });
});

describe('PUT /api/requests/:id/resubmit-correction', () => {
  test('no token -> 401', async () => {
    const res = await request(app)
      .put('/api/requests/1/resubmit-correction')
      .send({ alternatives: [] });
    expect(res.status).toBe(401);
  });

  test('a non-pharmacist role -> 403', async () => {
    const token = signToken({ id: 5, role: 'pharmacyhead', type: 'user' });
    const res = await request(app)
      .put('/api/requests/1/resubmit-correction')
      .set('Authorization', `Bearer ${token}`)
      .send({ alternatives: [] });
    expect(res.status).toBe(403);
  });
});
