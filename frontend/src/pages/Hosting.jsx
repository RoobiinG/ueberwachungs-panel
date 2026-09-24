import { useState, useEffect } from 'react';
import Hetzner from './Hetzner';
import MCHost from './MCHost';
import DSH from './DSH';
import { Cloud, Gamepad2, Server, Shield } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

export default function Hosting() {
  const { hasPermission, isAdmin, modules = {} } = useAuth();

  const canHetzner = (isAdmin || hasPermission('hetzner.view')) && modules.hetzner !== false;
  const canMCHost  = (isAdmin || hasPermission('mchost.view'))  && modules.mchost !== false;
  const canDSH     = (isAdmin || hasPermission('dsh.view'))     && modules.dsh !== false;

  const defaultTab = canHetzner ? 'hetzner' : canMCHost ? 'mchost' : canDSH ? 'dsh' : 'hetzner';
  const [tab, setTab] = useState(defaultTab);

  useEffect(() => {
    if (tab === 'hetzner' && !canHetzner) {
      setTab(canMCHost ? 'mchost' : canDSH ? 'dsh' : 'hetzner');
    } else if (tab === 'mchost' && !canMCHost) {
      setTab(canHetzner ? 'hetzner' : canDSH ? 'dsh' : 'mchost');
    } else if (tab === 'dsh' && !canDSH) {
      setTab(canHetzner ? 'hetzner' : canMCHost ? 'mchost' : 'dsh');
    }
  }, [canHetzner, canMCHost, canDSH]);

  return (
    <div className="space-y-6">
      {/* ── Kopfzeile mit Tab-Auswahl ── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-panel-surface border border-panel-border rounded-xl p-4">
        <div>
          <h1 className="text-lg font-bold text-panel-text flex items-center gap-2">
            <Server size={18} className="text-panel-accent" />
            Cloud- & Hosting-Provider
          </h1>
          <p className="text-xs text-panel-muted mt-0.5">
            Verwaltung und Monitoring deiner externen Server und Cloud-Dienste (Hetzner, MC-Host24 & DeinServerHost)
          </p>
        </div>

        <div className="flex gap-1 bg-panel-card border border-panel-border rounded-lg p-1 overflow-x-auto">
          {canHetzner && (
            <button
              onClick={() => setTab('hetzner')}
              className={`flex items-center gap-2 px-3.5 py-1.5 rounded-md text-xs font-medium transition-all whitespace-nowrap ${
                tab === 'hetzner'
                  ? 'bg-panel-accent/15 text-panel-accent border border-panel-accent/30 font-semibold shadow-sm'
                  : 'text-panel-muted hover:text-panel-text'
              }`}
            >
              <Cloud size={14} />
              Hetzner Cloud
            </button>
          )}

          {canMCHost && (
            <button
              onClick={() => setTab('mchost')}
              className={`flex items-center gap-2 px-3.5 py-1.5 rounded-md text-xs font-medium transition-all whitespace-nowrap ${
                tab === 'mchost'
                  ? 'bg-panel-accent/15 text-panel-accent border border-panel-accent/30 font-semibold shadow-sm'
                  : 'text-panel-muted hover:text-panel-text'
              }`}
            >
              <Gamepad2 size={14} />
              MC-Host24
            </button>
          )}

          {canDSH && (
            <button
              onClick={() => setTab('dsh')}
              className={`flex items-center gap-2 px-3.5 py-1.5 rounded-md text-xs font-medium transition-all whitespace-nowrap ${
                tab === 'dsh'
                  ? 'bg-panel-accent/15 text-panel-accent border border-panel-accent/30 font-semibold shadow-sm'
                  : 'text-panel-muted hover:text-panel-text'
              }`}
            >
              <Shield size={14} />
              DeinServerHost
            </button>
          )}
        </div>
      </div>

      {/* ── Tab-Inhalt ── */}
      <div className="transition-all duration-200">
        {tab === 'hetzner' ? <Hetzner /> : tab === 'mchost' ? <MCHost /> : <DSH />}
      </div>
    </div>
  );
}
