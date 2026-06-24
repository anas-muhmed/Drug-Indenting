import { useState, useEffect, useCallback } from 'react';
import AnalyticsDashboard from './AnalyticsDashboard';

const API = '/api';

// ── Role display config ──────────────────────────────────────────────────────
const ROLE_CONFIG = {
  doctor: { label: 'Doctor', icon: 'stethoscope', color: '#6366f1' },
  hod: { label: 'Head of Department', icon: 'user-star', color: '#8b5cf6' },
  pharmacist: { label: 'Pharmacist', icon: 'pill', color: '#0ea5e9' },
  pharmacyhead: { label: 'Pharmacy Head', icon: 'medical-cross', color: '#10b981' },
  dtc: { label: 'DTC Committee', icon: 'users-group', color: '#f59e0b' },
  dtccommittee: { label: 'DTC Committee', icon: 'users-group', color: '#f59e0b' },
  ceo: { label: 'CEO', icon: 'crown', color: '#ef4444' },
};
function getRoleConfig(role) {
  return ROLE_CONFIG[(role || '').toLowerCase()] || { label: role, icon: 'user', color: '#94a3b8' };
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function adminHeaders() {
  return {
    'Content-Type': 'application/json',
    'x-admin-id': localStorage.getItem('admin_id') || '',
  };
}

function formatDate(d) {
  if (!d) return '—';
  try { return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }); }
  catch { return String(d); }
}

