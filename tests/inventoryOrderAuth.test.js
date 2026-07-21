// Order placement and inventory-tracking routes — all pharmacist-only
// responsibilities. All three previously had zero auth and trusted a
// client-supplied performed_by for the audit log.

import request from 'supertest';
import app from '../server.js';
import { signToken } from '../utils/auth.js';

beforeAll(() => {
  process.env.JWT_SECRET = 'test-secret-do-not-use-in-real-env';
});

describe('POST /api/requests/:id/place_order', () => {
  test('no token -> 401', async () => {
    const res = await request(app).post('/api/requests/1/place_order').send({});
    expect(res.status).toBe(401);
  });

  test('a non-pharmacist role -> 403', async () => {
    const token = signToken({ id: 5, role: 'ceo', type: 'user' });
    const res = await request(app)
      .post('/api/requests/1/place_order')
      .set('Authorization', `Bearer ${token}`)
      .send({});
    expect(res.status).toBe(403);
  });
});

describe('PUT /api/requests/:id/mark-inventory-added', () => {
  test('no token -> 401', async () => {
    const res = await request(app).put('/api/requests/1/mark-inventory-added').send({});
    expect(res.status).toBe(401);
  });

  test('a non-pharmacist role -> 403', async () => {
    const token = signToken({ id: 5, role: 'doctor', type: 'user' });
    const res = await request(app)
      .put('/api/requests/1/mark-inventory-added')
      .set('Authorization', `Bearer ${token}`)
      .send({});
    expect(res.status).toBe(403);
  });
});

describe('POST /api/requests/:requestId/mark-inventory-received', () => {
  test('no token -> 401', async () => {
    const res = await request(app).post('/api/requests/1/mark-inventory-received').send({});
    expect(res.status).toBe(401);
  });

  test('a non-pharmacist role -> 403', async () => {
    const token = signToken({ id: 5, role: 'hod', type: 'user' });
    const res = await request(app)
      .post('/api/requests/1/mark-inventory-received')
      .set('Authorization', `Bearer ${token}`)
      .send({});
    expect(res.status).toBe(403);
  });
});
