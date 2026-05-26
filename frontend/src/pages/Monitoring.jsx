import { useState, useEffect, useCallback, useRef } from 'react';
import axios from 'axios';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine,
  LineChart, Line, Legend,
} from 'recharts';
import { RefreshCw, Wifi, Calendar, Activity, Globe } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { Card } from '../components/ui/Card';
import { StatCard } from '../components/ui/StatCard';

/* ── Zeitraum-Presets ──────────────────────────────────────────── */
const PRESETS = [
  { value: '1h',  label: '1h'  },
  { value: '6h',  label: '6h'  },
  { value: '24h', label: '24h' },
  { value: '7d',  label: '7d'  },
  { value: '30d', label: '30d' },
];
const PRESET_SECONDS = { '1h': 3600, '6h': 21600, '24h': 86400, '7d': 604800, '30d': 2592000 };

/* ── Metrik-Panels (Verlauf) ───────────────────────────────────── */
const METRIC_PANELS = [
  { key: 'cpu',  label: 'CPU',             color: '#FF9900', gradientId: 'gradCpu'  },
  { key: 'mem',  label: 'Arbeitsspeicher', color: '#73BF69', gradientId: 'gradMem'  },
  { key: 'disk', label: 'Festplatte (/)',  color: '#5794F2', gradientId: 'gradDisk' },
];

/* ── Hilfsfunktionen ───────────────────────────────────────────── */
const fmtSpeed = (bps) => {
  if (!bps || bps < 0) return '0 B/s';
  if (bps > 1_048_576) return `${(bps / 1_048_576).toFixed(1)} MB/s`;
  if (bps > 1_024)     return `${(bps / 1_024).toFixed(1)} KB/s`;
  return `${Math.round(bps)} B/s`;
};

const toInputValue = (ts) => {
  const d = new Date(ts * 1000);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};
const fromInputValue = (str) => Math.floor(new Date(str).getTime() / 1000);

const formatTs = (ts, spanSeconds) => {
  const d = new Date(ts * 1000);
  if (spanSeconds <= 7_200)  return d.toLocaleTimeString('de-DE');
  if (spanSeconds <= 86_400) return d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' }) + ' ' +
         d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
};
const formatTooltipTs = (ts) => {
  const d = new Date(ts * 1000);
  return d.toLocaleDateString('de-DE') + ' ' + d.toLocaleTimeString('de-DE');
};

