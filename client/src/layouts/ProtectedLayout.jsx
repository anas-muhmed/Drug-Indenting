import React, { useState, useEffect, useCallback, useRef } from 'react';
import axios from 'axios';
import { Outlet, useNavigate, Navigate, useLocation } from 'react-router-dom';
import DashboardLayout from './DashboardLayout';

const API = '/api';

// Maps each dashboard path to the roles that are allowed to access it
const PATH_ROLES = {
  '/dr_dashboard':            ['doctor'],
  '/hod_dashboard':           ['hod'],
  '/pharmacist_dashboard':    ['pharmacist'],
  '/pharmacy_head_dashboard': ['pharmacyhead'],
  '/dtc_dashboard':           ['dtc', 'dtccommittee'],
  '/ceo_dashboard':           ['ceo'],
};

// Returns the home dashboard path for a given role
function getDashboardPath(role) {
  switch ((role || '').toLowerCase().trim()) {
    case 'doctor':       return '/dr_dashboard';
    case 'pharmacist':   return '/pharmacist_dashboard';
    case 'ceo':          return '/ceo_dashboard';
    case 'hod':          return '/hod_dashboard';
    case 'dtc':
    case 'dtccommittee': return '/dtc_dashboard';
    case 'pharmacyhead': return '/pharmacy_head_dashboard';
    default:             return '/register';
  }
}

export default function ProtectedLayout() {
    // Read credentials synchronously before any hooks � used for the early-exit guard below
    const storedUserId = localStorage.getItem('userid');
    const storedRole   = localStorage.getItem('user_role');

    const [users, setUsers] = useState([]);
    const [currentUser, setCurrentUser] = useState(null);
    const [unreadCount, setUnreadCount] = useState(0);
    const [loadingUsers, setLoadingUsers] = useState(true);
    const [toast, setToast] = useState(null);
    const prevUnread = useRef(0);
    const toastTimer = useRef(null);
    const navigate   = useNavigate();
    const location   = useLocation();

    // Load all active users once on mount.
    // Only runs when valid credentials are present (guarded by the early return below).
    useEffect(() => {
        if (!storedUserId || !storedRole) {
            setLoadingUsers(false);
            return;
        }

        const parsedId = parseInt(storedUserId, 10);

        axios.get(`${API}/users`).then(r => {
            setUsers(r.data);

            // Verify the stored userid matches an existing active user
            const foundUser = r.data.find(u => u.USER_ID === parsedId);

            if (foundUser) {
                setCurrentUser(foundUser);
            } else {
                // Stored userid not found among active users � invalid / stale session
                localStorage.removeItem('userid');
                localStorage.removeItem('user_role');
                localStorage.removeItem('token');
                navigate('/register', { replace: true });
            }
        }).catch((err) => {
            console.error("Failed to load users", err);
        }).finally(() => setLoadingUsers(false));
    }, []); // runs once on mount

    // Poll unread notification count � 10 s interval.
    // Only starts after a valid currentUser is set.
    const fetchUnread = useCallback(() => {
        if (!currentUser) return;
        axios.get(`${API}/notifications/${currentUser.USER_ID}`)
            .then(r => {
                const count = r.data.filter(n => !n.IS_READ).length;
                setUnreadCount(count);
                // Show toast when new notifications arrive
                if (count > prevUnread.current) {
                    const diff = count - prevUnread.current;
                    showToast(`?? ${diff} new notification${diff > 1 ? 's' : ''}`, 'info');
                }
                prevUnread.current = count;
            })
            .catch(() => { });
    }, [currentUser]);

    useEffect(() => {
        fetchUnread();
        const iv = setInterval(fetchUnread, 10000);
        return () => clearInterval(iv);
    }, [fetchUnread]);

    const showToast = (msg, type = 'info') => {
        setToast({ msg, type });
        if (toastTimer.current) clearTimeout(toastTimer.current);
        toastTimer.current = setTimeout(() => setToast(null), 5000);
    };

    const handleSetCurrentUser = (user) => {
        setCurrentUser(user);
        prevUnread.current = 0;
        setUnreadCount(0);
        if (user) {
            localStorage.setItem('userid', user.USER_ID);
            localStorage.setItem('user_role', user.ROLE?.toLowerCase());

            // Redirect to appropriate dashboard based on selected role
            const role = user.ROLE?.toLowerCase();
            if (role === 'doctor') navigate('/dr_dashboard');
            else if (role === 'pharmacist') navigate('/pharmacist_dashboard');
            else if (role === 'ceo') navigate('/ceo_dashboard');
            else if (role === 'hod') navigate('/hod_dashboard');
            else if (role === 'dtccommittee' || role === 'dtc') navigate('/dtc_dashboard');
            else if (role === 'pharmacyhead') navigate('/pharmacy_head_dashboard');
        }
    };

    // Guard 1: No credentials -> redirect to login immediately
    // Must come after all hook declarations (Rules of Hooks).
    if (!storedUserId || !storedRole) {
        return <Navigate to="/register" replace />;
    }

    if (loadingUsers) {
        return (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', flexDirection: 'column', gap: 16 }}>
                <div className="spinner" style={{ width: 36, height: 36, borderWidth: 3 }} />
                <p style={{ color: 'var(--text-muted)', fontSize: '0.95rem' }}>Connecting to server...</p>
            </div>
        );
    }

    if (!users.length) {
        return (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }}>
                <div className="alert alert-error" style={{ maxWidth: 440 }}>
                    Could not connect to the server. Please ensure the backend is running on port 5000 and the Oracle DB is configured.
                </div>
            </div>
        );
    }

    // Guard 2: Role authorization � redirect if accessing another role's path
    if (currentUser) {
        const userRole     = currentUser.ROLE?.toLowerCase().trim();
        const allowedRoles = PATH_ROLES[location.pathname];
        if (allowedRoles && !allowedRoles.includes(userRole)) {
            return <Navigate to={getDashboardPath(userRole)} replace />;
        }
    }

    return (
        <DashboardLayout
            currentUser={currentUser}
            allUsers={users}
            setCurrentUser={handleSetCurrentUser}
            unreadCount={unreadCount}
        >
            {toast && (
                <div style={{
                    position: 'fixed', bottom: 24, right: 24, zIndex: 9999,
                    background: '#0ea5e9', color: '#fff',
                    padding: '12px 20px', borderRadius: 10,
                    boxShadow: '0 8px 32px rgba(14,165,233,0.35)',
                    fontSize: '0.9rem', fontWeight: 600,
                    display: 'flex', alignItems: 'center', gap: 10,
                    maxWidth: 340, cursor: 'pointer',
                }} onClick={() => setToast(null)}>
                    {toast.msg}
                    <span style={{ marginLeft: 'auto', opacity: 0.7, fontSize: '0.8rem' }}>X</span>
                </div>
            )}

            <Outlet context={{ currentUser, allUsers: users, onNotificationsRead: fetchUnread }} />
        </DashboardLayout>
    );
}
