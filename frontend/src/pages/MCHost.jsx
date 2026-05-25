import { useEffect, useState } from 'react';
import axios from 'axios';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { RefreshCw, Play, Square, RotateCcw } from 'lucide-react';

export default function MCHost() {
  const [servers, setServers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const { data } = await axios.get('/api/mchost/servers');
      setServers(Array.isArray(data) ? data : []);
    } catch {
      setError('MCHOST_API_TOKEN nicht konfiguriert oder API nicht erreichbar');
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const act = async (id, action) => {
    try { await axios.post(`/api/mchost/servers/${id}/${action}`); setTimeout(load, 2000); } catch {}
  };

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button variant="ghost" size="sm" onClick={load}><RefreshCw size={14} className="mr-1" />Aktualisieren</Button>
      </div>

      {error && (
        <div className="bg-panel-orange/10 border border-panel-orange/30 text-panel-orange text-sm rounded-md px-3 py-2">
          {error} — Bitte <code className="bg-panel-surface px-1 rounded font-mono">MCHOST_API_TOKEN</code> in der <code className="bg-panel-surface px-1 rounded font-mono">.env</code> setzen.
        </div>
      )}

      <Card title={`MC-Host24 Server (${servers.length})`}>
        {loading ? (
          <div className="text-panel-muted text-sm py-4 text-center">Lade...</div>
        ) : servers.length === 0 && !error ? (
          <div className="text-panel-muted text-sm py-4 text-center">Keine Server gefunden</div>
        ) : (
          <div className="divide-y divide-panel-border -mx-4 -mb-4">
            {servers.map((s, i) => (
              <div key={s.id || i} className="flex items-center justify-between px-4 py-3">
                <div>
                  <div className="flex items-center gap-2">
                    {s.status && <Badge color={s.status === 'running' ? 'green' : 'red'}>{s.status}</Badge>}
                    <span className="text-sm text-panel-text font-medium">{s.name || s.id}</span>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <Button size="sm" variant="success" onClick={() => act(s.id, 'start')}><Play size={12} /></Button>
                  <Button size="sm" variant="danger" onClick={() => act(s.id, 'stop')}><Square size={12} /></Button>
                  <Button size="sm" variant="ghost" onClick={() => act(s.id, 'restart')}><RotateCcw size={12} /></Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
