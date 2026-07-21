// Analytics, DTC-management, and the "requireAuth-only" shared routes.
// requireRole's actual decision logic is already thoroughly unit-tested
// in middleware/requireAuth.test.js — these are wiring smoke tests,
// confirming the middleware is actually attached to representative
// routes from each group, at the real HTTP layer.

import request from 'supertest';
import app from '../server.js';
import { signToken } from '../utils/auth.js';

beforeAll(() => {
  process.env.JWT_SECRET = 'test-secret-do-not-use-in-real-env';
});

describe('Analytics routes require ceo/dtc/dtccommittee (or admin)', () => {
  test('GET /api/analytics/summary — no token -> 401', async () => {
    const res = await request(app).get('/api/analytics/summary');
    expect(res.status).toBe(401);
  });

  test('GET /api/analytics/summary — a doctor token -> 403', async () => {
    const token = signToken({ id: 5, role: 'doctor', type: 'user' });
    const res = await request(app)
      .get('/api/analytics/summary')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  test('GET /api/analytics/audit-trail — a doctor token -> 403 (second analytics route, confirms it is not just the first one wired)', async () => {
    const token = signToken({ id: 5, role: 'doctor', type: 'user' });
    const res = await request(app)
      .get('/api/analytics/audit-trail')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });
});

describe('DTC-management routes require dtc/dtccommittee (or admin)', () => {
  test('GET /api/dtc/blacklist — no token -> 401', async () => {
    const res = await request(app).get('/api/dtc/blacklist');
    expect(res.status).toBe(401);
  });

  test('GET /api/dtc/blacklist — a pharmacist token -> 403', async () => {
    const token = signToken({ id: 5, role: 'pharmacist', type: 'user' });
    const res = await request(app)
      .get('/api/dtc/blacklist')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  test('GET /api/dtc/user-quotas — a doctor token -> 403', async () => {
    const token = signToken({ id: 5, role: 'doctor', type: 'user' });
    const res = await request(app)
      .get('/api/dtc/user-quotas')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });
});

describe('GET /api/users — any authenticated role, no restriction', () => {
  test('no token -> 401', async () => {
    const res = await request(app).get('/api/users');
    expect(res.status).toBe(401);
  });
});

describe('Ambiguous-role routes — requireAuth only, no role guess', () => {
  test('GET /api/audit/:requestId — no token -> 401', async () => {
    const res = await request(app).get('/api/audit/1');
    expect(res.status).toBe(401);
  });

  test('GET /api/rejection-remark-history — no token -> 401', async () => {
    const res = await request(app).get('/api/rejection-remark-history');
    expect(res.status).toBe(401);
  });

  test('GET /api/generics/search — no token -> 401', async () => {
    const res = await request(app).get('/api/generics/search?q=aspirin');
    expect(res.status).toBe(401);
  });

  test('POST /api/reports/item-margin-report — no token -> 401', async () => {
    const res = await request(app).post('/api/reports/item-margin-report').send({});
    expect(res.status).toBe(401);
  });
});
