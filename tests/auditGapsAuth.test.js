// Routes found during a final full-file audit sweep that had been missed
// by the earlier route-by-route pass — all had ZERO authentication
// before this fix. Most severe: DELETE /api/users/:id (deactivates any
// account), change-password-force (sets any user's password), and
// getPatientInfo (returns real patient name + diagnosis by MRNO).

import request from 'supertest';
import app from '../server.js';
import { signToken } from '../utils/auth.js';

beforeAll(() => {
  process.env.JWT_SECRET = 'test-secret-do-not-use-in-real-env';
});

describe('GET /api/requests/:requestId/existing-generic-data', () => {
  test('no token -> 401', async () => {
    const res = await request(app).get('/api/requests/1/existing-generic-data');
    expect(res.status).toBe(401);
  });
});

describe('DELETE /api/users/:id (deactivates an account — admin only)', () => {
  test('no token -> 401', async () => {
    const res = await request(app).delete('/api/users/5');
    expect(res.status).toBe(401);
  });

  test('a regular user token (not admin) -> 401', async () => {
    const token = signToken({ id: 1, role: 'admin', type: 'user' }); // wrong type on purpose
    const res = await request(app)
      .delete('/api/users/5')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(401);
  });
});

describe('POST /api/users/:id/change-password-force', () => {
  test('no token -> 401', async () => {
    const res = await request(app)
      .post('/api/users/5/change-password-force')
      .send({ newPassword: 'NewPass1!' });
    expect(res.status).toBe(401);
  });

  test('valid token for a DIFFERENT user -> 403 (this used to let anyone reset anyone\'s password)', async () => {
    const token = signToken({ id: 5, role: 'doctor', type: 'user' });
    const res = await request(app)
      .post('/api/users/999/change-password-force')
      .set('Authorization', `Bearer ${token}`)
      .send({ newPassword: 'NewPass1!' });
    expect(res.status).toBe(403);
  });
});

describe('POST /api/getPatientInfo (real patient name + diagnosis — doctor only)', () => {
  test('no token -> 401', async () => {
    const res = await request(app).post('/api/getPatientInfo').send({ mrno: '12345' });
    expect(res.status).toBe(401);
  });

  test('a non-doctor role -> 403', async () => {
    const token = signToken({ id: 5, role: 'pharmacist', type: 'user' });
    const res = await request(app)
      .post('/api/getPatientInfo')
      .set('Authorization', `Bearer ${token}`)
      .send({ mrno: '12345' });
    expect(res.status).toBe(403);
  });
});

describe('POST /api/getGeneric, POST /api/saveGenericItem, drug-profile, alternative-drug', () => {
  test('getGeneric — no token -> 401', async () => {
    const res = await request(app).post('/api/getGeneric').send({ search: 'aspirin' });
    expect(res.status).toBe(401);
  });

  test('saveGenericItem — no token -> 401', async () => {
    const res = await request(app).post('/api/saveGenericItem').send({});
    expect(res.status).toBe(401);
  });

  test('drug-profile — no token -> 401', async () => {
    const res = await request(app).post('/api/drug-profile').send({ drug_name: 'Aspirin' });
    expect(res.status).toBe(401);
  });

  test('alternative-drug — no token -> 401', async () => {
    const res = await request(app).post('/api/alternative-drug').send({ drug_name: 'Aspirin' });
    expect(res.status).toBe(401);
  });
});
