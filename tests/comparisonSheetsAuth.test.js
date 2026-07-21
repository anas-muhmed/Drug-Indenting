// Comparison-sheet routes (pharmacist + pharmacy-head) and DTC final
// drug selection — all previously had zero role restriction, and
// dtc/final-select + pharmacy-head/comparison also trusted a
// client-supplied performed_by.

import request from 'supertest';
import app from '../server.js';
import { signToken } from '../utils/auth.js';

beforeAll(() => {
  process.env.JWT_SECRET = 'test-secret-do-not-use-in-real-env';
});

describe('PUT /api/pharmacist/comparison/:requestId', () => {
  test('no token -> 401', async () => {
    const res = await request(app).put('/api/pharmacist/comparison/1').send({ existing_details: [] });
    expect(res.status).toBe(401);
  });

  test('a non-pharmacist role -> 403', async () => {
    const token = signToken({ id: 5, role: 'pharmacyhead', type: 'user' });
    const res = await request(app)
      .put('/api/pharmacist/comparison/1')
      .set('Authorization', `Bearer ${token}`)
      .send({ existing_details: [] });
    expect(res.status).toBe(403);
  });
});

describe('PUT /api/pharmacy-head/comparison/:requestId', () => {
  test('no token -> 401', async () => {
    const res = await request(app).put('/api/pharmacy-head/comparison/1').send({ alternatives: [] });
    expect(res.status).toBe(401);
  });

  test('a non-pharmacyhead role -> 403', async () => {
    const token = signToken({ id: 5, role: 'pharmacist', type: 'user' });
    const res = await request(app)
      .put('/api/pharmacy-head/comparison/1')
      .set('Authorization', `Bearer ${token}`)
      .send({ alternatives: [] });
    expect(res.status).toBe(403);
  });
});

describe('POST /api/dtc/final-select/:requestId', () => {
  test('no token -> 401', async () => {
    const res = await request(app).post('/api/dtc/final-select/1').send({});
    expect(res.status).toBe(401);
  });

  test('a non-DTC role -> 403', async () => {
    const token = signToken({ id: 5, role: 'ceo', type: 'user' });
    const res = await request(app)
      .post('/api/dtc/final-select/1')
      .set('Authorization', `Bearer ${token}`)
      .send({});
    expect(res.status).toBe(403);
  });
});
