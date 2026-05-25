import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { useWebSocket } from './hooks/useWebSocket';
import { Layout } from './components/Layout/Layout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Docker from './pages/Docker';
import Services from './pages/Services';
import Firewall from './pages/Firewall';
import Network from './pages/Network';
import SSH from './pages/SSH';
import Webhooks from './pages/Webhooks';
import Users from './pages/Users';
import Hetzner from './pages/Hetzner';
import MCHost from './pages/MCHost';
import Agents from './pages/Agents';
import AgentDetail from './pages/AgentDetail';
import UptimeKuma from './pages/UptimeKuma';
import Settings from './pages/Settings';

const ProtectedRoute = ({ children, adminOnly }) => {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  if (adminOnly && user.role !== 'admin') return <Navigate to="/" replace />;
  return children;
};

const AppRoutes = () => {
  const { user, token } = useAuth();
  const { data: liveStats, connected } = useWebSocket(user ? token : null);

  if (!user) {
    return (
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
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
        <Route path="/network" element={<Network liveStats={liveStats} />} />
        <Route path="/ssh" element={<SSH />} />
        <Route path="/agents" element={<Agents />} />
        <Route path="/agents/:id" element={<AgentDetail />} />
        <Route path="/uptime-kuma" element={<UptimeKuma />} />
        <Route path="/webhooks" element={<Webhooks />} />
        <Route path="/hetzner" element={<Hetzner />} />
        <Route path="/mchost" element={<MCHost />} />
        <Route path="/users" element={<ProtectedRoute adminOnly><Users /></ProtectedRoute>} />
        <Route path="/settings" element={<ProtectedRoute adminOnly><Settings /></ProtectedRoute>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  );
};

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  );
}
