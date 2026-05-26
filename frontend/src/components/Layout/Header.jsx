import { useState, useEffect, useRef } from 'react';
import { LogOut, Wifi, WifiOff, Bell, BellOff, AlertTriangle, CheckCircle, X } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useLocation } from 'react-router-dom';
import { useWSMessage } from '../../context/WSContext';

const pageTitles = {
  '/': 'Dashboard',
  '/docker': 'Docker Container',
  '/services': 'Services',
  '/firewall': 'Firewall & Ports',
  '/network': 'Netzwerk',
  '/ssh': 'SSH Terminal',
  '/webhooks': 'Webhooks',
  '/alerts': 'Alert-Regeln',
  '/hetzner': 'Hetzner Cloud',
  '/mchost': 'MC-Host24',
  '/agents': 'Agenten',
  '/uptime-kuma': 'Uptime Kuma',
  '/users': 'Benutzerverwaltung',
  '/roles': 'Rollen & Rechte',
  '/settings': 'Einstellungen',
};

const METRIC_LABELS  = { cpu: 'CPU', memory: 'RAM', disk: 'Disk' };
const METRIC_COLORS  = { cpu: 'text-blue-400', memory: 'text-green-400', disk: 'text-yellow-400' };

// ── Toast-Komponente ───────────────────────────────────────────────────────────
function Toast({ n, onDismiss }) {
  const isFired = n.alertType === 'fired';
  return (
    <div className={`flex items-start gap-3 px-4 py-3 rounded-lg shadow-xl border text-sm max-w-sm w-full
      ${isFired
        ? 'bg-panel-surface border-panel-orange/40'
        : 'bg-panel-surface border-panel-green/40'
      } animate-in slide-in-from-right-5 duration-300`}
    >
      {isFired
        ? <AlertTriangle size={16} className="text-panel-orange flex-shrink-0 mt-0.5" />
        : <CheckCircle   size={16} className="text-panel-green flex-shrink-0 mt-0.5" />
      }
      <div className="flex-1 min-w-0">
        <p className="font-medium text-panel-text truncate">{n.ruleName}</p>
        <p className="text-xs text-panel-muted mt-0.5">
          {n.serverName} · {METRIC_LABELS[n.metric]} {n.value?.toFixed(1)}%
        </p>
      </div>
      <button onClick={() => onDismiss(n.id)} className="text-panel-muted hover:text-panel-text flex-shrink-0">
        <X size={13} />
      </button>
    </div>
  );
}

