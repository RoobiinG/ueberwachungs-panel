import { useEffect, useState } from 'react';
import axios from 'axios';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { RefreshCw, Play, Square, RotateCcw, PowerOff, HardDrive, Ticket, Globe, User } from 'lucide-react';

const statusColor = (s) => {
  if (!s) return 'gray';
  const str = (typeof s === 'object' ? s.status || s.state || '' : s).toLowerCase();
  if (str.includes('running') || str.includes('online') || str === 'on') return 'green';
  if (str.includes('stop') || str.includes('off') || str === 'offline') return 'red';
  return 'orange';
};

const statusLabel = (s) => {
  if (!s) return '—';
  return typeof s === 'object' ? s.status || s.state || JSON.stringify(s) : s;
};

const ServerRow = ({ name, status, onStart, onStop, onRestart, onShutdown, extra }) => (
  <div className="flex items-center justify-between px-4 py-3">
    <div className="flex-1 min-w-0 mr-3">
      <div className="flex items-center gap-2">
        <Badge color={statusColor(status)}>{statusLabel(status)}</Badge>
        <span className="text-sm text-panel-text font-medium truncate">{name}</span>
      </div>
      {extra && <div className="text-xs text-panel-muted mt-0.5">{extra}</div>}
    </div>
    <div className="flex items-center gap-1">
      {onStart && <Button size="sm" variant="success" onClick={onStart}><Play size={12} /></Button>}
      {onStop && <Button size="sm" variant="danger" onClick={onStop}><Square size={12} /></Button>}
      {onShutdown && <Button size="sm" variant="warning" onClick={onShutdown}><PowerOff size={12} /></Button>}
      {onRestart && <Button size="sm" variant="ghost" onClick={onRestart}><RotateCcw size={12} /></Button>}
    </div>
  </div>
);

