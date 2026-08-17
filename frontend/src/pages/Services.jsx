import { useEffect, useState } from 'react';
import axios from 'axios';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { ServerSelector } from '../components/ui/ServerSelector';
import { RefreshCw, Play, Square, RotateCcw } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

export default function Services() {
  const { canWrite, hideLocal } = useAuth();

  const [selectedServer, setSelectedServer] = useState(null); // null = lokal
  const [services, setServices] = useState([]);
  const [loading, setLoading]   = useState(true);
  const [filter,   setFilter]   = useState('');
  const [actError, setActError] = useState('');
  const [actBusy,  setActBusy]  = useState({});

  const load = async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const url = selectedServer
        ? `/api/agents/${selectedServer}/services`
        : '/api/services';
      const { data } = await axios.get(url);
      setServices(data);
    } catch {
      if (!silent) setServices([]);
    }
    if (!silent) setLoading(false);
  };

  useEffect(() => {
    // Warte auf Auto-Select wenn lokaler Zugriff ausgeblendet ist
    if (hideLocal && selectedServer === null) return;
    setServices([]);
    setActError('');
    load();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedServer, hideLocal]);

  const act = async (name, action) => {
    setActError('');
    setActBusy(b => ({ ...b, [name]: action }));
    try {
      const url = selectedServer
        ? `/api/agents/${selectedServer}/services/${encodeURIComponent(name)}/${action}`
        : `/api/services/${encodeURIComponent(name)}/${action}`;
      await axios.post(url);
      await load(true);
    } catch (err) {
      setActError(err.response?.data?.error || `Aktion "${action}" fehlgeschlagen`);
    }
    setActBusy(b => ({ ...b, [name]: null }));
  };

  const filtered = services.filter(s => s.name?.toLowerCase().includes(filter.toLowerCase()));

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <ServerSelector selected={selectedServer} onChange={setSelectedServer} />
        <div className="flex gap-2 ml-auto">
          <input
            type="text"
            placeholder="Service suchen..."
            value={filter}
            onChange={e => setFilter(e.target.value)}
            className="bg-panel-surface border border-panel-border rounded-md px-3 py-1.5 text-sm text-panel-text focus:outline-none focus:border-panel-accent"
          />
          <Button variant="ghost" size="sm" onClick={load}><RefreshCw size={14} className="mr-1" />Aktualisieren</Button>
        </div>
      </div>

      {actError && (
        <div className="bg-panel-red/10 border border-panel-red/30 text-panel-red text-xs rounded-md px-3 py-2">
          {actError}
        </div>
      )}

      <Card title={`Systemd Services (${filtered.length})`}>
        {loading ? (
          <div className="text-panel-muted text-sm py-6 text-center">Lade…</div>
        ) : filtered.length === 0 ? (
          <div className="text-panel-muted text-sm py-6 text-center">Keine Services gefunden</div>
        ) : (
          <div className="-mx-4 -mb-4">
            {filtered.map(s => {
              const isActive = s.active === 'active';
              const isFailed = s.active === 'failed';
              const statusColor = isActive ? 'text-panel-green' : isFailed ? 'text-panel-red' : 'text-panel-orange';
              const dotColor    = isActive ? 'bg-panel-green' : isFailed ? 'bg-panel-red' : 'bg-panel-orange';
              return (
                <div key={s.name}
                  className="grid grid-cols-[1rem_1fr_auto] items-center gap-x-2 px-4 py-2 list-row">

                  {/* Status-Dot */}
                  <span className={`w-1.5 h-1.5 rounded-full justify-self-center flex-shrink-0 ${dotColor}`} />

                  {/* Name + Description */}
                  <div className="min-w-0">
                    <div className="flex items-baseline gap-2 min-w-0">
                      <span className="text-xs font-medium text-panel-text truncate">{s.name}</span>
                      {s.description && (
                        <span className="text-[11px] text-panel-muted truncate hidden sm:block">{s.description}</span>
                      )}
                    </div>
                  </div>

                  {/* Status + Aktionen */}
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <span className={`text-[10px] font-semibold tabular-nums ${statusColor}`}>
                      {s.active}
                    </span>
                    {canWrite && (
                      <>
                        {!isActive
                          ? <Button size="sm" variant="success" onClick={() => act(s.name, 'start')} disabled={!!actBusy[s.name]}>
                              <Play size={11} />Start
                            </Button>
                          : <Button size="sm" variant="danger" onClick={() => act(s.name, 'stop')} disabled={!!actBusy[s.name]}>
                              <Square size={11} />Stopp
                            </Button>
                        }
                        <Button size="sm" variant="ghost" onClick={() => act(s.name, 'restart')} disabled={!!actBusy[s.name]}>
                          <RotateCcw size={11} />Neustart
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}
