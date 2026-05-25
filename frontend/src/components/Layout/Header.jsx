import { LogOut, Wifi, WifiOff } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useLocation } from 'react-router-dom';

const pageTitles = {
  '/': 'Dashboard',
  '/docker': 'Docker Container',
  '/services': 'Services',
  '/firewall': 'Firewall & Ports',
  '/network': 'Netzwerk',
  '/ssh': 'SSH / SFTP',
  '/webhooks': 'Webhooks',
  '/hetzner': 'Hetzner Cloud',
  '/mchost': 'MC-Host24',
  '/users': 'Benutzerverwaltung',
};

export const Header = ({ connected }) => {
  const { logout } = useAuth();
  const location = useLocation();
  const title = pageTitles[location.pathname] || 'Panel';

  return (
    <header className="flex items-center justify-between px-4 py-3 bg-panel-surface border-b border-panel-border flex-shrink-0">
      <h1 className="text-sm font-semibold text-panel-text">{title}</h1>
      <div className="flex items-center gap-4">
        <div className={`flex items-center gap-1.5 text-xs ${connected ? 'text-panel-green' : 'text-panel-red'}`}>
          {connected ? <Wifi size={13} /> : <WifiOff size={13} />}
          <span>{connected ? 'Live' : 'Getrennt'}</span>
        </div>
        <button
          onClick={logout}
          className="flex items-center gap-1.5 text-xs text-panel-muted hover:text-panel-text transition-colors"
        >
          <LogOut size={13} />
          Abmelden
        </button>
      </div>
    </header>
  );
};
