import { useEffect, useState } from 'react';
import axios from 'axios';
import { Card } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { ServerSelector } from '../components/ui/ServerSelector';
import { RefreshCw, Play, Square, RotateCcw } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

const activeColor = (s) => s === 'active' ? 'green' : s === 'activating' ? 'orange' : 'red';

export default function Services() {
  const { canWrite } = useAuth();

  const [selectedServer, setSelectedServer] = useState(null); // null = lokal
  const [services, setServices] = useState([]);
  const [loading, setLoading]   = useState(true);
  const [filter,   setFilter]   = useState('');
  const [actError, setActError] = useState('');
  const [actBusy,  setActBusy]  = useState({});

  const load = async () => {
    setLoading(true);
    try {
      const url = selectedServer
        ? `/api/agents/${selectedServer}/services`
        : '/api/services';
      const { data } = await axios.get(url);
      setServices(data);
    } catch {
      setServices([]);
    }
    setLoading(false);
  };

  useEffect(() => {
    setServices([]);
    setActError('');
    load();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedServer]);

  const act = async (name, action) => {
    setActError('');
    setActBusy(b => ({ ...b, [name]: action }));
    try {
      const url = selectedServer
        ? `/api/agents/${selectedServer}/services/${encodeURIComponent(name)}/${action}`
        : `/api/services/${encodeURIComponent(name)}/${action}`;
      await axios.post(url);
      await load();
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
          <div className="text-panel-muted text-sm py-4 text-center">Lade...</div>
        ) : (
          <div className="divide-y divide-panel-border -mx-4 -mb-4">
            {filtered.map(s => (
              <div key={s.name} className="flex items-center justify-between px-4 py-2.5">
                <div className="flex-1 min-w-0 mr-3">
                  <div className="flex items-center gap-2">
                    <Badge color={activeColor(s.active)}>{s.active}</Badge>
                    <span className="text-sm text-panel-text truncate">{s.name}</span>
                  </div>
                  {s.description && <div className="text-xs text-panel-muted mt-0.5 truncate">{s.description}</div>}
                </div>
                {canWrite && (
                  <div className="flex items-center gap-1">
                    {s.active !== 'active'
                      ? <Button size="sm" variant="success" onClick={() => act(s.name, 'start')}
                          disabled={!!actBusy[s.name]}><Play size={11} /></Button>
                      : <Button size="sm" variant="danger"  onClick={() => act(s.name, 'stop')}
                          disabled={!!actBusy[s.name]}><Square size={11} /></Button>
                    }
                    <Button size="sm" variant="ghost" onClick={() => act(s.name, 'restart')}
                      disabled={!!actBusy[s.name]}><RotateCcw size={11} /></Button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
