import { useState } from 'react';
import Hetzner from './Hetzner';
import MCHost from './MCHost';
import { Cloud, Gamepad2, Server } from 'lucide-react';

export default function Hosting() {
  const [tab, setTab] = useState('hetzner');

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
            Verwaltung und Monitoring deiner externen Server und Storage Boxes (Hetzner Cloud & MC-Host24)
          </p>
        </div>

        <div className="flex gap-1 bg-panel-card border border-panel-border rounded-lg p-1">
          <button
            onClick={() => setTab('hetzner')}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-md text-xs font-medium transition-all ${
              tab === 'hetzner'
                ? 'bg-panel-accent/15 text-panel-accent border border-panel-accent/30 font-semibold shadow-sm'
                : 'text-panel-muted hover:text-panel-text'
            }`}
          >
            <Cloud size={14} />
            Hetzner Cloud
          </button>
          <button
            onClick={() => setTab('mchost')}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-md text-xs font-medium transition-all ${
              tab === 'mchost'
                ? 'bg-panel-accent/15 text-panel-accent border border-panel-accent/30 font-semibold shadow-sm'
                : 'text-panel-muted hover:text-panel-text'
            }`}
          >
            <Gamepad2 size={14} />
            MC-Host24
          </button>
        </div>
      </div>

      {/* ── Tab-Inhalt ── */}
      <div className="transition-all duration-200">
        {tab === 'hetzner' ? <Hetzner /> : <MCHost />}
      </div>
    </div>
  );
}
