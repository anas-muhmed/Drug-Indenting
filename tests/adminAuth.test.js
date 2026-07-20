// Whole-app HTTP tests for the newly-wired JWT admin middleware.
// Deliberately only covers the REJECTION paths (missing/invalid/wrong-type
// token) — those are stopped by requireAdminAuth before any DB call
// happens, so they're safe to test with no real database available.
// A valid-token "does the route actually work" test would need a real
// (or fully mocked) database and is out of scope here.

import request from 'supertest';
import app from '../server.js';
import { signToken } from '../utils/auth.js';

beforeAll(() => {
  process.env.JWT_SECRET = 'test-secret-do-not-use-in-real-env';
});

// Two representative routes (one GET, one PUT) — every admin route uses
// the exact same middleware, so this is a wiring smoke test, not an
// attempt to re-verify middleware logic already covered by
// middleware/requireAuth.test.js.
describe('admin routes require a valid admin JWT', () => {
  test('GET /api/admin/users with no Authorization header -> 401', async () => {
    const res = await request(app).get('/api/admin/users');
    expect(res.status).toBe(401);
  });

  test('GET /api/admin/users with a garbage token -> 401', async () => {
    const res = await request(app)
      .get('/api/admin/users')
      .set('Authorization', 'Bearer not-a-real-token');
    expect(res.status).toBe(401);
  });

  test('GET /api/admin/users with a valid regular-user token -> 401 (wrong type)', async () => {
    const userToken = signToken({ id: 7, role: 'doctor', type: 'user' });
    const res = await request(app)
      .get('/api/admin/users')
      .set('Authorization', `Bearer ${userToken}`);
    expect(res.status).toBe(401);
  });

  test('PUT /api/admin/toggle-user/1 with no Authorization header -> 401', async () => {
    const res = await request(app).put('/api/admin/toggle-user/1').send({});
    expect(res.status).toBe(401);
  });
});
