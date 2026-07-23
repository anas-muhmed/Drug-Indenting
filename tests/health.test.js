// GET /health — unauthenticated on purpose (load balancers/monitoring need
// to reach it without a token). Only the "pool not ready" path is testable
// here, since there's no real DB in this environment: importing server.js
// directly (without calling boot()) never initializes the Oracle pool, so
// isPoolReady() genuinely is false, and the route never attempts a real
// getConn() call.

import request from 'supertest';
import app from '../server.js';

describe('GET /health', () => {
  test('reports 503 when the DB pool has not been initialized', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(503);
    expect(res.body.status).toBe('unavailable');
    expect(res.body.db).toBe('not initialized');
  });

  test('requires no Authorization header', async () => {
    const res = await request(app).get('/health');
    expect(res.status).not.toBe(401);
  });
});
