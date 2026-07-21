// JWT signing/verification helpers. No Express, no DB — pure and testable.
// JWT_SECRET is read at call time (not captured at import time) so tests
// can set process.env.JWT_SECRET without worrying about import order.

import jwt from 'jsonwebtoken';

const TOKEN_EXPIRY = '10h'; // ~one hospital work shift

// bcrypt cost factor, shared across every route that hashes a password
// (register, admin routes, change-password, change-password-force).
export const SALT_ROUNDS = 12;

function getSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET is not configured');
  }
  return secret;
}

// payload should be small and non-sensitive — e.g. { id, role, tokenVersion }.
// Never put passwords or anything secret in here: JWTs are signed, not encrypted,
// meaning anyone holding the token can read the payload (just can't forge it).
export function signToken(payload) {
  return jwt.sign(payload, getSecret(), { expiresIn: TOKEN_EXPIRY });
}

// Throws if the token is missing, malformed, expired, or signed with a
// different secret. Callers are expected to catch and turn this into a 401.
export function verifyToken(token) {
  return jwt.verify(token, getSecret());
}

// Pulls the token out of an "Authorization: Bearer <token>" header value.
// Returns null (not a throw) for anything malformed, so callers can just
// check "if (!token)" without a try/catch for this part.
export function extractBearerToken(authHeaderValue) {
  if (!authHeaderValue || typeof authHeaderValue !== 'string') return null;
  const parts = authHeaderValue.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer' || !parts[1]) return null;
  return parts[1];
}

// Minimal role normalization so newly-issued tokens are internally
// consistent (lowercase, trimmed). This does NOT touch the many existing
// mixed-case string comparisons scattered through server.js — that broader
// standardization is a separate, later step.
export function normalizeRole(role) {
  return String(role || '').trim().toLowerCase();
}
