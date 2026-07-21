// GET /api/dashboard/:role has three distinct authorization shapes in one
// route: doctor/hod are personal (must match your own userId), the other
// clinical roles are role-level aggregates (role must match, no specific
// user needed), and admin requires a separate admin-type token entirely.

import request from 'supertest';
import app from '../server.js';
import { signToken } from '../utils/auth.js';

beforeAll(() => {
  process.env.JWT_SECRET = 'test-secret-do-not-use-in-real-env';
});

describe('GET /api/dashboard/:role', () => {
  test('no token -> 401', async () => {
    const res = await request(app).get('/api/dashboard/doctor?userId=5');
    expect(res.status).toBe(401);
  });

  test('doctor viewing a DIFFERENT doctor\'s dashboard -> 403', async () => {
    const token = signToken({ id: 5, role: 'doctor', type: 'user' });
    const res = await request(app)
      .get('/api/dashboard/doctor?userId=999')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  test('a doctor token requesting the ceo dashboard -> 403 (role mismatch)', async () => {
    const token = signToken({ id: 5, role: 'doctor', type: 'user' });
    const res = await request(app)
      .get('/api/dashboard/ceo')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  test('admin dashboard requires an admin-type token, not just any valid token', async () => {
    const userToken = signToken({ id: 1, role: 'admin', type: 'user' }); // impossible in practice, but proves type is checked
    const res = await request(app)
      .get('/api/dashboard/admin')
      .set('Authorization', `Bearer ${userToken}`);
    expect(res.status).toBe(403);
  });
});
