// Whole-app HTTP tests for POST /api/requests — previously trusted a
// client-supplied `doctor_id` in the body with no verification, meaning
// any authenticated (or even unauthenticated) caller could submit a
// request impersonating any doctor. Only rejection paths are tested
// (no real DB available).

import request from 'supertest';
import app from '../server.js';
import { signToken } from '../utils/auth.js';

beforeAll(() => {
  process.env.JWT_SECRET = 'test-secret-do-not-use-in-real-env';
});

describe('POST /api/requests requires auth and self-matching doctor_id', () => {
  test('no Authorization header -> 401', async () => {
    const res = await request(app).post('/api/requests').send({ doctor_id: 5 });
    expect(res.status).toBe(401);
  });

  test('valid token, but doctor_id in body belongs to someone else -> 403', async () => {
    const doctorToken = signToken({ id: 5, role: 'doctor', type: 'user' });
    const res = await request(app)
      .post('/api/requests')
      .set('Authorization', `Bearer ${doctorToken}`)
      .send({ doctor_id: 999 }); // impersonation attempt
    expect(res.status).toBe(403);
  });

  test('a role not allowed to submit requests (e.g. pharmacist) -> 403 even with matching id', async () => {
    const pharmacistToken = signToken({ id: 5, role: 'pharmacist', type: 'user' });
    const res = await request(app)
      .post('/api/requests')
      .set('Authorization', `Bearer ${pharmacistToken}`)
      .send({ doctor_id: 5 });
    expect(res.status).toBe(403);
  });

  test('an admin-type token is rejected on this user route', async () => {
    const adminToken = signToken({ id: 1, role: 'admin', type: 'admin' });
    const res = await request(app)
      .post('/api/requests')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ doctor_id: 5 });
    expect(res.status).toBe(401);
  });
});
