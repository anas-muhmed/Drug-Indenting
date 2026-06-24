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


const RoleRedirect = () => {
  const role = localStorage.getItem('user_role');
  if (!role) return <Navigate to="/register" replace />;

  if (role === 'doctor') return <Navigate to="/dr_dashboard" replace />;
  if (role === 'pharmacist') return <Navigate to="/pharmacist_dashboard" replace />;
  if (role === 'ceo') return <Navigate to="/ceo_dashboard" replace />;
  if (role === 'hod') return <Navigate to="/hod_dashboard" replace />;
  if (role === 'dtc' || role === 'dtccommittee') return <Navigate to="/dtc_dashboard" replace />;
  if (role === 'pharmacyhead') return <Navigate to="/pharmacy_head_dashboard" replace />;
  if (role === 'admin') return <Navigate to="/admin_dashboard" replace />;

  return <Navigate to="/register" replace />;
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

          {/* Admin Portal */}
          <Route path="/admin_register" element={<AdminRegister />} />
      
          <Route path="/admin_dashboard" element={<AdminDashboard />} />
          <Route path="/admin/dashboard" element={<AdminDashboard />} />

          <Route path="/" element={<ProtectedLayout />}>
            <Route index element={<Navigate to="/register" replace />} />

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