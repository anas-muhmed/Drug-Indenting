import React from 'react';
import { Link, useNavigate } from 'react-router-dom';

export default function DashboardLayout({
    currentUser,
    allUsers,
    setCurrentUser,
    unreadCount,
    children,
}) {
    const navigate = useNavigate();

    const handleLogout = () => {
        localStorage.removeItem('userid');
        localStorage.removeItem('user_role');
        localStorage.removeItem('token');
        setCurrentUser(null);
        navigate('/register');
    };

    return (
        <div className="app-shell">
            <header className="app-header">
                <div className="app-logo">
                    <span>💉</span>
                    Formulary Drug&nbsp;<span>Indenting System</span>
                </div>

                <div className="header-right" style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
                    {/* <div className="role-switcher">
                        <span>👤</span>
                        <select
                            value={currentUser?.USER_ID || ''}
                            onChange={(e) => {
                                const user = allUsers.find(
                                    x => x.USER_ID === parseInt(e.target.value)
                                );
                                setCurrentUser(user);
                            }}
                        >
                            {allUsers.map(u => (
                                <option key={u.USER_ID} value={u.USER_ID}>
                                    {u.NAME} ({u.ROLE})
                                </option>
                            ))}
                        </select>
                    </div> */}

                    {unreadCount > 0 && (
                        <div className="tab-badge" style={{ background: 'var(--danger)', fontSize: '0.8rem', padding: '3px 8px' }}>
                            🔔 {unreadCount}
                        </div>
                    )}

                    <button
                        onClick={handleLogout}
                        style={{
                            background: '#ef4444',
                            color: 'white',
                            border: 'none',
                            padding: '6px 12px',
                            borderRadius: '6px',
                            cursor: 'pointer',
                            fontWeight: '600',
                            fontSize: '0.85rem',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '5px'
                        }}
                    >
                        <span>⏏</span> Logout
                    </button>
                </div>
            </header>

            <nav className="tab-nav">
                {currentUser?.ROLE?.toLowerCase() === 'doctor' && <Link to="/dr_dashboard" className="tab-btn">Doctor</Link>}
                {currentUser?.ROLE?.toLowerCase() === 'hod' && <Link to="/hod_dashboard" className="tab-btn">HOD</Link>}
                {currentUser?.ROLE?.toLowerCase() === 'pharmacist' && <Link to="/pharmacist_dashboard" className="tab-btn">Pharmacist</Link>}
                {currentUser?.ROLE?.toLowerCase() === 'pharmacyhead' && <Link to="/pharmacy_head_dashboard" className="tab-btn">Pharmacy Head</Link>}
                {(currentUser?.ROLE?.toLowerCase() === 'dtc' || currentUser?.ROLE?.toLowerCase() === 'dtccommittee') && <Link to="/dtc_dashboard" className="tab-btn">DTC</Link>}
                {currentUser?.ROLE?.toLowerCase() === 'ceo' && <Link to="/ceo_dashboard" className="tab-btn">CEO</Link>}
            </nav>

            <main className="tab-content">
                {children}
            </main>
        </div>
    );
}