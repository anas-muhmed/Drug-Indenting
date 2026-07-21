// Admin portal routes — moved out of server.js unchanged, mounted at
// /api/admin. register/login are intentionally public (no token exists
// yet); every other route requires requireAdminAuth.

import express from 'express';
import bcrypt from 'bcrypt';
import oracledb from 'oracledb';
import { getConn } from '../db/pool.js';
import { requireAdminAuth } from '../middleware/requireAuth.js';
import { signToken, SALT_ROUNDS } from '../utils/auth.js';
import { validatePassword } from '../utils/pureHelpers.js';
import { writeAdminAudit } from '../utils/auditHelpers.js';

const router = express.Router();

router.post('/register', async (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password) {
    return res.status(400).json({ success: false, message: 'name, email, and password are required.' });
  }
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.status(400).json({ success: false, message: 'Invalid email format.' });
  }
  const pwErrors = validatePassword(password);
  if (pwErrors.length > 0) {
    return res.status(400).json({ success: false, message: pwErrors.join(' ') });
  }

  let conn;
  try {
    conn = await getConn();
    // ONE-TIME: check if admin already exists
    const existCheck = await conn.execute(`SELECT COUNT(*) AS cnt FROM admin_users`);
    if (existCheck.rows[0].CNT > 0) {
      return res.status(409).json({
        success: false,
        message: 'Admin account already exists. Registration is one-time only.',
      });
    }

    const hashedPw = await bcrypt.hash(password, SALT_ROUNDS);
    const result = await conn.execute(
      `INSERT INTO admin_users (name, email, password)
       VALUES (:name, :email, :password)
       RETURNING admin_id INTO :adminId`,
      {
        name: name.trim(),
        email: email.toLowerCase().trim(),
        password: hashedPw,
        adminId: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER },
      },
      { autoCommit: true }
    );
    const adminId = result.outBinds.adminId[0];
    console.log(`[ADMIN] Admin account created: ${email} (admin_id=${adminId})`);
    return res.status(201).json({
      success: true,
      message: 'Admin account created successfully.',
      admin_id: adminId,
    });
  } catch (err) {
    console.error('[POST /api/admin/register] Error:', err.message);
    return res.status(500).json({ success: false, message: 'Internal server error.' });
  } finally {
    if (conn) await conn.close();
  }
});

// =============================================================
// POST /api/admin/login — Admin login
// =============================================================
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ success: false, message: 'Email and password required.' });
  }
  let conn;
  try {
    conn = await getConn();
    const result = await conn.execute(
      `SELECT admin_id, name, email, password FROM admin_users WHERE email = :email`,
      { email: email.toLowerCase().trim() }
    );
    if (result.rows.length === 0) {
      return res.status(401).json({ success: false, message: 'Invalid credentials.' });
    }
    const admin = result.rows[0];
    const isMatch = await bcrypt.compare(password, admin.PASSWORD);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: 'Invalid credentials.' });
    }
    const token = signToken({ id: admin.ADMIN_ID, role: 'admin', type: 'admin' });

    return res.status(200).json({
      success: true,
      admin_id: admin.ADMIN_ID,
      name: admin.NAME,
      email: admin.EMAIL,
      role: 'admin',
      token,
    });
  } catch (err) {
    console.error('[POST /api/admin/login] Error:', err.message);
    return res.status(500).json({ success: false, message: 'Internal server error.' });
  } finally {
    if (conn) await conn.close();
  }
});

// =============================================================
// GET /api/admin/users — Get all users grouped by role
// =============================================================
router.get('/users', requireAdminAuth, async (req, res) => {
  let conn;
  try {
    conn = await getConn();
    const result = await conn.execute(
      `SELECT user_id,
          user_login_id,
          name,
          email,
          role,
          department,
          is_active,
          force_password_reset,
          temp_password_issued
   FROM users
   ORDER BY role, name`
    );
    // Group by role
    const grouped = {};
    for (const row of result.rows) {
      const r = row.ROLE || 'unknown';
      if (!grouped[r]) grouped[r] = [];
      grouped[r].push({
        user_id: row.USER_ID,
        user_login_id: row.USER_LOGIN_ID,
        name: row.NAME,
        email: row.EMAIL,
        role: row.ROLE,
        department: row.DEPARTMENT,
        is_active: row.IS_ACTIVE,
        force_password_reset: row.FORCE_PASSWORD_RESET,
        temp_password_issued: row.TEMP_PASSWORD_ISSUED,
      });
    }
    return res.json({ success: true, data: grouped, total: result.rows.length });
  } catch (err) {
    console.error('[GET /api/admin/users] Error:', err.message);
    return res.status(500).json({ success: false, message: 'Internal server error.' });
  } finally {
    if (conn) await conn.close();
  }
});

