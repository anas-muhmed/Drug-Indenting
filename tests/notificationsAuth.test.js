import request from 'supertest';
import app from '../server.js';
import { signToken } from '../utils/auth.js';

beforeAll(() => {
  process.env.JWT_SECRET = 'test-secret-do-not-use-in-real-env';
});

describe('GET /api/notifications/:userId requires a matching token', () => {
  test('no Authorization header -> 401', async () => {
    const res = await request(app).get('/api/notifications/5');
    expect(res.status).toBe(401);
  });

  test('valid token for a DIFFERENT user -> 403', async () => {
    const token = signToken({ id: 5, role: 'doctor', type: 'user' });
    const res = await request(app)
      .get('/api/notifications/999')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });
});

describe('PUT /api/notifications/:id/read requires authentication', () => {
  // Note: the "wrong owner" case requires a real DB lookup (ownerCheck)
  // that happens after this middleware, so it can't be exercised here
  // without a live database — only the pre-DB rejection path is testable.
  test('no Authorization header -> 401', async () => {
    const res = await request(app).put('/api/notifications/1/read').send({});
    expect(res.status).toBe(401);
  });
});