// ── Haupt-Header ───────────────────────────────────────────────────────────────
export const Header = ({ connected }) => {
  const { logout } = useAuth();
  const location   = useLocation();
  const title      = pageTitles[location.pathname] || 'Panel';

  // Benachrichtigungen
  const [notifications, setNotifications] = useState([]);  // { id, alertType, ruleName, metric, value, threshold, serverName, timestamp }
  const [unread, setUnread]   = useState(0);
  const [bellOpen, setBellOpen] = useState(false);
  const [toasts, setToasts]   = useState([]);              // aktive Toasts
  const bellRef = useRef(null);

  // WS: Alert-Ereignisse empfangen
  useWSMessage('alert', (msg) => {
    const n = { ...msg.payload, id: Date.now() + Math.random(), timestamp: Date.now() };
    setNotifications(prev => [n, ...prev].slice(0, 30));
    setUnread(u => u + 1);

    // Toast anzeigen (5s)
    setToasts(prev => [...prev, n]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== n.id)), 5000);
  });

  // Click outside → Bell schließen
  useEffect(() => {
    const handler = (e) => {
      if (bellRef.current && !bellRef.current.contains(e.target)) setBellOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const toggleBell = () => {
    setBellOpen(o => !o);
    setUnread(0);
  };

  const dismissToast = (id) => setToasts(prev => prev.filter(t => t.id !== id));

  const fmtTime = (ts) => new Date(ts).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });

  return (
    <>
      {/* ── Toasts (fixed, unten rechts) ─────────────────────────────────────── */}
      <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 items-end">
        {toasts.map(n => (
          <Toast key={n.id} n={n} onDismiss={dismissToast} />
        ))}
      </div>

      {/* ── Header-Bar ───────────────────────────────────────────────────────── */}
      <header className="flex items-center justify-between px-4 py-3 bg-panel-surface border-b border-panel-border flex-shrink-0">
        <h1 className="text-sm font-semibold text-panel-text">{title}</h1>

        <div className="flex items-center gap-3">
          {/* Live-Indikator */}
          <div className={`flex items-center gap-1.5 text-xs ${connected ? 'text-panel-green' : 'text-panel-red'}`}>
            {connected ? <Wifi size={13} /> : <WifiOff size={13} />}
            <span className="hidden sm:inline">{connected ? 'Live' : 'Getrennt'}</span>
          </div>

          {/* Benachrichtigungs-Glocke */}
          <div className="relative" ref={bellRef}>
            <button
              onClick={toggleBell}
              className="relative p-1.5 rounded-md text-panel-muted hover:text-panel-text hover:bg-panel-card transition-colors"
              title="Benachrichtigungen"
            >
              {notifications.length > 0 ? <Bell size={15} /> : <BellOff size={15} />}
              {unread > 0 && (
                <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-0.5 bg-panel-orange text-white text-[10px] font-bold rounded-full flex items-center justify-center leading-none">
                  {unread > 9 ? '9+' : unread}
                </span>
              )}
            </button>

            {/* Dropdown */}
            {bellOpen && (
              <div className="absolute right-0 top-full mt-2 w-80 bg-panel-surface border border-panel-border rounded-lg shadow-2xl z-40 overflow-hidden">
                <div className="flex items-center justify-between px-3 py-2 border-b border-panel-border">
                  <span className="text-xs font-semibold text-panel-text">Benachrichtigungen</span>
                  {notifications.length > 0 && (
                    <button
                      onClick={() => setNotifications([])}
                      className="text-xs text-panel-muted hover:text-panel-text transition-colors"
                    >
                      Alle löschen
                    </button>
                  )}
                </div>
                <div className="max-h-80 overflow-y-auto">
                  {notifications.length === 0 ? (
                    <div className="py-8 text-center">
                      <BellOff size={24} className="mx-auto mb-2 text-panel-muted opacity-40" />
                      <p className="text-xs text-panel-muted">Keine Benachrichtigungen</p>
                    </div>
                  ) : (
                    notifications.map((n, i) => {
                      const isFired = n.alertType === 'fired';
                      return (
                        <div key={n.id || i}
                          className="flex items-start gap-3 px-3 py-2.5 border-b border-panel-border/50 last:border-0 hover:bg-panel-card/30 transition-colors">
                          {isFired
                            ? <AlertTriangle size={14} className={`flex-shrink-0 mt-0.5 ${METRIC_COLORS[n.metric] || 'text-panel-orange'}`} />
                            : <CheckCircle   size={14} className="flex-shrink-0 mt-0.5 text-panel-green" />
                          }
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between gap-1">
                              <p className="text-xs font-medium text-panel-text truncate">
                                {isFired ? '⚠️' : '✅'} {n.ruleName}
                              </p>
                              <span className="text-[10px] text-panel-muted flex-shrink-0">{fmtTime(n.timestamp)}</span>
                            </div>
                            <p className="text-[11px] text-panel-muted mt-0.5">
                              {n.serverName} · {METRIC_LABELS[n.metric]} {n.value?.toFixed(1)}%
                              {isFired && <span className="ml-1">(Schwelle: {n.threshold}%)</span>}
                            </p>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Abmelden */}
          <button
            onClick={logout}
            className="flex items-center gap-1.5 text-xs text-panel-muted hover:text-panel-text transition-colors"
          >
            <LogOut size={13} />
            <span className="hidden sm:inline">Abmelden</span>
          </button>
        </div>
      </header>
    </>
  );
};