// =============================================================
// PUT /api/admin/reset-password/:userId — Admin resets a user's password
// Generates a secure temp password, hashes it, sets force_password_reset=1
// NEVER returns hashed password. Returns temp password ONCE for admin to relay.
// =============================================================
router.put('/reset-password/:userId', requireAdminAuth, async (req, res) => {
  const userId = Number(req.params.userId);
  if (isNaN(userId)) return res.status(400).json({ success: false, message: 'Invalid user ID.' });

  let conn;
  try {
    conn = await getConn();

    // Check user exists
    const userCheck = await conn.execute(
      `SELECT user_id, name, email, role FROM users WHERE user_id = :userId`,
      { userId }
    );
    if (userCheck.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }
    const user = userCheck.rows[0];

    // Generate secure temp password: TempXXXX@YY format
    const randomNum = Math.floor(1000 + Math.random() * 9000);
    const randomSuffix = Math.floor(10 + Math.random() * 90);
    const tempPassword = `Temp${randomNum}@${randomSuffix}`;

    const hashedTemp = await bcrypt.hash(tempPassword, SALT_ROUNDS);

    await conn.execute(
      `UPDATE users
       SET password = :password,
           force_password_reset = 1,
           temp_password_issued = 1
       WHERE user_id = :userId`,
      { password: hashedTemp, userId },
      { autoCommit: true }
    );

    await writeAdminAudit(conn, req.adminId, 'PASSWORD_RESET', userId,
      `Admin reset password for user: ${user.NAME} (${user.EMAIL}) [Role: ${user.ROLE}]`);

    // Return temp password ONCE — admin conveys it securely to user
    return res.json({
      success: true,
      message: `Temporary password set for ${user.NAME}. User must change on next login.`,
      temp_password: tempPassword,
    });
  } catch (err) {
    console.error('[PUT /api/admin/reset-password] Error:', err.message);
    return res.status(500).json({ success: false, message: 'Internal server error.' });
  } finally {
    if (conn) await conn.close();
  }
});

// =============================================================
// PUT /api/admin/toggle-user/:userId — Activate or deactivate a user
// =============================================================
router.put('/toggle-user/:userId', requireAdminAuth, async (req, res) => {
  const userId = Number(req.params.userId);
  if (isNaN(userId)) return res.status(400).json({ success: false, message: 'Invalid user ID.' });

  let conn;
  try {
    conn = await getConn();

    const userCheck = await conn.execute(
      `SELECT user_id, name, email, role, is_active FROM users WHERE user_id = :userId`,
      { userId }
    );
    if (userCheck.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }
    const user = userCheck.rows[0];
    const newStatus = user.IS_ACTIVE === 1 ? 0 : 1;

    await conn.execute(
      `UPDATE users SET is_active = :isActive WHERE user_id = :userId`,
      { isActive: newStatus, userId },
      { autoCommit: true }
    );

    const action = newStatus === 1 ? 'USER_ACTIVATED' : 'USER_DEACTIVATED';
    await writeAdminAudit(conn, req.adminId, action, userId,
      `${newStatus === 1 ? 'Activated' : 'Deactivated'} user: ${user.NAME} (${user.EMAIL}) [Role: ${user.ROLE}]`);

    return res.json({
      success: true,
      message: `User ${user.NAME} has been ${newStatus === 1 ? 'activated' : 'deactivated'}.`,
      is_active: newStatus,
    });
  } catch (err) {
    console.error('[PUT /api/admin/toggle-user] Error:', err.message);
    return res.status(500).json({ success: false, message: 'Internal server error.' });
  } finally {
    if (conn) await conn.close();
  }
});

// =============================================================
// GET /api/admin/audit-logs — View admin action history
// =============================================================
router.get('/audit-logs', requireAdminAuth, async (req, res) => {
  let conn;
  try {
    conn = await getConn();
    const result = await conn.execute(
      `SELECT al.audit_id, al.action, al.target_user, al.details, al.performed_at,
              u.name AS target_user_name, u.email AS target_user_email
       FROM admin_audit_logs al
       LEFT JOIN users u ON u.user_id = al.target_user
       WHERE al.admin_id = :adminId
       ORDER BY al.performed_at DESC
       FETCH FIRST 200 ROWS ONLY`,
      { adminId: req.adminId }
    );
    return res.json({ success: true, data: result.rows });
  } catch (err) {
    console.error('[GET /api/admin/audit-logs] Error:', err.message);
    return res.status(500).json({ success: false, message: 'Internal server error.' });
  } finally {
    if (conn) await conn.close();
  }
});

// =============================================================
// GET /api/admin/pending-users — Get all users awaiting approval
// =============================================================
router.get('/pending-users', requireAdminAuth, async (req, res) => {
  let conn;
  try {
    conn = await getConn();
    const result = await conn.execute(
      `SELECT user_id, user_login_id, name, email, role, department
       FROM users
       WHERE is_approved = 0 AND is_active = 1
       ORDER BY user_id DESC`
    );
    const users = result.rows.map(row => ({
      user_id: row.USER_ID,
      user_login_id: row.USER_LOGIN_ID,
      name: row.NAME,
      email: row.EMAIL,
      role: row.ROLE,
      department: row.DEPARTMENT
    }));
    return res.json({ success: true, data: users });
  } catch (err) {
    console.error('[GET /api/admin/pending-users] Error:', err.message);
    return res.status(500).json({ success: false, message: 'Internal server error.' });
  } finally {
    if (conn) await conn.close();
  }
});

