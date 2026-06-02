import { useState, useEffect, useCallback, useRef, startTransition, memo } from 'react';
import axios from 'axios';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  ReferenceLine, ReferenceArea, LineChart, Line, Legend,
} from 'recharts';
import {
  RefreshCw, Calendar, Activity, Globe,
  GripVertical, Plus, X, LayoutDashboard, Save, RotateCcw, CheckCircle2,
  ChevronDown, ChevronRight, FolderOpen, ZoomIn, ZoomOut,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useWSMessage } from '../context/WSContext';
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
  metric_cpu:  { key: 'cpu',  label: 'CPU',             color: '#F97316', gradientId: 'gradCpu'  },
  metric_mem:  { key: 'mem',  label: 'Arbeitsspeicher', color: '#22C55E', gradientId: 'gradMem'  },
  metric_disk: { key: 'disk', label: 'Festplatte (/)',  color: '#3B82F6', gradientId: 'gradDisk' },
};

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
  { value: '15m', label: '15m' },
  { value: '1h',  label: '1h'  },
  { value: '6h',  label: '6h'  },
  { value: '24h', label: '24h' },
  { value: '7d',  label: '7d'  },
  { value: '30d', label: '30d' },
  { value: '3m',  label: '3M'  },
  { value: '6m',  label: '6M'  },
];
const PRESET_SECONDS = {
  '15m': 900, '1h': 3600, '6h': 21600, '24h': 86400,
  '7d': 604800, '30d': 2592000, '3m': 7776000, '6m': 15552000,
};

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
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};
const fromInputValue = (str) => Math.floor(new Date(str).getTime() / 1000);

const TZ = 'Europe/Berlin';
const formatTs = (ts, span) => {
  const d = new Date(ts * 1000);
  if (span <= 3_600)   return d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: TZ });
  if (span <= 86_400)  return d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', timeZone: TZ });
  if (span <= 604_800) return d.toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', timeZone: TZ });
  return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', timeZone: TZ });
};
const formatTip = (ts) =>
  new Date(ts * 1000).toLocaleString('de-DE', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: TZ,
  });

/* ═══════════════════════════════════════════════════════════
   Grafana-Tooltip
   ═══════════════════════════════════════════════════════════ */
const TOOLTIP_STYLE = {
  contentStyle: {
    backgroundColor: '#0f111a',
    border: '1px solid rgba(255,255,255,0.12)',
    borderRadius: '6px',
    fontSize: '12px',
    padding: '8px 12px',
    boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
  },
  labelStyle: { color: '#6b7280', marginBottom: '6px', fontSize: '11px' },
  cursor: { stroke: 'rgba(255,255,255,0.15)', strokeWidth: 1 },
};

/* ═══════════════════════════════════════════════════════════
   MetricPanel (CPU / RAM / Disk)
   ═══════════════════════════════════════════════════════════ */
const MetricPanel = memo(function MetricPanel({ def, data, span, loading, zoomLeft, zoomRight, onZoomStart, onZoomMove, onZoomEnd }) {
  const latest = data.length > 0 ? data[data.length - 1]?.[def.key] ?? null : null;
  return (
    <div className="bg-[#0f111a] border border-white/8 rounded-lg overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-white/8">
        <span className="text-xs font-semibold uppercase tracking-widest text-gray-500">{def.label}</span>
        {latest !== null
          ? <span className="text-2xl font-bold tabular-nums" style={{ color: def.color }}>{latest.toFixed(1)}<span className="text-sm font-normal ml-0.5 text-gray-500">%</span></span>
          : <span className="text-sm text-gray-600">—</span>
        }
      </div>
      <div className="px-1 pt-3 pb-1" style={{ cursor: 'crosshair' }}>
        {loading
          ? <div className="flex items-center justify-center" style={{ height: 180 }}><RefreshCw size={14} className="text-gray-600 animate-spin" /></div>
          : data.length === 0
            ? <div className="flex items-center justify-center text-gray-600 text-sm" style={{ height: 180 }}>Keine Daten</div>
            : (
              <ResponsiveContainer width="100%" height={180}>
                <AreaChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 0 }} syncId="monitoring"
                  onMouseDown={e => e?.activeLabel != null && onZoomStart?.(e.activeLabel)}
                  onMouseMove={e => e?.activeLabel != null && onZoomMove?.(e.activeLabel)}
                  onMouseUp={onZoomEnd}
                >
                  <defs>
                    <linearGradient id={def.gradientId} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor={def.color} stopOpacity={0.25} />
                      <stop offset="95%" stopColor={def.color} stopOpacity={0}    />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="2 2" stroke="rgba(255,255,255,0.05)" vertical={false} />
                  <XAxis dataKey="t" tickFormatter={v => formatTs(v, span)}
                    tick={{ fontSize: 10, fill: '#4b5563' }} axisLine={false} tickLine={false}
                    interval="preserveStartEnd" minTickGap={50} />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: '#4b5563' }} axisLine={false}
                    tickLine={false} width={26} tickCount={5} unit="%" />
                  <Tooltip {...TOOLTIP_STYLE}
                    labelFormatter={v => formatTip(v)}
                    formatter={v => [`${v?.toFixed(2) ?? '—'}%`, def.label]}
                    itemStyle={{ color: def.color, fontWeight: '600' }}
                  />
                  <ReferenceLine y={80} stroke="rgba(251,146,60,0.2)"  strokeDasharray="4 3" />
                  <ReferenceLine y={90} stroke="rgba(239,68,68,0.25)"  strokeDasharray="4 3" />
                  <Area type="monotone" dataKey={def.key} stroke={def.color} strokeWidth={1.5}
                    fill={`url(#${def.gradientId})`} dot={false}
                    activeDot={{ r: 4, fill: def.color, stroke: '#0f111a', strokeWidth: 2 }}
                    connectNulls isAnimationActive={false} />
                  {zoomLeft != null && zoomRight != null && (
                    <ReferenceArea x1={Math.min(zoomLeft,zoomRight)} x2={Math.max(zoomLeft,zoomRight)}
                      fill="rgba(59,130,246,0.15)" stroke="rgba(59,130,246,0.5)" strokeWidth={1} />
                  )}
                </AreaChart>
              </ResponsiveContainer>
            )
        }
      </div>
    </div>
  );
});

