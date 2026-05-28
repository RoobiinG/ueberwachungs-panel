import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { WSProvider } from './context/WSContext';
import { ErrorProvider } from './context/ErrorContext';
import { useWebSocket } from './hooks/useWebSocket';
import { useErrorReporter } from './hooks/useErrorReporter';
import { Layout } from './components/Layout/Layout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Docker from './pages/Docker';
import Services from './pages/Services';
import Firewall from './pages/Firewall';
import SSH from './pages/SSH';
import Webhooks from './pages/Webhooks';
import Users from './pages/Users';
import Hetzner from './pages/Hetzner';
import MCHost from './pages/MCHost';
import Agents from './pages/Agents';
import AgentDetail from './pages/AgentDetail';
import UptimeKuma from './pages/UptimeKuma';
import Settings from './pages/Settings';
import Alerts from './pages/Alerts';
import Roles from './pages/Roles';
import AuditLog from './pages/AuditLog';
import Monitoring from './pages/Monitoring';
import ForgotPassword from './pages/ForgotPassword';
import ResetPassword from './pages/ResetPassword';
import PanelLogs from './pages/PanelLogs';

const ProtectedRoute = ({ children, adminOnly, permission }) => {
  const { user, hasPermission } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  if (adminOnly && user.role !== 'admin') return <Navigate to="/" replace />;
  if (permission && !hasPermission(permission)) return <Navigate to="/" replace />;
  return children;
};

const AppRoutes = () => {
  const { user } = useAuth();
  const { data: liveStats, connected } = useWebSocket();

  // Globaler Frontend-Fehler-Reporter (aktiviert sich nur wenn eingeloggt)
  useErrorReporter();

  if (!user) {
    return (
      <Routes>
        <Route path="/login"           element={<Login />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/reset-password"  element={<ResetPassword />} />
        <Route path="*"                element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  return (
    <Layout connected={connected}>
      <Routes>
        <Route path="/" element={<Dashboard liveStats={liveStats} />} />
        <Route path="/docker" element={<Docker />} />
        <Route path="/services" element={<Services />} />
        <Route path="/firewall" element={<Firewall />} />
        <Route path="/network"    element={<Navigate to="/monitoring" replace />} />
        <Route path="/monitoring" element={<Monitoring liveStats={liveStats} />} />
        <Route path="/ssh" element={<SSH />} />
        <Route path="/agents" element={<Agents />} />
        <Route path="/agents/:id" element={<AgentDetail />} />
        <Route path="/uptime-kuma" element={<UptimeKuma />} />
        <Route path="/alerts" element={<Alerts />} />
        <Route path="/webhooks" element={<Webhooks />} />
        <Route path="/hetzner" element={<Hetzner />} />
        <Route path="/mchost" element={<MCHost />} />
        <Route path="/users"     element={<ProtectedRoute adminOnly><Users /></ProtectedRoute>} />
        <Route path="/roles"     element={<ProtectedRoute adminOnly><Roles /></ProtectedRoute>} />
        <Route path="/audit"     element={<ProtectedRoute permission="audit.view"><AuditLog /></ProtectedRoute>} />
        <Route path="/panel-logs" element={<ProtectedRoute adminOnly><PanelLogs /></ProtectedRoute>} />
        <Route path="/settings"  element={<Settings />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  );
};

/** Zugriff auf token erst NACH AuthProvider möglich → eigener Wrapper */
function WSWrapper({ children }) {
  const { user, token } = useAuth();
  return <WSProvider token={user ? token : null}>{children}</WSProvider>;
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <ErrorProvider>
          <WSWrapper>
            <AppRoutes />
          </WSWrapper>
        </ErrorProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
