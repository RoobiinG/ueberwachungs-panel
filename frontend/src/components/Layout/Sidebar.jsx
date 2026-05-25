import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard, Container, Wrench, Shield, Activity,
  Terminal, Webhook, Users, Cloud, Gamepad2, ChevronLeft, ChevronRight,
  Server, Settings, ServerCog, MonitorCheck, Bell,
} from 'lucide-react';
import { useState } from 'react';
import { useAuth } from '../../context/AuthContext';

const navItems = [
  { to: '/', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/docker', icon: Container, label: 'Docker' },
  { to: '/services', icon: Wrench, label: 'Services' },
  { to: '/firewall', icon: Shield, label: 'Firewall' },
  { to: '/network', icon: Activity, label: 'Netzwerk' },
  { to: '/ssh', icon: Terminal, label: 'SSH / SFTP' },
  { to: '/agents',      icon: ServerCog,    label: 'Server' },
  { to: '/uptime-kuma', icon: MonitorCheck, label: 'Uptime Kuma' },
  { to: '/alerts', icon: Bell, label: 'Benachrichtigungen' },
  { divider: true },
  { to: '/webhooks', icon: Webhook, label: 'Webhooks' },
  { to: '/hetzner', icon: Cloud, label: 'Hetzner' },
  { to: '/mchost', icon: Gamepad2, label: 'MC-Host24' },
  { divider: true },
  { to: '/users', icon: Users, label: 'Benutzer', adminOnly: true },
  { to: '/settings', icon: Settings, label: 'Einstellungen', adminOnly: true },
];

export const Sidebar = () => {
  const [collapsed, setCollapsed] = useState(false);
  const { user, isAdmin } = useAuth();

  return (
    <aside className={`flex flex-col bg-panel-surface border-r border-panel-border transition-all duration-200 flex-shrink-0 ${collapsed ? 'w-14' : 'w-56'}`}>
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

      <nav className="flex-1 py-2 overflow-y-auto">
        {navItems.map((item, i) => {
          if (item.divider) return <div key={i} className="my-1 mx-3 border-t border-panel-border" />;
          if (item.adminOnly && !isAdmin) return null;
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

      <div className="px-3 py-3 border-t border-panel-border">
        {!collapsed && user && (
          <div className="text-xs text-panel-muted truncate">
            <span className="text-panel-text">{user.username}</span>
            <span className="ml-1">({user.role})</span>
          </div>
        )}
      </div>
    </aside>
  );
};