/* ═══════════════════════════════════════════════════════════
   NetworkHistoryPanel
   ═══════════════════════════════════════════════════════════ */
const NetworkHistoryPanel = memo(function NetworkHistoryPanel({ data, span, loading, zoomLeft, zoomRight, onZoomStart, onZoomMove, onZoomEnd }) {
  const last = data.length > 0 ? data[data.length - 1] : null;
  return (
    <div className="bg-[#0f111a] border border-white/8 rounded-lg overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-white/8">
        <span className="text-xs font-semibold uppercase tracking-widest text-gray-500">Netzwerk-Traffic</span>
        <div className="flex items-center gap-4 text-xs font-semibold tabular-nums">
          <span style={{ color: '#22C55E' }}>↓ {fmtKBs(last?.net_rx)}</span>
          <span style={{ color: '#3B82F6' }}>↑ {fmtKBs(last?.net_tx)}</span>
        </div>
      </div>
      <div className="px-1 pt-3 pb-1" style={{ cursor: 'crosshair' }}>
        {loading
          ? <div className="flex items-center justify-center" style={{ height: 180 }}><RefreshCw size={14} className="text-gray-600 animate-spin" /></div>
          : data.length === 0
            ? <div className="flex items-center justify-center text-gray-600 text-sm" style={{ height: 180 }}>Keine Daten</div>
            : (
              <ResponsiveContainer width="100%" height={180}>
                <AreaChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 0 }} syncId="monitoring"
                  onMouseDown={e => e?.activeLabel != null && onZoomStart?.(e.activeLabel)}
                  onMouseMove={e => e?.activeLabel != null && onZoomMove?.(e.activeLabel)}
                  onMouseUp={onZoomEnd}
                >
                  <defs>
                    <linearGradient id="gradNetRx" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor="#22C55E" stopOpacity={0.2} />
                      <stop offset="95%" stopColor="#22C55E" stopOpacity={0}   />
                    </linearGradient>
                    <linearGradient id="gradNetTx" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor="#3B82F6" stopOpacity={0.2} />
                      <stop offset="95%" stopColor="#3B82F6" stopOpacity={0}   />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="2 2" stroke="rgba(255,255,255,0.05)" vertical={false} />
                  <XAxis dataKey="t" tickFormatter={v => formatTs(v, span)}
                    tick={{ fontSize: 10, fill: '#4b5563' }} axisLine={false} tickLine={false}
                    interval="preserveStartEnd" minTickGap={50} />
                  <YAxis tick={{ fontSize: 10, fill: '#4b5563' }} axisLine={false} tickLine={false}
                    tickFormatter={v => v >= 1024 ? `${(v/1024).toFixed(0)}M` : `${v}K`}
                    unit="/s" width={44} tickCount={4} />
                  <Tooltip {...TOOLTIP_STYLE}
                    labelFormatter={v => formatTip(v)}
                    formatter={(v, name) => [fmtKBs(v), name]}
                  />
                  <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: '11px', paddingTop: '4px', color: '#6b7280' }} />
                  <Area type="monotone" dataKey="net_rx" name="Download" stroke="#22C55E" strokeWidth={1.5}
                    fill="url(#gradNetRx)" dot={false}
                    activeDot={{ r: 4, fill: '#22C55E', stroke: '#0f111a', strokeWidth: 2 }}
                    connectNulls isAnimationActive={false} />
                  <Area type="monotone" dataKey="net_tx" name="Upload" stroke="#3B82F6" strokeWidth={1.5}
                    fill="url(#gradNetTx)" dot={false}
                    activeDot={{ r: 4, fill: '#3B82F6', stroke: '#0f111a', strokeWidth: 2 }}
                    connectNulls isAnimationActive={false} />
                  {zoomLeft != null && zoomRight != null && (
                    <ReferenceArea x1={Math.min(zoomLeft,zoomRight)} x2={Math.max(zoomLeft,zoomRight)}
                      fill="rgba(59,130,246,0.15)" stroke="rgba(59,130,246,0.5)" strokeWidth={1} />
                  )}
                </AreaChart>
              </ResponsiveContainer>
            )
        }
      </div>
    </div>
  );
});

