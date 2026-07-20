import jwt from 'jsonwebtoken';
import { signToken, verifyToken, extractBearerToken, normalizeRole } from './auth.js';

beforeAll(() => {
  process.env.JWT_SECRET = 'test-secret-do-not-use-in-real-env';
});

describe('signToken / verifyToken', () => {
  test('round-trip: verifying a freshly signed token returns the original payload', () => {
    const token = signToken({ id: 42, role: 'doctor' });
    const decoded = verifyToken(token);
    expect(decoded.id).toBe(42);
    expect(decoded.role).toBe('doctor');
  });

  test('throws when JWT_SECRET is missing', () => {
    const original = process.env.JWT_SECRET;
    delete process.env.JWT_SECRET;
    expect(() => signToken({ id: 1 })).toThrow('JWT_SECRET is not configured');
    process.env.JWT_SECRET = original;
  });

  test('throws on a tampered/garbage token', () => {
    expect(() => verifyToken('not-a-real-token')).toThrow();
  });

  test('throws on a token signed with a different secret', () => {
    const token = signToken({ id: 1 });
    const original = process.env.JWT_SECRET;
    process.env.JWT_SECRET = 'a-different-secret';
    expect(() => verifyToken(token)).toThrow();
    process.env.JWT_SECRET = original;
  });

  test('throws on an already-expired token', () => {
    // signToken always uses the fixed 10h expiry, so build an expired one
    // directly here rather than adding a test-only code path to auth.js.
    const expired = jwt.sign({ id: 1 }, process.env.JWT_SECRET, { expiresIn: -10 });
    expect(() => verifyToken(expired)).toThrow(/expired/i);
  });
});

describe('extractBearerToken', () => {
  test('extracts the token from a well-formed header', () => {
    expect(extractBearerToken('Bearer abc123')).toBe('abc123');
  });

  test('returns null for a missing header', () => {
    expect(extractBearerToken(undefined)).toBeNull();
    expect(extractBearerToken(null)).toBeNull();
    expect(extractBearerToken('')).toBeNull();
  });

  test('returns null for a non-Bearer scheme', () => {
    expect(extractBearerToken('Basic abc123')).toBeNull();
  });

  test('returns null for a malformed header with no token', () => {
    expect(extractBearerToken('Bearer')).toBeNull();
    expect(extractBearerToken('justoneword')).toBeNull();
  });
});

describe('normalizeRole', () => {
  test('lowercases and trims', () => {
    expect(normalizeRole('  Doctor  ')).toBe('doctor');
    expect(normalizeRole('PHARMACYHEAD')).toBe('pharmacyhead');
  });

  test('handles missing/null/undefined role as an empty string', () => {
    expect(normalizeRole(null)).toBe('');
    expect(normalizeRole(undefined)).toBe('');
    expect(normalizeRole('')).toBe('');
  });
});
