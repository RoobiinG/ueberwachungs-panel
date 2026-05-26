import { useEffect, useState, useRef } from 'react';
import axios from 'axios';
import { Card } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { ServerSelector } from '../components/ui/ServerSelector';
import { RefreshCw, Play, Square, RotateCcw, ChevronDown, ChevronUp } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import {
  LineChart, Line, AreaChart, Area,
  XAxis, YAxis, ResponsiveContainer, Tooltip, CartesianGrid,
} from 'recharts';

// Farbe anhand Status-String (lokal: "Up 2 hours" / "Exited…"; remote: "running" / "exited")
const statusColor = (s) =>
  s?.includes('Up') || s === 'running'   ? 'green' :
  s?.includes('Exited') || s === 'exited' ? 'red'  : 'gray';

const fmtBytes = (b) => {
  if (b == null || b === 0) return '0 B';
  const k = 1024, sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(Math.floor(Math.log(Math.max(b, 1)) / Math.log(k)), sizes.length - 1);
  return `${(b / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
};

const fmtTs = (ts) =>
  ts ? new Date(ts * 1000).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) : '';

// Mini-Sparkline für CPU % pro Container (letzte 20 Werte) — nur lokal
function Sparkline({ data }) {
  if (!data || data.length < 2) return null;
  return (
    <div style={{ width: 64, height: 28 }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data.map((v, i) => ({ i, v }))}>
          <Line type="monotone" dataKey="v" stroke="#388bfd" strokeWidth={1.5} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

// Detail-Chart für einen lokalen Container
function ContainerChart({ containerId, containerName }) {
  const [range, setRange]     = useState('1h');
  const [data, setData]       = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    axios.get(`/api/docker/metrics/${containerId}?range=${range}`)
      .then(r => setData(r.data.rows || []))
      .catch(() => setData([]))
      .finally(() => setLoading(false));
  }, [containerId, range]);

  return (
    <div className="mt-3 border-t border-panel-border pt-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-panel-muted font-medium">{containerName} — Verlauf</span>
        <div className="flex gap-1">
          {['1h', '24h'].map(r => (
            <button key={r} onClick={() => setRange(r)}
              className={`px-2 py-0.5 rounded text-xs transition-colors ${range === r ? 'bg-panel-accent text-white' : 'text-panel-muted hover:text-panel-text'}`}>
              {r}
            </button>
          ))}
        </div>
      </div>
      {loading ? (
        <div className="text-panel-muted text-xs py-3 text-center">Lade...</div>
      ) : data.length < 2 ? (
        <div className="text-panel-muted text-xs py-3 text-center">Noch keine Verlaufsdaten</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <div className="text-xs text-panel-muted mb-1">CPU %</div>
            <ResponsiveContainer width="100%" height={90}>
              <AreaChart data={data} margin={{ top: 2, right: 4, bottom: 0, left: -10 }}>
                <defs>
                  <linearGradient id="dcpu" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#388bfd" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#388bfd" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#30363d" />
                <XAxis dataKey="ts" tickFormatter={fmtTs} tick={{ fill: '#8b949e', fontSize: 9 }} interval="preserveStartEnd" />
                <YAxis domain={[0, 100]} tick={{ fill: '#8b949e', fontSize: 9 }} unit="%" />
                <Tooltip contentStyle={{ background: '#21262d', border: '1px solid #30363d', borderRadius: '6px', fontSize: '11px' }}
                  labelFormatter={fmtTs} formatter={v => [`${v?.toFixed(1)}%`, 'CPU']} />
                <Area type="monotone" dataKey="cpu" stroke="#388bfd" fill="url(#dcpu)" strokeWidth={1.5} dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <div>
            <div className="text-xs text-panel-muted mb-1">RAM</div>
            <ResponsiveContainer width="100%" height={90}>
              <AreaChart
                data={data.map(d => ({ ...d, memPct: d.mem_limit > 0 ? Math.round(d.mem_used / d.mem_limit * 100) : 0 }))}
                margin={{ top: 2, right: 4, bottom: 0, left: -10 }}>
                <defs>
                  <linearGradient id="dmem" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#3fb950" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#3fb950" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#30363d" />
                <XAxis dataKey="ts" tickFormatter={fmtTs} tick={{ fill: '#8b949e', fontSize: 9 }} interval="preserveStartEnd" />
                <YAxis domain={[0, 100]} tick={{ fill: '#8b949e', fontSize: 9 }} unit="%" />
                <Tooltip contentStyle={{ background: '#21262d', border: '1px solid #30363d', borderRadius: '6px', fontSize: '11px' }}
                  labelFormatter={fmtTs} formatter={v => [`${v}%`, 'RAM']} />
                <Area type="monotone" dataKey="memPct" stroke="#3fb950" fill="url(#dmem)" strokeWidth={1.5} dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  );
}

export default function Docker({ liveStats }) {
  const { user } = useAuth();
  const canWrite = user?.role === 'admin' || user?.role === 'operator';

  const [selectedServer, setSelectedServer] = useState(null); // null = lokal
  const [containers, setContainers] = useState([]);
  const [loading, setLoading]       = useState(true);
  const [busy, setBusy]             = useState({});
  const [error, setError]           = useState('');
  const [expanded, setExpanded]     = useState(null);

  // Sparkline-Historie: letzten 20 CPU%-Werte pro Container-ID (nur lokal)
  const sparkRef = useRef({});
  const [sparkData, setSparkData] = useState({});

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const url = selectedServer
        ? `/api/agents/${selectedServer}/docker/containers`
        : '/api/docker/containers';
      const { data } = await axios.get(url);
      setContainers(data);
    } catch (err) {
      setError(err.response?.data?.error || 'Docker nicht erreichbar');
    }
    setLoading(false);
  };

  useEffect(() => {
    setContainers([]);
    setExpanded(null);
    load();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedServer]);

  // Sparklines nur für lokalen Docker via WebSocket-Broadcast
  useEffect(() => {
    if (selectedServer) return;
    const cs = liveStats?.containers;
    if (!cs) return;
    const updated = { ...sparkRef.current };
    for (const [id, stat] of Object.entries(cs)) {
      const prev = updated[id] || [];
      updated[id] = [...prev.slice(-19), stat.cpuPercent ?? 0];
    }
    sparkRef.current = updated;
    setSparkData({ ...updated });
  }, [liveStats?.containers, selectedServer]);

  const act = async (cid, action) => {
    setBusy(b => ({ ...b, [cid]: action }));
    try {
      const url = selectedServer
        ? `/api/agents/${selectedServer}/docker/containers/${cid}/${action}`
        : `/api/docker/containers/${cid}/${action}`;
      await axios.post(url);
      await load();
    } catch {}
    setBusy(b => ({ ...b, [cid]: null }));
  };

  const toggle = (id) => setExpanded(e => e === id ? null : id);

  // Accessor-Helfer: lokal nutzt dockerode-Format, remote nutzt normalisierten Agent-Output
  const getId     = (c) => selectedServer ? c.id    : c.Id;
  const getName   = (c) => selectedServer ? c.name  : (c.Names?.[0]?.replace('/', '') || c.Id?.slice(0, 12));
  const getState  = (c) => selectedServer ? c.state : c.State;
  const getStatus = (c) => selectedServer ? c.status : c.Status;
  const getImage  = (c) => selectedServer ? c.image : c.Image;
  // Live-WS-Stats (nur lokal)
  const getLiveStat = (c) => !selectedServer ? liveStats?.containers?.[c.Id] : null;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <ServerSelector selected={selectedServer} onChange={setSelectedServer} />
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
            {containers.map(c => {
              const cid      = getId(c);
              const name     = getName(c);
              const state    = getState(c);
              const status   = getStatus(c);
              const image    = getImage(c);
              const liveStat = getLiveStat(c);
              const isOpen   = expanded === cid;
              const isRun    = state === 'running';

              // CPU / RAM: remote → aus API; lokal → aus WS
              const cpuPct  = selectedServer ? c.cpu         : liveStat?.cpuPercent;
              const memUsed = selectedServer ? c.memUsed     : liveStat?.memUsed;
              const rxSec   = selectedServer ? null          : liveStat?.rxSec;
              const txSec   = selectedServer ? null          : liveStat?.txSec;

              return (
                <div key={cid}>
                  <div className="flex items-center justify-between px-4 py-3">
                    {/* Name & Status */}
                    <div className="flex-1 min-w-0 mr-3">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge color={statusColor(status || state)}>{state}</Badge>
                        <span className="text-sm text-panel-text font-medium truncate">{name}</span>
                        {selectedServer && c.stack && (
                          <span className="text-xs text-panel-muted bg-panel-surface px-1.5 py-0.5 rounded">{c.stack}</span>
                        )}
                      </div>
                      <div className="text-xs text-panel-muted mt-0.5 truncate">{image}</div>
                      {/* Live-Werte */}
                      {isRun && (cpuPct != null || memUsed != null) && (
                        <div className="flex items-center gap-3 mt-1 text-xs text-panel-muted">
                          {cpuPct  != null && <span className="text-blue-400  font-mono">{Number(cpuPct).toFixed(1)}% CPU</span>}
                          {memUsed != null && <span className="text-green-400 font-mono">{fmtBytes(memUsed)} RAM</span>}
                          {!selectedServer && rxSec != null && (rxSec > 0 || txSec > 0) && (
                            <span className="font-mono">↑{fmtBytes(txSec)}/s ↓{fmtBytes(rxSec)}/s</span>
                          )}
                          {selectedServer && c.ports?.length > 0 && (
                            <span className="text-panel-muted/70">{c.ports.slice(0, 3).join(' · ')}</span>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Sparkline (nur lokal) */}
                    {!selectedServer && sparkData[c.Id]?.length >= 2 && isRun && (
                      <Sparkline data={sparkData[c.Id]} />
                    )}

                    {/* Aktionen */}
                    <div className="flex items-center gap-1 ml-2">
                      {canWrite && (
                        <>
                          {!isRun
                            ? <Button size="sm" variant="success" onClick={() => act(cid, 'start')}  disabled={!!busy[cid]}><Play size={12} /></Button>
                            : <Button size="sm" variant="danger"  onClick={() => act(cid, 'stop')}   disabled={!!busy[cid]}><Square size={12} /></Button>
                          }
                          <Button size="sm" variant="ghost" onClick={() => act(cid, 'restart')} disabled={!!busy[cid]}><RotateCcw size={12} /></Button>
                        </>
                      )}
                      {/* Detail-Chart nur lokal */}
                      {!selectedServer && (
                        <button onClick={() => toggle(cid)}
                          className="p-1.5 rounded hover:bg-panel-card text-panel-muted hover:text-panel-text transition-colors">
                          {isOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Ausklappbarer Detail-Chart (nur lokal) */}
                  {!selectedServer && isOpen && (
                    <div className="px-4 pb-3">
                      <ContainerChart containerId={c.Id} containerName={name} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}
