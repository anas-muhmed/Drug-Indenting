import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { ForceChangePassword } from "./AdminDashboard";

const ROLES = [
    { value: "doctor", label: "Doctor" },
    { value: "hod", label: "Head of Department (HOD)" },
    { value: "pharmacist", label: "Pharmacist" },
    { value: "pharmacyhead", label: "Pharmacy Head" },
    { value: "dtc", label: "DTC" },
    { value: "ceo", label: "CEO" },
];

const DEPARTMENTS = [
    "Cardiology", "Neurology", "Orthopedics", "Pediatrics",
    "Pharmacy", "Radiology", "Surgery", "General Medicine", "Administration",
    "Oncology", "Dermatology", "Psychiatry", "Emergency Medicine",
    "Ophthalmology", "ENT", "Gynaecology", "Urology", "Nephrology", "Pulmonology",
];

// ─── Department Combobox (type + filter) ──────────────────────────────────────
function DepartmentCombobox({ value, onChange, placeholder = 'Type or select...', icon }) {
    const [query, setQuery] = useState(value || '');
    const [open, setOpen] = useState(false);
    const [highlighted, setHighlighted] = useState(0);
    const ref = useRef(null);

    const filtered = DEPARTMENTS.filter(d =>
        d.toLowerCase().includes(query.toLowerCase())
    );

    // Sync external value changes
    useEffect(() => { setQuery(value || ''); }, [value]);

    // Close on outside click
    useEffect(() => {
        function handleClick(e) {
            if (ref.current && !ref.current.contains(e.target)) {
                setOpen(false);
            }
        }
        document.addEventListener('mousedown', handleClick);
        return () => document.removeEventListener('mousedown', handleClick);
    }, []);

    const select = (dept) => {
        setQuery(dept);
        onChange({ target: { value: dept } });
        setOpen(false);
    };

    const handleKey = (e) => {
        if (!open && e.key !== 'Tab') setOpen(true);
        if (e.key === 'ArrowDown') { e.preventDefault(); setHighlighted(h => Math.min(h + 1, filtered.length - 1)); }
        if (e.key === 'ArrowUp')   { e.preventDefault(); setHighlighted(h => Math.max(h - 1, 0)); }
        if (e.key === 'Enter')     { e.preventDefault(); if (filtered[highlighted]) select(filtered[highlighted]); else setOpen(false); }
        if (e.key === 'Escape')    { setOpen(false); }
    };

    return (
        <div ref={ref} style={{ position: 'relative' }}>
            {icon && (
                <i className={`ti ti-${icon}`} aria-hidden="true" style={{
                    position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)',
                    fontSize: 18, color: 'var(--text-subtle)', pointerEvents: 'none', zIndex: 1,
                }} />
            )}
            <input
                type="text"
                value={query}
                placeholder={placeholder}
                autoComplete="off"
                onChange={e => {
                    const v = e.target.value;
                    setQuery(v);
                    onChange({ target: { value: v } });
                    setOpen(true);
                    setHighlighted(0);
                }}
                onFocus={e => {
                    setOpen(true);
                    e.target.style.borderColor = 'var(--primary)';
                    e.target.style.boxShadow = '0 0 0 4px rgba(14,165,233,0.15)';
                }}
                onBlur={e => {
                    e.target.style.borderColor = 'var(--border)';
                    e.target.style.boxShadow = 'none';
                    // Commit whatever is typed into the form state when focus leaves
                    onChange({ target: { value: query.trim() } });
                }}
                onKeyDown={handleKey}
                style={{
                    width: '100%', boxSizing: 'border-box',
                    padding: icon ? '0 40px 0 42px' : '0 40px 0 16px',
                    height: 46, fontSize: '0.95rem', borderRadius: '10px',
                    border: '1.5px solid var(--border)',
                    background: 'var(--bg)', color: 'var(--text)',
                    outline: 'none', fontFamily: 'inherit', transition: 'all 0.2s ease',
                }}
            />
            <i className={`ti ti-chevron-${open ? 'up' : 'down'}`} style={{
                position: 'absolute', right: 14, top: '50%', transform: 'translateY(-50%)',
                fontSize: 16, color: 'var(--text-subtle)', pointerEvents: 'none',
                transition: 'transform 0.2s'
            }} />

            {open && (
                <div style={{
                    position: 'absolute', top: 'calc(100% + 6px)', left: 0, right: 0,
                    background: '#fff', border: '1.5px solid var(--border)',
                    borderRadius: '10px', boxShadow: '0 10px 30px rgba(0,0,0,0.12)',
                    zIndex: 9999, maxHeight: 220, overflowY: 'auto',
                    padding: '6px',
                }}>
                    {filtered.map((dept, i) => (
                        <div
                            key={dept}
                            onMouseDown={() => select(dept)}
                            style={{
                                padding: '10px 12px', fontSize: '0.9rem', cursor: 'pointer',
                                borderRadius: '8px',
                                background: i === highlighted ? 'rgba(14,165,233,0.1)' : 'transparent',
                                color: i === highlighted ? 'var(--primary)' : 'var(--text)',
                                fontWeight: i === highlighted ? 600 : 400,
                                transition: 'background 0.1s',
                                display: 'flex', alignItems: 'center', gap: 8,
                            }}
                            onMouseEnter={() => setHighlighted(i)}
                        >
                            <i className="ti ti-building-hospital" style={{ fontSize: 16, opacity: 0.6 }} />
                            {dept}
                        </div>
                    ))}
                    {filtered.length === 0 && (
                        <div style={{ padding: '10px 12px', fontSize: '0.875rem', color: 'var(--text-muted)', textAlign: 'center' }}>
                            No matching departments
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

// ─── Password rules ───────────────────────────────────────────────────────────
const PW_RULES = [
    { id: "len", label: "At least 6 characters", test: (v) => v.length >= 6 },
    { id: "upper", label: "At least one uppercase letter", test: (v) => /[A-Z]/.test(v) },
    { id: "number", label: "At least one number", test: (v) => /\d/.test(v) },
    { id: "symbol", label: "At least one special character", test: (v) => /[!@#$%^&*()\-_=+[\]{};':"\\|,.<>/?]/.test(v) },
];

function passwordStrength(pw) {
    const passed = PW_RULES.filter((r) => r.test(pw)).length;
    if (passed <= 1) return { level: 0, label: "Weak", color: "#ef4444" };
    if (passed === 2) return { level: 1, label: "Fair", color: "#f59e0b" };
    if (passed === 3) return { level: 2, label: "Good", color: "#10b981" };
    return { level: 3, label: "Strong", color: "#059669" };
}

// ─── Shared field component ───────────────────────────────────────────────────
function Field({ label, error, children }) {
    return (
        <div style={{ marginBottom: "1.2rem" }}>
            <label style={{ display: "block", fontSize: '0.75rem', fontWeight: 600, color: "var(--text-muted)", marginBottom: 8, letterSpacing: "0.06em", textTransform: "uppercase" }}>
                {label}
            </label>
            {children}
            {error && (
                <div style={{ margin: "6px 0 0", fontSize: '0.75rem', color: "#ef4444", display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <i className="ti ti-alert-circle" style={{ fontSize: '14px' }}></i> {error}
                </div>
            )}
        </div>
    );
}

function Input({ icon, type = "text", ...props }) {
    const [show, setShow] = useState(false);
    const isPassword = type === "password";
    return (
        <div style={{ position: "relative" }}>
            {icon && (
                <i className={`ti ti-${icon}`} aria-hidden="true" style={{
                    position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)",
                    fontSize: 18, color: "var(--text-subtle)", pointerEvents: "none", zIndex: 1
                }} />
            )}
            <input
                type={isPassword && show ? "text" : type}
                {...props}
                style={{
                    width: "100%", boxSizing: "border-box",
                    padding: icon ? "0 44px 0 42px" : "0 16px",
                    height: 46, fontSize: '0.95rem', borderRadius: "10px",
                    border: "1.5px solid var(--border)",
                    background: "var(--bg)",
                    color: "var(--text)",
                    outline: "none", transition: "all 0.2s ease",
                    fontFamily: 'inherit',
                    ...(props.style || {}),
                }}
                onFocus={(e) => { e.target.style.borderColor = "var(--primary)"; e.target.style.boxShadow = "0 0 0 4px rgba(14,165,233,0.15)"; props.onFocus?.(e); }}
                onBlur={(e) => { e.target.style.borderColor = "var(--border)"; e.target.style.boxShadow = "none"; props.onBlur?.(e); }}
            />
            {isPassword && (
                <button type="button" onClick={() => setShow(!show)} aria-label={show ? "Hide password" : "Show password"}
                    style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", padding: '4px', color: "var(--text-subtle)", display: 'flex' }}>
                    <i className={`ti ti-eye${show ? "-off" : ""}`} style={{ fontSize: 18 }} aria-hidden="true" />
                </button>
            )}
        </div>
    );
}

function Select({ icon, children, ...props }) {
    return (
        <div style={{ position: "relative" }}>
            {icon && (
                <i className={`ti ti-${icon}`} aria-hidden="true" style={{
                    position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)",
                    fontSize: 18, color: "var(--text-subtle)", pointerEvents: "none", zIndex: 1,
                }} />
            )}
            <select {...props} style={{
                width: "100%", boxSizing: "border-box",
                padding: icon ? "0 16px 0 42px" : "0 16px",
                height: 46, fontSize: '0.95rem', borderRadius: "10px",
                border: "1.5px solid var(--border)",
                background: "var(--bg)",
                color: props.value ? "var(--text)" : "var(--text-muted)",
                outline: "none", appearance: "none", cursor: "pointer",
                fontFamily: 'inherit', transition: "all 0.2s ease",
            }}
            onFocus={(e) => { e.target.style.borderColor = "var(--primary)"; e.target.style.boxShadow = "0 0 0 4px rgba(14,165,233,0.15)"; }}
            onBlur={(e) => { e.target.style.borderColor = "var(--border)"; e.target.style.boxShadow = "none"; }}
            >
                {children}
            </select>
            <i className="ti ti-chevron-down" aria-hidden="true" style={{
                position: "absolute", right: 16, top: "50%", transform: "translateY(-50%)",
                fontSize: 16, color: "var(--text-subtle)", pointerEvents: "none",
            }} />
        </div>
    );
}

// ─── Password strength meter ──────────────────────────────────────────────────
function StrengthMeter({ password }) {
    if (!password) return null;
    const { level, label, color } = passwordStrength(password);
    return (
        <div style={{ marginTop: 10 }}>
            <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
                {[0, 1, 2, 3].map((i) => (
                    <div key={i} style={{
                        flex: 1, height: 4, borderRadius: 4,
                        background: i <= level ? color : "var(--border)",
                        transition: "background 0.4s ease",
                    }} />
                ))}
            </div>
            <p style={{ margin: 0, fontSize: '0.75rem', color, fontWeight: 600 }}>{label}</p>
        </div>
    );
}

// ─── Password rules checklist ─────────────────────────────────────────────────
function RuleList({ password }) {
    if (!password) return null;
    return (
        <ul style={{ margin: "12px 0 0", padding: 0, listStyle: "none", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px 12px" }}>
            {PW_RULES.map((r) => {
                const ok = r.test(password);
                return (
                    <li key={r.id} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: '0.75rem', transition: 'color 0.2s' }}>
                        <i className={`ti ti-${ok ? "circle-check-filled" : "circle-x"}`} aria-hidden="true"
                            style={{ fontSize: 16, color: ok ? "#10b981" : "var(--text-subtle)", transition: 'color 0.2s' }} />
                        <span style={{ color: ok ? "var(--text)" : "var(--text-subtle)" }}>{r.label}</span>
                    </li>
                );
            })}
        </ul>
    );
}

// ─── Divider ──────────────────────────────────────────────────────────────────
function Divider({ label }) {
    return (
        <div style={{ display: "flex", alignItems: "center", gap: 16, margin: "2rem 0" }}>
            <div style={{ flex: 1, height: "1px", background: "var(--border)" }} />
            <span style={{ fontSize: '0.8rem', color: "var(--text-muted)", fontWeight: 500 }}>{label}</span>
            <div style={{ flex: 1, height: "1px", background: "var(--border)" }} />
        </div>
    );
}

// ─── Submit button ────────────────────────────────────────────────────────────
function SubmitBtn({ loading, children }) {
    return (
        <button type="submit" disabled={loading} style={{
            width: "100%", height: 48, borderRadius: "10px",
            background: loading ? "var(--border)" : "linear-gradient(135deg, var(--primary), var(--primary-dark))",
            color: loading ? "var(--text-muted)" : "#ffffff",
            border: "none", fontSize: '1rem', fontWeight: 600, cursor: loading ? "not-allowed" : "pointer",
            display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
            transition: "all 0.2s ease",
            boxShadow: loading ? "none" : "0 4px 14px rgba(14,165,233,0.3)",
        }}
        onMouseEnter={(e) => { if(!loading) e.currentTarget.style.transform = "translateY(-2px)" }}
        onMouseLeave={(e) => { if(!loading) e.currentTarget.style.transform = "translateY(0)" }}
        >
            {loading && <i className="ti ti-loader-2" aria-hidden="true" style={{ fontSize: 18, animation: "spin 1s linear infinite" }} />}
            {children}
            {!loading && <i className="ti ti-arrow-right" style={{ fontSize: 18 }} />}
        </button>
    );
}

// ─── Toast ────────────────────────────────────────────────────────────────────
function Toast({ msg, type, onClose }) {
    useEffect(() => { const t = setTimeout(onClose, 4000); return () => clearTimeout(t); }, [onClose]);
    return (
        <div style={{
            position: "fixed", bottom: 32, right: 32,
            background: type === "success" ? "#10b981" : "#ef4444",
            color: "#ffffff",
            borderRadius: "12px", padding: "14px 22px", fontSize: '0.9rem', fontWeight: 500,
            display: "flex", alignItems: "center", gap: 12, zIndex: 100,
            boxShadow: "0 10px 25px rgba(0,0,0,0.15)",
            animation: "slideUp 0.3s cubic-bezier(0.16, 1, 0.3, 1)",
        }}>
            <style>{`@keyframes slideUp { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }`}</style>
            <i className={`ti ti-${type === "success" ? "circle-check-filled" : "alert-circle-filled"}`} style={{ fontSize: 22 }} />
            {msg}
            <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", padding: 0, marginLeft: 12, color: 'rgba(255,255,255,0.7)', display: 'flex' }}>
                <i className="ti ti-x" aria-hidden="true" style={{ fontSize: 18 }} />
            </button>
        </div>
    );
}

// ═══════════════════════════════════════════════════════════════════════════════
// LOGIN FORM
// ═══════════════════════════════════════════════════════════════════════════════
function LoginForm({ onSwitch, onForceReset }) {
    const navigate = useNavigate();
    const [form, setForm] = useState({ email: "", password: "" });
    const [errors, setErrors] = useState({});
    const [loading, setLoading] = useState(false);
    const [toast, setToast] = useState(null);

    const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

    function validate() {
        const e = {};
        if (!form.email.trim()) e.email = "Email is required.";
        else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) e.email = "Enter a valid email address.";
        if (!form.password) e.password = "Password is required.";
        return e;
    }

    async function handleSubmit(e) {
        const API = '/api';
        e.preventDefault();
        const errs = validate();
        if (Object.keys(errs).length) { setErrors(errs); return; }
        setErrors({});
        setLoading(true);
        try {
            const res = await fetch(`${API}/login`, { method: 'POST', body: JSON.stringify({ email: form.email, password: form.password }), headers: { "Content-Type": "application/json" } });
            const data = await res.json();

            if (data.success) {
                // Check if admin reset the password — force change before proceeding
                if (data.force_password_reset) {
                    localStorage.setItem('user_role', data.role);
                    localStorage.setItem('userid', data.user_id);
                    onForceReset(data.user_id, data.role);
                    return;
                }
                localStorage.setItem('user_role', data.role);
                localStorage.setItem('userid', data.user_id);
                if (data.role === 'doctor') navigate('/dr_dashboard');
                if (data.role === 'pharmacist') navigate('/pharmacist_dashboard');
                if (data.role === 'ceo') navigate('/ceo_dashboard');
                if (data.role === 'hod') navigate('/hod_dashboard');
                if (data.role === 'dtc' || data.role === 'dtccommittee') navigate('/dtc_dashboard');
                if (data.role === 'pharmacyhead') navigate('/pharmacy_head_dashboard');
                setToast({ msg: "Login successful! Redirecting…", type: "success" });
            } else {
                if (data.pendingApproval) {
                    setErrors({ server: 'pending_approval' });
                } else {
                    setErrors((prev) => ({ ...prev, server: data.message || "Invalid credentials" }));
                    setToast({ msg: data.message || "Invalid credentials. Please try again.", type: "error" });
                }
            }

        } catch (err) {
            setErrors((prev) => ({ ...prev, server: err.message || "Invalid credentials" }));
            setToast({ msg: "Invalid credentials. Please try again.", type: "error" });
        } finally {
            setLoading(false);
        }
    }

    return (
        <div style={{ width: '100%', maxWidth: 440, margin: '0 auto' }}>
            <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
            
            <div style={{ marginBottom: '2.5rem' }}>
                <h2 style={{ margin: "0 0 8px", fontSize: '2rem', fontWeight: 700, color: "var(--text)", letterSpacing: '-0.02em' }}>Welcome back</h2>
                <p style={{ margin: 0, fontSize: '0.95rem', color: "var(--text-muted)" }}>Sign in to manage your drug addition requests.</p>
            </div>

            {errors.server === 'pending_approval' && (
                <div style={{
                    background: '#fffbeb',
                    border: '1px solid #fef3c7',
                    borderRadius: '8px',
                    padding: '16px',
                    marginBottom: '20px',
                    color: '#92400e',
                    fontSize: '0.9rem',
                    lineHeight: '1.5'
                }}>
                    <div style={{ display: 'flex', gap: 8, fontWeight: 700, marginBottom: 4, alignItems: 'center' }}>
                        <span style={{ fontSize: '1.1rem' }}>⏳</span> Awaiting Admin Approval
                    </div>
                    Your registration request is still pending approval by the Administrator. Please contact the IT Department.
                </div>
            )}

            <form onSubmit={handleSubmit} noValidate>
                <Field label="Email Address" error={errors.email}>
                    <Input icon="mail" type="email" placeholder="you@hospital.org" value={form.email} onChange={set("email")} />
                </Field>
                <Field label="Password" error={errors.password}>
                    <Input icon="lock" type="password" placeholder="Enter your password" value={form.password} onChange={set("password")} />
                </Field>

                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "2rem", marginTop: '-4px' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.85rem', color: 'var(--text-muted)', cursor: 'pointer' }}>
                        <input type="checkbox" style={{ accentColor: 'var(--primary)', width: 16, height: 16, cursor: 'pointer' }} />
                        Remember me
                    </label>
                    <button type="button" style={{ background: "none", border: "none", fontSize: '0.85rem', color: "var(--primary)", cursor: "pointer", padding: 0, fontWeight: 600 }}>
                        Forgot password?
                    </button>
                </div>

                <SubmitBtn loading={loading}>Sign In to Account</SubmitBtn>
            </form>

            <Divider label="New to MedPortal?" />

            <button type="button" onClick={onSwitch} style={{
                width: "100%", height: 48, borderRadius: "10px",
                background: "#f8fafc", border: "1.5px solid var(--border)",
                fontSize: '0.95rem', color: "var(--text)", cursor: "pointer",
                fontWeight: 600, transition: "all 0.2s ease",
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8
            }}
            onMouseEnter={(e) => e.currentTarget.style.background = "#f1f5f9"}
            onMouseLeave={(e) => e.currentTarget.style.background = "#f8fafc"}
            >
                Create an account
            </button>

            {toast && <Toast msg={toast.msg} type={toast.type} onClose={() => setToast(null)} />}
        </div>
    );
}

// ═══════════════════════════════════════════════════════════════════════════════
// REGISTRATION FORM
// ═══════════════════════════════════════════════════════════════════════════════
function RegisterForm({ onSwitch }) {
    const [form, setForm] = useState({
        name: "", email: "", password: "", confirmPassword: "",
        role: "", department: "",
    });
    const [errors, setErrors] = useState({});
    const [loading, setLoading] = useState(false);
    const [toast, setToast] = useState(null);
    const [pwFocused, setPwFocused] = useState(false);
    const [submitted, setSubmitted] = useState(false);

    const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

    function validate() {
        const e = {};
        if (!form.name.trim()) e.name = "Full name is required.";
        else if (form.name.trim().length < 2) e.name = "Name must be at least 2 characters.";

        if (!form.email.trim()) e.email = "Email is required.";
        else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) e.email = "Enter a valid email address.";

        const pwErrs = PW_RULES.filter((r) => !r.test(form.password));
        if (!form.password) e.password = "Password is required.";
        else if (pwErrs.length) e.password = "Password does not meet all requirements.";

        if (!form.confirmPassword) e.confirmPassword = "Please confirm your password.";
        else if (form.password !== form.confirmPassword) e.confirmPassword = "Passwords do not match.";

        if (!form.role) e.role = "Please select a role.";

        return e;
    }

    async function handleSubmit(ev) {
        const API = '/api';
        ev.preventDefault();
        const errs = validate();
        if (Object.keys(errs).length) { setErrors(errs); return; }
        setErrors({});
        setLoading(true);
        try {
            const res = await fetch(`${API}/register`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: form.name, email: form.email, password: form.password, role: form.role, department: form.department }),
            });
            if (!res.ok) throw new Error("Registration failed");
            setSubmitted(true);
        } catch {
            setToast({ msg: "Registration failed. Please try again.", type: "error" });
        } finally {
            setLoading(false);
        }
    }

    if (submitted) {
        return (
            <div style={{ width: '100%', maxWidth: 440, margin: '0 auto', textAlign: 'center', padding: '24px', background: '#ffffff', borderRadius: '12px', border: '1px solid var(--border)' }}>
                <div style={{ fontSize: '3.5rem', marginBottom: '16px' }}>✅</div>
                <h2 style={{ margin: "0 0 12px", fontSize: '1.75rem', fontWeight: 700, color: "var(--text)" }}>Registration Submitted</h2>
                <p style={{ fontSize: '0.95rem', color: "var(--text-muted)", marginBottom: '16px', lineHeight: '1.5' }}>
                    Your account has been created and is <strong>awaiting approval</strong> from the Administrator.
                </p>
                <div style={{
                    background: '#fffbeb',
                    border: '1px solid #fef3c7',
                    borderRadius: '8px',
                    padding: '12px',
                    marginBottom: '24px',
                    color: '#92400e',
                    fontSize: '0.85rem',
                    textAlign: 'left',
                    lineHeight: '1.4'
                }}>
                    <strong>Note:</strong> You will only be able to log in after an Administrator approves your account. Please contact the IT Department if approval is delayed.
                </div>
                <button type="button" onClick={onSwitch} style={{
                    width: "100%", height: 48, borderRadius: "10px",
                    background: "var(--primary)", border: "none",
                    fontSize: '0.95rem', color: "#ffffff", cursor: "pointer",
                    fontWeight: 600, transition: "all 0.2s ease"
                }}
                onMouseEnter={(e) => e.currentTarget.style.filter = "brightness(0.95)"}
                onMouseLeave={(e) => e.currentTarget.style.filter = "none"}
                >
                    Back to Sign In
                </button>
            </div>
        );
    }

    const rolesNeedingDept = ["doctor", "hod", "pharmacist", "pharmacyhead"];
    const showDept = rolesNeedingDept.includes(form.role);

    return (
        <div style={{ width: '100%', maxWidth: 440, margin: '0 auto' }}>
            <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
            
            <div style={{ marginBottom: '2rem' }}>
                <h2 style={{ margin: "0 0 8px", fontSize: '2rem', fontWeight: 700, color: "var(--text)", letterSpacing: '-0.02em' }}>Create account</h2>
                <p style={{ margin: 0, fontSize: '0.95rem', color: "var(--text-muted)" }}>Join MedPortal to streamline hospital drug indenting.</p>
            </div>

            <form onSubmit={handleSubmit} noValidate>
                <Field label="Full Name" error={errors.name}>
                    <Input icon="user" placeholder="Dr. Priya Menon" value={form.name} onChange={set("name")} />
                </Field>

                <Field label="Email Address" error={errors.email}>
                    <Input icon="mail" type="email" placeholder="you@hospital.org" value={form.email} onChange={set("email")} />
                </Field>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                    <Field label="Role" error={errors.role}>
                        <Select icon="id-badge-2" value={form.role} onChange={set("role")}>
                            <option value="">Select role...</option>
                            {ROLES.map((r) => (
                                <option key={r.value} value={r.value}>{r.label}</option>
                            ))}
                        </Select>
                    </Field>

                    <Field label={`Department${showDept ? "" : " (optional)"}`} error={errors.department}>
                        <DepartmentCombobox
                            icon="building-hospital"
                            value={form.department}
                            onChange={set("department")}
                            placeholder={showDept ? 'e.g. Cardiology' : 'Type or select dept...'}
                        />
                    </Field>
                </div>

                <Field label="Create Password" error={errors.password}>
                    <Input
                        icon="lock" type="password"
                        placeholder="••••••••"
                        value={form.password} onChange={set("password")}
                        onFocus={() => setPwFocused(true)}
                        onBlur={() => setPwFocused(false)}
                    />
                    <StrengthMeter password={form.password} />
                    {(pwFocused || form.password) && <RuleList password={form.password} />}
                </Field>

                <Field label="Confirm Password" error={errors.confirmPassword}>
                    <div style={{ position: "relative" }}>
                        <Input
                            icon="lock-check" type="password"
                            placeholder="••••••••"
                            value={form.confirmPassword} onChange={set("confirmPassword")}
                        />
                        {form.confirmPassword && (
                            <i className={`ti ti-${form.password === form.confirmPassword ? "circle-check-filled" : "alert-circle-filled"}`}
                                aria-hidden="true"
                                style={{
                                    position: "absolute", right: 44, top: "50%", transform: "translateY(-50%)",
                                    fontSize: 18,
                                    color: form.password === form.confirmPassword ? "#10b981" : "#ef4444",
                                    transition: 'color 0.2s', zIndex: 2
                                }} />
                        )}
                    </div>
                </Field>

                <div style={{ marginTop: '2rem' }}>
                    <SubmitBtn loading={loading}>Create Account</SubmitBtn>
                </div>
            </form>

            <Divider label="Already have an account?" />

            <button type="button" onClick={onSwitch} style={{
                width: "100%", height: 48, borderRadius: "10px",
                background: "none", border: "1.5px solid var(--border)",
                fontSize: '0.95rem', color: "var(--text)", cursor: "pointer", fontWeight: 600,
                transition: "all 0.2s ease",
            }}
            onMouseEnter={(e) => e.currentTarget.style.background = "var(--bg)"}
            onMouseLeave={(e) => e.currentTarget.style.background = "none"}
            >
                Sign in instead
            </button>

            {toast && <Toast msg={toast.msg} type={toast.type} onClose={() => setToast(null)} />}
        </div>
    );
}

// ═══════════════════════════════════════════════════════════════════════════════
// ROOT: Modern Split-Screen Layout
// ═══════════════════════════════════════════════════════════════════════════════
export default function AuthForms() {
    const navigate = useNavigate();
    const [view, setView] = useState("login"); // "login" | "register"
    const [forceReset, setForceReset] = useState(null); // { userId, role } | null

    function handleForceReset(userId, role) {
        setForceReset({ userId, role });
    }

    function handleForceResetDone() {
        const role = localStorage.getItem('user_role') || '';
        setForceReset(null);
        if (role === 'doctor') navigate('/dr_dashboard');
        else if (role === 'pharmacist') navigate('/pharmacist_dashboard');
        else if (role === 'ceo') navigate('/ceo_dashboard');
        else if (role === 'hod') navigate('/hod_dashboard');
        else if (role === 'dtc' || role === 'dtccommittee') navigate('/dtc_dashboard');
        else if (role === 'pharmacyhead') navigate('/pharmacy_head_dashboard');
        else navigate('/register');
    }

    // Show force change password screen
    if (forceReset) {
        return <ForceChangePassword userId={forceReset.userId} onDone={handleForceResetDone} />;
    }

    return (
        <div style={{
            minHeight: "100vh", display: "flex", backgroundColor: "#ffffff",
            fontFamily: "'Inter', sans-serif"
        }}>
            {/* LEFT PANE: Branding / Graphic */}
            <div style={{
                flex: 1, 
                display: "none", 
                '@media (min-width: 900px)': { display: "flex" }, // Need CSS media queries in JS, we'll use a hack or just rely on flex-basis
            }} className="auth-left-pane">
                <style>{`
                    .auth-left-pane {
                        display: none;
                        flex: 1.1;
                        background: url('/auth-bg.png') center/cover no-repeat;
                        position: relative;
                        overflow: hidden;
                    }
                    @media (min-width: 900px) {
                        .auth-left-pane { display: block; }
                    }
                    .glass-card {
                        background: rgba(255, 255, 255, 0.1);
                        backdrop-filter: blur(16px);
                        -webkit-backdrop-filter: blur(16px);
                        border: 1px solid rgba(255, 255, 255, 0.2);
                        border-radius: 24px;
                        padding: 40px;
                        color: white;
                        box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
                    }
                `}</style>
                
                {/* Gradient Overlay */}
                <div style={{
                    position: 'absolute', inset: 0, 
                    background: 'linear-gradient(135deg, rgba(14,165,233,0.4) 0%, rgba(2,132,199,0.8) 100%)',
                    zIndex: 1
                }} />
                
                {/* Content */}
                <div style={{
                    position: 'relative', zIndex: 2, height: '100%',
                    display: 'flex', flexDirection: 'column', padding: '60px',
                    justifyContent: 'space-between'
                }}>
                    {/* Logo Area */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <div style={{ 
                            width: 48, height: 48, borderRadius: 14, 
                            background: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center',
                            boxShadow: '0 10px 25px rgba(0,0,0,0.1)'
                        }}>
                            <i className="ti ti-stethoscope" style={{ fontSize: 26, color: 'var(--primary)' }}></i>
                        </div>
                        <span style={{ fontSize: '1.4rem', fontWeight: 700, color: 'white', letterSpacing: '0.5px' }}>
                            MedPortal
                        </span>
                    </div>

                    {/* Value Prop */}
                    <div className="glass-card" style={{ maxWidth: 500, marginBottom: '10vh' }}>
                        <h1 style={{ fontSize: '2.5rem', fontWeight: 700, lineHeight: 1.2, marginBottom: 20 }}>
                            Formulary Drug Addition System
                        </h1>
                        <p style={{ fontSize: '1.1rem', color: 'rgba(255,255,255,0.9)', lineHeight: 1.6 }}>
                            Streamline your hospital's drug indenting process. A unified portal for Doctors, HODs, Pharmacists, and the DTC to review and approve new formulary additions.
                        </p>
                        
                        <div style={{ display: 'flex', gap: 20, marginTop: 40 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <i className="ti ti-shield-check" style={{ fontSize: 24, color: '#6ee7b7' }}></i>
                                <span style={{ fontSize: '0.9rem', fontWeight: 500 }}>Secure Access</span>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <i className="ti ti-bolt" style={{ fontSize: 24, color: '#fcd34d' }}></i>
                                <span style={{ fontSize: '0.9rem', fontWeight: 500 }}>Fast Workflows</span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* RIGHT PANE: Forms */}
            <div style={{
                flex: 1, display: "flex", flexDirection: "column",
                overflowY: 'auto'
            }}>
                {/* Mobile Header (Only visible on small screens) */}
                <div style={{ padding: '24px 24px 0', display: 'flex', justifyContent: 'center' }}>
                    <style>{`
                        .mobile-brand { display: flex; align-items: center; gap: 10px; margin-bottom: 2rem; }
                        @media (min-width: 900px) { .mobile-brand { display: none; } }
                    `}</style>
                    <div className="mobile-brand">
                        <div style={{ 
                            width: 40, height: 40, borderRadius: 10, 
                            background: 'var(--primary)', display: 'flex', alignItems: 'center', justifyContent: 'center',
                        }}>
                            <i className="ti ti-stethoscope" style={{ fontSize: 22, color: 'white' }}></i>
                        </div>
                        <span style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--text)' }}>
                            MedPortal
                        </span>
                    </div>
                </div>

                {/* Form Container */}
                <div style={{
                    flex: 1, display: "flex", alignItems: "center", justifyContent: "center",
                    padding: "40px 24px 60px",
                }}>
                    {view === "login"
                        ? <LoginForm onSwitch={() => setView("register")} onForceReset={handleForceReset} />
                        : <RegisterForm onSwitch={() => setView("login")} />}
                </div>
            </div>
        </div>
    );
}