// ── Password Rules ───────────────────────────────────────────────────────────
const PW_RULES = [
  { id: 'len', label: '≥ 6 characters', test: v => v.length >= 6 },
  { id: 'upper', label: 'Uppercase letter', test: v => /[A-Z]/.test(v) },
  { id: 'number', label: 'One number', test: v => /\d/.test(v) },
  { id: 'symbol', label: 'Special character', test: v => /[!@#$%^&*()\-_=+[\]{};':"\\|,.<>/?]/.test(v) },
];

// ═══════════════════════════════════════════════════════════════════════════════
// FORCE CHANGE PASSWORD SCREEN
// ═══════════════════════════════════════════════════════════════════════════════
export function ForceChangePassword({ userId, onDone }) {
  const [pw, setPw] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    if (pw !== confirm) { setMsg({ type: 'error', text: 'Passwords do not match.' }); return; }
    const fails = PW_RULES.filter(r => !r.test(pw));
    if (fails.length) { setMsg({ type: 'error', text: 'Password does not meet requirements.' }); return; }
    setLoading(true);
    try {
      const res = await fetch(`${API}/users/${userId}/change-password-force`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newPassword: pw }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.message);
      setMsg({ type: 'success', text: 'Password changed! Redirecting…' });
      setTimeout(onDone, 1500);
    } catch (err) {
      setMsg({ type: 'error', text: err.message || 'Failed to change password.' });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ minHeight: '100vh', background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'Inter', sans-serif" }}>
      <div style={{ background: 'rgba(255,255,255,0.05)', backdropFilter: 'blur(20px)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 24, padding: '48px 40px', width: '100%', maxWidth: 440, color: '#fff' }}>
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{ width: 64, height: 64, borderRadius: 20, background: 'linear-gradient(135deg, #ef4444, #f97316)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
            <i className="ti ti-lock-exclamation" style={{ fontSize: 32, color: '#fff' }} />
          </div>
          <h2 style={{ margin: '0 0 8px', fontSize: '1.6rem', fontWeight: 700 }}>Password Reset Required</h2>
          <p style={{ margin: 0, color: 'rgba(255,255,255,0.6)', fontSize: '0.9rem' }}>Your administrator has reset your password. Please set a new secure password to continue.</p>
        </div>
        <form onSubmit={handleSubmit}>
          {['New Password', 'Confirm Password'].map((label, i) => (
            <div key={i} style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'rgba(255,255,255,0.5)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</label>
              <input
                type="password"
                value={i === 0 ? pw : confirm}
                onChange={e => i === 0 ? setPw(e.target.value) : setConfirm(e.target.value)}
                placeholder="••••••••"
                style={{ width: '100%', boxSizing: 'border-box', padding: '0 16px', height: 46, borderRadius: 10, border: '1.5px solid rgba(255,255,255,0.15)', background: 'rgba(255,255,255,0.07)', color: '#fff', fontSize: '0.95rem', outline: 'none', fontFamily: 'inherit' }}
              />
            </div>
          ))}
          {pw && (
            <ul style={{ margin: '8px 0 16px', padding: 0, listStyle: 'none', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 12px' }}>
              {PW_RULES.map(r => (
                <li key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.75rem', color: r.test(pw) ? '#4ade80' : 'rgba(255,255,255,0.4)' }}>
                  <i className={`ti ti-${r.test(pw) ? 'circle-check-filled' : 'circle-x'}`} style={{ fontSize: 14 }} />
                  {r.label}
                </li>
              ))}
            </ul>
          )}
          {msg && (
            <div style={{ padding: '10px 14px', borderRadius: 8, marginBottom: 16, background: msg.type === 'success' ? 'rgba(74,222,128,0.15)' : 'rgba(239,68,68,0.15)', color: msg.type === 'success' ? '#4ade80' : '#f87171', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: 8 }}>
              <i className={`ti ti-${msg.type === 'success' ? 'circle-check' : 'alert-circle'}`} />
              {msg.text}
            </div>
          )}
          <button type="submit" disabled={loading} style={{ width: '100%', height: 48, borderRadius: 10, background: 'linear-gradient(135deg, #6366f1, #8b5cf6)', color: '#fff', border: 'none', fontSize: '1rem', fontWeight: 600, cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.7 : 1 }}>
            {loading ? 'Saving…' : 'Set New Password'}
          </button>
        </form>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// ADMIN LOGIN
// ═══════════════════════════════════════════════════════════════════════════════
function AdminLogin({ onLogin }) {
  const [form, setForm] = useState({ email: '', password: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await fetch(`${API}/admin/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.message);
      localStorage.setItem('admin_id', data.admin_id);
      localStorage.setItem('admin_name', data.name);
      localStorage.setItem('admin_email', data.email);
      onLogin(data);
    } catch (err) {
      setError(err.message || 'Invalid credentials. Try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ minHeight: '100vh', background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'Inter', sans-serif" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap'); @keyframes fadeIn{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)}}`}</style>
      <div style={{ animation: 'fadeIn 0.4s ease', background: 'rgba(255,255,255,0.05)', backdropFilter: 'blur(20px)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 24, padding: '48px 40px', width: '100%', maxWidth: 420, color: '#fff', boxShadow: '0 25px 60px rgba(0,0,0,0.5)' }}>
        <div style={{ textAlign: 'center', marginBottom: 36 }}>
          <div style={{ width: 72, height: 72, borderRadius: 22, background: 'linear-gradient(135deg, #6366f1, #8b5cf6)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px', boxShadow: '0 12px 30px rgba(99,102,241,0.4)' }}>
            <i className="ti ti-shield-lock" style={{ fontSize: 36, color: '#fff' }} />
          </div>
          <h1 style={{ margin: '0 0 6px', fontSize: '1.75rem', fontWeight: 700 }}>Admin Portal</h1>
          <p style={{ margin: 0, color: 'rgba(255,255,255,0.5)', fontSize: '0.9rem' }}>Formulary Drug Indenting System</p>
        </div>
        <form onSubmit={handleSubmit}>
          {[['email', 'Email Address', 'email', 'admin@hospital.org', 'mail'],
          ['password', 'Password', 'password', '••••••••', 'lock']].map(([key, label, type, ph, icon]) => (
            <div key={key} style={{ marginBottom: 18 }}>
              <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 600, color: 'rgba(255,255,255,0.5)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.07em' }}>{label}</label>
              <div style={{ position: 'relative' }}>
                <i className={`ti ti-${icon}`} style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'rgba(255,255,255,0.35)', fontSize: 18, pointerEvents: 'none' }} />
                <input
                  type={type}
                  value={form[key]}
                  onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
                  placeholder={ph}
                  style={{ width: '100%', boxSizing: 'border-box', paddingLeft: 42, paddingRight: 16, height: 48, borderRadius: 12, border: '1.5px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.07)', color: '#fff', fontSize: '0.95rem', outline: 'none', fontFamily: 'inherit', transition: 'border 0.2s' }}
                  onFocus={e => e.target.style.borderColor = 'rgba(99,102,241,0.8)'}
                  onBlur={e => e.target.style.borderColor = 'rgba(255,255,255,0.12)'}
                />
              </div>
            </div>
          ))}
          {error && (
            <div style={{ marginBottom: 16, padding: '10px 14px', borderRadius: 8, background: 'rgba(239,68,68,0.15)', color: '#f87171', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: 8 }}>
              <i className="ti ti-alert-circle" /> {error}
            </div>
          )}
          <button type="submit" disabled={loading} style={{ width: '100%', height: 50, borderRadius: 12, background: 'linear-gradient(135deg, #6366f1, #8b5cf6)', color: '#fff', border: 'none', fontSize: '1rem', fontWeight: 600, cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.8 : 1, marginTop: 8, boxShadow: '0 8px 25px rgba(99,102,241,0.4)', transition: 'all 0.2s', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
            {loading ? <><i className="ti ti-loader-2" style={{ animation: 'spin 1s linear infinite' }} /> Signing In…</> : <><i className="ti ti-login-2" /> Sign In to Admin Portal</>}
          </button>
        </form>
        <p style={{ marginTop: 24, textAlign: 'center', color: 'rgba(255,255,255,0.3)', fontSize: '0.78rem' }}>
          First time? Register admin account at <code style={{ color: 'rgba(99,102,241,0.9)' }}>/api/admin/register</code>
        </p>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// TEMP PASSWORD MODAL
// ═══════════════════════════════════════════════════════════════════════════════
function TempPasswordModal({ tempPassword, userName, onClose }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {

      // Modern clipboard API
      if (navigator.clipboard && window.isSecureContext) {

        await navigator.clipboard.writeText(tempPassword);

      } else {

        // Fallback for HTTP / LAN / older browsers
        const textArea = document.createElement('textarea');

        textArea.value = tempPassword;

        textArea.style.position = 'fixed';
        textArea.style.left = '-999999px';
        textArea.style.top = '-999999px';

        document.body.appendChild(textArea);

        textArea.focus();
        textArea.select();

        document.execCommand('copy');

        document.body.removeChild(textArea);
      }

      setCopied(true);

      setTimeout(() => {
        setCopied(false);
      }, 2000);

    } catch (err) {

      console.error('Copy failed:', err);

      alert('Failed to copy password.');
    }
  }
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999 }}>
      <div style={{ background: '#1e293b', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 20, padding: 36, width: '100%', maxWidth: 420, color: '#fff', boxShadow: '0 30px 80px rgba(0,0,0,0.5)' }}>
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <div style={{ width: 56, height: 56, borderRadius: 16, background: 'linear-gradient(135deg, #f59e0b, #f97316)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 14px', boxShadow: '0 8px 20px rgba(245,158,11,0.35)' }}>
            <i className="ti ti-key" style={{ fontSize: 28, color: '#fff' }} />
          </div>
          <h3 style={{ margin: '0 0 6px', fontSize: '1.2rem', fontWeight: 700 }}>Temporary Password Generated</h3>
          <p style={{ margin: 0, color: 'rgba(255,255,255,0.5)', fontSize: '0.85rem' }}>Share this password securely with <strong>{userName}</strong>. It will not be shown again.</p>
        </div>
        <div style={{ background: 'rgba(255,255,255,0.06)', borderRadius: 12, padding: '16px 20px', marginBottom: 20, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, border: '1px solid rgba(245,158,11,0.25)' }}>
          <code style={{ fontSize: '1.2rem', fontFamily: 'monospace', fontWeight: 700, color: '#fbbf24', letterSpacing: '0.08em' }}>{tempPassword}</code>
          <button onClick={copy} style={{ background: copied ? 'rgba(74,222,128,0.2)' : 'rgba(245,158,11,0.2)', border: '1px solid', borderColor: copied ? 'rgba(74,222,128,0.4)' : 'rgba(245,158,11,0.4)', borderRadius: 8, padding: '6px 12px', color: copied ? '#4ade80' : '#fbbf24', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 600, transition: 'all 0.2s', display: 'flex', alignItems: 'center', gap: 6 }}>
            <i className={`ti ti-${copied ? 'check' : 'copy'}`} style={{ fontSize: 14 }} />
            {copied ? 'Copied!' : 'Copy'}
          </button>
        </div>
        <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: 10, padding: '12px 16px', marginBottom: 24, display: 'flex', gap: 10, alignItems: 'flex-start' }}>
          <i className="ti ti-alert-triangle" style={{ color: '#f87171', fontSize: 18, flexShrink: 0, marginTop: 1 }} />
          <p style={{ margin: 0, fontSize: '0.8rem', color: 'rgba(255,255,255,0.6)', lineHeight: 1.5 }}>
            The user will be <strong style={{ color: '#f87171' }}>required to change this password</strong> on their next login. This password is shown only once.
          </p>
        </div>
        <button onClick={onClose} style={{ width: '100%', height: 44, borderRadius: 10, background: 'rgba(255,255,255,0.08)', color: '#fff', border: '1px solid rgba(255,255,255,0.12)', cursor: 'pointer', fontWeight: 600, fontSize: '0.9rem', transition: 'background 0.2s' }}
          onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.14)'}
          onMouseLeave={e => e.currentTarget.style.background = 'rgba(255,255,255,0.08)'}
        >
          Close
        </button>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// USER CARD
// ═══════════════════════════════════════════════════════════════════════════════
function UserCard({ user, onReset, onToggle }) {
  const cfg = getRoleConfig(user.role);
  const isActive = user.is_active === 1;
  return (
    <div style={{ background: 'rgba(255,255,255,0.04)', border: `1px solid ${isActive ? 'rgba(255,255,255,0.08)' : 'rgba(239,68,68,0.3)'}`, borderRadius: 14, padding: '18px 20px', display: 'flex', alignItems: 'center', gap: 16, transition: 'all 0.2s', opacity: isActive ? 1 : 0.65 }}
      onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.07)'}
      onMouseLeave={e => e.currentTarget.style.background = 'rgba(255,255,255,0.04)'}
    >
      {/* Avatar */}
      <div style={{ width: 44, height: 44, borderRadius: 14, background: `${cfg.color}22`, border: `1.5px solid ${cfg.color}44`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        <i className={`ti ti-${cfg.icon}`} style={{ fontSize: 22, color: cfg.color }} />
      </div>

      {/* Info */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontWeight: 600, fontSize: '0.9rem', color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{user.name}</span>
          {user.force_password_reset === 1 && (
            <span style={{ fontSize: '0.65rem', fontWeight: 700, background: 'rgba(245,158,11,0.2)', color: '#fbbf24', border: '1px solid rgba(245,158,11,0.4)', borderRadius: 6, padding: '2px 6px', whiteSpace: 'nowrap' }}>TEMP PASSWORD</span>
          )}
          {!isActive && (
            <span style={{ fontSize: '0.65rem', fontWeight: 700, background: 'rgba(239,68,68,0.2)', color: '#f87171', border: '1px solid rgba(239,68,68,0.4)', borderRadius: 6, padding: '2px 6px', whiteSpace: 'nowrap' }}>INACTIVE</span>
          )}
        </div>
        <div style={{ color: 'rgba(255,255,255,0.45)', fontSize: '0.8rem', marginTop: 2 }}>{user.email}</div>
        {user.department && <div style={{ color: 'rgba(255,255,255,0.35)', fontSize: '0.75rem', marginTop: 1 }}><i className="ti ti-building-hospital" style={{ fontSize: 12, marginRight: 4 }} />{user.department}</div>}
      </div>

      {/* Actions */}
      {/* Actions */}
      <div
        style={{
          display: 'flex',
          gap: 10,
          flexShrink: 0,
          flexWrap: 'wrap',
        }}
      >
        {/* Reset Password Button */}
        <button
          onClick={() => onReset(user)}
          title="Reset Password"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '10px 14px',
            borderRadius: 10,
            background: 'rgba(245,158,11,0.15)',
            border: '1px solid rgba(245,158,11,0.3)',
            color: '#fbbf24',
            cursor: 'pointer',
            fontSize: '0.82rem',
            fontWeight: 600,
            transition: 'all 0.18s ease',
            minWidth: 150,
            justifyContent: 'center',
          }}
          onMouseEnter={e => {
            e.currentTarget.style.background = 'rgba(245,158,11,0.28)';
            e.currentTarget.style.transform = 'translateY(-1px)';
          }}
          onMouseLeave={e => {
            e.currentTarget.style.background = 'rgba(245,158,11,0.15)';
            e.currentTarget.style.transform = 'translateY(0)';
          }}
        >
          <i className="ti ti-key" style={{ fontSize: 16 }} />
          Reset Password
        </button>

        {/* Activate / Reject Button */}
        <button
          onClick={() => onToggle(user)}
          title={isActive ? 'Reject User' : 'Activate User'}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '10px 14px',
            borderRadius: 10,
            background: isActive
              ? 'rgba(239,68,68,0.15)'
              : 'rgba(74,222,128,0.15)',
            border: `1px solid ${isActive
                ? 'rgba(239,68,68,0.3)'
                : 'rgba(74,222,128,0.3)'
              }`,
            color: isActive ? '#f87171' : '#4ade80',
            cursor: 'pointer',
            fontSize: '0.82rem',
            fontWeight: 600,
            transition: 'all 0.18s ease',
            minWidth: 150,
            justifyContent: 'center',
          }}
          onMouseEnter={e => {
            e.currentTarget.style.opacity = '0.9';
            e.currentTarget.style.transform = 'translateY(-1px)';
          }}
          onMouseLeave={e => {
            e.currentTarget.style.opacity = '1';
            e.currentTarget.style.transform = 'translateY(0)';
          }}
        >
          <i
            className={`ti ti-user-${isActive ? 'off' : 'check'}`}
            style={{ fontSize: 16 }}
          />
          {isActive ? 'Reject User' : 'Activate User'}
        </button>
           </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN ADMIN DASHBOARD
// ═══════════════════════════════════════════════════════════════════════════════
export default function AdminDashboard() {
  const [admin, setAdmin] = useState(() => {
    const id = localStorage.getItem('admin_id');
    const name = localStorage.getItem('admin_name');
    return id ? {admin_id: id, name } : null;
  });

  const [usersGrouped, setUsersGrouped] = useState({ });
  const [totalUsers, setTotalUsers] = useState(0);
  const [auditLogs, setAuditLogs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('dashboard'); // 'dashboard' | 'users' | 'audit' | 'approvals'
  const [toast, setToast] = useState(null);
  const [tempPwModal, setTempPwModal] = useState(null); // {tempPassword, userName}
  const [confirmAction, setConfirmAction] = useState(null); // {type, user, resolve}
  
  const [pendingUsers, setPendingUsers] = useState([]);
  const [pendingLoading, setPendingLoading] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 4000);
  };

  const loadUsers = useCallback(async () => {
    if (!admin) return;
    setLoading(true);
    try {
      const res = await fetch(`${API}/admin/users`, {headers: adminHeaders() });
      const data = await res.json();
      if (!data.success) throw new Error(data.message);
      setUsersGrouped(data.data || { });
      setTotalUsers(data.total || 0);
    } catch (err) {
        showToast(err.message || 'Failed to load users.', 'error');
    } finally {
        setLoading(false);
    }
  }, [admin]);

  const loadAuditLogs = useCallback(async () => {
    if (!admin) return;
      try {
      const res = await fetch(`${API}/admin/audit-logs`, {headers: adminHeaders() });
      const data = await res.json();
      if (data.success) setAuditLogs(data.data || []);
    } catch { /* silent */}
  }, [admin]);

  const loadPendingUsers = useCallback(async () => {
    if (!admin) return;
    setPendingLoading(true);
    try {
      const res = await fetch(`${API}/admin/pending-users`, { headers: adminHeaders() });
      const data = await res.json();
      if (data.success) {
        setPendingUsers(data.data || []);
        setPendingCount(data.data?.length || 0);
      }
    } catch {
      /* silent */
    } finally {
      setPendingLoading(false);
    }
  }, [admin]);

  useEffect(() => {
    if (admin) {
      loadUsers();
      loadAuditLogs();
      loadPendingUsers();
    }
  }, [admin, loadUsers, loadAuditLogs, loadPendingUsers]);

  async function handleApprove(user) {
    if (!window.confirm(`Approve registration for ${user.name}?`)) return;
    try {
      const res = await fetch(`${API}/admin/approve-user/${user.user_id}`, {
        method: 'PUT',
        headers: adminHeaders(),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.message);
      showToast(data.message);
      await loadPendingUsers();
      await loadUsers();
      await loadAuditLogs();
    } catch (err) {
      showToast(err.message || 'Failed to approve user.', 'error');
    }
  }

  async function handleReject(user) {
    if (!window.confirm(`Reject registration and deactivate ${user.name}?`)) return;
    try {
      const res = await fetch(`${API}/admin/reject-user/${user.user_id}`, {
        method: 'PUT',
        headers: adminHeaders(),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.message);
      showToast(data.message);
      await loadPendingUsers();
      await loadUsers();
      await loadAuditLogs();
    } catch (err) {
      showToast(err.message || 'Failed to reject user.', 'error');
    }
  }

  async function handleReset(user) {
    if (!window.confirm(`Reset password for ${user.name}?\nA temporary password will be generated. Share it securely with the user.`)) return;
      try {
      const res = await fetch(`${API}/admin/reset-password/${user.user_id}`, {
        method: 'PUT',
      headers: adminHeaders(),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.message);
      setTempPwModal({tempPassword: data.temp_password, userName: user.name });
      await loadUsers();
      await loadAuditLogs();
    } catch (err) {
        showToast(err.message || 'Failed to reset password.', 'error');
    }
  }

  async function handleToggle(user) {
    const action = user.is_active === 1 ? 'deactivate' : 'activate';
      if (!window.confirm(`${action.charAt(0).toUpperCase() + action.slice(1)} user ${user.name}?`)) return;
      try {
      const res = await fetch(`${API}/admin/toggle-user/${user.user_id}`, {
        method: 'PUT',
      headers: adminHeaders(),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.message);
      showToast(data.message);
      await loadUsers();
      await loadAuditLogs();
    } catch (err) {
        showToast(err.message || 'Failed to update user.', 'error');
    }
  }

  function handleLogout() {
    localStorage.removeItem('admin_id');
    localStorage.removeItem('admin_name');
    localStorage.removeItem('admin_email');
    setAdmin(null);
    setUsersGrouped({ });
    setAuditLogs([]);
    setPendingUsers([]);
    setPendingCount(0);
  }

      if (!admin) return <AdminLogin onLogin={data => setAdmin(data)} />;

  // Summary counts
  const activeCount = Object.values(usersGrouped).flat().filter(u => u.is_active === 1).length;
      const inactiveCount = totalUsers - activeCount;
  const tempPwCount = Object.values(usersGrouped).flat().filter(u => u.force_password_reset === 1).length;
      const roleCount = Object.keys(usersGrouped).length;

      const ORDERED_ROLES = ['doctor', 'hod', 'pharmacist', 'pharmacyhead', 'dtc', 'dtccommittee', 'ceo'];
      const sortedRoleKeys = [
    ...ORDERED_ROLES.filter(r => usersGrouped[r]),
    ...Object.keys(usersGrouped).filter(r => !ORDERED_ROLES.includes(r)),
      ];

      return (
      <div style={{ minHeight: '100vh', background: '#0f172a', fontFamily: "'Inter', sans-serif", color: '#fff' }}>
        <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
        ::-webkit-scrollbar { width: 6px; } ::-webkit-scrollbar-track { background: rgba(255,255,255,0.03); } ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.15); border-radius: 3px; }
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes slideUp { from { opacity: 0; transform: translateY(16px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
      `}</style>

        {/* TOP NAV */}
        <nav style={{ borderBottom: '1px solid rgba(255,255,255,0.08)', padding: '0 32px', height: 64, display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'rgba(255,255,255,0.02)', backdropFilter: 'blur(10px)', position: 'sticky', top: 0, zIndex: 100 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{ width: 40, height: 40, borderRadius: 12, background: 'linear-gradient(135deg, #6366f1, #8b5cf6)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 4px 15px rgba(99,102,241,0.35)' }}>
              <i className="ti ti-shield-lock" style={{ fontSize: 22, color: '#fff' }} />
            </div>
            <div>
              <div style={{ fontWeight: 700, fontSize: '1rem', color: '#fff' }}>Admin Control Panel</div>
              <div style={{ fontSize: '0.72rem', color: 'rgba(255,255,255,0.4)' }}>Formulary Drug Indenting System</div>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: '0.85rem', fontWeight: 600, color: '#fff' }}>{admin.name}</div>
              <div style={{ fontSize: '0.72rem', color: 'rgba(255,255,255,0.4)' }}>System Administrator</div>
            </div>
            <button onClick={handleLogout} title="Logout" style={{ width: 38, height: 38, borderRadius: 10, background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.3)', color: '#f87171', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.2s' }}
              onMouseEnter={e => e.currentTarget.style.background = 'rgba(239,68,68,0.3)'}
              onMouseLeave={e => e.currentTarget.style.background = 'rgba(239,68,68,0.15)'}
            >
              <i className="ti ti-logout" style={{ fontSize: 18 }} />
            </button>
          </div>
        </nav>

        <div style={{ maxWidth: '100%', width: '100%', margin: '0 auto', padding: '32px 24px' }}>

          {/* STAT CARDS */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16, marginBottom: 32 }}>
            {[
              { label: 'Total Users', value: totalUsers, icon: 'users', color: '#6366f1', bg: 'rgba(99,102,241,0.15)' },
              { label: 'Active Users', value: activeCount, icon: 'user-check', color: '#10b981', bg: 'rgba(16,185,129,0.15)' },
              { label: 'Pending Approvals', value: pendingCount, icon: 'user-clock', color: '#f59e0b', bg: 'rgba(245,158,11,0.15)' },
              { label: 'Inactive Users', value: inactiveCount, icon: 'user-off', color: '#ef4444', bg: 'rgba(239,68,68,0.15)' },
              { label: 'Temp Passwords', value: tempPwCount, icon: 'key', color: '#ec4899', bg: 'rgba(236,72,153,0.15)' },
              { label: 'Role Types', value: roleCount, icon: 'id-badge-2', color: '#8b5cf6', bg: 'rgba(139,92,246,0.15)' },
            ].map(card => (
              <div key={card.label} style={{ background: card.bg, border: `1px solid ${card.color}30`, borderRadius: 16, padding: '20px 22px', animation: 'fadeIn 0.4s ease' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <div style={{ fontSize: '0.72rem', fontWeight: 600, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 8 }}>{card.label}</div>
                    <div style={{ fontSize: '2rem', fontWeight: 700, color: card.color, lineHeight: 1 }}>{card.value}</div>
                  </div>
                  <div style={{ width: 42, height: 42, borderRadius: 12, background: `${card.color}22`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <i className={`ti ti-${card.icon}`} style={{ fontSize: 22, color: card.color }} />
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* TAB BAR */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 24, background: 'rgba(255,255,255,0.04)', borderRadius: 12, padding: 6, width: 'fit-content' }}>
            {[
              ['dashboard', 'chart-bar', 'Dashboard'],
              ['users', 'users', 'User Management'],
              ['approvals', 'user-clock', 'Pending Approvals'],
              ['audit', 'list-check', 'Audit Log']
            ].map(([tab, icon, label]) => (
              <button key={tab} onClick={() => { setActiveTab(tab); if (tab === 'audit') loadAuditLogs(); if (tab === 'approvals') loadPendingUsers(); }}
                style={{
                  padding: '8px 20px', borderRadius: 8, border: 'none', cursor: 'pointer', fontWeight: 600, fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: 7, transition: 'all 0.2s',
                  background: activeTab === tab ? 'linear-gradient(135deg, #6366f1, #8b5cf6)' : 'transparent',
                  color: activeTab === tab ? '#fff' : 'rgba(255,255,255,0.5)',
                  boxShadow: activeTab === tab ? '0 4px 14px rgba(99,102,241,0.35)' : 'none',
                }}
              >
                <i className={`ti ti-${icon}`} style={{ fontSize: 16 }} />
                {label}
                {tab === 'approvals' && pendingCount > 0 && (
                  <span style={{
                    background: '#ef4444',
                    color: '#fff',
                    borderRadius: '50%',
                    width: 18,
                    height: 18,
                    fontSize: '0.68rem',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    marginLeft: 6,
                    fontWeight: 'bold'
                  }}>
                    {pendingCount}
                  </span>
                )}
              </button>
            ))}
            <button onClick={() => { loadUsers(); loadPendingUsers(); }} title="Refresh" style={{ width: 36, height: 36, borderRadius: 8, border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.5)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.2s', marginLeft: 4 }}
              onMouseEnter={e => e.currentTarget.style.color = '#fff'}
              onMouseLeave={e => e.currentTarget.style.color = 'rgba(255,255,255,0.5)'}
            >
              <i className={`ti ti-refresh${loading || pendingLoading ? ' ti-spin' : ''}`} style={{ fontSize: 16, animation: (loading || pendingLoading) ? 'spin 1s linear infinite' : 'none' }} />
            </button>
          </div>

          {/* ANALYTICS DASHBOARD TAB */}
          {activeTab === 'dashboard' && (
            <div style={{ animation: 'slideUp 0.3s ease' }}>
              <AnalyticsDashboard role="Admin" />
            </div>
          )}

          {/* PENDING APPROVALS TAB */}
          {activeTab === 'approvals' && (
            <div style={{ animation: 'fadeIn 0.3s ease' }}>
              {pendingLoading ? (
                <div style={{ textAlign: 'center', padding: 60, color: 'rgba(255,255,255,0.35)' }}>
                  <i className="ti ti-loader-2" style={{ fontSize: 36, animation: 'spin 1s linear infinite', display: 'block', marginBottom: 12 }} />
                  Loading pending registrations…
                </div>
              ) : pendingUsers.length === 0 ? (
                <div style={{ textAlign: 'center', padding: 60, color: 'rgba(255,255,255,0.25)', background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 16 }}>
                  <i className="ti ti-circle-check" style={{ fontSize: 48, color: '#10b981', display: 'block', marginBottom: 12 }} />
                  No pending registrations. All users are approved.
                </div>
              ) : (
                <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 16, overflow: 'hidden' }}>
                  <div style={{ padding: '16px 20px', borderBottom: '1px solid rgba(255,255,255,0.07)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <i className="ti ti-user-clock" style={{ color: '#f59e0b', fontSize: 18 }} />
                      <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>Pending Registration Approvals</span>
                    </div>
                    <span style={{ fontSize: '0.75rem', fontWeight: 600, background: 'rgba(245,158,11,0.2)', color: '#fbbf24', border: '1px solid rgba(245,158,11,0.4)', borderRadius: 20, padding: '2px 10px' }}>
                      {pendingUsers.length} Pending
                    </span>
                  </div>
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
                      <thead>
                        <tr style={{ background: 'rgba(255,255,255,0.04)' }}>
                          {['Name', 'Email Address', 'Role', 'Department', 'Actions'].map(h => (
                            <th key={h} style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 600, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '0.06em', fontSize: '0.7rem', whiteSpace: 'nowrap' }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {pendingUsers.map((pUser, i) => {
                          const cfg = getRoleConfig(pUser.role);
                          return (
                            <tr key={pUser.user_id} style={{ borderTop: '1px solid rgba(255,255,255,0.05)', background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.02)' }}>
                              <td style={{ padding: '12px 16px', fontWeight: 600, color: '#fff' }}>{pUser.name}</td>
                              <td style={{ padding: '12px 16px', color: 'rgba(255,255,255,0.7)' }}>{pUser.email}</td>
                              <td style={{ padding: '12px 16px' }}>
                                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: cfg.color, fontWeight: 600 }}>
                                  <i className={`ti ti-${cfg.icon}`} /> {cfg.label}
                                </span>
                              </td>
                              <td style={{ padding: '12px 16px', color: 'rgba(255,255,255,0.5)' }}>{pUser.department || '—'}</td>
                              <td style={{ padding: '12px 16px' }}>
                                <div style={{ display: 'flex', gap: 10 }}>
                                  <button onClick={() => handleApprove(pUser)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 8, background: 'rgba(16,185,129,0.15)', border: '1px solid rgba(16,185,129,0.3)', color: '#34d399', cursor: 'pointer', fontWeight: 600, fontSize: '0.78rem', transition: 'all 0.2s' }}
                                    onMouseEnter={e => e.currentTarget.style.background = 'rgba(16,185,129,0.3)'}
                                    onMouseLeave={e => e.currentTarget.style.background = 'rgba(16,185,129,0.15)'}
                                  >
                                    <i className="ti ti-circle-check" /> Approve
                                  </button>
                                  <button onClick={() => handleReject(pUser)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 8, background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.3)', color: '#f87171', cursor: 'pointer', fontWeight: 600, fontSize: '0.78rem', transition: 'all 0.2s' }}
                                    onMouseEnter={e => e.currentTarget.style.background = 'rgba(239,68,68,0.3)'}
                                    onMouseLeave={e => e.currentTarget.style.background = 'rgba(239,68,68,0.15)'}
                                  >
                                    <i className="ti ti-circle-x" /> Reject
                                  </button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* USERS TAB */}
          {activeTab === 'users' && (
            <div style={{ animation: 'fadeIn 0.3s ease' }}>
              {loading ? (
                <div style={{ textAlign: 'center', padding: 60, color: 'rgba(255,255,255,0.35)' }}>
                  <i className="ti ti-loader-2" style={{ fontSize: 36, animation: 'spin 1s linear infinite', display: 'block', marginBottom: 12 }} />
                  Loading users…
                </div>
              ) : sortedRoleKeys.length === 0 ? (
                <div style={{ textAlign: 'center', padding: 60, color: 'rgba(255,255,255,0.25)' }}>
                  <i className="ti ti-users-minus" style={{ fontSize: 48, display: 'block', marginBottom: 12 }} />
                  No users found.
                </div>
              ) : sortedRoleKeys.map(role => {
                const cfg = getRoleConfig(role);
                const users = usersGrouped[role] || [];
                return (
                  <div key={role} style={{ marginBottom: 28 }}>
                    {/* Role Header */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                      <div style={{ width: 32, height: 32, borderRadius: 10, background: `${cfg.color}22`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <i className={`ti ti-${cfg.icon}`} style={{ fontSize: 18, color: cfg.color }} />
                      </div>
                      <h3 style={{ margin: 0, fontSize: '0.9rem', fontWeight: 700, color: cfg.color, textTransform: 'uppercase', letterSpacing: '0.07em' }}>{cfg.label}</h3>
                      <span style={{ fontSize: '0.75rem', fontWeight: 600, background: `${cfg.color}20`, color: cfg.color, border: `1px solid ${cfg.color}40`, borderRadius: 20, padding: '2px 10px' }}>{users.length}</span>
                    </div>
                    <div style={{ display: 'grid', gap: 10 }}>
                      {users.map(user => (
                        <UserCard key={user.user_id} user={user} onReset={handleReset} onToggle={handleToggle} />
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* AUDIT LOG TAB */}
          {activeTab === 'audit' && (
            <div style={{ animation: 'fadeIn 0.3s ease' }}>
              <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 16, overflow: 'hidden' }}>
                <div style={{ padding: '16px 20px', borderBottom: '1px solid rgba(255,255,255,0.07)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <i className="ti ti-list-check" style={{ color: '#6366f1', fontSize: 18 }} />
                    <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>Recent Admin Actions</span>
                  </div>
                  <span style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.35)' }}>Last 200 actions</span>
                </div>
                {auditLogs.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: 48, color: 'rgba(255,255,255,0.25)' }}>
                    <i className="ti ti-clipboard-list" style={{ fontSize: 40, display: 'block', marginBottom: 10 }} />
                    No audit logs yet.
                  </div>
                ) : (
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
                      <thead>
                        <tr style={{ background: 'rgba(255,255,255,0.04)' }}>
                          {['Action', 'Target User', 'Details', 'Performed At'].map(h => (
                            <th key={h} style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 600, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '0.06em', fontSize: '0.7rem', whiteSpace: 'nowrap' }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {auditLogs.map((log, i) => {
                          const actionColor = log.ACTION === 'PASSWORD_RESET' ? '#f59e0b' : log.ACTION === 'USER_DEACTIVATED' ? '#ef4444' : log.ACTION === 'USER_ACTIVATED' ? '#10b981' : '#6366f1';
                          return (
                            <tr key={log.AUDIT_ID} style={{ borderTop: '1px solid rgba(255,255,255,0.05)', background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.02)' }}>
                              <td style={{ padding: '12px 16px' }}>
                                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: `${actionColor}18`, color: actionColor, border: `1px solid ${actionColor}35`, borderRadius: 6, padding: '3px 10px', fontWeight: 600, fontSize: '0.72rem', whiteSpace: 'nowrap' }}>
                                  {log.ACTION}
                                </span>
                              </td>
                              <td style={{ padding: '12px 16px', color: 'rgba(255,255,255,0.7)' }}>
                                {log.TARGET_USER_NAME || log.TARGET_USER || '—'}
                                {log.TARGET_USER_EMAIL && <div style={{ fontSize: '0.72rem', color: 'rgba(255,255,255,0.35)' }}>{log.TARGET_USER_EMAIL}</div>}
                              </td>
                              <td style={{ padding: '12px 16px', color: 'rgba(255,255,255,0.45)', maxWidth: 280, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{log.DETAILS || '—'}</td>
                              <td style={{ padding: '12px 16px', color: 'rgba(255,255,255,0.35)', whiteSpace: 'nowrap' }}>{formatDate(log.PERFORMED_AT)}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* TEMP PASSWORD MODAL */}
        {tempPwModal && (
          <TempPasswordModal
            tempPassword={tempPwModal.tempPassword}
            userName={tempPwModal.userName}
            onClose={() => setTempPwModal(null)}
          />
        )}

        {/* TOAST */}
        {toast && (
          <div style={{ position: 'fixed', bottom: 28, right: 28, background: toast.type === 'success' ? '#10b981' : '#ef4444', color: '#fff', borderRadius: 12, padding: '14px 22px', fontSize: '0.88rem', fontWeight: 500, display: 'flex', alignItems: 'center', gap: 10, zIndex: 9999, boxShadow: '0 8px 30px rgba(0,0,0,0.4)', animation: 'slideUp 0.3s ease' }}>
            <i className={`ti ti-${toast.type === 'success' ? 'circle-check-filled' : 'alert-circle-filled'}`} style={{ fontSize: 20 }} />
            {toast.msg}
          </div>
        )}
      </div>
      );
}
