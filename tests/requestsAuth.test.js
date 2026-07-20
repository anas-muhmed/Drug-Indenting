// Whole-app HTTP tests for GET /api/requests/:role/:userId — the exact
// route used throughout this project as the flagship example of the
// broken-access-control finding (anyone could curl this with no login
// and read any role's requests). These confirm that hole is closed.
//
// Only rejection paths are tested (no real DB available) — a valid,
// matching token would proceed to a real getConn() call and hang.

import request from 'supertest';
import app from '../server.js';
import { signToken } from '../utils/auth.js';

beforeAll(() => {
  process.env.JWT_SECRET = 'test-secret-do-not-use-in-real-env';
});

describe('GET /api/requests/:role/:userId requires a matching token', () => {
  test('no Authorization header -> 401 (the original vulnerability: this used to return real data)', async () => {
    const res = await request(app).get('/api/requests/CEO/1');
    expect(res.status).toBe(401);
  });

  test('garbage token -> 401', async () => {
    const res = await request(app)
      .get('/api/requests/CEO/1')
      .set('Authorization', 'Bearer not-a-real-token');
    expect(res.status).toBe(401);
  });

  test('a valid token for a DIFFERENT user/role -> 403, not 401', async () => {
    // A real, valid, logged-in doctor's token — but trying to read CEO's requests.
    const doctorToken = signToken({ id: 5, role: 'doctor', type: 'user' });
    const res = await request(app)
      .get('/api/requests/CEO/1')
      .set('Authorization', `Bearer ${doctorToken}`);
    expect(res.status).toBe(403);
  });

  test('a valid token for a different USER of the SAME role -> 403', async () => {
    // Doctor id=5 trying to view doctor id=99's requests.
    const doctorToken = signToken({ id: 5, role: 'doctor', type: 'user' });
    const res = await request(app)
      .get('/api/requests/doctor/99')
      .set('Authorization', `Bearer ${doctorToken}`);
    expect(res.status).toBe(403);
  });

  test('an admin-type token is rejected here too (wrong token type for a user route)', async () => {
    const adminToken = signToken({ id: 1, role: 'admin', type: 'admin' });
    const res = await request(app)
      .get('/api/requests/CEO/1')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(401);
  });
});