export default function MCHost() {
  const [data, setData] = useState({ minecraft: [], vserver: [], teamspeak: [], domains: [], tickets: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('minecraft');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const [mc, vs, ts, dom, tick] = await Promise.allSettled([
        axios.get('/api/mchost/minecraft'),
        axios.get('/api/mchost/vserver'),
        axios.get('/api/mchost/teamspeak'),
        axios.get('/api/mchost/domains'),
        axios.get('/api/mchost/tickets'),
      ]);
      setData({
        minecraft: mc.status === 'fulfilled' ? (Array.isArray(mc.value.data) ? mc.value.data : []) : [],
        vserver:   vs.status === 'fulfilled' ? (Array.isArray(vs.value.data) ? vs.value.data : []) : [],
        teamspeak: ts.status === 'fulfilled' ? (Array.isArray(ts.value.data) ? ts.value.data : []) : [],
        domains:   dom.status === 'fulfilled' ? (Array.isArray(dom.value.data) ? dom.value.data : []) : [],
        tickets:   tick.status === 'fulfilled' ? (Array.isArray(tick.value.data) ? tick.value.data : []) : [],
      });
      if (mc.status === 'rejected') setError(mc.reason?.response?.data?.error || 'MCHOST_API_TOKEN nicht konfiguriert');
    } catch {}
    setLoading(false);
  };

  const act = async (type, id, action) => {
    try { await axios.post(`/api/mchost/${type}/${id}/${action}`); setTimeout(load, 1500); } catch {}
  };

  useEffect(() => { load(); }, []);

  const tabs = [
    { id: 'minecraft', label: `Minecraft (${data.minecraft.length})` },
    { id: 'vserver',   label: `VServer (${data.vserver.length})` },
    { id: 'teamspeak', label: `Teamspeak (${data.teamspeak.length})` },
    { id: 'domains',   label: `Domains (${data.domains.length})` },
    { id: 'tickets',   label: `Tickets (${data.tickets.length})` },
  ];

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

      {/* Tabs */}
      <div className="flex gap-1 bg-panel-surface rounded-lg p-1 border border-panel-border">
        {tabs.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex-1 text-xs py-1.5 px-2 rounded-md font-medium transition-colors ${
              tab === t.id ? 'bg-panel-card text-panel-text' : 'text-panel-muted hover:text-panel-text'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {loading ? (
        <Card><div className="text-panel-muted text-sm py-4 text-center">Lade...</div></Card>
      ) : (
        <>
          {/* Minecraft */}
          {tab === 'minecraft' && (
            <Card title="Minecraft Server">
              {data.minecraft.length === 0 ? (
                <div className="text-panel-muted text-sm py-4 text-center">Keine Minecraft-Server gefunden</div>
              ) : (
                <div className="divide-y divide-panel-border -mx-4 -mb-4">
                  {data.minecraft.map(s => (
                    <ServerRow
                      key={s.id}
                      name={s.name || s.hostname || `Server ${s.id}`}
                      status={s.status || s.state}
                      extra={[s.version, s.ip && `${s.ip}:${s.port}`].filter(Boolean).join(' · ')}
                      onStart={() => act('minecraft', s.id, 'start')}
                      onStop={() => act('minecraft', s.id, 'stop')}
                      onRestart={() => act('minecraft', s.id, 'restart')}
                    />
                  ))}
                </div>
              )}
            </Card>
          )}

          {/* VServer */}
          {tab === 'vserver' && (
            <Card title="VServer / Rootserver">
              {data.vserver.length === 0 ? (
                <div className="text-panel-muted text-sm py-4 text-center">Keine VServer gefunden</div>
              ) : (
                <div className="divide-y divide-panel-border -mx-4 -mb-4">
                  {data.vserver.map(s => (
                    <ServerRow
                      key={s.id}
                      name={s.name || s.hostname || `VServer ${s.id}`}
                      status={s.status || s.state}
                      extra={[s.ip, s.os].filter(Boolean).join(' · ')}
                      onStart={() => act('vserver', s.id, 'start')}
                      onStop={() => act('vserver', s.id, 'stop')}
                      onShutdown={() => act('vserver', s.id, 'shutdown')}
                      onRestart={() => act('vserver', s.id, 'restart')}
                    />
                  ))}
                </div>
              )}
            </Card>
          )}

          {/* Teamspeak */}
          {tab === 'teamspeak' && (
            <Card title="Teamspeak Server">
              {data.teamspeak.length === 0 ? (
                <div className="text-panel-muted text-sm py-4 text-center">Keine Teamspeak-Server gefunden</div>
              ) : (
                <div className="divide-y divide-panel-border -mx-4 -mb-4">
                  {data.teamspeak.map(s => (
                    <ServerRow
                      key={s.id}
                      name={s.name || s.hostname || `TS3 ${s.id}`}
                      status={s.status || s.state}
                      extra={s.ip && `${s.ip}:${s.port || 9987}`}
                      onStart={() => act('teamspeak', s.id, 'start')}
                      onStop={() => act('teamspeak', s.id, 'stop')}
                      onRestart={() => act('teamspeak', s.id, 'restart')}
                    />
                  ))}
                </div>
              )}
            </Card>
          )}

          {/* Domains */}
          {tab === 'domains' && (
            <Card title="Domains">
              {data.domains.length === 0 ? (
                <div className="text-panel-muted text-sm py-4 text-center">Keine Domains gefunden</div>
              ) : (
                <div className="divide-y divide-panel-border -mx-4 -mb-4">
                  {data.domains.map(d => (
                    <div key={d.id} className="flex items-center justify-between px-4 py-3">
                      <div className="flex items-center gap-2">
                        <Globe size={14} className="text-panel-muted flex-shrink-0" />
                        <div>
                          <div className="text-sm text-panel-text">{d.domain || d.name}</div>
                          {d.expires && <div className="text-xs text-panel-muted">Läuft ab: {d.expires}</div>}
                        </div>
                      </div>
                      {d.status && <Badge color={statusColor(d.status)}>{d.status}</Badge>}
                    </div>
                  ))}
                </div>
              )}
            </Card>
          )}

          {/* Tickets */}
          {tab === 'tickets' && (
            <Card title="Support Tickets">
              {data.tickets.length === 0 ? (
                <div className="text-panel-muted text-sm py-4 text-center">Keine Tickets vorhanden</div>
              ) : (
                <div className="divide-y divide-panel-border -mx-4 -mb-4">
                  {data.tickets.map(t => (
                    <div key={t.id} className="px-4 py-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="text-sm text-panel-text font-medium truncate">{t.betr || t.subject || `Ticket #${t.id}`}</div>
                          <div className="text-xs text-panel-muted mt-0.5">{t.date || t.created_at}</div>
                        </div>
                        <Badge color={t.status === 'open' ? 'green' : t.status === 'closed' ? 'red' : 'orange'}>
                          {t.status}
                        </Badge>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          )}
        </>
      )}
    </div>
  );
}
