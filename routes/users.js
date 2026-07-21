// User profile/admin-management routes — moved out of server.js
// unchanged, mounted at /api/users. Route order preserved exactly as
// it was (check-username before :id matters — a specific path must be
// registered before a generic single-segment param, or Express would
// wrongly match it as an :id value).

import express from 'express';
import bcrypt from 'bcrypt';
import { getConn } from '../db/pool.js';
import { requireAuth, requireAdminAuth } from '../middleware/requireAuth.js';
import { extractBearerToken, verifyToken, SALT_ROUNDS } from '../utils/auth.js';
import { validatePassword } from '../utils/pureHelpers.js';
import { writeAdminAudit } from '../utils/auditHelpers.js';

const router = express.Router();

router.get('/', requireAuth, async (req, res) => {
  const conn = await getConn();
  try {
    const result = await conn.execute(
      `SELECT user_id, name, email, role, department FROM users WHERE is_active = 1 ORDER BY user_id`
    );
    res.json(result.rows);
  } catch (err) {
    console.error('GET users error:', err);
    res.status(500).json({ error: 'Internal server error.', detail: err.message });
  } finally {
    await conn.close();
  }
});

router.get('/check-username', async (req, res) => {
  const { username } = req.query;
  if (!username) {
    return res.status(400).json({ success: false, message: 'Username is required.' });
  }
  let conn;
  try {
    conn = await getConn();
    const check = await conn.execute(
      `SELECT COUNT(*) AS cnt FROM users WHERE LOWER(user_login_id) = :username`,
      { username: username.toLowerCase().trim() }
    );
    return res.json({ available: check.rows[0].CNT === 0 });
  } catch (err) {
    console.error('[GET /api/users/check-username] Error:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  } finally {
    if (conn) await conn.close();
  }
});

router.get('/:id', requireAuth, async (req, res) => {
  const userId = Number(req.params.id);
  if (isNaN(userId)) return res.status(400).json({ success: false, message: 'Invalid user ID.' });

  let conn;
  try {
    conn = await getConn();
    const result = await conn.execute(
      `SELECT user_id, user_login_id, name, email, role, department, is_active
       FROM users WHERE user_id = :id`,
      { id: userId }
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }
    return res.status(200).json({ success: true, data: result.rows[0] });
  } catch (err) {
    console.error('[GET /:id] Error:', err);
    return res.status(500).json({ success: false, message: 'Internal server error.' });
  } finally {
    if (conn) await conn.close();
  }
});

router.put('/:id', async (req, res) => {
  const userId = Number(req.params.id);
  if (isNaN(userId)) return res.status(400).json({ success: false, message: 'Invalid user ID.' });

  const { name, role, department, is_active, user_login_id } = req.body;
  if (!name && !role && department === undefined && is_active === undefined && !user_login_id) {
    return res.status(400).json({ success: false, message: 'Nothing to update.' });
  }

  // role, is_active, and user_login_id are admin-only changes; a plain
  // name/department edit is allowed by the user themselves too.
  const requiresAdmin = role !== undefined || is_active !== undefined || !!user_login_id;

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

  let adminId = null;
  if (decoded.type === 'admin') {
    adminId = decoded.id;
  } else if (decoded.type === 'user') {
    if (requiresAdmin) {
      return res.status(403).json({ success: false, message: 'Only an admin can change role, active status, or user ID.' });
    }
    if (decoded.id !== userId) {
      return res.status(403).json({ success: false, message: 'You can only update your own profile.' });
    }
  } else {
    return res.status(401).json({ success: false, message: 'Invalid token for this request.' });
  }
  req.adminId = adminId;

  let conn;
  try {
    conn = await getConn();

    // Check if user exists first to get details for validation and audit logs
    const userCheck = await conn.execute(
      `SELECT name, email, user_login_id FROM users WHERE user_id = :userId`,
      { userId }
    );
    if (userCheck.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }
    const currentUser = userCheck.rows[0];
    const oldLoginId = currentUser.USER_LOGIN_ID || '';

    // Build dynamic SET clause
    const setClauses = [];
    const binds = { id: userId };

    if (name) { setClauses.push('name       = :name'); binds.name = name.trim(); }
    if (role) { setClauses.push('role       = :role'); binds.role = role.trim(); }
    if (department !== undefined) {
      setClauses.push('department = :department'); binds.department = department?.trim() ?? null;
    }
    if (is_active !== undefined) {
      setClauses.push('is_active  = :is_active'); binds.is_active = is_active ? 1 : 0;
    }

    let isUserIdChanged = false;
    let normalizedNewId = '';
    if (user_login_id && user_login_id.trim() !== '') {
      normalizedNewId = user_login_id.toLowerCase().trim();
      if (normalizedNewId !== oldLoginId.toLowerCase().trim()) {
        isUserIdChanged = true;
      }
    }

    if (isUserIdChanged) {
      // Admin auth for this change was already verified above (requiresAdmin).

      // 2. Validate regex: ^[a-zA-Z0-9._-]{4,30}$
      const userIdRegex = /^[a-zA-Z0-9._-]{4,30}$/;
      if (!userIdRegex.test(normalizedNewId)) {
        return res.status(400).json({ success: false, message: 'User ID must be 4-30 alphanumeric characters, including underscores, dots, or hyphens, and no spaces.' });
      }

      // 3. Validate uniqueness
      const dupCheck = await conn.execute(
        `SELECT COUNT(*) AS cnt FROM users WHERE LOWER(user_login_id) = :newId AND user_id <> :id`,
        { newId: normalizedNewId, id: userId }
      );
      if (dupCheck.rows[0].CNT > 0) {
        return res.status(409).json({ success: false, message: 'User ID already exists.' });
      }

      setClauses.push('user_login_id = :user_login_id');
      binds.user_login_id = normalizedNewId;
    }

    await conn.execute(
      `UPDATE users SET ${setClauses.join(', ')} WHERE user_id = :id`,
      binds,
      { autoCommit: true }
    );

    // Write audit log entry if User ID was updated
    if (isUserIdChanged) {
      await writeAdminAudit(
        conn,
        req.adminId,
        'USER_LOGIN_ID_UPDATED',
        userId,
        `Updated User ID for user ${currentUser.NAME} (${currentUser.EMAIL}). Old User ID: ${oldLoginId}, New User ID: ${normalizedNewId}`
      );
    }

    return res.status(200).json({ success: true, message: 'User updated successfully.' });
  } catch (err) {
    console.error('[PUT /:id] Error:', err);
    return res.status(500).json({ success: false, message: 'Internal server error.' });
  } finally {
    if (conn) await conn.close();
  }
});

router.patch('/:id/change-password', requireAuth, async (req, res) => {
  const userId = Number(req.params.id);
  if (isNaN(userId)) return res.status(400).json({ success: false, message: 'Invalid user ID.' });

  if (req.user.id !== userId) {
    return res.status(403).json({ success: false, message: 'You can only change your own password.' });
  }

  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ success: false, message: 'currentPassword and newPassword are required.' });
  }

  const pwErrors = validatePassword(newPassword);
  if (pwErrors.length > 0) {
    return res.status(400).json({ success: false, message: pwErrors.join(' ') });
  }

  let conn;
  try {
    conn = await getConn();

    const result = await conn.execute(
      `SELECT password FROM users WHERE user_id = :id`,
      { id: userId }
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    const isMatch = await bcrypt.compare(currentPassword, result.rows[0].PASSWORD);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: 'Current password is incorrect.' });
    }

    const hashedNew = await bcrypt.hash(newPassword, SALT_ROUNDS);
    await conn.execute(
      `UPDATE users SET password = :password WHERE user_id = :id`,
      { password: hashedNew, id: userId },
      { autoCommit: true }
    );

    return res.status(200).json({ success: true, message: 'Password changed successfully.' });
  } catch (err) {
    console.error('[PATCH /:id/change-password] Error:', err);
    return res.status(500).json({ success: false, message: 'Internal server error.' });
  } finally {
    if (conn) await conn.close();
  }
});

