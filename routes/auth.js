// Core registration/login routes — moved out of server.js unchanged,
// mounted at the API root (/api) since these are /api/register and
// /api/login specifically, not under a shared prefix of their own.
// Both are intentionally public — no token exists yet at this point.

import express from 'express';
import bcrypt from 'bcrypt';
import oracledb from 'oracledb';
import { getConn } from '../db/pool.js';
import { signToken, normalizeRole, SALT_ROUNDS } from '../utils/auth.js';
import { validatePassword } from '../utils/pureHelpers.js';

const router = express.Router();

router.post('/register', async (req, res) => {
  const { name, email, password, role, department, user_login_id } = req.body;

  // ── 1. Basic presence checks ──────────────────────────────────────────────
  if (!name || !email || !password || !role || !user_login_id) {
    return res.status(400).json({
      success: false,
      message: 'name, email, password, role, and user_login_id are required.',
    });
  }

  // ── 1.1 User ID validation ────────────────────────────────────────────────
  const normalizedUserId = user_login_id.toLowerCase().trim();
  const userIdRegex = /^[a-zA-Z0-9._-]{1,30}$/;
  if (!userIdRegex.test(normalizedUserId)) {
    return res.status(400).json({
      success: false,
      message: 'User ID must be 1-30 alphanumeric characters, including underscores, dots, or hyphens, and no spaces.',
    });
  }

  // ── 2. Email format check ─────────────────────────────────────────────────
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.status(400).json({ success: false, message: 'Invalid email format.' });
  }

  // ── 3. Password policy ────────────────────────────────────────────────────
  const pwErrors = validatePassword(password);
  if (pwErrors.length > 0) {
    return res.status(400).json({ success: false, message: pwErrors.join(' ') });
  }

  let conn;
  try {
    conn = await getConn();   // ← your Oracle pool helper

    // ── 4. Duplicate email check ──────────────────────────────────────────
    const dupCheck = await conn.execute(
      `SELECT COUNT(*) AS cnt FROM users WHERE email = :email`,
      { email: email.toLowerCase().trim() }
    );
    if (dupCheck.rows[0].CNT > 0) {
      return res.status(409).json({ success: false, message: 'Email already registered.' });
    }

    // ── 4.1 Duplicate User ID check ───────────────────────────────────────
    const dupUserCheck = await conn.execute(
      `SELECT COUNT(*) AS cnt FROM users WHERE LOWER(user_login_id) = :userLoginId`,
      { userLoginId: normalizedUserId }
    );
    if (dupUserCheck.rows[0].CNT > 0) {
      return res.status(409).json({ success: false, message: 'User ID already exists.' });
    }

    // ── 5. Hash the password ──────────────────────────────────────────────
    const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);

    // ── 6. Insert into DB ─────────────────────────────────────────────────
    const result = await conn.execute(
      `INSERT INTO users (name, email, password, role, department, is_active, is_approved, user_login_id)
       VALUES (:name, :email, :password, :role, :department, 1, 0, :userLoginId)
       RETURNING user_id INTO :user_id`,
      {
        name: name.trim(),
        email: email.toLowerCase().trim(),
        password: hashedPassword,
        role: role.toLowerCase().trim(),
        department: department && department.trim() !== '' ? department.trim() : null,
        userLoginId: normalizedUserId,
        user_id: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER },
      },
      { autoCommit: true }
    );

    const newUserId = result.outBinds.user_id[0];

    const normalizedRole = role.toLowerCase().trim();
    if (normalizedRole === 'doctor' || normalizedRole === 'hod') {
      await conn.execute(
        `INSERT INTO user_request_quotas (user_id, quarterly_limit, updated_by)
         VALUES (:userId, 10, :updatedBy)`,
        { userId: newUserId, updatedBy: newUserId },
        { autoCommit: true }
      );
    }

    return res.status(201).json({
      success: true,
      pendingApproval: true,
      message: 'Registration submitted successfully. Awaiting admin approval.',
      data: {
        user_id: newUserId,
        name: name.trim(),
        email: email.toLowerCase().trim(),
        role: role.toLowerCase().trim(),
        department: department?.trim() ?? null,
        is_active: 1,
      },
    });

  } catch (err) {
    console.error('[POST /register] Error:', err);
    return res.status(500).json({ success: false, message: 'Internal server error.' });
  } finally {
    if (conn) await conn.close();
  }
});

// ─── GET /api/users/check-username ───────────────────────────────────────────

// ─── POST /api/login ───────────────────────────────────────────────────────────
router.post('/login', async (req, res) => {
  const { userId, password } = req.body;
  if (!userId || !password) return res.status(400).json({ success: false, message: 'User ID and password required' });

  let conn;
  try {
    conn = await getConn();
    const result = await conn.execute(
      `SELECT user_id, password, role, is_approved, force_password_reset FROM users WHERE LOWER(user_login_id) = LOWER(:userId) AND is_active = 1`,
      { userId: userId.trim() }
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    const user = result.rows[0];
    const isMatch = await bcrypt.compare(password, user.PASSWORD);

    if (!isMatch) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    if (user.IS_APPROVED !== 1) {
      return res.status(403).json({
        success: false,
        pendingApproval: true,
        message: 'Your account is awaiting approval by the Administrator. Please contact the IT Department.',
      });
    }

    const role = normalizeRole(user.ROLE);
    const token = signToken({ id: user.USER_ID, role, type: 'user' });

    return res.status(200).json({
      success: true,
      user_id: user.USER_ID,
      role: user.ROLE,
      force_password_reset: user.FORCE_PASSWORD_RESET === 1,
      token,
    });
  } catch (err) {
    console.error('[POST /api/login] Error:', err);
    return res.status(500).json({ success: false, message: 'Internal server error.' });
  } finally {
    if (conn) await conn.close();
  }
});

export default router;
