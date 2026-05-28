import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard, Container, Wrench, Shield,
  Terminal, Webhook, Users, Cloud, Gamepad2, ChevronLeft, ChevronRight,
  Server, Settings, ServerCog, MonitorCheck, Bell, ShieldCheck, ClipboardList,
  BarChart2, AlertCircle, X, ChevronDown, ChevronUp, Trash2, ScrollText,
} from 'lucide-react';
import { useState, useEffect } from 'react';
import axios from 'axios';
import { useAuth } from '../../context/AuthContext';
import { useErrors } from '../../context/ErrorContext';

const navItems = [
  { to: '/', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/docker', icon: Container, label: 'Docker' },
  { to: '/services', icon: Wrench, label: 'Services' },
  { to: '/firewall', icon: Shield, label: 'Firewall' },
  { to: '/monitoring',  icon: BarChart2,  label: 'Monitoring' },
  { to: '/ssh', icon: Terminal, label: 'SSH / SFTP' },
  { to: '/agents',      icon: ServerCog,    label: 'Server' },
  { to: '/uptime-kuma', icon: MonitorCheck, label: 'Uptime Kuma' },
  { to: '/alerts', icon: Bell, label: 'Benachrichtigungen' },
  { divider: true },
  { to: '/webhooks', icon: Webhook, label: 'Webhooks', permission: 'webhooks.view' },
  { to: '/hetzner', icon: Cloud,    label: 'Hetzner',   permission: 'hetzner.view' },
  { to: '/mchost',  icon: Gamepad2, label: 'MC-Host24', permission: 'mchost.view'  },
  { divider: true },
  { to: '/users',      icon: Users,          label: 'Benutzer',        adminOnly: true },
  { to: '/roles',      icon: ShieldCheck,    label: 'Rollen & Rechte', adminOnly: true },
  { to: '/audit',      icon: ClipboardList,  label: 'Audit-Log',       permission: 'audit.view' },
  { to: '/panel-logs', icon: ScrollText,     label: 'Panel-Logs',      adminOnly: true },
  { to: '/settings',   icon: Settings,       label: 'Einstellungen' },
];

// ── Quell-Farben für Fehlereinträge ──────────────────────────────────────────

const SOURCE_CHIP = {
  SSH:           'bg-red-500/15 text-red-400',
  SFTP:          'bg-purple-500/15 text-purple-400',
  'Uptime Kuma': 'bg-panel-orange/15 text-panel-orange',
  System:        'bg-panel-muted/15 text-panel-muted',
};

// ── Fehler-Eintrag ────────────────────────────────────────────────────────────

function ErrorEntry({ err, onDismiss }) {
  const chipCls = SOURCE_CHIP[err.source] ?? 'bg-panel-muted/15 text-panel-muted';
  const timeStr = new Date(err.time).toLocaleTimeString('de-DE', {
    hour:   '2-digit',
    minute: '2-digit',
  });

  return (
    <div className="flex items-start gap-1.5 rounded-md bg-panel-surface px-2 py-1.5 group">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1 mb-0.5 flex-wrap">
          <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-medium whitespace-nowrap ${chipCls}`}>
            {err.source}
          </span>
          <span className="text-[9px] text-panel-muted/50 ml-auto whitespace-nowrap tabular-nums">
            {timeStr}
          </span>
        </div>
        <p className="text-[10px] text-panel-muted leading-snug line-clamp-2 break-words">
          {err.message}
        </p>
      </div>
      <button
        onClick={onDismiss}
        title="Entfernen"
        className="flex-shrink-0 mt-0.5 opacity-0 group-hover:opacity-100 transition-opacity text-panel-muted/60 hover:text-panel-red p-0.5 rounded"
      >
        <X size={9} />
      </button>
    </div>
  );
}

// ── Sidebar ───────────────────────────────────────────────────────────────────

export const Sidebar = () => {
  const [collapsed, setCollapsed] = useState(false);
  const { user, isAdmin, hasPermission } = useAuth();
  const [version,  setVersion]  = useState(null);
  const [errOpen,  setErrOpen]  = useState(true);

  const { errors, dismissError, clearErrors } = useErrors();

  useEffect(() => {
    axios.get('/api/version').then(r => setVersion(r.data)).catch(() => {});
  }, []);

  return (
    <aside className={`flex flex-col bg-panel-surface border-r border-panel-border transition-all duration-200 flex-shrink-0 ${collapsed ? 'w-14' : 'w-56'}`}>

      {/* ── Kopfzeile ────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-3 py-4 border-b border-panel-border min-h-[57px]">
        {!collapsed && (
          <div className="flex items-center gap-2 min-w-0">
            <Server size={16} className="text-panel-accent flex-shrink-0" />
            <span className="text-sm font-bold text-panel-text truncate">Überwachungs-Panel</span>
          </div>
        )}
        <button
          onClick={() => setCollapsed(c => !c)}
          className="ml-auto text-panel-muted hover:text-panel-text transition-colors"
        >
          {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
        </button>
      </div>

      {/* ── Navigation ───────────────────────────────────────────────────── */}
      <nav className="flex-1 py-2 overflow-y-auto">
        {navItems.map((item, i) => {
          if (item.divider) return <div key={i} className="my-1 mx-3 border-t border-panel-border" />;
          if (item.adminOnly && !isAdmin) return null;
          if (item.permission && !hasPermission(item.permission)) return null;
          return (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              title={collapsed ? item.label : undefined}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2 mx-1 my-0.5 rounded-md text-sm transition-colors ${
                  isActive
                    ? 'bg-panel-accent/15 text-panel-accent'
                    : 'text-panel-muted hover:text-panel-text hover:bg-panel-card'
                }`
              }
            >
              <item.icon size={16} className="flex-shrink-0" />
              {!collapsed && <span className="truncate">{item.label}</span>}
            </NavLink>
          );
        })}
      </nav>

      {/* ── Panel-Fehler (ausgeklappt) ────────────────────────────────────── */}
      {errors.length > 0 && !collapsed && (
        <div className="border-t border-panel-border/60">

          {/* Header */}
          <div
            className="flex items-center justify-between px-3 py-2 cursor-pointer hover:bg-panel-card transition-colors select-none"
            onClick={() => setErrOpen(o => !o)}
          >
            <div className="flex items-center gap-1.5">
              <AlertCircle size={11} className="text-panel-red flex-shrink-0" />
              <span className="text-[11px] font-medium text-panel-red">Panel-Fehler</span>
              <span className="text-[9px] bg-panel-red/20 text-panel-red rounded-full px-1.5 leading-[1.6] tabular-nums">
                {errors.length}
              </span>
            </div>
            <div className="flex items-center gap-1 text-panel-muted">
              <button
                onClick={(e) => { e.stopPropagation(); clearErrors(); }}
                title="Alle löschen"
                className="hover:text-panel-red transition-colors p-0.5 rounded"
              >
                <Trash2 size={10} />
              </button>
              {errOpen
                ? <ChevronUp   size={11} />
                : <ChevronDown size={11} />
              }
            </div>
          </div>

          {/* Fehler-Liste */}
          {errOpen && (
            <div className="max-h-40 overflow-y-auto px-2 space-y-1">
              {errors.slice(0, 15).map(err => (
                <ErrorEntry key={err.id} err={err} onDismiss={() => dismissError(err.id)} />
              ))}
            </div>
          )}

          {/* Link zu Panel-Logs */}
          {errOpen && isAdmin && (
            <NavLink
              to="/panel-logs"
              className="flex items-center justify-center gap-1 px-3 py-1.5 text-[10px] text-panel-muted hover:text-panel-accent transition-colors border-t border-panel-border/40"
            >
              Alle Logs anzeigen →
            </NavLink>
          )}
        </div>
      )}

      {/* ── Panel-Fehler (eingeklappt) ────────────────────────────────────── */}
      {errors.length > 0 && collapsed && (
        <div className="flex justify-center py-2 border-t border-panel-border/60">
          <span
            title={`${errors.length} Panel-Fehler`}
            className="relative inline-flex items-center justify-center w-6 h-6 rounded-full bg-panel-red/15"
          >
            <AlertCircle size={13} className="text-panel-red" />
            {errors.length > 1 && (
              <span className="absolute -top-1 -right-1 text-[8px] bg-panel-red text-white rounded-full w-3.5 h-3.5 flex items-center justify-center tabular-nums font-bold leading-none">
                {errors.length > 9 ? '9+' : errors.length}
              </span>
            )}
          </span>
        </div>
      )}

      {/* ── Benutzer-Info + Version ───────────────────────────────────────── */}
      <div className="px-3 py-3 border-t border-panel-border">
        {!collapsed && user && (
          <div className="text-xs text-panel-muted truncate">
            <span className="text-panel-text">{user.username}</span>
            <span className="ml-1">({user.roleLabel || user.role})</span>
          </div>
        )}
        {version && (
          <div className={`mt-1 text-[10px] text-panel-muted/60 ${collapsed ? 'text-center' : ''}`}
            title={`Build ${version.build} · ${version.date}`}>
            {collapsed ? `v${version.version}` : `v${version.version} · Build ${version.build}`}
          </div>
        )}
      </div>
    </aside>
  );
};
