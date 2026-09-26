import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { WSProvider } from './context/WSContext';
import { ErrorProvider } from './context/ErrorContext';
import { useWebSocket } from './hooks/useWebSocket';
import { useErrorReporter } from './hooks/useErrorReporter';
import { Layout } from './components/Layout/Layout';
import ErrorBoundary from './components/ErrorBoundary';
import { HUB_RECHTE } from './utils/hubRechte';

// Auth-Seiten sofort laden (werden vor dem Login benötigt)
import Login from './pages/Login';
import ForgotPassword from './pages/ForgotPassword';
import ResetPassword from './pages/ResetPassword';

// Alle anderen Seiten lazy laden → eigene Chunks, nur bei Bedarf geladen
const Dashboard     = lazy(() => import('./pages/Dashboard'));
const DockerCenter  = lazy(() => import('./pages/DockerCenter'));
const Services      = lazy(() => import('./pages/Services'));
const SecurityCenter = lazy(() => import('./pages/SecurityCenter'));
const CronJobs      = lazy(() => import('./pages/CronJobs'));
const Webhooks      = lazy(() => import('./pages/Webhooks'));
const AccessCenter  = lazy(() => import('./pages/AccessCenter'));
const Hetzner       = lazy(() => import('./pages/Hetzner'));
const MCHost        = lazy(() => import('./pages/MCHost'));
const Hosting       = lazy(() => import('./pages/Hosting'));
const Agents        = lazy(() => import('./pages/Agents'));
const AgentDetail   = lazy(() => import('./pages/AgentDetail'));
const UptimeKuma    = lazy(() => import('./pages/UptimeKuma'));
const PatchMon      = lazy(() => import('./pages/PatchMon'));
const Settings      = lazy(() => import('./pages/Settings'));
const Alerts        = lazy(() => import('./pages/Alerts'));
const Logs          = lazy(() => import('./pages/Logs'));
const SslMonitor    = lazy(() => import('./pages/SslMonitor'));
const LogsDiagnostics = lazy(() => import('./pages/LogsDiagnostics'));
const Monitoring    = lazy(() => import('./pages/Monitoring'));
const PanelLogsShare = lazy(() => import('./pages/PanelLogsShare'));
const DiagnoseShare  = lazy(() => import('./pages/DiagnoseShare'));

function PageLoader() {
  return (
    <div className="flex items-center justify-center h-64">
      <div className="w-6 h-6 border-2 border-panel-accent border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

// `permission` als String oder Array (eines genügt — wie requirePermission im Backend).
// Hub-Seiten übergeben die Rechte aller ihrer Tabs; welche Tabs sichtbar sind, entscheidet
// danach useTabParam.
const ProtectedRoute = ({ children, adminOnly, permission }) => {
  const { user, isAdmin, hasPermission } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  if (adminOnly && !isAdmin) return <Navigate to="/" replace />;
  if (permission && !hasPermission(permission)) return <Navigate to="/" replace />;
  return children;
};

// Alte Einzelseiten leiten auf den passenden Tab der Hub-Seite weiter. Vorhandene
// Parameter (z. B. ?id= eines hervorgehobenen Panel-Logs) bleiben erhalten.
function RedirectToTab({ to, tab }) {
  const { search } = useLocation();
  const params = new URLSearchParams(search);
  params.set('tab', tab);
  return <Navigate to={`${to}?${params}`} replace />;
}

const AppRoutes = () => {
  const { user } = useAuth();
  const { data: liveStats, connected } = useWebSocket();
  const location = useLocation();

  // Globaler Frontend-Fehler-Reporter (aktiviert sich nur wenn eingeloggt)
  useErrorReporter();

  // Öffentliche Share-Seiten — kein Login nötig
  if (location.pathname.startsWith('/s/')) {
    return (
      <Suspense fallback={<PageLoader />}>
        <Routes>
          <Route path="/s/diagnose/:token" element={<DiagnoseShare />} />
          <Route path="/s/:token"          element={<PanelLogsShare />} />
        </Routes>
      </Suspense>
    );
  }

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
      <ErrorBoundary resetKey={location.pathname}>
        <Suspense fallback={<PageLoader />}>
          <Routes>
            <Route path="/" element={<Dashboard liveStats={liveStats} />} />
            <Route path="/docker" element={<DockerCenter />} />
            {/* Container und Ressourcen sind zusammengelegt — alte Lesezeichen weiterleiten */}
            <Route path="/docker-resources" element={<Navigate to="/docker" replace />} />
            <Route path="/services" element={<Services />} />
            <Route path="/security" element={<ProtectedRoute permission={HUB_RECHTE.security}><SecurityCenter /></ProtectedRoute>} />
            <Route path="/firewall" element={<RedirectToTab to="/security" tab="firewall" />} />
            <Route path="/cron" element={<CronJobs />} />
            <Route path="/network"    element={<Navigate to="/monitoring" replace />} />
            <Route path="/monitoring" element={<Monitoring liveStats={liveStats} />} />
            <Route path="/agents" element={<Agents />} />
            <Route path="/agents/:id" element={<AgentDetail />} />
            <Route path="/uptime-kuma" element={<UptimeKuma />} />
            <Route path="/patchmon" element={<PatchMon />} />
            <Route path="/hosting" element={<Hosting />} />
            <Route path="/hetzner" element={<Navigate to="/hosting" replace />} />
            <Route path="/mchost" element={<Navigate to="/hosting" replace />} />

            <Route path="/alerts" element={<ProtectedRoute permission="alerts.manage"><Alerts /></ProtectedRoute>} />
            <Route path="/logs" element={<ProtectedRoute permission="alerts.manage"><Logs /></ProtectedRoute>} />
            <Route path="/ssl" element={<ProtectedRoute permission="alerts.manage"><SslMonitor /></ProtectedRoute>} />
            <Route path="/webhooks" element={<ProtectedRoute permission="alerts.manage"><Webhooks /></ProtectedRoute>} />
            <Route path="/access"      element={<ProtectedRoute permission={HUB_RECHTE.access}><AccessCenter /></ProtectedRoute>} />
            <Route path="/diagnostics" element={<ProtectedRoute permission={HUB_RECHTE.diagnostics}><LogsDiagnostics /></ProtectedRoute>} />
            {/* Frühere Einzelseiten — Lesezeichen und alte Links landen im richtigen Tab */}
            <Route path="/users"      element={<RedirectToTab to="/access" tab="users" />} />
            <Route path="/roles"      element={<RedirectToTab to="/access" tab="roles" />} />
            <Route path="/audit"      element={<RedirectToTab to="/diagnostics" tab="audit" />} />
            <Route path="/panel-logs" element={<RedirectToTab to="/diagnostics" tab="system" />} />
            <Route path="/diagnose"   element={<RedirectToTab to="/diagnostics" tab="diagnose" />} />
            <Route path="/settings"  element={<Settings />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </ErrorBoundary>
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
