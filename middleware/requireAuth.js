// Express middleware that verifies the JWT issued at login and attaches
// the caller's identity to req — this is what every protected route should
// depend on to know "who is actually making this request", instead of
// trusting a role/userId the client just typed into a URL.
//
// Not yet wired into any route (see server.js) — built and tested in
// isolation first, applied to routes as its own separate, reviewed step.

import { verifyToken, extractBearerToken } from '../utils/auth.js';

export function requireAuth(req, res, next) {
  const token = extractBearerToken(req.headers.authorization);
  if (!token) {
    return res.status(401).json({ success: false, message: 'Authentication required.' });
  }

  let decoded;
  try {
    decoded = verifyToken(token);
  } catch (err) {
    return res.status(401).json({ success: false, message: 'Invalid or expired session. Please log in again.' });
  }

  if (decoded.type !== 'user') {
    return res.status(401).json({ success: false, message: 'Invalid token for this request.' });
  }

  req.user = { id: decoded.id, role: decoded.role };
  next();
}

export function requireAdminAuth(req, res, next) {
  const token = extractBearerToken(req.headers.authorization);
  if (!token) {
    return res.status(401).json({ success: false, message: 'Admin authentication required.' });
  }

  let decoded;
  try {
    decoded = verifyToken(token);
  } catch (err) {
    return res.status(401).json({ success: false, message: 'Invalid or expired session. Please log in again.' });
  }

  if (decoded.type !== 'admin') {
    return res.status(401).json({ success: false, message: 'Invalid token for this request.' });
  }

  // Matches the existing convention already used by the 8 routes on the
  // old x-admin-id-header version of this middleware, so wiring this in
  // later doesn't require touching those route bodies.
  req.adminId = decoded.id;
  next();
}

// Requires the caller to be an authenticated user with one of the given
// roles, OR an admin (admins can always reach role-gated management/
// analytics views too). Used for routes restricted by role rather than
// by per-user ownership — e.g. analytics dashboards only CEO/DTC/admin
// are meant to see, per client/src/layouts/ProtectedLayout.jsx's
// PATH_ROLES map and the AnalyticsDashboard import chain.
export function requireRole(...allowedRoles) {
  return (req, res, next) => {
    const token = extractBearerToken(req.headers.authorization);
    if (!token) {
      return res.status(401).json({ success: false, message: 'Authentication required.' });
    }

    let decoded;
    try {
      decoded = verifyToken(token);
    } catch (err) {
      return res.status(401).json({ success: false, message: 'Invalid or expired session. Please log in again.' });
    }

    if (decoded.type === 'admin') {
      req.adminId = decoded.id;
      return next();
    }

    if (decoded.type === 'user' && allowedRoles.includes(decoded.role)) {
      req.user = { id: decoded.id, role: decoded.role };
      return next();
    }

    return res.status(403).json({ success: false, message: 'You are not authorized to access this resource.' });
  };
}
