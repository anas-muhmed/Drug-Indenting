// Alternatives submission (pharmacist-only) and viewing (any authenticated
// role — Pharmacy Head, DTC, and CEO all need to see these at their
// respective review stages, so requireAuth only, same reasoning as the
// earlier analytics "ambiguous group").

import request from 'supertest';
import app from '../server.js';
import { signToken } from '../utils/auth.js';

beforeAll(() => {
  process.env.JWT_SECRET = 'test-secret-do-not-use-in-real-env';
});

describe('POST /api/alternatives/:requestId', () => {
  test('no token -> 401', async () => {
    const res = await request(app).post('/api/alternatives/1').send({ alternatives: [{}] });
    expect(res.status).toBe(401);
  });

  test('a non-pharmacist role -> 403', async () => {
    const token = signToken({ id: 5, role: 'ceo', type: 'user' });
    const res = await request(app)
      .post('/api/alternatives/1')
      .set('Authorization', `Bearer ${token}`)
      .send({ alternatives: [{}] });
    expect(res.status).toBe(403);
  });
});

describe('POST /api/pharmacist/correction-submit/:requestId', () => {
  test('no token -> 401', async () => {
    const res = await request(app).post('/api/pharmacist/correction-submit/1').send({ alternatives: [{}] });
    expect(res.status).toBe(401);
  });

  test('a non-pharmacist role -> 403', async () => {
    const token = signToken({ id: 5, role: 'pharmacyhead', type: 'user' });
    const res = await request(app)
      .post('/api/pharmacist/correction-submit/1')
      .set('Authorization', `Bearer ${token}`)
      .send({ alternatives: [{}] });
    expect(res.status).toBe(403);
  });
});

describe('GET /api/alternatives/:requestId', () => {
  test('no token -> 401', async () => {
    const res = await request(app).get('/api/alternatives/1');
    expect(res.status).toBe(401);
  });
});

describe('GET /api/alternatives/:requestId/selected', () => {
  test('no token -> 401', async () => {
    const res = await request(app).get('/api/alternatives/1/selected');
    expect(res.status).toBe(401);
  });
});
