import React, { useState, useEffect, useCallback, useRef } from 'react';
import axios from 'axios';
import { Outlet, useNavigate } from 'react-router-dom';
import DashboardLayout from './DashboardLayout';

const API = '/api';

export default function ProtectedLayout() {
    const [users, setUsers] = useState([]);
    const [currentUser, setCurrentUser] = useState(null);
    const [unreadCount, setUnreadCount] = useState(0);
    const [loadingUsers, setLoadingUsers] = useState(true);
    const [toast, setToast] = useState(null);
    const prevUnread = useRef(0);
    const toastTimer = useRef(null);
    const navigate = useNavigate();

    // Load all users once on mount
    useEffect(() => {
        axios.get(`${API}/users`).then(r => {
            setUsers(r.data);
            if (r.data.length > 0) {
                const storedUserId = localStorage.getItem('userid');
                let foundUser = null;
                if (storedUserId) {
                    foundUser = r.data.find(u => u.USER_ID === parseInt(storedUserId, 10));
                }
                setCurrentUser(foundUser || r.data[0]);
            }
        }).catch((err) => {
            console.error("Failed to load users", err);
        }).finally(() => setLoadingUsers(false));
    }, []);

    // Poll unread notification count — 10s interval
    const fetchUnread = useCallback(() => {
        if (!currentUser) return;
        axios.get(`${API}/notifications/${currentUser.USER_ID}`)
            .then(r => {
                const count = r.data.filter(n => !n.IS_READ).length;
                setUnreadCount(count);
                // Show toast when new notifications arrive
                if (count > prevUnread.current) {
                    const diff = count - prevUnread.current;
                    showToast(`🔔 ${diff} new notification${diff > 1 ? 's' : ''}`, 'info');
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

    if (loadingUsers) {
        return (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', flexDirection: 'column', gap: 16 }}>
                <div className="spinner" style={{ width: 36, height: 36, borderWidth: 3 }} />
                <p style={{ color: 'var(--text-muted)', fontSize: '0.95rem' }}>Connecting to server…</p>
            </div>
        );
    }

    if (!users.length) {
        return (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }}>
                <div className="alert alert-error" style={{ maxWidth: 440 }}>
                    ⚠️ Could not connect to the server. Please ensure the backend is running on port 5000 and the Oracle DB is configured.
                </div>
            </div>
        );
    }

    return (
        <DashboardLayout
            currentUser={currentUser}
            allUsers={users}
            setCurrentUser={handleSetCurrentUser}
            unreadCount={unreadCount}
        >
            {/* ---- Toast Notification ---- */}
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
                    <span style={{ marginLeft: 'auto', opacity: 0.7, fontSize: '0.8rem' }}>✕</span>
                </div>
            )}

            <Outlet context={{ currentUser, allUsers: users, onNotificationsRead: fetchUnread }} />
        </DashboardLayout>
    );
}
