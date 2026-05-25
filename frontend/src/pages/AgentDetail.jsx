import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import axios from 'axios';
import { Cpu, HardDrive, Server, MemoryStick, ArrowLeft, RefreshCw, Play, Square, RotateCcw } from 'lucide-react';
import { StatCard } from '../components/ui/StatCard';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';

const fmtBytes = (b, d = 1) => {
  if (!b) return '0 B';
  const k = 1024, sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(b) / Math.log(k));
  return `${parseFloat((b / Math.pow(k, i)).toFixed(d))} ${sizes[i]}`;
};
const fmtUptime = (s) => s ? `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m` : '—';

export default function AgentDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [stats, setStats] = useState(null);
  const [services, setServices] = useState([]);
  const [agentName, setAgentName] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [serviceFilter, setServiceFilter] = useState('');
  const [actionLoading, setActionLoading] = useState({});

  const loadStats = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    else setRefreshing(true);
    setError('');
    try {
      const [agentsRes, statsRes, servicesRes] = await Promise.all([
        axios.get('/api/agents'),
        axios.get(`/api/agents/${id}/stats`),
        axios.get(`/api/agents/${id}/services`),
      ]);
      const agent = agentsRes.data.find(a => String(a.id) === String(id));
      if (agent) setAgentName(agent.name);
      setStats(statsRes.data);
      setServices(servicesRes.data);
    } catch (err) {
      setError(err.response?.data?.error || 'Agent nicht erreichbar');
    }
    setLoading(false);
    setRefreshing(false);
  }, [id]);

  useEffect(() => { loadStats(); }, [loadStats]);

  const serviceAction = async (name, action) => {
    setActionLoading(l => ({ ...l, [name]: action }));
    try {
      await axios.post(`/api/agents/${id}/services/${encodeURIComponent(name)}/${action}`);
      setTimeout(() => loadStats(true), 1000);
    } catch (err) {
      alert(err.response?.data?.error || 'Fehler');
    }
    setActionLoading(l => ({ ...l, [name]: null }));
  };

  const filtered = services.filter(s =>
    !serviceFilter || s.name.toLowerCase().includes(serviceFilter.toLowerCase())
  );

  if (loading) return (
    <div className="flex items-center justify-center py-20 text-panel-muted text-sm">
      Verbinde mit Agent...
    </div>
  );

  if (error) return (
    <div className="space-y-4">
      <Button size="sm" variant="ghost" onClick={() => navigate('/agents')}>
        <ArrowLeft size={13} className="mr-1" />Zurück
      </Button>
      <div className="text-center py-16">
        <p className="text-panel-red text-sm">{error}</p>
        <Button size="sm" className="mt-4" onClick={() => loadStats()}>Erneut versuchen</Button>
      </div>
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button size="sm" variant="ghost" onClick={() => navigate('/agents')}>
            <ArrowLeft size={13} className="mr-1" />Zurück
          </Button>
          <h2 className="text-sm font-semibold text-panel-text">{agentName || `Server #${id}`}</h2>
        </div>
        <Button size="sm" variant="ghost" onClick={() => loadStats(true)} disabled={refreshing}>
          <RefreshCw size={13} className={`mr-1 ${refreshing ? 'animate-spin' : ''}`} />Aktualisieren
        </Button>
      </div>

      {stats && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <StatCard title="CPU" value={stats.cpu?.usage ?? 0} unit="%" icon={Cpu} color="blue"
              percent={stats.cpu?.usage ?? 0}
              subtitle={`${stats.cpu?.cores ?? 0} Kerne`} />
            <StatCard title="RAM" value={stats.memory?.usedPercent ?? 0} unit="%" icon={MemoryStick} color="green"
              percent={stats.memory?.usedPercent ?? 0}
              subtitle={`${fmtBytes(stats.memory?.used)} / ${fmtBytes(stats.memory?.total)}`} />
            {stats.disk?.[0] && (
              <StatCard title="Festplatte" value={Math.round(stats.disk[0].usedPercent ?? 0)} unit="%"
                icon={HardDrive} color="orange" percent={stats.disk[0].usedPercent ?? 0}
                subtitle={`${fmtBytes(stats.disk[0].used)} / ${fmtBytes(stats.disk[0].size)}`} />
            )}
            <StatCard title="System" value={stats.os?.distro?.split(' ')[0] ?? '—'} unit="" icon={Server} color="purple"
              subtitle={stats.os ? `${stats.os.hostname} · ${fmtUptime(stats.os.uptime)}` : ''} />
          </div>

          {stats.disk?.length > 0 && (
            <Card title="Festplatten">
              <div className="space-y-3">
                {stats.disk.map((d, i) => (
                  <div key={i}>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-panel-text">{d.mount} <span className="text-panel-muted">({d.fs})</span></span>
                      <span className="text-panel-muted">{fmtBytes(d.used)} / {fmtBytes(d.size)}</span>
                    </div>
                    <div className="h-1.5 bg-panel-surface rounded-full overflow-hidden">
                      <div className={`h-full rounded-full transition-all ${d.usedPercent > 80 ? 'bg-panel-red' : d.usedPercent > 60 ? 'bg-panel-orange' : 'bg-panel-accent'}`}
                        style={{ width: `${Math.min(d.usedPercent, 100)}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </>
      )}

      {services.length > 0 && (
        <Card title={`Systemd Services (${filtered.length})`}>
          <div className="mb-3">
            <input className="w-full bg-panel-surface border border-panel-border rounded-md px-3 py-1.5 text-xs text-panel-text focus:outline-none focus:border-panel-accent"
              placeholder="Service suchen..." value={serviceFilter}
              onChange={e => setServiceFilter(e.target.value)} />
          </div>
          <div className="space-y-1 max-h-96 overflow-y-auto">
            {filtered.map(svc => (
              <div key={svc.name}
                className="flex items-center justify-between gap-2 px-2 py-1.5 rounded hover:bg-panel-surface transition-colors">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <Badge variant={svc.active === 'active' ? 'green' : svc.active === 'failed' ? 'red' : 'gray'}>
                      {svc.active}
                    </Badge>
                    <span className="text-xs text-panel-text truncate font-mono">{svc.name}</span>
                  </div>
                </div>
                <div className="flex gap-1 flex-shrink-0">
                  {svc.active !== 'active' && (
                    <button title="Starten" disabled={!!actionLoading[svc.name]}
                      onClick={() => serviceAction(svc.name, 'start')}
                      className="p-1 text-panel-green hover:bg-panel-green/10 rounded transition-colors disabled:opacity-40">
                      <Play size={12} />
                    </button>
                  )}
                  {svc.active === 'active' && (
                    <button title="Stoppen" disabled={!!actionLoading[svc.name]}
                      onClick={() => serviceAction(svc.name, 'stop')}
                      className="p-1 text-panel-red hover:bg-panel-red/10 rounded transition-colors disabled:opacity-40">
                      <Square size={12} />
                    </button>
                  )}
                  <button title="Neustarten" disabled={!!actionLoading[svc.name]}
                    onClick={() => serviceAction(svc.name, 'restart')}
                    className="p-1 text-panel-muted hover:text-panel-text hover:bg-panel-surface rounded transition-colors disabled:opacity-40">
                    <RotateCcw size={12} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
