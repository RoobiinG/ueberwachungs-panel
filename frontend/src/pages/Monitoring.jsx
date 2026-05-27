import { useState, useEffect, useCallback, useRef } from 'react';
import axios from 'axios';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine,
  LineChart, Line, Legend,
} from 'recharts';
import {
  RefreshCw, Wifi, Calendar, Activity, Globe,
  GripVertical, Plus, X, LayoutDashboard, Save, RotateCcw, CheckCircle2,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { Card } from '../components/ui/Card';
import { StatCard } from '../components/ui/StatCard';

/* ═══════════════════════════════════════════════════════════
   Panel-Definitionen & Standardlayout
   ═══════════════════════════════════════════════════════════ */
const PANEL_DEFS = [
  { type: 'stat_cards',      label: 'Live-Stats',                needsMetrics: false, defaultW: 3 },
  { type: 'network_live',    label: 'Live-Traffic-Chart',        needsMetrics: false, defaultW: 3 },
  { type: 'network_history', label: 'Netzwerk-Verlauf',          needsMetrics: true,  defaultW: 3 },
  { type: 'metric_cpu',      label: 'CPU-Verlauf',               needsMetrics: true,  defaultW: 1 },
  { type: 'metric_mem',      label: 'Arbeitsspeicher-Verlauf',   needsMetrics: true,  defaultW: 1 },
  { type: 'metric_disk',     label: 'Festplatten-Verlauf',       needsMetrics: true,  defaultW: 1 },
  { type: 'interfaces',      label: 'Netzwerk-Interfaces',       needsMetrics: false, defaultW: 3 },
];

const METRIC_MAP = {
  metric_cpu:  { key: 'cpu',  label: 'CPU',             color: '#FF9900', gradientId: 'gradCpu'  },
  metric_mem:  { key: 'mem',  label: 'Arbeitsspeicher', color: '#73BF69', gradientId: 'gradMem'  },
  metric_disk: { key: 'disk', label: 'Festplatte (/)',  color: '#5794F2', gradientId: 'gradDisk' },
};

// Tailwind col-span — vollständige Klassen damit Purge greift
const COL_SPAN = { 1: 'col-span-1', 2: 'col-span-2', 3: 'col-span-3' };

const uid = () => Math.random().toString(36).slice(2, 9);
const mkDefault = () => [
  { id: uid(), type: 'stat_cards',      w: 3 },
  { id: uid(), type: 'network_live',    w: 3 },
  { id: uid(), type: 'network_history', w: 3 },
  { id: uid(), type: 'metric_cpu',      w: 1 },
  { id: uid(), type: 'metric_mem',      w: 1 },
  { id: uid(), type: 'metric_disk',     w: 1 },
  { id: uid(), type: 'interfaces',      w: 3 },
];

/* ═══════════════════════════════════════════════════════════
   Zeitraum-Presets
   ═══════════════════════════════════════════════════════════ */
const PRESETS = [
  { value: '1h',  label: '1h'  },
  { value: '6h',  label: '6h'  },
  { value: '24h', label: '24h' },
  { value: '7d',  label: '7d'  },
  { value: '30d', label: '30d' },
];
const PRESET_SECONDS = { '1h': 3600, '6h': 21600, '24h': 86400, '7d': 604800, '30d': 2592000 };

/* ═══════════════════════════════════════════════════════════
   Hilfsfunktionen
   ═══════════════════════════════════════════════════════════ */
const fmtSpeed = (bps) => {
  if (!bps || bps < 0) return '0 B/s';
  if (bps > 1_048_576) return `${(bps / 1_048_576).toFixed(1)} MB/s`;
  if (bps > 1_024)     return `${(bps / 1_024).toFixed(1)} KB/s`;
  return `${Math.round(bps)} B/s`;
};
const fmtKBs = (v) =>
  v == null ? '—' : v >= 1024 ? `${(v / 1024).toFixed(1)} MB/s` : `${v.toFixed(1)} KB/s`;

const toInputValue = (ts) => {
  const d = new Date(ts * 1000);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};
const fromInputValue = (str) => Math.floor(new Date(str).getTime() / 1000);

const formatTs = (ts, span) => {
  const d = new Date(ts * 1000);
  if (span <= 7_200)  return d.toLocaleTimeString('de-DE');
  if (span <= 86_400) return d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' }) + ' ' +
         d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
};
const formatTip = (ts) => {
  const d = new Date(ts * 1000);
  return d.toLocaleDateString('de-DE') + ' ' + d.toLocaleTimeString('de-DE');
};

/* ═══════════════════════════════════════════════════════════
   Wiederverwendbare Panel-Komponenten
   ═══════════════════════════════════════════════════════════ */
function PermissionNotice() {
  return (
    <div className="bg-panel-orange/10 border border-panel-orange/30 text-panel-orange text-sm rounded-md px-4 py-6 text-center">
      Keine Berechtigung (metrics.view erforderlich)
    </div>
  );
}

function MetricPanel({ def, data, span, loading }) {
  const latest = data.length > 0 ? data[data.length - 1]?.[def.key] ?? null : null;
  return (
    <div className="bg-panel-surface border border-panel-border rounded-lg overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-panel-border">
        <span className="text-xs font-semibold uppercase tracking-wider text-panel-muted">{def.label}</span>
        {latest !== null
          ? <span className="text-2xl font-bold tabular-nums" style={{ color: def.color }}>{latest.toFixed(1)}<span className="text-sm font-normal ml-0.5">%</span></span>
          : <span className="text-sm text-panel-muted">—</span>
        }
      </div>
      <div className="px-1 pt-3 pb-1">
        {loading
          ? <div className="flex items-center justify-center" style={{ height: 200 }}><RefreshCw size={16} className="text-panel-muted animate-spin" /></div>
          : data.length === 0
            ? <div className="flex items-center justify-center text-panel-muted text-sm" style={{ height: 200 }}>Keine Daten</div>
            : (
              <ResponsiveContainer width="100%" height={200}>
                <AreaChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                  <defs>
                    <linearGradient id={def.gradientId} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor={def.color} stopOpacity={0.3} />
                      <stop offset="95%" stopColor={def.color} stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
                  <XAxis dataKey="t" tickFormatter={v => formatTs(v, span)}
                    tick={{ fontSize: 10, fill: '#6b7280' }} axisLine={false} tickLine={false}
                    interval="preserveStartEnd" minTickGap={60} />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: '#6b7280' }} axisLine={false}
                    tickLine={false} width={28} tickCount={5} />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#0f1117', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px', fontSize: '12px', padding: '8px 12px' }}
                    labelStyle={{ color: '#9ca3af', marginBottom: '4px', fontSize: '11px' }}
                    labelFormatter={v => formatTip(v)}
                    formatter={v => [`${v?.toFixed(2)}%`, def.label]}
                    itemStyle={{ color: def.color, fontWeight: '600' }}
                    cursor={{ stroke: 'rgba(255,255,255,0.1)', strokeWidth: 1 }}
                  />
                  <ReferenceLine y={80} stroke="rgba(255,150,0,0.25)" strokeDasharray="4 4" />
                  <ReferenceLine y={90} stroke="rgba(255,80,80,0.25)"  strokeDasharray="4 4" />
                  <Area type="monotone" dataKey={def.key} stroke={def.color} strokeWidth={1.5}
                    fill={`url(#${def.gradientId})`} dot={false}
                    activeDot={{ r: 3, fill: def.color, strokeWidth: 0 }}
                    connectNulls isAnimationActive={false} />
                </AreaChart>
              </ResponsiveContainer>
            )
        }
      </div>
    </div>
  );
}

