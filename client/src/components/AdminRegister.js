import React, { useState } from 'react';

const API = '/api';

export default function AdminRegister() {
  const [form, setForm] = useState({
    name: '',
    email: '',
    password: ''
  });

  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();

    setLoading(true);
    setMsg(null);

    try {
      const res = await fetch(`${API}/admin/register`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(form)
      });

      const data = await res.json();

      if (!data.success) {
        throw new Error(data.message || 'Registration failed');
      }

      setMsg({
        type: 'success',
        text: '✅ Admin registered successfully.'
      });

    } catch (err) {
      setMsg({
        type: 'error',
        text: err.message || 'Registration failed.'
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{
      minHeight: '100vh',
      background: '#0f172a',
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      color: 'white',
      fontFamily: 'Inter, sans-serif'
    }}>
      <form
        onSubmit={handleSubmit}
        style={{
          width: 420,
          background: '#111827',
          padding: 36,
          borderRadius: 18,
          border: '1px solid rgba(255,255,255,0.08)'
        }}
      >
        <h2 style={{
          marginBottom: 28,
          textAlign: 'center'
        }}>
          Admin Registration
        </h2>

        <input
          type="text"
          placeholder="Full Name"
          value={form.name}
          onChange={(e) =>
            setForm({ ...form, name: e.target.value })
          }
          style={inputStyle}
        />

        <input
          type="email"
          placeholder="Email"
          value={form.email}
          onChange={(e) =>
            setForm({ ...form, email: e.target.value })
          }
          style={inputStyle}
        />

        <input
          type="password"
          placeholder="Password"
          value={form.password}
          onChange={(e) =>
            setForm({ ...form, password: e.target.value })
          }
          style={inputStyle}
        />

        <button
          type="submit"
          disabled={loading}
          style={btnStyle}
        >
          {loading ? 'Creating Admin...' : 'Register Admin'}
        </button>

        {msg && (
          <div style={{
            marginTop: 18,
            padding: 12,
            borderRadius: 10,
            background:
              msg.type === 'success'
                ? 'rgba(16,185,129,0.15)'
                : 'rgba(239,68,68,0.15)',
            color:
              msg.type === 'success'
                ? '#34d399'
                : '#f87171'
          }}>
            {msg.text}
          </div>
        )}
      </form>
    </div>
  );
}

const inputStyle = {
  width: '100%',
  padding: '12px 14px',
  marginBottom: 16,
  borderRadius: 10,
  border: '1px solid rgba(255,255,255,0.12)',
  background: '#1f2937',
  color: 'white',
  fontSize: '0.95rem',
  boxSizing: 'border-box'
};

const btnStyle = {
  width: '100%',
  padding: 14,
  borderRadius: 10,
  border: 'none',
  background: '#6366f1',
  color: 'white',
  fontWeight: 600,
  fontSize: '0.95rem',
  cursor: 'pointer'
};