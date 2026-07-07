import { lazy, Suspense } from "react"
import { Routes, Route, Navigate } from "react-router-dom"

const Register = lazy(() => import('./components/user_register'))
const AdminDashboard = lazy(() => import('./components/AdminDashboard'))
const ProtectedLayout = lazy(() => import('./layouts/ProtectedLayout'))
const DrDashboard = lazy(() => import('./pages/DrDashboard'))
const HODDashboard = lazy(() => import('./pages/HODDashboard'))
const PharmacistDashboard = lazy(() => import('./pages/PharmacistDashboard'))
const PharmacyHeadDashboard = lazy(() => import('./pages/PharmacyHeadDashboard'))
const DTCDashboard = lazy(() => import('./pages/DTCDashboard'))
const CEODashboard = lazy(() => import('./pages/CEODashboard'))
const AdminRegister = lazy(() => import('./components/AdminRegister'))

// Returns the correct dashboard path for a given role string
function getDashboardPath(role) {
  if (!role) return '/register';
  switch ((role || '').toLowerCase().trim()) {
    case 'doctor': return '/dr_dashboard';
    case 'pharmacist': return '/pharmacist_dashboard';
    case 'ceo': return '/ceo_dashboard';
    case 'hod': return '/hod_dashboard';
    case 'dtc':
    case 'dtccommittee': return '/dtc_dashboard';
    case 'pharmacyhead': return '/pharmacy_head_dashboard';
    case 'admin': return '/admin_dashboard';
    default: return '/register';
  }
}

// Redirects the current user to their own role's dashboard.
// If no role is stored, sends to /register.
const RoleRedirect = () => {
  const role = localStorage.getItem('user_role');
  return <Navigate to={getDashboardPath(role)} replace />;
};

const Loader = () => (
  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', flexDirection: 'column', gap: 16 }}>
    <div className="spinner" style={{ width: 36, height: 36, borderWidth: 3 }} />
    <p style={{ color: 'var(--text-muted)', fontSize: '0.95rem' }}>Loading application…</p>
  </div>
);

export default function App() {
  return (
    <>
      <Suspense fallback={<Loader />}>
        <Routes>

          <Route path="/register" element={<Register />} />

          {/* Admin Portal — AdminDashboard has its own internal login gate */}
          <Route path="/admin_register" element={<AdminRegister />} />
          <Route path="/admin_dashboard" element={<AdminDashboard />} />
          <Route path="/admin/dashboard" element={<AdminDashboard />} />

          {/* Protected zone — auth + role checks are handled inside ProtectedLayout */}
          <Route path="/" element={<ProtectedLayout />}>
            {/* Root redirect: send logged-in users to their dashboard */}
            <Route index element={<RoleRedirect />} />

            <Route path="dr_dashboard" element={<DrDashboard />} />
            <Route path="hod_dashboard" element={<HODDashboard />} />
            <Route path="pharmacist_dashboard" element={<PharmacistDashboard />} />
            <Route path="pharmacy_head_dashboard" element={<PharmacyHeadDashboard />} />
            <Route path="dtc_dashboard" element={<DTCDashboard />} />
            <Route path="ceo_dashboard" element={<CEODashboard />} />
          </Route>

        </Routes>
      </Suspense>
    </>
  )
}