router.delete('/:id', requireAdminAuth, async (req, res) => {
  const userId = Number(req.params.id);
  if (isNaN(userId)) return res.status(400).json({ success: false, message: 'Invalid user ID.' });

  let conn;
  try {
    conn = await getConn();
    const result = await conn.execute(
      `UPDATE users SET is_active = 0 WHERE user_id = :id`,
      { id: userId },
      { autoCommit: true }
    );
    if (result.rowsAffected === 0) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }
    return res.status(200).json({ success: true, message: 'User deactivated successfully.' });
  } catch (err) {
    console.error('[DELETE /:id] Error:', err);
    return res.status(500).json({ success: false, message: 'Internal server error.' });
  } finally {
    if (conn) await conn.close();
  }
});

router.post('/:id/change-password-force', requireAuth, async (req, res) => {
  const userId = Number(req.params.id);
  if (isNaN(userId)) return res.status(400).json({ success: false, message: 'Invalid user ID.' });

  if (req.user.id !== userId) {
    return res.status(403).json({ success: false, message: 'You can only change your own password.' });
  }

  const { newPassword } = req.body;
  if (!newPassword) return res.status(400).json({ success: false, message: 'newPassword is required.' });

  const pwErrors = validatePassword(newPassword);
  if (pwErrors.length > 0) return res.status(400).json({ success: false, message: pwErrors.join(' ') });

  let conn;
  try {
    conn = await getConn();
    const userCheck = await conn.execute(
      `SELECT user_id, force_password_reset FROM users WHERE user_id = :userId AND is_active = 1`,
      { userId }
    );
    if (userCheck.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'User not found or inactive.' });
    }

    const hashed = await bcrypt.hash(newPassword, SALT_ROUNDS);
    await conn.execute(
      `UPDATE users
       SET password = :password, force_password_reset = 0, temp_password_issued = 0
       WHERE user_id = :userId`,
      { password: hashed, userId },
      { autoCommit: true }
    );
    return res.json({ success: true, message: 'Password updated successfully. You can now proceed.' });
  } catch (err) {
    console.error('[POST /api/users/change-password-force] Error:', err.message);
    return res.status(500).json({ success: false, message: 'Internal server error.' });
  } finally {
    if (conn) await conn.close();
  }
});


export default router;