// =============================================================
// PUT /api/admin/approve-user/:userId — Approve a pending registration
// =============================================================
router.put('/approve-user/:userId', requireAdminAuth, async (req, res) => {
  const userId = Number(req.params.userId);
  if (isNaN(userId)) return res.status(400).json({ success: false, message: 'Invalid user ID.' });

  let conn;
  try {
    conn = await getConn();
    const userCheck = await conn.execute(
      `SELECT user_id, name, email, role FROM users WHERE user_id = :userId`,
      { userId }
    );
    if (userCheck.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }
    const user = userCheck.rows[0];

    await conn.execute(
      `UPDATE users SET is_approved = 1 WHERE user_id = :userId`,
      { userId },
      { autoCommit: true }
    );

    await writeAdminAudit(conn, req.adminId, 'USER_APPROVED', userId,
      `Approved user registration: ${user.NAME} (${user.EMAIL}) [Role: ${user.ROLE}]`);

    return res.json({
      success: true,
      message: `User ${user.NAME} has been approved.`,
    });
  } catch (err) {
    console.error('[PUT /api/admin/approve-user] Error:', err.message);
    return res.status(500).json({ success: false, message: 'Internal server error.' });
  } finally {
    if (conn) await conn.close();
  }
});

// =============================================================
// PUT /api/admin/users/:userId/role — Update a user's role
// =============================================================
router.put('/users/:userId/role', requireAdminAuth, async (req, res) => {
  const userId = Number(req.params.userId);
  if (isNaN(userId)) {
    return res.status(400).json({ success: false, message: 'Invalid user ID.' });
  }

  let { role } = req.body;
  if (typeof role !== 'string') {
    return res.status(400).json({ success: false, message: 'Role must be a string.' });
  }

  role = role.trim();
  const normalizedRole = role.toLowerCase();
  const ALLOWED_ROLES = ['doctor', 'hod', 'pharmacist', 'pharmacyhead', 'ceo'];
  if (!ALLOWED_ROLES.includes(normalizedRole)) {
    return res.status(400).json({ success: false, message: 'Invalid role value.' });
  }

  function formatRole(r) {
    const l = (r || '').toLowerCase().trim();
    if (l === 'hod') return 'HOD';
    if (l === 'ceo') return 'CEO';
    if (l === 'pharmacyhead') return 'PharmacyHead';
    return l.charAt(0).toUpperCase() + l.slice(1);
  }

  let conn;
  try {
    conn = await getConn();
    const userCheck = await conn.execute(
      `SELECT user_id, name, email, role FROM users WHERE user_id = :userId`,
      { userId }
    );
    if (userCheck.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }
    const user = userCheck.rows[0];
    const oldRole = user.ROLE || '';

    await conn.execute(
      `UPDATE users SET role = :role WHERE user_id = :userId`,
      { role: normalizedRole, userId },
      { autoCommit: true }
    );

    // Write audit log entry
    await writeAdminAudit(
      conn,
      req.adminId,
      'ROLE_UPDATED',
      userId,
      `Updated role for user ${user.NAME} (${user.EMAIL}). Old Role: ${formatRole(oldRole)}, New Role: ${formatRole(normalizedRole)}`
    );

    return res.json({
      success: true,
      message: 'Role updated successfully.',
      role: formatRole(normalizedRole)
    });
  } catch (err) {
    console.error('[PUT /api/admin/users/:userId/role] Error:', err.message);
    return res.status(500).json({ success: false, message: 'Internal server error.' });
  } finally {
    if (conn) await conn.close();
  }
});

// =============================================================
// PUT /api/admin/reject-user/:userId — Reject a pending registration (deactivate)
// =============================================================
router.put('/reject-user/:userId', requireAdminAuth, async (req, res) => {
  const userId = Number(req.params.userId);
  if (isNaN(userId)) return res.status(400).json({ success: false, message: 'Invalid user ID.' });

  let conn;
  try {
    conn = await getConn();
    const userCheck = await conn.execute(
      `SELECT user_id, name, email, role FROM users WHERE user_id = :userId`,
      { userId }
    );
    if (userCheck.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }
    const user = userCheck.rows[0];

    await conn.execute(
      `UPDATE users SET is_active = 0, is_approved = 0 WHERE user_id = :userId`,
      { userId },
      { autoCommit: true }
    );

    await writeAdminAudit(conn, req.adminId, 'USER_REJECTED', userId,
      `Rejected user registration and deactivated account: ${user.NAME} (${user.EMAIL}) [Role: ${user.ROLE}]`);

    return res.json({
      success: true,
      message: `User registration for ${user.NAME} has been rejected/deactivated.`,
    });
  } catch (err) {
    console.error('[PUT /api/admin/reject-user] Error:', err.message);
    return res.status(500).json({ success: false, message: 'Internal server error.' });
  } finally {
    if (conn) await conn.close();
  }
});

export default router;
