import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard, Container, Wrench, Shield,
  Webhook, Users, Cloud, Gamepad2, ChevronLeft, ChevronRight,
  Server, Settings, ServerCog, MonitorCheck, Bell, ShieldCheck, ClipboardList,
  BarChart2, AlertCircle, Trash2, ScrollText, PackageCheck, Layers,
} from 'lucide-react';
import { useState, useEffect } from 'react';
import axios from 'axios';
import { useAuth } from '../../context/AuthContext';
import { useErrors } from '../../context/ErrorContext';

export const navItems = [
  { section: 'Übersicht' },
  { to: '/', icon: LayoutDashboard, label: 'Dashboard' },

  { section: 'Infrastruktur' },
  { to: '/docker',      icon: Container,    label: 'Docker',            moduleKey: 'docker' },
  { to: '/docker-resources', icon: Layers,  label: 'Docker-Ressourcen', moduleKey: 'docker', permission: ['docker.images.view', 'docker.volumes.view', 'docker.networks.view', 'docker.stacks.view'] },
  { to: '/services',    icon: Wrench,       label: 'Services' },
  { to: '/firewall',    icon: Shield,       label: 'Firewall' },
  { to: '/monitoring',  icon: BarChart2,    label: 'Monitoring' },
  { to: '/agents',      icon: ServerCog,    label: 'Server' },

  { section: 'Dienste' },
  { to: '/uptime-kuma', icon: MonitorCheck, label: 'Uptime Kuma',       moduleKey: 'uptimekuma', permission: 'uptimekuma.view' },
  { to: '/patchmon',    icon: PackageCheck, label: 'PatchMon',          moduleKey: 'patchmon',   permission: 'patchmon.view' },
  { to: '/alerts',      icon: Bell,         label: 'Benachrichtigungen' },
  { to: '/hetzner',     icon: Cloud,        label: 'Hetzner',           moduleKey: 'hetzner',    permission: 'hetzner.view' },
  { to: '/mchost',      icon: Gamepad2,     label: 'MC-Host24',         moduleKey: 'mchost',     permission: 'mchost.view'  },

  { section: 'Verwaltung' },
  { to: '/users',      icon: Users,         label: 'Benutzer',        adminOnly: true },
  { to: '/roles',      icon: ShieldCheck,   label: 'Rollen & Rechte', adminOnly: true },
  { to: '/audit',      icon: ClipboardList, label: 'Audit-Log',       permission: 'audit.view' },
  { to: '/panel-logs', icon: ScrollText,    label: 'Panel-Logs',      adminOnly: true },
  { to: '/settings',   icon: Settings,      label: 'Einstellungen' },
];

