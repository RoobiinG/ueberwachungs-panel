import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { ServerCog, Plus, Trash2, Wifi, WifiOff, Eye, EyeOff, ChevronRight, Terminal } from 'lucide-react';

const inputCls = 'w-full bg-panel-surface border border-panel-border rounded-md px-3 py-2 text-sm text-panel-text focus:outline-none focus:border-panel-accent transition-colors';

export default function Agents() {
  const [agents, setAgents] = useState([]);
  const [status, setStatus] = useState({});
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [token, setToken] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  const load = useCallback(async () => {
    const { data } = await axios.get('/api/agents');
    setAgents(data);
    data.forEach(a => pingAgent(a.id));
  }, []);

  useEffect(() => { load(); }, [load]);

  const pingAgent = async (id) => {
    try {
      const { data } = await axios.get(`/api/agents/${id}/ping`);
      setStatus(s => ({ ...s, [id]: data }));
    } catch {
      setStatus(s => ({ ...s, [id]: { online: false } }));
    }
  };

  const addAgent = async () => {
    if (!name.trim() || !url.trim()) return setError('Name und URL erforderlich');
    setLoading(true);
    setError('');
    try {
      await axios.post('/api/agents', { name: name.trim(), url: url.trim(), token: token.trim() });
      setName(''); setUrl(''); setToken(''); setShowForm(false);
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Fehler beim Hinzufügen');
    }
    setLoading(false);
  };

  const remove = async (id, agentName) => {
    if (!confirm(`"${agentName}" wirklich entfernen?`)) return;
    await axios.delete(`/api/agents/${id}`);
    load();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-panel-text">Remote Server ({agents.length})</h2>
        <Button size="sm" onClick={() => setShowForm(v => !v)}>
          <Plus size={13} className="mr-1" />{showForm ? 'Abbrechen' : 'Server hinzufügen'}
        </Button>
      </div>

      {showForm && (
        <Card title="Neuen Server hinzufügen">
          <div className="space-y-3">
            <div>
              <label className="block text-xs text-panel-muted mb-1">Name</label>
              <input className={inputCls} value={name} onChange={e => setName(e.target.value)}
                placeholder="Mein Server" onKeyDown={e => e.key === 'Enter' && addAgent()} />
            </div>
            <div>
              <label className="block text-xs text-panel-muted mb-1">Agent URL</label>
              <input className={inputCls} value={url} onChange={e => setUrl(e.target.value)}
                placeholder="http://192.168.1.100:7331" onKeyDown={e => e.key === 'Enter' && addAgent()} />
            </div>
            <div>
              <label className="block text-xs text-panel-muted mb-1">Token (aus install.sh)</label>
              <div className="relative">
                <input className={inputCls + ' pr-9'} type={showToken ? 'text' : 'password'}
                  value={token} onChange={e => setToken(e.target.value)}
                  placeholder="optional, aber empfohlen" onKeyDown={e => e.key === 'Enter' && addAgent()} />
                <button type="button" onClick={() => setShowToken(v => !v)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-panel-muted hover:text-panel-text">
                  {showToken ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
            </div>
            {error && <p className="text-xs text-panel-red">{error}</p>}
            <Button size="sm" onClick={addAgent} disabled={loading}>
              {loading ? 'Wird hinzugefügt...' : 'Hinzufügen'}
            </Button>
          </div>
        </Card>
      )}

      {/* Install-Anleitung */}
      <Card title={<span className="flex items-center gap-2"><Terminal size={14} />Agent installieren</span>}>
        <p className="text-xs text-panel-muted mb-2">
          Diesen Befehl auf dem Remote-Server als root ausführen:
        </p>
        <pre className="bg-panel-surface rounded-md px-3 py-2 text-xs text-panel-green font-mono select-all">
          curl -sL https://raw.githubusercontent.com/RoobiinG/ueberwachungs-panel/master/agent/install.sh | bash
        </pre>
        <p className="text-xs text-panel-muted mt-2">
          Das Skript installiert den Agent als systemd-Service und gibt URL + Token aus.
        </p>
      </Card>

      {/* Server-Liste */}
      {agents.length === 0 && !showForm && (
        <div className="text-center py-12 text-panel-muted text-sm">
          <ServerCog size={32} className="mx-auto mb-3 opacity-40" />
          <p>Noch keine Remote-Server konfiguriert</p>
          <p className="text-xs mt-1">Installiere den Agent auf deinen Servern und füge sie hier hinzu</p>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        {agents.map(agent => {
          const s = status[agent.id];
          const online = s?.online;
          return (
            <div key={agent.id}
              className="bg-panel-card border border-panel-border rounded-lg p-4 flex flex-col gap-3 hover:border-panel-accent/40 transition-colors">
              <div className="flex items-start justify-between">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    {online === undefined
                      ? <span className="w-2 h-2 rounded-full bg-panel-muted animate-pulse flex-shrink-0" />
                      : online
                      ? <Wifi size={14} className="text-panel-green flex-shrink-0" />
                      : <WifiOff size={14} className="text-panel-red flex-shrink-0" />
                    }
                    <span className="text-sm font-medium text-panel-text truncate">{agent.name}</span>
                  </div>
                  <p className="text-xs text-panel-muted mt-0.5 truncate">{agent.url}</p>
                  {s?.hostname && <p className="text-xs text-panel-muted">{s.hostname}</p>}
                </div>
                <button onClick={() => remove(agent.id, agent.name)}
                  className="text-panel-muted hover:text-panel-red transition-colors ml-2 flex-shrink-0">
                  <Trash2 size={14} />
                </button>
              </div>
              <Button size="sm" variant={online ? 'default' : 'ghost'}
                disabled={!online} onClick={() => navigate(`/agents/${agent.id}`)}>
                Details anzeigen <ChevronRight size={13} className="ml-1" />
              </Button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
