import { useEffect, useState } from 'react';
import axios from 'axios';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { RefreshCw, Power, PowerOff, RotateCcw } from 'lucide-react';

const statusColor = (s) => s === 'running' ? 'green' : s === 'off' ? 'red' : 'orange';

export default function Hetzner() {
  const [servers, setServers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const { data } = await axios.get('/api/hetzner/servers');
      setServers(data.servers || []);
    } catch (err) {
      setError(err.response?.data?.error || 'HETZNER_API_TOKEN nicht konfiguriert');
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const act = async (id, action) => {
    try { await axios.post(`/api/hetzner/servers/${id}/${action}`); setTimeout(load, 2000); } catch {}
  };

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button variant="ghost" size="sm" onClick={load}><RefreshCw size={14} className="mr-1" />Aktualisieren</Button>
      </div>

      {error && (
        <div className="bg-panel-orange/10 border border-panel-orange/30 text-panel-orange text-sm rounded-md px-3 py-2">
          {error} — Bitte <code className="bg-panel-surface px-1 rounded font-mono">HETZNER_API_TOKEN</code> in der <code className="bg-panel-surface px-1 rounded font-mono">.env</code> setzen.
        </div>
      )}

      <Card title={`Hetzner Cloud Server (${servers.length})`}>
        {loading ? (
          <div className="text-panel-muted text-sm py-4 text-center">Lade...</div>
        ) : servers.length === 0 && !error ? (
          <div className="text-panel-muted text-sm py-4 text-center">Keine Server vorhanden</div>
        ) : (
          <div className="divide-y divide-panel-border -mx-4 -mb-4">
            {servers.map(s => (
              <div key={s.id} className="flex items-center justify-between px-4 py-3">
                <div>
                  <div className="flex items-center gap-2">
                    <Badge color={statusColor(s.status)}>{s.status}</Badge>
                    <span className="text-sm text-panel-text font-medium">{s.name}</span>
                  </div>
                  <div className="text-xs text-panel-muted mt-0.5">
                    {s.server_type?.name} · {s.datacenter?.location?.name} · {s.public_net?.ipv4?.ip}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  {s.status === 'off'
                    ? <Button size="sm" variant="success" onClick={() => act(s.id, 'poweron')}><Power size={12} /></Button>
                    : <Button size="sm" variant="danger" onClick={() => act(s.id, 'poweroff')}><PowerOff size={12} /></Button>
                  }
                  <Button size="sm" variant="ghost" onClick={() => act(s.id, 'reboot')}><RotateCcw size={12} /></Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
