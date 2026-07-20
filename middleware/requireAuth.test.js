import { jest } from '@jest/globals';
import { signToken } from '../utils/auth.js';
import { requireAuth, requireAdminAuth } from './requireAuth.js';

beforeAll(() => {
  process.env.JWT_SECRET = 'test-secret-do-not-use-in-real-env';
});

function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

describe('requireAuth', () => {
  test('valid user token: calls next() and attaches req.user', () => {
    const token = signToken({ id: 7, role: 'doctor', type: 'user' });
    const req = { headers: { authorization: `Bearer ${token}` } };
    const res = mockRes();
    const next = jest.fn();

    requireAuth(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.user).toEqual({ id: 7, role: 'doctor' });
    expect(res.status).not.toHaveBeenCalled();
  });

  test('missing Authorization header: 401, next not called', () => {
    const req = { headers: {} };
    const res = mockRes();
    const next = jest.fn();

    requireAuth(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  test('garbage token: 401', () => {
    const req = { headers: { authorization: 'Bearer not-a-real-token' } };
    const res = mockRes();
    const next = jest.fn();

    requireAuth(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  test('an admin-type token is rejected by requireAuth', () => {
    const token = signToken({ id: 1, role: 'admin', type: 'admin' });
    const req = { headers: { authorization: `Bearer ${token}` } };
    const res = mockRes();
    const next = jest.fn();

    requireAuth(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });
});

describe('requireAdminAuth', () => {
  test('valid admin token: calls next() and attaches req.adminId', () => {
    const token = signToken({ id: 3, role: 'admin', type: 'admin' });
    const req = { headers: { authorization: `Bearer ${token}` } };
    const res = mockRes();
    const next = jest.fn();

    requireAdminAuth(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.adminId).toBe(3);
    expect(res.status).not.toHaveBeenCalled();
  });

  test('missing Authorization header: 401, next not called', () => {
    const req = { headers: {} };
    const res = mockRes();
    const next = jest.fn();

    requireAdminAuth(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  test('a regular user-type token is rejected by requireAdminAuth', () => {
    const token = signToken({ id: 7, role: 'doctor', type: 'user' });
    const req = { headers: { authorization: `Bearer ${token}` } };
    const res = mockRes();
    const next = jest.fn();

    requireAdminAuth(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });
});