function NetworkHistoryPanel({ data, span, loading }) {
  const last = data.length > 0 ? data[data.length - 1] : null;
  return (
    <div className="bg-panel-surface border border-panel-border rounded-lg overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-panel-border">
        <span className="text-xs font-semibold uppercase tracking-wider text-panel-muted">Netzwerk-Traffic</span>
        <div className="flex items-center gap-4 text-xs font-semibold tabular-nums">
          <span style={{ color: '#3fb950' }}>↓ {fmtKBs(last?.net_rx)}</span>
          <span style={{ color: '#388bfd' }}>↑ {fmtKBs(last?.net_tx)}</span>
        </div>
      </div>
      <div className="px-1 pt-3 pb-1">
        {loading
          ? <div className="flex items-center justify-center" style={{ height: 200 }}><RefreshCw size={16} className="text-panel-muted animate-spin" /></div>
          : data.length === 0
            ? <div className="flex items-center justify-center text-panel-muted text-sm" style={{ height: 200 }}>Keine Daten</div>
            : (
              <ResponsiveContainer width="100%" height={200}>
                <AreaChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                  <defs>
                    <linearGradient id="gradNetRx" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor="#3fb950" stopOpacity={0.25} />
                      <stop offset="95%" stopColor="#3fb950" stopOpacity={0.02} />
                    </linearGradient>
                    <linearGradient id="gradNetTx" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor="#388bfd" stopOpacity={0.25} />
                      <stop offset="95%" stopColor="#388bfd" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
                  <XAxis dataKey="t" tickFormatter={v => formatTs(v, span)}
                    tick={{ fontSize: 10, fill: '#6b7280' }} axisLine={false} tickLine={false}
                    interval="preserveStartEnd" minTickGap={60} />
                  <YAxis tick={{ fontSize: 10, fill: '#6b7280' }} axisLine={false} tickLine={false}
                    tickFormatter={v => v >= 1024 ? `${(v / 1024).toFixed(0)}M` : `${v}K`}
                    unit="/s" width={44} tickCount={5} />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#0f1117', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px', fontSize: '12px', padding: '8px 12px' }}
                    labelStyle={{ color: '#9ca3af', marginBottom: '4px', fontSize: '11px' }}
                    labelFormatter={v => formatTip(v)}
                    formatter={(v, name) => [fmtKBs(v), name]}
                    cursor={{ stroke: 'rgba(255,255,255,0.1)', strokeWidth: 1 }}
                  />
                  <Area type="monotone" dataKey="net_rx" name="Download" stroke="#3fb950" strokeWidth={1.5}
                    fill="url(#gradNetRx)" dot={false} activeDot={{ r: 3, fill: '#3fb950', strokeWidth: 0 }}
                    connectNulls isAnimationActive={false} />
                  <Area type="monotone" dataKey="net_tx" name="Upload" stroke="#388bfd" strokeWidth={1.5}
                    fill="url(#gradNetTx)" dot={false} activeDot={{ r: 3, fill: '#388bfd', strokeWidth: 0 }}
                    connectNulls isAnimationActive={false} />
                </AreaChart>
              </ResponsiveContainer>
            )
        }
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   Hauptkomponente
   ═══════════════════════════════════════════════════════════ */
export default function Monitoring({ liveStats }) {
  const { hasPermission, isAdmin } = useAuth();
  const canViewMetrics = isAdmin || hasPermission('metrics.view');

  const now = Math.floor(Date.now() / 1000);

  /* ── Server ─────────────────────────────────────────────── */
  const [servers, setServers] = useState([{ id: 'local', label: 'Panel (lokal)' }]);
  const [server,  setServer]  = useState('local');
  const networkAgentId = server === 'local' ? null : server.replace('agent:', '');

  /* ── Zeitraum ───────────────────────────────────────────── */
  const [range,      setRange]      = useState('1h');
  const [customMode, setCustomMode] = useState(false);
  const [fromInput,  setFromInput]  = useState(toInputValue(now - 3600));
  const [toInput,    setToInput]    = useState(toInputValue(now));

  /* ── Metrik-Daten ───────────────────────────────────────── */
  const [metricData,  setMetricData]  = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [lastUpdate,  setLastUpdate]  = useState(null);
  const [spanSeconds, setSpanSeconds] = useState(3600);
  const timerRef = useRef(null);

  /* ── Netzwerk ───────────────────────────────────────────── */
  const [interfaces,  setInterfaces]  = useState([]);
  const [publicIp,    setPublicIp]    = useState('');
  const [netHistory,  setNetHistory]  = useState([]);
  const [remoteStats, setRemoteStats] = useState(null);

  /* ── Dashboard-Layout ───────────────────────────────────── */
  const [layout,   setLayout]   = useState(() => mkDefault());
  const [editMode, setEditMode] = useState(false);
  const [saving,   setSaving]   = useState(false);
  const [savedOk,  setSavedOk]  = useState(false);

  /* ── Drag & Drop ────────────────────────────────────────── */
  const [dragIdx,     setDragIdx]     = useState(null);
  const [dragOverIdx, setDragOverIdx] = useState(null);

  /* ── Server-Liste laden ─────────────────────────────────── */
  useEffect(() => {
    axios.get('/api/metrics/servers').then(r => setServers(r.data)).catch(() => {});
  }, []);

  /* ── Gespeichertes Layout laden ─────────────────────────── */
  useEffect(() => {
    axios.get('/api/dashboard/layout')
      .then(r => {
        if (Array.isArray(r.data.layout) && r.data.layout.length > 0)
          setLayout(r.data.layout);
      })
      .catch(() => {});
  }, []);

  /* ── Netzwerk: Interfaces + Public-IP ──────────────────── */
  useEffect(() => {
    setInterfaces([]); setPublicIp(''); setNetHistory([]); setRemoteStats(null);
    const base = networkAgentId ? `/api/agents/${networkAgentId}` : '/api';
    axios.get(`${base}/network/interfaces`).then(r => setInterfaces(r.data)).catch(() => {});
    axios.get(`${base}/network/public-ip`).then(r => setPublicIp(r.data.ip || '')).catch(() => {});
  }, [networkAgentId]);

  /* ── Netzwerk: Remote-Polling ───────────────────────────── */
  useEffect(() => {
    if (!networkAgentId) { setRemoteStats(null); return; }
    const fetch = () =>
      axios.get(`/api/agents/${networkAgentId}/network/stats`)
        .then(r => setRemoteStats(r.data)).catch(() => {});
    fetch();
    const id = setInterval(fetch, 3000);
    return () => clearInterval(id);
  }, [networkAgentId]);

  /* ── Live-Chart lokal ───────────────────────────────────── */
  useEffect(() => {
    if (networkAgentId || !liveStats?.network?.[0]) return;
    const n = liveStats.network[0];
    setNetHistory(h => [...h.slice(-29), {
      t: new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      rx: Math.round((n.rxSec  || 0) / 1024),
      tx: Math.round((n.txSec  || 0) / 1024),
    }]);
  }, [liveStats, networkAgentId]);

  /* ── Live-Chart remote ──────────────────────────────────── */
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

  /* ── Metriken laden ─────────────────────────────────────── */
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
    setLoading(true); setMetricData([]);
    loadMetrics();
    if (timerRef.current) clearInterval(timerRef.current);
    const live = !customMode && (range === '1h' || range === '6h');
    if (live) timerRef.current = setInterval(() => loadMetrics(true), 10_000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [range, server, customMode, loadMetrics, canViewMetrics]);

  const applyCustom = () => { if (timerRef.current) clearInterval(timerRef.current); loadMetrics(); };
  const isLive = !customMode && (range === '1h' || range === '6h');

  /* ── Layout-Operationen ─────────────────────────────────── */
  const togglePanel = (type) =>
    setLayout(l => {
      if (l.find(p => p.type === type)) return l.filter(p => p.type !== type);
      const def = PANEL_DEFS.find(d => d.type === type);
      return [...l, { id: uid(), type, w: def.defaultW }];
    });

  const setWidth = (id, w) => setLayout(l => l.map(p => p.id === id ? { ...p, w } : p));

  const saveLayout = async () => {
    setSaving(true);
    try {
      await axios.put('/api/dashboard/layout', { layout });
      setSavedOk(true);
      setTimeout(() => setSavedOk(false), 2500);
    } catch {}
    setSaving(false);
  };

  /* ── Drag & Drop ────────────────────────────────────────── */
  const onDragStart = (e, idx) => { setDragIdx(idx); e.dataTransfer.effectAllowed = 'move'; };
  const onDragOver  = (e, idx) => { e.preventDefault(); setDragOverIdx(idx); };
  const onDrop      = (e, idx) => {
    e.preventDefault();
    if (dragIdx !== null && dragIdx !== idx) {
      const nl = [...layout];
      const [moved] = nl.splice(dragIdx, 1);
      nl.splice(idx, 0, moved);
      setLayout(nl);
    }
    setDragIdx(null); setDragOverIdx(null);
  };
  const onDragEnd = () => { setDragIdx(null); setDragOverIdx(null); };

  /* ── Panel-Inhalt rendern ───────────────────────────────── */
  const renderContent = (panel) => {
    switch (panel.type) {

      case 'stat_cards':
        return (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <StatCard title="Download"       value={n0 ? fmtSpeed(n0.rxSec ?? n0.rx_sec) : '—'} unit="" icon={Activity} color="green"  />
            <StatCard title="Upload"         value={n0 ? fmtSpeed(n0.txSec ?? n0.tx_sec) : '—'} unit="" icon={Activity} color="blue"   />
            <StatCard title="Öffentliche IP" value={publicIp || '—'}                             unit="" icon={Globe}    color="purple" />
          </div>
        );

      case 'network_live':
        return netHistory.length > 1 ? (
          <div className="bg-panel-surface border border-panel-border rounded-lg overflow-hidden">
            <div className="flex items-center gap-2 px-4 py-2.5 border-b border-panel-border">
              <span className="text-xs font-semibold uppercase tracking-wider text-panel-muted">Live-Traffic</span>
              {networkAgentId && <span className="text-xs text-panel-muted/60">· 3s-Polling</span>}
            </div>
            <div className="p-1 pt-3">
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
            </div>
          </div>
        ) : (
          <div className="bg-panel-surface border border-panel-border rounded-lg flex items-center justify-center text-panel-muted text-sm" style={{ height: 230 }}>
            Warte auf Live-Daten…
          </div>
        );

      case 'network_history':
        return canViewMetrics
          ? <NetworkHistoryPanel data={metricData} span={spanSeconds} loading={loading} />
          : <PermissionNotice />;

      case 'metric_cpu':
      case 'metric_mem':
      case 'metric_disk':
        return canViewMetrics
          ? <MetricPanel def={METRIC_MAP[panel.type]} data={metricData} span={spanSeconds} loading={loading} />
          : <PermissionNotice />;

      case 'interfaces':
        return (
          <Card title="Netzwerk-Interfaces">
            {interfaces.length === 0
              ? <div className="text-panel-muted text-sm py-4 text-center">Keine Interfaces gefunden</div>
              : (
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
                        {iface.ip6 && <div>IPv6: <span className="text-panel-text font-mono">{iface.ip6.slice(0, 20)}…</span></div>}
                        {iface.mac && <div>MAC: <span className="text-panel-text font-mono">{iface.mac}</span></div>}
                        {iface.speed > 0 && <div>Speed: <span className="text-panel-text">{iface.speed} Mbit/s</span></div>}
                      </div>
                    </div>
                  ))}
                </div>
              )
            }
          </Card>
        );

      default: return null;
    }
  };

  /* ═══════════════════════════════════════════════════════════
     Render
     ═══════════════════════════════════════════════════════════ */
  return (
    <div className="space-y-3">

      {/* ── Toolbar ──────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <select
          value={server}
          onChange={e => setServer(e.target.value)}
          className="bg-panel-card border border-panel-border text-panel-text text-sm rounded-md px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-panel-accent min-w-[180px]"
        >
          {servers.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>

        <div className="flex items-center gap-2 flex-wrap">
          {canViewMetrics && (
            <>
              <div className="flex items-center bg-panel-card border border-panel-border rounded-md overflow-hidden">
                {PRESETS.map(r => (
                  <button key={r.value}
                    onClick={() => { setCustomMode(false); setRange(r.value); }}
                    className={`px-3 py-1.5 text-xs font-medium transition-colors border-r border-panel-border last:border-r-0 ${
                      !customMode && range === r.value ? 'bg-panel-accent text-white' : 'text-panel-muted hover:text-panel-text hover:bg-panel-surface'
                    }`}
                  >{r.label}</button>
                ))}
                <button
                  onClick={() => setCustomMode(m => !m)}
                  title="Benutzerdefinierter Zeitraum"
                  className={`px-2.5 py-1.5 text-xs transition-colors ${customMode ? 'bg-panel-accent text-white' : 'text-panel-muted hover:text-panel-text hover:bg-panel-surface'}`}
                ><Calendar size={13} /></button>
              </div>
              <button
                onClick={() => customMode ? applyCustom() : loadMetrics()}
                className="p-1.5 bg-panel-card border border-panel-border text-panel-muted hover:text-panel-text rounded-md transition-colors"
              ><RefreshCw size={14} className={loading ? 'animate-spin' : ''} /></button>
            </>
          )}

          {/* Edit-Mode-Toggle */}
          <button
            onClick={() => setEditMode(m => !m)}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border transition-colors ${
              editMode ? 'bg-panel-accent text-white border-panel-accent' : 'bg-panel-card border-panel-border text-panel-muted hover:text-panel-text'
            }`}
          >
            <LayoutDashboard size={13} /> Anpassen
          </button>
        </div>
      </div>

      {/* ── Benutzerdefinierter Zeitraum ─────────────────── */}
      {canViewMetrics && customMode && (
        <div className="flex items-center gap-3 flex-wrap p-3 bg-panel-card border border-panel-border rounded-lg">
          <div className="flex items-center gap-2">
            <span className="text-xs text-panel-muted whitespace-nowrap">Von:</span>
            <input type="datetime-local" step="1" value={fromInput}
              onChange={e => setFromInput(e.target.value)}
              className="bg-panel-surface border border-panel-border text-panel-text text-xs rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-panel-accent" />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-panel-muted whitespace-nowrap">Bis:</span>
            <input type="datetime-local" step="1" value={toInput}
              onChange={e => setToInput(e.target.value)}
              className="bg-panel-surface border border-panel-border text-panel-text text-xs rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-panel-accent" />
          </div>
          <button onClick={applyCustom}
            className="px-3 py-1.5 bg-panel-accent text-white text-xs font-medium rounded-md hover:opacity-90">
            Anwenden
          </button>
        </div>
      )}

      {/* ── Live-Status ──────────────────────────────────── */}
      {canViewMetrics && (isLive || lastUpdate) && (
        <div className="flex items-center gap-3 text-xs text-panel-muted">
          {isLive && <span className="flex items-center gap-1 text-green-400"><Wifi size={11} /> Live (alle 10s)</span>}
          {lastUpdate && <span>Zuletzt: {lastUpdate.toLocaleTimeString('de-DE')}</span>}
        </div>
      )}

      {/* ── Edit-Panel ───────────────────────────────────── */}
      {editMode && (
        <div className="p-4 bg-panel-card border border-panel-accent/40 rounded-lg space-y-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <span className="text-sm font-semibold text-panel-text">Dashboard anpassen</span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setLayout(mkDefault())}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-panel-muted hover:text-panel-text bg-panel-surface border border-panel-border rounded-md transition-colors"
              ><RotateCcw size={11} /> Zurücksetzen</button>
              <button
                onClick={saveLayout}
                disabled={saving}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-all ${
                  savedOk ? 'bg-green-600 text-white' : 'bg-panel-accent text-white hover:opacity-90'
                }`}
              >
                {savedOk
                  ? <><CheckCircle2 size={11} /> Gespeichert!</>
                  : saving
                    ? <><RefreshCw size={11} className="animate-spin" /> Speichern…</>
                    : <><Save size={11} /> Speichern</>
                }
              </button>
            </div>
          </div>

          <div>
            <p className="text-xs text-panel-muted mb-2">Panels ein- / ausblenden:</p>
            <div className="flex flex-wrap gap-2">
              {PANEL_DEFS.map(def => {
                const active = layout.some(p => p.type === def.type);
                return (
                  <button key={def.type}
                    onClick={() => togglePanel(def.type)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-full border transition-all ${
                      active
                        ? 'bg-panel-accent/20 border-panel-accent text-panel-accent'
                        : 'bg-panel-surface border-panel-border text-panel-muted hover:text-panel-text hover:border-panel-border'
                    }`}
                  >
                    {active ? <X size={10} /> : <Plus size={10} />}
                    {def.label}
                  </button>
                );
              })}
            </div>
          </div>

          <p className="text-xs text-panel-muted/60">
            Panels per Drag & Drop neu anordnen · Breite (1/3 – 3/3) über die Panel-Leiste ändern
          </p>
        </div>
      )}

      {/* ── Dashboard-Grid ───────────────────────────────── */}
      {layout.length === 0
        ? (
          <div className="flex flex-col items-center justify-center gap-2 py-16 text-panel-muted border border-dashed border-panel-border rounded-lg">
            <LayoutDashboard size={32} className="opacity-30" />
            <span className="text-sm">Keine Panels aktiv</span>
            <button onClick={() => setEditMode(true)}
              className="mt-1 px-3 py-1.5 text-xs bg-panel-accent text-white rounded-md hover:opacity-90">
              Dashboard anpassen
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-3">
            {layout.map((panel, idx) => {
              const dragging  = dragIdx === idx;
              const dragOver  = dragOverIdx === idx && dragIdx !== idx;
              return (
                <div
                  key={panel.id}
                  className={`${COL_SPAN[panel.w] ?? 'col-span-3'} transition-opacity duration-150 ${dragging ? 'opacity-30' : ''} ${dragOver ? 'ring-2 ring-panel-accent rounded-lg' : ''}`}
                  draggable={editMode}
                  onDragStart={e => onDragStart(e, idx)}
                  onDragOver={e => onDragOver(e, idx)}
                  onDrop={e => onDrop(e, idx)}
                  onDragEnd={onDragEnd}
                >
                  {/* Edit-Leiste über dem Panel */}
                  {editMode && (
                    <div className="flex items-center gap-1.5 px-2 py-1 mb-1 bg-panel-card border border-panel-border rounded-md text-xs select-none">
                      <GripVertical size={13} className="text-panel-muted cursor-grab flex-shrink-0" />
                      <span className="flex-1 truncate text-panel-muted">
                        {PANEL_DEFS.find(d => d.type === panel.type)?.label}
                      </span>
                      {/* Breite */}
                      <div className="flex items-center">
                        {[1, 2, 3].map(w => (
                          <button key={w}
                            onClick={() => setWidth(panel.id, w)}
                            className={`px-1.5 py-0.5 text-[10px] rounded transition-colors ${
                              panel.w === w ? 'bg-panel-accent text-white' : 'text-panel-muted hover:bg-panel-surface'
                            }`}
                          >{w}/3</button>
                        ))}
                      </div>
                      {/* Entfernen */}
                      <button
                        onClick={() => setLayout(l => l.filter(p => p.id !== panel.id))}
                        className="text-panel-muted hover:text-red-400 transition-colors ml-1"
                      ><X size={12} /></button>
                    </div>
                  )}

                  {renderContent(panel)}
                </div>
              );
            })}
          </div>
        )
      }

    </div>
  );
}