/* ═══════════════════════════════════════════════════════════
   CalendarBrowser — Verlauf-Navigator
   ═══════════════════════════════════════════════════════════ */
function CalendarBrowser({ server, onSelectDay, onClose }) {
  const [days,    setDays]    = useState([]);
  const [loading, setLoading] = useState(true);
  const [open,    setOpen]    = useState({});   // { '2026-05': true }

  useEffect(() => {
    setLoading(true);
    axios.get(`/api/metrics/calendar?server=${server}`)
      .then(r => {
        setDays(r.data.days || []);
        // Aktuellen Monat automatisch öffnen
        const today = new Date().toISOString().slice(0, 7);
        setOpen({ [today]: true });
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [server]);

  // Tage nach Monat gruppieren
  const months = {};
  for (const d of days) {
    const m = d.date.slice(0, 7);
    if (!months[m]) months[m] = [];
    months[m].push(d);
  }

  const fmtMonth = (ym) => {
    const [y, m] = ym.split('-');
    const names = ['Jan','Feb','Mär','Apr','Mai','Jun','Jul','Aug','Sep','Okt','Nov','Dez'];
    return `${names[parseInt(m)-1]} ${y}`;
  };
  const fmtDay = (dateStr) => {
    const d = new Date(dateStr + 'T12:00:00Z');
    const names = ['So','Mo','Di','Mi','Do','Fr','Sa'];
    return `${names[d.getUTCDay()]}, ${String(d.getUTCDate()).padStart(2,'0')}.${String(d.getUTCMonth()+1).padStart(2,'0')}.`;
  };

  const toggle = (m) => setOpen(o => ({ ...o, [m]: !o[m] }));

  return (
    <div className="absolute z-30 right-0 top-full mt-2 w-56 bg-[#0f111a] border border-white/10 rounded-lg shadow-2xl overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-white/8">
        <span className="text-xs font-semibold text-gray-400 flex items-center gap-1.5">
          <FolderOpen size={12} />Verlauf
        </span>
        <button onClick={onClose} className="text-gray-600 hover:text-gray-300 transition-colors"><X size={12} /></button>
      </div>
      <div className="max-h-80 overflow-y-auto">
        {loading
          ? <p className="text-xs text-gray-600 text-center py-6">Lade…</p>
          : Object.keys(months).length === 0
            ? <p className="text-xs text-gray-600 text-center py-6">Noch keine historischen Daten</p>
            : Object.entries(months).map(([month, mdays]) => (
              <div key={month}>
                <button
                  onClick={() => toggle(month)}
                  className="w-full flex items-center gap-2 px-3 py-2 text-xs font-medium text-gray-400 hover:bg-white/5 transition-colors"
                >
                  {open[month] ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
                  {fmtMonth(month)}
                  <span className="ml-auto text-gray-600">{mdays.length}T</span>
                </button>
                {open[month] && (
                  <div className="border-l border-white/5 ml-3 mb-1">
                    {mdays.map(d => (
                      <button
                        key={d.date}
                        onClick={() => { onSelectDay(d.date); onClose(); }}
                        className="w-full text-left px-4 py-1.5 text-xs text-gray-500 hover:text-gray-200 hover:bg-white/5 transition-colors"
                      >
                        {fmtDay(d.date)}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))
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

  const [servers,    setServers]    = useState([]);
  const [server,     setServer]     = useState('local');
  const [range,      setRange]      = useState('1h');
  const [metricData, setMetricData] = useState([]);
  const [spanSeconds,setSpanSeconds]= useState(3600);
  const [loading,    setLoading]    = useState(false);
  const [lastUpdate, setLastUpdate] = useState(null);
  const [interfaces, setInterfaces] = useState([]);
  const [publicIp,   setPublicIp]   = useState('');
  const [netHistory, setNetHistory] = useState([]);
  const [remoteStats,setRemoteStats]= useState(null);
  const [layout,     setLayout]     = useState(mkDefault());
  const [editMode,   setEditMode]   = useState(false);
  const [saving,     setSaving]     = useState(false);
  const [savedOk,    setSavedOk]    = useState(false);
  const [customMode, setCustomMode] = useState(false);
  const [fromInput,  setFromInput]  = useState('');
  const [toInput,    setToInput]    = useState('');
  const [showCalendar, setShowCalendar] = useState(false);
  const [liveMode,   setLiveMode]   = useState(false);
  const [zoomLeft,   setZoomLeft]   = useState(null);
  const [zoomRight,  setZoomRight]  = useState(null);
  const [preZoom,    setPreZoom]    = useState(null); // Range vor dem Zoom für Reset
  const zoomRef = useRef({ left: null, right: null }); // Ref für stableref in onZoomEnd

  const timerRef    = useRef(null);
  const liveDiskRef = useRef(null);  // letzter bekannter Disk-Wert für live-Stream
  const networkAgentId = server !== 'local' ? server : null;

  /* ── Drag & Drop ────────────────────────────────────────── */
  const [dragIdx,     setDragIdx]     = useState(null);
  const [dragOverIdx, setDragOverIdx] = useState(null);

  /* ── Server-Liste ───────────────────────────────────────── */
  useEffect(() => {
    axios.get('/api/metrics/servers').then(r => setServers(r.data)).catch(() => {});
  }, []);

  /* ── Dashboard-Layout laden ─────────────────────────────── */
  useEffect(() => {
    axios.get('/api/dashboard/layout')
      .then(r => { if (Array.isArray(r.data.layout) && r.data.layout.length > 0) setLayout(r.data.layout); })
      .catch(() => {});
  }, []);

  /* ── Netzwerk: Interfaces + Public-IP ──────────────────── */
  useEffect(() => {
    setInterfaces([]); setPublicIp(''); setNetHistory([]); setRemoteStats(null);
    const base = networkAgentId ? `/api/agents/${networkAgentId}` : '/api';
    axios.get(`${base}/network/interfaces`).then(r => setInterfaces(r.data)).catch(() => {});
    axios.get(`${base}/network/public-ip`).then(r => setPublicIp(r.data.ip || '')).catch(() => {});
  }, [networkAgentId]);

  /* ── Remote-Polling ─────────────────────────────────────── */
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
    setNetHistory(h => [...h.slice(-59), {
      t: Math.floor(Date.now() / 1000),
      rx: Math.round((n.rxSec || 0) / 1024),
      tx: Math.round((n.txSec || 0) / 1024),
    }]);
  }, [liveStats, networkAgentId]);

  /* ── Live-Chart remote ──────────────────────────────────── */
  useEffect(() => {
    if (!networkAgentId || !remoteStats?.[0]) return;
    const n = remoteStats[0];
    setNetHistory(h => [...h.slice(-59), {
      t: Math.floor(Date.now() / 1000),
      rx: Math.round((n.rx_sec || 0) / 1024),
      tx: Math.round((n.tx_sec || 0) / 1024),
    }]);
  }, [remoteStats, networkAgentId]);

  const n0 = networkAgentId ? remoteStats?.[0] : liveStats?.network?.[0];

  /* ── Live-Stream (lokal) — WS-Daten direkt in Chart ─────── */
  useWSMessage('stats', (msg) => {
    if (!liveMode || server !== 'local') return;
    const p   = msg.payload;
    const ts  = Math.floor(Date.now() / 1000);
    const cpu = p?.cpu ?? null;
    const mem = p?.memory ? Math.round(p.memory.usedPercent * 10) / 10 : null;
    let rxKBs = 0, txKBs = 0;
    for (const n of (p?.network || [])) {
      if (n.iface === 'lo') continue;
      rxKBs += (n.rxSec || 0) / 1024;
      txKBs += (n.txSec || 0) / 1024;
    }
    const point = {
      t: ts, cpu, mem,
      disk: liveDiskRef.current,
      net_rx: Math.round(rxKBs * 100) / 100,
      net_tx: Math.round(txKBs * 100) / 100,
    };
    startTransition(() => {
      setMetricData(prev => {
        const cutoff = ts - 180; // 3 Minuten Rolling-Window im Live-Modus
        return [...prev.filter(p => p.t >= cutoff), point];
      });
      setSpanSeconds(180);
      setLastUpdate(new Date());
    });
  });

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
      startTransition(() => {
        const rows = res.rows || [];
        // Letzten Disk-Wert für Live-Modus merken
        const lastDisk = [...rows].reverse().find(r => r.disk != null)?.disk ?? null;
        if (lastDisk != null) liveDiskRef.current = lastDisk;
        setMetricData(rows);
        setSpanSeconds(span);
        setLastUpdate(new Date());
      });
    } catch {}
    if (!silent) setLoading(false);
  }, [range, server, customMode, fromInput, toInput, canViewMetrics]);

  useEffect(() => {
    if (!canViewMetrics) return;
    if (timerRef.current) clearInterval(timerRef.current);

    if (liveMode) {
      if (server === 'local') {
        // Lokal: WS-Stream übernimmt, nur einmal initialen Schnappschuss laden
        setMetricData([]); setSpanSeconds(180);
        loadMetrics(true);
      } else {
        // Remote: 1s API-Polling der letzten 60s
        const fetchLive = async () => {
          try {
            const now  = Math.floor(Date.now() / 1000);
            const { data: res } = await axios.get(`/api/metrics?from=${now - 60}&to=${now}&server=${server}`);
            startTransition(() => {
              const rows = res.rows || [];
              rows.forEach(r => { if (r.disk != null) liveDiskRef.current = r.disk; });
              setMetricData(rows);
              setSpanSeconds(60);
              setLastUpdate(new Date());
            });
          } catch {}
        };
        fetchLive();
        timerRef.current = setInterval(fetchLive, 1_000);
      }
    } else {
      setLoading(true); setMetricData([]);
      loadMetrics();
      const autoLive = !customMode && (range === '15m' || range === '1h' || range === '6h');
      if (autoLive) timerRef.current = setInterval(() => loadMetrics(true), 5_000);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [range, server, customMode, loadMetrics, canViewMetrics, liveMode]);

  const applyCustom = () => { if (timerRef.current) clearInterval(timerRef.current); loadMetrics(); };

  /* ── Zoom-Logik ─────────────────────────────────────────── */
  const onZoomStart = useCallback((ts) => {
    zoomRef.current = { left: ts, right: null };
    setZoomLeft(ts);
    setZoomRight(null);
  }, []);

  const onZoomMove = useCallback((ts) => {
    if (zoomRef.current.left == null) return;
    if (zoomRef.current.right !== null && Math.abs(ts - zoomRef.current.right) < 1) return;
    zoomRef.current.right = ts;
    setZoomRight(ts);
  }, []);

  const onZoomEnd = useCallback(() => {
    const { left, right } = zoomRef.current;
    zoomRef.current = { left: null, right: null };
    setZoomLeft(null);
    setZoomRight(null);
    if (left == null || right == null) return;
    const from = Math.min(left, right);
    const to   = Math.max(left, right);
    if (to - from < 2) return; // Zu kleine Selektion ignorieren
    setPreZoom({ customMode, fromInput, toInput, range });
    setFromInput(toInputValue(from));
    setToInput(toInputValue(to));
    setCustomMode(true);
    setLiveMode(false);
    if (timerRef.current) clearInterval(timerRef.current);
    setTimeout(() => loadMetrics(), 30);
  }, [customMode, fromInput, toInput, range, loadMetrics]);

  const resetZoom = useCallback(() => {
    if (!preZoom) { setCustomMode(false); return; }
    setCustomMode(preZoom.customMode);
    setFromInput(preZoom.fromInput);
    setToInput(preZoom.toInput);
    setRange(preZoom.range);
    setPreZoom(null);
    setTimeout(() => loadMetrics(), 30);
  }, [preZoom, loadMetrics]);

  /* ── Kalender-Tag wählen ────────────────────────────────── */
  const selectCalendarDay = (dateStr) => {
    // Tages-Anfang und -Ende in lokaler Zeit (Berlin) berechnen
    const from = new Date(dateStr + 'T00:00:00');
    const to   = new Date(dateStr + 'T23:59:59');
    setFromInput(toInputValue(Math.floor(from.getTime() / 1000)));
    setToInput(toInputValue(Math.floor(to.getTime() / 1000)));
    setCustomMode(true);
    if (timerRef.current) clearInterval(timerRef.current);
    // loadMetrics wird durch useEffect getriggert sobald customMode + fromInput/toInput gesetzt
    setTimeout(loadMetrics, 50);
  };

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
    try { await axios.put('/api/dashboard/layout', { layout }); setSavedOk(true); setTimeout(() => setSavedOk(false), 2500); }
    catch {}
    setSaving(false);
  };
  const onDragStart = (e, idx) => { setDragIdx(idx); e.dataTransfer.effectAllowed = 'move'; };
  const onDragOver  = (e, idx) => { e.preventDefault(); setDragOverIdx(idx); };
  const onDrop      = (e, idx) => {
    e.preventDefault();
    if (dragIdx !== null && dragIdx !== idx) {
      const nl = [...layout]; const [moved] = nl.splice(dragIdx, 1); nl.splice(idx, 0, moved);
      setLayout(nl);
    }
    setDragIdx(null); setDragOverIdx(null);
  };
  const onDragEnd = () => { setDragIdx(null); setDragOverIdx(null); };

  /* ── Panel-Inhalte ──────────────────────────────────────── */
  const renderContent = (panel) => {
    const def = METRIC_MAP[panel.type];
    const zoomProps = { zoomLeft, zoomRight, onZoomStart, onZoomMove, onZoomEnd };
    if (def) return <MetricPanel def={def} data={metricData} span={spanSeconds} loading={loading} {...zoomProps} />;

    switch (panel.type) {
      case 'stat_cards': {
        const cpu  = liveStats?.cpu  ?? null;
        const mem  = liveStats?.memory ? Math.round(liveStats.memory.usedPercent) : null;
        const rx   = n0 ? Math.round((n0.rxSec ?? n0.rx_sec ?? 0)) : null;
        const tx   = n0 ? Math.round((n0.txSec ?? n0.tx_sec ?? 0)) : null;
        return (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <StatCard label="CPU" value={cpu != null ? `${cpu}%` : '—'} color="text-orange-400" />
            <StatCard label="RAM" value={mem != null ? `${mem}%` : '—'} color="text-green-400" />
            <StatCard label="Download" value={rx != null ? fmtSpeed(rx) : '—'} color="text-blue-400" />
            <StatCard label="Upload"   value={tx != null ? fmtSpeed(tx) : '—'} color="text-purple-400" />
          </div>
        );
      }
      case 'network_live': {
        const live = netHistory.length > 0;
        return (
          <div className="bg-[#0f111a] border border-white/8 rounded-lg overflow-hidden">
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-white/8">
              <span className="text-xs font-semibold uppercase tracking-widest text-gray-500">Live-Traffic</span>
              <div className="flex items-center gap-4 text-xs font-semibold tabular-nums">
                {n0 && <><span style={{ color: '#22C55E' }}>↓ {fmtSpeed(n0.rxSec ?? n0.rx_sec ?? 0)}</span>
                         <span style={{ color: '#3B82F6' }}>↑ {fmtSpeed(n0.txSec ?? n0.tx_sec ?? 0)}</span></>}
              </div>
            </div>
            <div className="px-1 pt-3 pb-1">
              {!live
                ? <div className="flex items-center justify-center text-gray-600 text-sm" style={{ height: 150 }}>Warte auf Daten…</div>
                : (
                  <ResponsiveContainer width="100%" height={150}>
                    <LineChart data={netHistory} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                      <CartesianGrid strokeDasharray="2 2" stroke="rgba(255,255,255,0.05)" vertical={false} />
                      <XAxis dataKey="t" tickFormatter={v => formatTs(v, 120)}
                        tick={{ fontSize: 10, fill: '#4b5563' }} axisLine={false} tickLine={false}
                        interval="preserveStartEnd" minTickGap={40} />
                      <YAxis tick={{ fontSize: 10, fill: '#4b5563' }} axisLine={false} tickLine={false}
                        tickFormatter={v => v >= 1024 ? `${(v/1024).toFixed(0)}M` : `${v}K`}
                        unit="/s" width={44} tickCount={4} />
                      <Tooltip {...TOOLTIP_STYLE} labelFormatter={v => formatTip(v)} formatter={(v, name) => [fmtKBs(v), name]} />
                      <Line type="monotone" dataKey="rx" name="Download" stroke="#22C55E" strokeWidth={1.5} dot={false} activeDot={{ r: 3 }} isAnimationActive={false} />
                      <Line type="monotone" dataKey="tx" name="Upload"   stroke="#3B82F6" strokeWidth={1.5} dot={false} activeDot={{ r: 3 }} isAnimationActive={false} />
                    </LineChart>
                  </ResponsiveContainer>
                )
              }
            </div>
          </div>
        );
      }
      case 'network_history':
        return <NetworkHistoryPanel data={metricData} span={spanSeconds} loading={loading} {...zoomProps} />;
      case 'interfaces':
        return (
          <div className="bg-[#0f111a] border border-white/8 rounded-lg overflow-hidden">
            <div className="flex items-center gap-2 px-4 py-2.5 border-b border-white/8">
              <Globe size={13} className="text-gray-500" />
              <span className="text-xs font-semibold uppercase tracking-widest text-gray-500">Netzwerk</span>
              {publicIp && <span className="ml-auto text-xs font-mono text-blue-400">{publicIp}</span>}
            </div>
            <div className="divide-y divide-white/5">
              {interfaces.length === 0
                ? <p className="text-xs text-gray-600 text-center py-4">Keine Interfaces</p>
                : interfaces.slice(0, 8).map((iface, i) => (
                  <div key={i} className="flex items-center justify-between px-4 py-2.5 text-xs">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-gray-300">{iface.iface}</span>
                      {iface.ip4 && <span className="text-gray-600 font-mono">{iface.ip4}</span>}
                    </div>
                    <div className="flex items-center gap-3 text-gray-500">
                      {(iface.rxSec ?? iface.rx_sec) != null && <span style={{ color: '#22C55E' }}>↓{fmtSpeed(iface.rxSec ?? iface.rx_sec)}</span>}
                      {(iface.txSec ?? iface.tx_sec) != null && <span style={{ color: '#3B82F6' }}>↑{fmtSpeed(iface.txSec ?? iface.tx_sec)}</span>}
                    </div>
                  </div>
                ))
              }
            </div>
          </div>
        );
      default: return null;
    }
  };

  /* ── Keine Berechtigung ─────────────────────────────────── */
  if (!canViewMetrics && !liveStats) {
    return (
      <div className="bg-panel-orange/10 border border-panel-orange/30 text-panel-orange text-sm rounded-md px-4 py-6 text-center">
        Keine Berechtigung (metrics.view erforderlich)
      </div>
    );
  }

  /* ── Render ─────────────────────────────────────────────── */
  return (
    <div className="space-y-3">

      {/* ── Server-Tabs ─────────────────────────────────────── */}
      {servers.length > 1 && (
        <div className="flex items-center gap-1 flex-wrap">
          {servers.map(s => (
            <button key={s.id}
              onClick={() => { setServer(s.id); setCustomMode(false); setLiveMode(false); setZoomLeft(null); setZoomRight(null); setPreZoom(null); }}
              className={`px-3 py-1.5 text-xs font-medium rounded border transition-all
                ${server === s.id
                  ? 'bg-blue-600/80 border-blue-500/60 text-white'
                  : 'bg-[#0f111a] border-white/10 text-gray-400 hover:text-gray-200 hover:border-white/20'}`}
            >
              {s.label}
            </button>
          ))}
        </div>
      )}

      {/* ── Toolbar ─────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2">

        {/* ⚡ Live-Button */}
        <button
          onClick={() => { setLiveMode(v => !v); setCustomMode(false); }}
          className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold rounded border transition-colors
            ${liveMode
              ? 'bg-red-600/20 border-red-500/50 text-red-400'
              : 'border-white/10 text-gray-500 hover:text-gray-200 hover:bg-white/5'}`}
        >
          <span className={`inline-block w-1.5 h-1.5 rounded-full ${liveMode ? 'bg-red-400 animate-pulse' : 'bg-gray-600'}`} />
          Live
        </button>

        {/* Preset-Buttons */}
        <div className={`flex items-center rounded overflow-hidden border border-white/10 ${liveMode ? 'opacity-40 pointer-events-none' : ''}`}>
          {PRESETS.map(p => (
            <button key={p.value}
              onClick={() => { setRange(p.value); setCustomMode(false); }}
              className={`px-2.5 py-1.5 text-xs font-medium transition-colors border-r border-white/10 last:border-0
                ${!customMode && range === p.value
                  ? 'bg-blue-600/80 text-white'
                  : 'text-gray-500 hover:text-gray-200 hover:bg-white/5'
                }`}
            >
              {p.label}
            </button>
          ))}
        </div>

        {/* Verlauf (Kalender) */}
        <div className="relative">
          <button
            onClick={() => setShowCalendar(v => !v)}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded border transition-colors
              ${showCalendar ? 'bg-blue-600/20 border-blue-500/40 text-blue-400' : 'border-white/10 text-gray-500 hover:text-gray-200 hover:bg-white/5'}`}
          >
            <FolderOpen size={12} />Verlauf
          </button>
          {showCalendar && (
            <CalendarBrowser server={server} onSelectDay={selectCalendarDay} onClose={() => setShowCalendar(false)} />
          )}
        </div>

        {/* Benutzerdefiniert */}
        <button
          onClick={() => {
            if (!customMode) {
              const now  = Math.floor(Date.now() / 1000);
              const from = now - (PRESET_SECONDS[range] || 3600);
              setFromInput(toInputValue(from));
              setToInput(toInputValue(now));
            }
            setCustomMode(v => !v);
          }}
          className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded border transition-colors
            ${customMode ? 'bg-blue-600/20 border-blue-500/40 text-blue-400' : 'border-white/10 text-gray-500 hover:text-gray-200 hover:bg-white/5'}`}
        >
          <Calendar size={12} />Zeitraum
        </button>

        {/* Zoom zurücksetzen — erscheint wenn man reingezoomt hat */}
        {(customMode || preZoom) && (
          <button onClick={resetZoom}
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs border border-blue-500/40 text-blue-400 hover:bg-blue-600/10 rounded transition-colors">
            <ZoomOut size={12} />Zoom zurück
          </button>
        )}

        {/* Refresh */}
        <button onClick={() => loadMetrics()}
          className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs border border-white/10 text-gray-500 hover:text-gray-200 hover:bg-white/5 rounded transition-colors">
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
        </button>

        {/* Dashboard bearbeiten */}
        <button onClick={() => setEditMode(v => !v)}
          className={`ml-auto flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded border transition-colors
            ${editMode ? 'bg-blue-600/20 border-blue-500/40 text-blue-400' : 'border-white/10 text-gray-500 hover:text-gray-200 hover:bg-white/5'}`}
        >
          <LayoutDashboard size={12} />Layout
        </button>

        {/* Zuletzt aktualisiert / Live-Indikator */}
        {liveMode
          ? <span className="text-[10px] text-red-400/70 flex items-center gap-1">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse" />
              {server === 'local' ? 'WS-Stream aktiv' : '1s Polling aktiv'}
            </span>
          : lastUpdate && !loading && (
              <span className="text-[10px] text-gray-600">
                Zuletzt: {lastUpdate.toLocaleTimeString('de-DE', { timeZone: TZ })}
              </span>
            )
        }
      </div>

      {/* ── Benutzerdefinierter Zeitraum ─────────────────────── */}
      {customMode && (
        <div className="flex flex-wrap items-center gap-2 px-3 py-2.5 bg-[#0f111a] border border-white/8 rounded-lg text-xs">
          <span className="text-gray-500 font-medium">Von:</span>
          <input type="datetime-local" step="1" value={fromInput} onChange={e => setFromInput(e.target.value)}
            className="bg-black/30 border border-white/10 rounded px-2 py-1 text-gray-300 focus:outline-none focus:border-blue-500/50" />
          <span className="text-gray-500 font-medium">Bis:</span>
          <input type="datetime-local" step="1" value={toInput} onChange={e => setToInput(e.target.value)}
            className="bg-black/30 border border-white/10 rounded px-2 py-1 text-gray-300 focus:outline-none focus:border-blue-500/50" />
          <button onClick={applyCustom}
            className="px-3 py-1 bg-blue-600/80 text-white rounded hover:bg-blue-600 transition-colors">
            Anwenden
          </button>
        </div>
      )}

      {/* ── Edit-Modus ───────────────────────────────────────── */}
      {editMode && (
        <div className="space-y-3 px-3 py-3 bg-[#0f111a] border border-white/8 rounded-lg text-xs">
          <div className="flex items-center gap-2">
            <button onClick={saveLayout} disabled={saving}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600/80 text-white rounded hover:bg-blue-600 transition-colors">
              {savedOk ? <><CheckCircle2 size={12} />Gespeichert</> : <><Save size={12} />Speichern</>}
            </button>
            <button onClick={() => { setLayout(mkDefault()); setEditMode(false); }}
              className="flex items-center gap-1.5 px-3 py-1.5 border border-white/10 text-gray-500 hover:text-gray-200 rounded transition-colors">
              <RotateCcw size={12} />Reset
            </button>
          </div>
          <div>
            <p className="text-gray-600 mb-2">Panels ein-/ausblenden:</p>
            <div className="flex flex-wrap gap-2">
              {PANEL_DEFS.map(def => {
                const active = layout.some(p => p.type === def.type);
                return (
                  <button key={def.type} onClick={() => togglePanel(def.type)}
                    className={`flex items-center gap-1 px-2.5 py-1 rounded-full border transition-all text-[11px]
                      ${active ? 'bg-blue-600/20 border-blue-500/40 text-blue-400' : 'border-white/10 text-gray-600 hover:text-gray-300'}`}
                  >
                    {active ? <X size={9} /> : <Plus size={9} />}{def.label}
                  </button>
                );
              })}
            </div>
          </div>
          <p className="text-gray-700">Panels per Drag & Drop neu anordnen · Breite über Panel-Leiste ändern</p>
        </div>
      )}

      {/* ── Dashboard-Grid ───────────────────────────────────── */}
      {layout.length === 0
        ? (
          <div className="flex flex-col items-center justify-center gap-2 py-16 text-gray-600 border border-dashed border-white/8 rounded-lg">
            <LayoutDashboard size={28} className="opacity-30" />
            <span className="text-sm">Keine Panels aktiv</span>
            <button onClick={() => setEditMode(true)}
              className="mt-1 px-3 py-1.5 text-xs bg-blue-600/80 text-white rounded hover:bg-blue-600">
              Dashboard anpassen
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-3">
            {layout.map((panel, idx) => {
              const dragging = dragIdx === idx;
              const dragOver = dragOverIdx === idx && dragIdx !== idx;
              return (
                <div key={panel.id}
                  className={`${COL_SPAN[panel.w] ?? 'col-span-3'} transition-opacity duration-150
                    ${dragging ? 'opacity-30' : ''} ${dragOver ? 'ring-1 ring-blue-500/50 rounded-lg' : ''}`}
                  draggable={editMode}
                  onDragStart={e => onDragStart(e, idx)}
                  onDragOver={e => onDragOver(e, idx)}
                  onDrop={e => onDrop(e, idx)}
                  onDragEnd={onDragEnd}
                >
                  {editMode && (
                    <div className="flex items-center gap-1.5 px-2 py-1 mb-1 bg-[#0f111a] border border-white/8 rounded text-xs select-none">
                      <GripVertical size={12} className="text-gray-600 cursor-grab flex-shrink-0" />
                      <span className="flex-1 truncate text-gray-600">{PANEL_DEFS.find(d => d.type === panel.type)?.label}</span>
                      <div className="flex items-center">
                        {[1,2,3].map(w => (
                          <button key={w} onClick={() => setWidth(panel.id, w)}
                            className={`px-1.5 py-0.5 text-[10px] rounded transition-colors
                              ${panel.w === w ? 'bg-blue-600/80 text-white' : 'text-gray-600 hover:text-gray-300'}`}
                          >{w}/3</button>
                        ))}
                      </div>
                      <button onClick={() => setLayout(l => l.filter(p => p.id !== panel.id))}
                        className="text-gray-600 hover:text-red-400 transition-colors ml-1"><X size={11} /></button>
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
