// Whole-app HTTP tests for the user profile / quota routes.
// PUT /api/users/:id previously had NO authentication at all for
// role/is_active changes — anyone could grant themselves any role with
// zero login. These tests confirm that hole is closed.
// Only rejection paths are tested (no real DB available) — every check
// here happens before any getConn() call, so none of this hangs.

import request from 'supertest';
import app from '../server.js';
import { signToken } from '../utils/auth.js';

beforeAll(() => {
  process.env.JWT_SECRET = 'test-secret-do-not-use-in-real-env';
});

describe('GET /api/user/quota/:userId', () => {
  test('no token -> 401', async () => {
    const res = await request(app).get('/api/user/quota/5');
    expect(res.status).toBe(401);
  });

  test('valid token for a different user -> 403', async () => {
    const token = signToken({ id: 5, role: 'doctor', type: 'user' });
    const res = await request(app)
      .get('/api/user/quota/999')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });
});

describe('GET /api/users/:id', () => {
  test('no token -> 401', async () => {
    const res = await request(app).get('/api/users/5');
    expect(res.status).toBe(401);
  });
});

describe('PUT /api/users/:id — the privilege-escalation fix', () => {
  test('no token at all -> 401 (this used to succeed with zero auth)', async () => {
    const res = await request(app)
      .put('/api/users/5')
      .send({ role: 'ceo' });
    expect(res.status).toBe(401);
  });

  test('a regular user token trying to change their own role -> 403', async () => {
    const token = signToken({ id: 5, role: 'doctor', type: 'user' });
    const res = await request(app)
      .put('/api/users/5')
      .set('Authorization', `Bearer ${token}`)
      .send({ role: 'ceo' }); // self-escalation attempt
    expect(res.status).toBe(403);
  });

  test('a regular user token trying to change is_active -> 403', async () => {
    const token = signToken({ id: 5, role: 'doctor', type: 'user' });
    const res = await request(app)
      .put('/api/users/5')
      .set('Authorization', `Bearer ${token}`)
      .send({ is_active: true });
    expect(res.status).toBe(403);
  });

  test('a regular user token editing SOMEONE ELSE\'s name/department -> 403', async () => {
    const token = signToken({ id: 5, role: 'doctor', type: 'user' });
    const res = await request(app)
      .put('/api/users/999')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'New Name' });
    expect(res.status).toBe(403);
  });

  test('changing user_login_id requires an admin token, not just a matching user', async () => {
    const token = signToken({ id: 5, role: 'doctor', type: 'user' });
    const res = await request(app)
      .put('/api/users/5')
      .set('Authorization', `Bearer ${token}`)
      .send({ user_login_id: 'new.login.id' });
    expect(res.status).toBe(403);
  });
});

describe('PATCH /api/users/:id/change-password', () => {
  test('no token -> 401', async () => {
    const res = await request(app)
      .patch('/api/users/5/change-password')
      .send({ currentPassword: 'x', newPassword: 'y' });
    expect(res.status).toBe(401);
  });

  test('valid token for a different user -> 403', async () => {
    const token = signToken({ id: 5, role: 'doctor', type: 'user' });
    const res = await request(app)
      .patch('/api/users/999/change-password')
      .set('Authorization', `Bearer ${token}`)
      .send({ currentPassword: 'x', newPassword: 'y' });
    expect(res.status).toBe(403);
  });
});