export const Sidebar = () => {
  const [collapsed, setCollapsed] = useState(false);
  const { user, isAdmin, hasPermission } = useAuth();
  const [version, setVersion] = useState(null);
  const [modules, setModules] = useState({});
  const [updateStatus, setUpdateStatus] = useState(null);
  const { errors, clearErrors } = useErrors();
  const [showPrideFlag, setShowPrideFlag] = useState(() => localStorage.getItem('show_pride_flag') !== 'false');

  useEffect(() => {
    const handleStorage = () => {
      setShowPrideFlag(localStorage.getItem('show_pride_flag') !== 'false');
    };
    window.addEventListener('storage', handleStorage);
    window.addEventListener('pride_flag_change', handleStorage);
    return () => {
      window.removeEventListener('storage', handleStorage);
      window.removeEventListener('pride_flag_change', handleStorage);
    };
  }, []);

  useEffect(() => {
    axios.get('/api/version').then(r => setVersion(r.data)).catch(() => {});
    axios.get('/api/settings/modules').then(r => setModules(r.data)).catch(() => {});
    axios.get('/api/update/status').then(r => setUpdateStatus(r.data)).catch(() => {});
  }, []);

  return (
    <aside className={`flex flex-col bg-panel-surface border-r border-panel-border transition-all duration-200 flex-shrink-0 ${collapsed ? 'w-14' : 'w-56'}`}>

      {/* ── Kopfzeile ────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-3 py-4 border-b border-panel-border min-h-[57px]">
        {!collapsed && (
          <div className="flex items-center gap-2 min-w-0">
            <Server size={15} className="text-panel-accent flex-shrink-0" />
            <span className="text-xs font-bold text-panel-text truncate tracking-wide">Überwachungs-Panel</span>
          </div>
        )}
        <button
          onClick={() => setCollapsed(c => !c)}
          className="ml-auto text-panel-muted hover:text-panel-text transition-colors p-1 rounded hover:bg-panel-card"
        >
          {collapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
        </button>
      </div>

      {/* ── Navigation ───────────────────────────────────────────────────── */}
      <nav className="flex-1 py-1 overflow-y-auto">
        {navItems.map((item, i) => {
          if (item.section) {
            if (collapsed) return null;
            return <span key={i} className="section-label">{item.section}</span>;
          }
          if (item.adminOnly && !isAdmin) return null;
          if (item.permission && !(Array.isArray(item.permission) ? item.permission.some(hasPermission) : hasPermission(item.permission))) return null;
          if (item.moduleKey && modules[item.moduleKey] === false) return null;
          return (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              title={collapsed ? item.label : undefined}
              className={({ isActive }) =>
                `flex items-center gap-2.5 py-2 mx-1 my-0.5 rounded-md text-xs font-medium transition-all duration-150 border-l-2 ${
                  isActive
                    ? 'bg-panel-accent/10 text-panel-accent border-panel-accent px-2.5'
                    : 'text-panel-muted hover:text-panel-text hover:bg-panel-card border-transparent px-2.5'
                }`
              }
            >
              <item.icon size={15} className="flex-shrink-0" />
              {!collapsed && <span className="truncate">{item.label}</span>}
            </NavLink>
          );
        })}
      </nav>

      {/* ── Panel-Fehler ─────────────────────────────────────────────────── */}
      {errors.length > 0 && !collapsed && (
        <div className="flex items-center justify-between px-3 py-2 border-t border-panel-border/60">
          <div className="flex items-center gap-1.5">
            <AlertCircle size={11} className="text-panel-red flex-shrink-0" />
            <span className="text-[11px] font-medium text-panel-red">Panel-Fehler</span>
            <span className="text-[9px] bg-panel-red/20 text-panel-red rounded-full px-1.5 leading-[1.6] tabular-nums">
              {errors.length}
            </span>
          </div>
          <button onClick={clearErrors} title="Alle löschen"
            className="text-panel-muted hover:text-panel-red transition-colors p-0.5 rounded">
            <Trash2 size={10} />
          </button>
        </div>
      )}

      {errors.length > 0 && collapsed && (
        <div className="flex justify-center py-2 border-t border-panel-border/60">
          <span title={`${errors.length} Panel-Fehler`}
            className="relative inline-flex items-center justify-center w-6 h-6 rounded-full bg-panel-red/15">
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
      <div
        className={`px-3 py-3 border-t border-panel-border relative transition-all duration-300 overflow-hidden ${
          showPrideFlag ? 'text-white shadow-inner' : ''
        }`}
        style={
          showPrideFlag
            ? {
                background:
                  'linear-gradient(rgba(0, 0, 0, 0.18), rgba(0, 0, 0, 0.18)), linear-gradient(135deg, #E40303 0%, #FF8C00 14%, #FFED00 28%, #008026 42%, #004DFF 56%, #750787 70%, #5BCEFA 85%, #F5A9B8 100%)',
                textShadow: '0 1px 3px rgba(0, 0, 0, 0.95), 0 1px 2px rgba(0, 0, 0, 0.85)',
              }
            : {}
        }
      >
        {!collapsed && user && (
          <div className={`flex items-center justify-between text-xs ${showPrideFlag ? 'text-white' : 'text-panel-muted'}`}>
            <div className="truncate">
              <span className={`font-medium ${showPrideFlag ? 'text-white font-bold' : 'text-panel-text'}`}>
                {user.username}
              </span>
              <span className="ml-1 opacity-80">({user.roleLabel || user.role})</span>
            </div>
          </div>
        )}
        {version && (
          <div
            className={`mt-1 flex items-center justify-between text-[10px] ${
              showPrideFlag ? 'text-white/90 font-medium' : 'text-panel-muted/50'
            } ${collapsed ? 'justify-center' : ''}`}
            title={`Build ${version.build} · ${version.date}`}
          >
            <span>
              {collapsed
                ? `v${version.version}`
                : `v${version.version} · Build ${version.build}`}
            </span>
          </div>
        )}
        {updateStatus?.panel?.available && !collapsed && (
          <button
            type="button"
            onClick={async () => {
              if (!confirm(`Möchtest du das Panel jetzt automatisch auf v${updateStatus.panel.remoteVersion} aktualisieren und neu starten?`)) return;
              try {
                const { data } = await axios.post('/api/update/run');
                localStorage.setItem('panel_update_result', JSON.stringify({
                  timestamp: Date.now(),
                  oldVersion: data.oldVersion,
                  newVersion: data.newVersion,
                  log: data.log
                }));
                window.location.reload();
              } catch (err) {
                alert('Update fehlgeschlagen: ' + (err.response?.data?.error || 'Fehler'));
              }
            }}
            className="mt-1.5 flex items-center gap-1 text-[11px] text-yellow-400 hover:text-yellow-300 font-medium transition-colors cursor-pointer text-left w-full"
            title="Klicken, um das Panel automatisch zu aktualisieren und neu zu starten"
          >
            <span>⚡ Update v{updateStatus.panel.remoteVersion} jetzt installieren</span>
          </button>
        )}
        {updateStatus?.agent?.available && !collapsed && (
          <div className="mt-1 flex items-center gap-1 text-[11px] text-yellow-400 font-medium" title="Agent-Update auf GitHub verfügbar">
            <span>⚡ Agent v{updateStatus.agent.remoteVersion} verfügbar</span>
          </div>
        )}
      </div>
    </aside>
  );
};
