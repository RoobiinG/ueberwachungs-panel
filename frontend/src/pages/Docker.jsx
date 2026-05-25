import { useEffect, useState } from 'react';
import axios from 'axios';
import { Card } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { RefreshCw, Play, Square, RotateCcw } from 'lucide-react';

const statusColor = (s) => s?.includes('Up') ? 'green' : s?.includes('Exited') ? 'red' : 'gray';

export default function Docker() {
  const [containers, setContainers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState({});
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const { data } = await axios.get('/api/docker/containers');
      setContainers(data);
    } catch (err) {
      setError(err.response?.data?.error || 'Docker nicht erreichbar');
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const act = async (id, action) => {
    setBusy(b => ({ ...b, [id]: action }));
    try { await axios.post(`/api/docker/containers/${id}/${action}`); await load(); } catch {}
    setBusy(b => ({ ...b, [id]: null }));
  };

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button variant="ghost" size="sm" onClick={load}><RefreshCw size={14} className="mr-1" />Aktualisieren</Button>
      </div>

      {error && (
        <div className="bg-panel-orange/10 border border-panel-orange/30 text-panel-orange text-sm rounded-md px-3 py-2">
          {error}
        </div>
      )}

      <Card title={`Docker Container (${containers.length})`}>
        {loading ? (
          <div className="text-panel-muted text-sm py-4 text-center">Lade...</div>
        ) : containers.length === 0 ? (
          <div className="text-panel-muted text-sm py-4 text-center">Keine Container gefunden</div>
        ) : (
          <div className="divide-y divide-panel-border -mx-4 -mb-4">
            {containers.map(c => (
              <div key={c.Id} className="flex items-center justify-between px-4 py-3">
                <div className="flex-1 min-w-0 mr-3">
                  <div className="flex items-center gap-2">
                    <Badge color={statusColor(c.Status)}>{c.State}</Badge>
                    <span className="text-sm text-panel-text font-medium truncate">
                      {c.Names?.[0]?.replace('/', '') || c.Id.slice(0, 12)}
                    </span>
                  </div>
                  <div className="text-xs text-panel-muted mt-0.5 truncate">{c.Image}</div>
                </div>
                <div className="flex items-center gap-1">
                  {c.State !== 'running'
                    ? <Button size="sm" variant="success" onClick={() => act(c.Id, 'start')} disabled={!!busy[c.Id]}><Play size={12} /></Button>
                    : <Button size="sm" variant="danger" onClick={() => act(c.Id, 'stop')} disabled={!!busy[c.Id]}><Square size={12} /></Button>
                  }
                  <Button size="sm" variant="ghost" onClick={() => act(c.Id, 'restart')} disabled={!!busy[c.Id]}><RotateCcw size={12} /></Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
