import { useState } from 'react';
import { NavLink } from 'react-router-dom';
import { LayoutDashboard, ServerCog, Container, BarChart2, Menu, X } from 'lucide-react';
import { navItems } from './Sidebar';
import { useAuth } from '../../context/AuthContext';

// Primäre Punkte für die untere Tab-Leiste (ungegated Kernseiten)
const PRIMARY = [
  { to: '/',           icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/agents',     icon: ServerCog,       label: 'Server' },
  { to: '/docker',     icon: Container,       label: 'Docker' },
  { to: '/monitoring', icon: BarChart2,       label: 'Monitoring' },
];

const visible = (item, isAdmin, hasPermission) => {
  if (item.section || !item.to) return false;
  if (item.adminOnly && !isAdmin) return false;
  // Ein Array bedeutet "eines dieser Rechte genügt" — genau wie in der Sidebar.
  // Vorher wurde das Array direkt an hasPermission() gereicht, was wegen des
  // includes()-Vergleichs immer false ergab: Solche Punkte fehlten im Menü komplett.
  if (item.permission) {
    const ok = Array.isArray(item.permission)
      ? item.permission.some(hasPermission)
      : hasPermission(item.permission);
    if (!ok) return false;
  }
  return true;
};

export function MobileNav() {
  const [open, setOpen] = useState(false);
  const { isAdmin, hasPermission } = useAuth();

  const tabCls = ({ isActive }) =>
    `flex-1 flex flex-col items-center justify-center gap-0.5 py-1.5 text-[10px] transition-colors ${
      isActive ? 'text-panel-accent' : 'text-panel-muted'
    }`;

  return (
    <>
      {/* Drawer mit vollem Menü */}
      {open && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-0 bottom-0 w-64 bg-panel-surface border-r border-panel-border overflow-y-auto">
            <div className="flex items-center justify-between px-4 py-3 border-b border-panel-border">
              <span className="text-xs font-bold text-panel-text tracking-wide">Überwachungs-Panel</span>
              <button onClick={() => setOpen(false)} className="text-panel-muted hover:text-panel-text"><X size={16} /></button>
            </div>
            <nav className="py-1">
              {navItems.map((item, i) => {
                if (item.section) return <span key={i} className="section-label">{item.section}</span>;
                if (!visible(item, isAdmin, hasPermission)) return null;
                return (
                  <NavLink key={item.to} to={item.to} end={item.to === '/'} onClick={() => setOpen(false)}
                    className={({ isActive }) => `flex items-center gap-2.5 px-4 py-2.5 text-sm border-l-2 ${
                      isActive ? 'text-panel-accent bg-panel-accent/10 border-panel-accent'
                               : 'text-panel-muted border-transparent hover:text-panel-text'
                    }`}>
                    <item.icon size={16} className="flex-shrink-0" />{item.label}
                  </NavLink>
                );
              })}
            </nav>
          </div>
        </div>
      )}

      {/* Untere Tab-Leiste */}
      <nav className="fixed bottom-0 inset-x-0 z-40 md:hidden flex bg-panel-surface border-t border-panel-border">
        {PRIMARY.map(p => (
          <NavLink key={p.to} to={p.to} end={p.to === '/'} className={tabCls}>
            <p.icon size={18} />{p.label}
          </NavLink>
        ))}
        <button onClick={() => setOpen(true)}
          className="flex-1 flex flex-col items-center justify-center gap-0.5 py-1.5 text-[10px] text-panel-muted">
          <Menu size={18} />Mehr
        </button>
      </nav>
    </>
  );
}