/* ── Verlauf-Panel-Komponente ──────────────────────────────────── */
function MetricPanel({ panel, data, spanSeconds, loading }) {
  const latest = data.length > 0 ? data[data.length - 1]?.[panel.key] ?? null : null;

  return (
    <div className="bg-panel-surface border border-panel-border rounded-lg overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-panel-border">
        <span className="text-xs font-semibold uppercase tracking-wider text-panel-muted">
          {panel.label}
        </span>
        {latest !== null ? (
          <span className="text-2xl font-bold tabular-nums" style={{ color: panel.color }}>
            {latest.toFixed(1)}<span className="text-sm font-normal ml-0.5">%</span>
          </span>
        ) : (
          <span className="text-sm text-panel-muted">—</span>
        )}
      </div>

      <div className="px-1 pt-3 pb-1">
        {loading ? (
          <div className="flex items-center justify-center" style={{ height: 200 }}>
            <RefreshCw size={16} className="text-panel-muted animate-spin" />
          </div>
        ) : data.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-1" style={{ height: 200 }}>
            <span className="text-panel-muted text-sm">Keine Daten</span>
            <span className="text-panel-muted/60 text-xs">Noch keine Messungen für diesen Zeitraum</span>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id={panel.gradientId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor={panel.color} stopOpacity={0.3} />
                  <stop offset="95%" stopColor={panel.color} stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
              <XAxis
                dataKey="t"
                tickFormatter={(v) => formatTs(v, spanSeconds)}
                tick={{ fontSize: 10, fill: '#6b7280' }}
                axisLine={false} tickLine={false}
                interval="preserveStartEnd" minTickGap={60}
              />
              <YAxis
                domain={[0, 100]}
                tick={{ fontSize: 10, fill: '#6b7280' }}
                axisLine={false} tickLine={false}
                tickFormatter={(v) => `${v}`}
                width={28} tickCount={5}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#0f1117',
                  border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: '6px', fontSize: '12px', padding: '8px 12px',
                }}
                labelStyle={{ color: '#9ca3af', marginBottom: '4px', fontSize: '11px' }}
                labelFormatter={(v) => formatTooltipTs(v)}
                formatter={(v) => [`${v?.toFixed(2)}%`, panel.label]}
                itemStyle={{ color: panel.color, fontWeight: '600' }}
                cursor={{ stroke: 'rgba(255,255,255,0.1)', strokeWidth: 1 }}
              />
              <ReferenceLine y={80} stroke="rgba(255,150,0,0.25)" strokeDasharray="4 4" />
              <ReferenceLine y={90} stroke="rgba(255,80,80,0.25)"  strokeDasharray="4 4" />
              <Area
                type="monotone" dataKey={panel.key}
                stroke={panel.color} strokeWidth={1.5}
                fill={`url(#${panel.gradientId})`}
                dot={false} activeDot={{ r: 3, fill: panel.color, strokeWidth: 0 }}
                connectNulls isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}

/* ── Hauptkomponente ───────────────────────────────────────────── */
export default function Monitoring({ liveStats }) {
  const { hasPermission, isAdmin } = useAuth();
  const canViewMetrics = isAdmin || hasPermission('metrics.view');

  const now = Math.floor(Date.now() / 1000);

  /* Server */
  const [servers, setServers] = useState([{ id: 'local', label: 'Panel (lokal)' }]);
  const [server,  setServer]  = useState('local');

  // Für Netzwerk-APIs: null = lokal, sonst Agent-ID (z.B. "3")
  const networkAgentId = server === 'local' ? null : server.replace('agent:', '');

  /* Metriken */
  const [range,       setRange]       = useState('1h');
  const [customMode,  setCustomMode]  = useState(false);
  const [fromInput,   setFromInput]   = useState(toInputValue(now - 3600));
  const [toInput,     setToInput]     = useState(toInputValue(now));
  const [metricData,  setMetricData]  = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [lastUpdate,  setLastUpdate]  = useState(null);
  const [spanSeconds, setSpanSeconds] = useState(3600);
  const timerRef = useRef(null);

  /* Netzwerk */
  const [interfaces,  setInterfaces]  = useState([]);
  const [publicIp,    setPublicIp]    = useState('');
  const [netHistory,  setNetHistory]  = useState([]);
  const [remoteStats, setRemoteStats] = useState(null);

  /* ── Server-Liste laden ─────────────────────────────────────── */
  useEffect(() => {
    axios.get('/api/metrics/servers').then(r => setServers(r.data)).catch(() => {});
  }, []);

  /* ── Netzwerk: Interfaces + Public-IP ──────────────────────── */
  useEffect(() => {
    setInterfaces([]);
    setPublicIp('');
    setNetHistory([]);
    setRemoteStats(null);
    const base = networkAgentId ? `/api/agents/${networkAgentId}` : '/api';
    axios.get(`${base}/network/interfaces`).then(r => setInterfaces(r.data)).catch(() => {});
    axios.get(`${base}/network/public-ip`).then(r => setPublicIp(r.data.ip || '')).catch(() => {});
  }, [networkAgentId]);

  /* ── Netzwerk: Remote-Polling (3s) ─────────────────────────── */
  useEffect(() => {
    if (!networkAgentId) { setRemoteStats(null); return; }
    const fetchStats = () =>
      axios.get(`/api/agents/${networkAgentId}/network/stats`)
        .then(r => setRemoteStats(r.data)).catch(() => {});
    fetchStats();
    const id = setInterval(fetchStats, 3000);
    return () => clearInterval(id);
  }, [networkAgentId]);

  /* ── Netzwerk: Live-Chart lokal (WebSocket) ─────────────────── */
  useEffect(() => {
    if (networkAgentId) return;
    if (!liveStats?.network?.[0]) return;
    const n = liveStats.network[0];
    setNetHistory(h => [...h.slice(-29), {
      t: new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      rx: Math.round((n.rxSec  || 0) / 1024),
      tx: Math.round((n.txSec  || 0) / 1024),
    }]);
  }, [liveStats, networkAgentId]);

  /* ── Netzwerk: Live-Chart remote (Polling) ──────────────────── */
  useEffect(() => {
    if (!networkAgentId || !remoteStats?.[0]) return;
    const n = remoteStats[0];
    setNetHistory(h => [...h.slice(-29), {
      t: new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      rx: Math.round((n.rx_sec || 0) / 1024),
      tx: Math.round((n.tx_sec || 0) / 1024),
    }]);
  }, [remoteStats, networkAgentId]);

  const n0 = networkAgentId ? remoteStats?.[0] : liveStats?.network?.[0];

  /* ── Metriken laden ─────────────────────────────────────────── */
  const loadMetrics = useCallback(async (silent = false) => {
    if (!canViewMetrics) return;
    if (!silent) setLoading(true);
    try {
      let url, span;
      if (customMode) {
        const from = fromInputValue(fromInput);
        const to   = fromInputValue(toInput);
        span = to - from;
        url  = `/api/metrics?from=${from}&to=${to}&server=${server}`;
      } else {
        span = PRESET_SECONDS[range] || 3600;
        url  = `/api/metrics?range=${range}&server=${server}`;
      }
      const { data: res } = await axios.get(url);
      setMetricData(res.rows || []);
      setSpanSeconds(span);
      setLastUpdate(new Date());
    } catch {}
    if (!silent) setLoading(false);
  }, [range, server, customMode, fromInput, toInput, canViewMetrics]);

  useEffect(() => {
    if (!canViewMetrics) return;
    setLoading(true);
    setMetricData([]);
    loadMetrics();
    if (timerRef.current) clearInterval(timerRef.current);
    const isLiveRange = !customMode && (range === '1h' || range === '6h');
    if (isLiveRange) timerRef.current = setInterval(() => loadMetrics(true), 10_000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [range, server, customMode, loadMetrics, canViewMetrics]);

  const applyCustom = () => { if (timerRef.current) clearInterval(timerRef.current); loadMetrics(); };
  const isLive = !customMode && (range === '1h' || range === '6h');

  /* ── Render ─────────────────────────────────────────────────── */
  return (
    <div className="space-y-4">

      {/* ── Toolbar ──────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <select
          value={server}
          onChange={e => setServer(e.target.value)}
          className="bg-panel-card border border-panel-border text-panel-text text-sm rounded-md px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-panel-accent min-w-[180px]"
        >
          {servers.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>

        {canViewMetrics && (
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex items-center bg-panel-card border border-panel-border rounded-md overflow-hidden">
              {PRESETS.map(r => (
                <button
                  key={r.value}
                  onClick={() => { setCustomMode(false); setRange(r.value); }}
                  className={`px-3 py-1.5 text-xs font-medium transition-colors border-r border-panel-border last:border-r-0 ${
                    !customMode && range === r.value
                      ? 'bg-panel-accent text-white'
                      : 'text-panel-muted hover:text-panel-text hover:bg-panel-surface'
                  }`}
                >{r.label}</button>
              ))}
              <button
                onClick={() => setCustomMode(m => !m)}
                title="Benutzerdefinierter Zeitraum"
                className={`px-2.5 py-1.5 text-xs font-medium transition-colors ${
                  customMode ? 'bg-panel-accent text-white' : 'text-panel-muted hover:text-panel-text hover:bg-panel-surface'
                }`}
              ><Calendar size={13} /></button>
            </div>
            <button
              onClick={() => customMode ? applyCustom() : loadMetrics()}
              title="Aktualisieren"
              className="p-1.5 bg-panel-card border border-panel-border text-panel-muted hover:text-panel-text rounded-md transition-colors"
            ><RefreshCw size={14} className={loading ? 'animate-spin' : ''} /></button>
          </div>
        )}
      </div>

      {/* ── Benutzerdefinierter Zeitraum ─────────────────────── */}
      {canViewMetrics && customMode && (
        <div className="flex items-center gap-3 flex-wrap p-3 bg-panel-card border border-panel-border rounded-lg">
          <div className="flex items-center gap-2">
            <span className="text-xs text-panel-muted whitespace-nowrap">Von:</span>
            <input type="datetime-local" step="1" value={fromInput}
              onChange={e => setFromInput(e.target.value)}
              className="bg-panel-surface border border-panel-border text-panel-text text-xs rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-panel-accent"
            />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-panel-muted whitespace-nowrap">Bis:</span>
            <input type="datetime-local" step="1" value={toInput}
              onChange={e => setToInput(e.target.value)}
              className="bg-panel-surface border border-panel-border text-panel-text text-xs rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-panel-accent"
            />
          </div>
          <button onClick={applyCustom}
            className="px-3 py-1.5 bg-panel-accent text-white text-xs font-medium rounded-md hover:opacity-90 transition-opacity"
          >Anwenden</button>
        </div>
      )}

      {/* ── Status-Zeile ─────────────────────────────────────── */}
      {canViewMetrics && (isLive || lastUpdate) && (
        <div className="flex items-center gap-3 text-xs text-panel-muted -mt-1">
          {isLive && (
            <span className="flex items-center gap-1 text-green-400">
              <Wifi size={11} /> Live (alle 10s)
            </span>
          )}
          {lastUpdate && <span>Zuletzt: {lastUpdate.toLocaleTimeString('de-DE')}</span>}
        </div>
      )}

      {/* ══════════════ NETZWERK ══════════════════════════════ */}
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-panel-muted mb-2">Netzwerk</p>

        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-3">
          <StatCard title="Download"      value={n0 ? fmtSpeed(n0.rxSec ?? n0.rx_sec) : '—'} unit="" icon={Activity} color="green"  />
          <StatCard title="Upload"        value={n0 ? fmtSpeed(n0.txSec ?? n0.tx_sec) : '—'} unit="" icon={Activity} color="blue"   />
          <StatCard title="Öffentliche IP" value={publicIp || '—'}                            unit="" icon={Globe}    color="purple" />
        </div>

        {netHistory.length > 1 && (
          <Card title="Netzwerk-Traffic (Live)" className="mb-3">
            <ResponsiveContainer width="100%" height={180}>
              <LineChart data={netHistory}>
                <CartesianGrid strokeDasharray="3 3" stroke="#30363d" />
                <XAxis dataKey="t" tick={{ fill: '#8b949e', fontSize: 10 }} />
                <YAxis tick={{ fill: '#8b949e', fontSize: 10 }} unit=" KB/s" />
                <Tooltip
                  contentStyle={{ background: '#21262d', border: '1px solid #30363d', borderRadius: '6px', fontSize: '12px' }}
                  labelStyle={{ color: '#e6edf3' }}
                />
                <Legend />
                <Line type="monotone" dataKey="rx" name="Download (KB/s)" stroke="#3fb950" dot={false} strokeWidth={1.5} />
                <Line type="monotone" dataKey="tx" name="Upload (KB/s)"   stroke="#388bfd" dot={false} strokeWidth={1.5} />
              </LineChart>
            </ResponsiveContainer>
          </Card>
        )}

        {networkAgentId && (
          <div className="bg-panel-surface/50 border border-panel-border rounded-md px-3 py-2 text-xs text-panel-muted mb-3">
            Live-Traffic via 3-Sekunden-Polling (kein WebSocket-Stream zu Remote-Agents).
          </div>
        )}

        <Card title="Netzwerk-Interfaces">
          {interfaces.length === 0 ? (
            <div className="text-panel-muted text-sm py-4 text-center">Keine Interfaces gefunden</div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {interfaces.map((iface, i) => (
                <div key={i} className="bg-panel-surface rounded-md p-3 text-xs">
                  <div className="flex justify-between mb-2">
                    <span className="font-medium text-panel-text">{iface.iface || iface.ifaceName}</span>
                    {iface.operstate && (
                      <span className={iface.operstate === 'up' ? 'text-panel-green' : 'text-panel-red'}>
                        {iface.operstate}
                      </span>
                    )}
                  </div>
                  <div className="text-panel-muted space-y-0.5">
                    {iface.ip4 && <div>IPv4: <span className="text-panel-text">{iface.ip4}</span></div>}
                    {iface.ip6 && <div>IPv6: <span className="text-panel-text font-mono text-xs">{iface.ip6.slice(0, 20)}…</span></div>}
                    {iface.mac && <div>MAC: <span className="text-panel-text font-mono">{iface.mac}</span></div>}
                    {iface.speed > 0 && <div>Speed: <span className="text-panel-text">{iface.speed} Mbit/s</span></div>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      {/* ══════════════ VERLAUF ═══════════════════════════════ */}
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-panel-muted mb-2">Verlauf</p>
        {canViewMetrics ? (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {METRIC_PANELS.map(p => (
              <MetricPanel key={p.key} panel={p} data={metricData} spanSeconds={spanSeconds} loading={loading} />
            ))}
          </div>
        ) : (
          <div className="bg-panel-orange/10 border border-panel-orange/30 text-panel-orange text-sm rounded-md px-4 py-3">
            Du hast keine Berechtigung, historische Metriken anzuzeigen.
          </div>
        )}
      </div>

    </div>
  );
}
