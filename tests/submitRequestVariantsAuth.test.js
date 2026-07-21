// POST /api/requests/pharmacist and POST /api/requests/emergency —
// both alternate ways to create a drug_requests row, both previously
// missing the same protections we already fixed on POST /api/requests.

import request from 'supertest';
import app from '../server.js';
import { signToken } from '../utils/auth.js';

beforeAll(() => {
  process.env.JWT_SECRET = 'test-secret-do-not-use-in-real-env';
});

describe('POST /api/requests/pharmacist', () => {
  test('no token -> 401', async () => {
    const res = await request(app).post('/api/requests/pharmacist').send({ doctor_id: 5 });
    expect(res.status).toBe(401);
  });

  test('a non-pharmacist role (e.g. doctor) -> 403', async () => {
    const token = signToken({ id: 5, role: 'doctor', type: 'user' });
    const res = await request(app)
      .post('/api/requests/pharmacist')
      .set('Authorization', `Bearer ${token}`)
      .send({ doctor_id: 5 });
    expect(res.status).toBe(403);
  });
});

describe('POST /api/requests/emergency', () => {
  test('no token -> 401', async () => {
    const res = await request(app).post('/api/requests/emergency').send({ doctor_id: 5 });
    expect(res.status).toBe(401);
  });

  test('doctor_id in body belongs to someone else -> 403 (impersonation attempt)', async () => {
    const token = signToken({ id: 5, role: 'doctor', type: 'user' });
    const res = await request(app)
      .post('/api/requests/emergency')
      .set('Authorization', `Bearer ${token}`)
      .send({ doctor_id: 999 });
    expect(res.status).toBe(403);
  });

  test('a role not allowed to submit (e.g. pharmacist) -> 403 even with matching id', async () => {
    const token = signToken({ id: 5, role: 'pharmacist', type: 'user' });
    const res = await request(app)
      .post('/api/requests/emergency')
      .set('Authorization', `Bearer ${token}`)
      .send({ doctor_id: 5 });
    expect(res.status).toBe(403);
  });
});
