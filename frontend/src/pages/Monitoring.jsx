import { useState, useEffect, useCallback, useRef } from 'react';
import axios from 'axios';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  ReferenceLine,
} from 'recharts';
import { RefreshCw, Wifi, Calendar } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

const PRESETS = [
  { value: '1h',  label: '1h'  },
  { value: '6h',  label: '6h'  },
  { value: '24h', label: '24h' },
  { value: '7d',  label: '7d'  },
  { value: '30d', label: '30d' },
];

const PANELS = [
  { key: 'cpu',  label: 'CPU',              color: '#FF9900', gradientId: 'gradCpu'  },
  { key: 'mem',  label: 'Arbeitsspeicher',  color: '#73BF69', gradientId: 'gradMem'  },
  { key: 'disk', label: 'Festplatte (/)',   color: '#5794F2', gradientId: 'gradDisk' },
];

// Unix-Timestamp → Wert für datetime-local Input (lokale Zeit)
const toInputValue = (ts) => {
  const d = new Date(ts * 1000);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};

// datetime-local Input → Unix-Timestamp
const fromInputValue = (str) => Math.floor(new Date(str).getTime() / 1000);

// X-Achsen-Label je nach Zeitspanne (Sekunden)
const formatTs = (ts, spanSeconds) => {
  const d = new Date(ts * 1000);
  if (spanSeconds <= 7_200)    return d.toLocaleTimeString('de-DE');                                   // ≤ 2h: HH:mm:ss
  if (spanSeconds <= 86_400)   return d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });  // ≤ 1d: HH:mm
  return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' }) + ' ' +
         d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });                        // > 1d: DD.MM HH:mm
};

// Tooltip-Label mit vollem Datum + Sekunden
const formatTooltipTs = (ts) => {
  const d = new Date(ts * 1000);
  return d.toLocaleDateString('de-DE') + ' ' + d.toLocaleTimeString('de-DE');
};

// Zeitspanne eines Preset-Ranges in Sekunden
const PRESET_SECONDS = { '1h': 3600, '6h': 21600, '24h': 86400, '7d': 604800, '30d': 2592000 };

function MetricPanel({ panel, data, spanSeconds, loading }) {
  const latest = data.length > 0 ? data[data.length - 1]?.[panel.key] ?? null : null;

  return (
    <div className="bg-panel-surface border border-panel-border rounded-lg overflow-hidden flex flex-col">
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

      <div className="flex-1 h-[200px] px-1 pt-3 pb-1">
        {loading ? (
          <div className="h-full flex items-center justify-center">
            <RefreshCw size={16} className="text-panel-muted animate-spin" />
          </div>
        ) : data.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center gap-1">
            <span className="text-panel-muted text-sm">Keine Daten</span>
            <span className="text-panel-muted/60 text-xs">Noch keine Messungen für diesen Zeitraum</span>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
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
                axisLine={false}
                tickLine={false}
                interval="preserveStartEnd"
                minTickGap={60}
              />
              <YAxis
                domain={[0, 100]}
                tick={{ fontSize: 10, fill: '#6b7280' }}
                axisLine={false}
                tickLine={false}
                tickFormatter={(v) => `${v}`}
                width={28}
                tickCount={5}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#0f1117',
                  border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: '6px',
                  fontSize: '12px',
                  padding: '8px 12px',
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
                type="monotone"
                dataKey={panel.key}
                stroke={panel.color}
                strokeWidth={1.5}
                fill={`url(#${panel.gradientId})`}
                dot={false}
                activeDot={{ r: 3, fill: panel.color, strokeWidth: 0 }}
                connectNulls
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}

export default function Monitoring() {
  const { hasPermission, isAdmin } = useAuth();
  const canView = isAdmin || hasPermission('metrics.view');

  const now = Math.floor(Date.now() / 1000);

  const [servers, setServers]     = useState([{ id: 'local', label: 'Panel (lokal)' }]);
  const [server, setServer]       = useState('local');
  const [range, setRange]         = useState('1h');          // Preset-Range
  const [customMode, setCustomMode] = useState(false);
  const [fromInput, setFromInput] = useState(toInputValue(now - 3600)); // Standard: letzte Stunde
  const [toInput, setToInput]     = useState(toInputValue(now));
  const [data, setData]           = useState([]);
  const [loading, setLoading]     = useState(true);
  const [lastUpdate, setLastUpdate] = useState(null);
  const [spanSeconds, setSpanSeconds] = useState(3600);
  const timerRef = useRef(null);

  useEffect(() => {
    if (!canView) return;
    axios.get('/api/metrics/servers').then(r => setServers(r.data)).catch(() => {});
  }, [canView]);

  const load = useCallback(async (silent = false) => {
    if (!canView) return;
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
      setData(res.rows || []);
      setSpanSeconds(span);
      setLastUpdate(new Date());
    } catch {}
    if (!silent) setLoading(false);
  }, [range, server, customMode, fromInput, toInput, canView]);

  // Auto-Refresh bei Live-Presets
  useEffect(() => {
    setLoading(true);
    setData([]);
    load();

    if (timerRef.current) clearInterval(timerRef.current);
    const isLiveRange = !customMode && (range === '1h' || range === '6h');
    if (isLiveRange) {
      timerRef.current = setInterval(() => load(true), 10_000);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [range, server, customMode, load]);

  const applyCustom = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    load();
  };

  if (!canView) {
    return (
      <div className="bg-panel-orange/10 border border-panel-orange/30 text-panel-orange text-sm rounded-md px-4 py-3">
        Du hast keine Berechtigung, Metriken anzuzeigen.
      </div>
    );
  }

  const isLive = !customMode && (range === '1h' || range === '6h');

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        {/* Server */}
        <select
          value={server}
          onChange={e => setServer(e.target.value)}
          className="bg-panel-card border border-panel-border text-panel-text text-sm rounded-md px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-panel-accent min-w-[180px]"
        >
          {servers.map(s => (
            <option key={s.id} value={s.id}>{s.label}</option>
          ))}
        </select>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Preset-Buttons */}
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
              >
                {r.label}
              </button>
            ))}
            {/* Custom-Toggle */}
            <button
              onClick={() => setCustomMode(m => !m)}
              title="Benutzerdefinierter Zeitraum"
              className={`px-2.5 py-1.5 text-xs font-medium transition-colors ${
                customMode
                  ? 'bg-panel-accent text-white'
                  : 'text-panel-muted hover:text-panel-text hover:bg-panel-surface'
              }`}
            >
              <Calendar size={13} />
            </button>
          </div>

          <button
            onClick={() => customMode ? applyCustom() : load()}
            title="Aktualisieren"
            className="p-1.5 bg-panel-card border border-panel-border text-panel-muted hover:text-panel-text rounded-md transition-colors"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* Benutzerdefinierter Zeitraum */}
      {customMode && (
        <div className="flex items-center gap-3 flex-wrap p-3 bg-panel-card border border-panel-border rounded-lg">
          <div className="flex items-center gap-2">
            <span className="text-xs text-panel-muted whitespace-nowrap">Von:</span>
            <input
              type="datetime-local"
              step="1"
              value={fromInput}
              onChange={e => setFromInput(e.target.value)}
              className="bg-panel-surface border border-panel-border text-panel-text text-xs rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-panel-accent"
            />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-panel-muted whitespace-nowrap">Bis:</span>
            <input
              type="datetime-local"
              step="1"
              value={toInput}
              onChange={e => setToInput(e.target.value)}
              className="bg-panel-surface border border-panel-border text-panel-text text-xs rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-panel-accent"
            />
          </div>
          <button
            onClick={applyCustom}
            className="px-3 py-1.5 bg-panel-accent text-white text-xs font-medium rounded-md hover:opacity-90 transition-opacity"
          >
            Anwenden
          </button>
        </div>
      )}

      {/* Status-Zeile */}
      <div className="flex items-center gap-3 text-xs text-panel-muted">
        {isLive && (
          <span className="flex items-center gap-1 text-green-400">
            <Wifi size={11} />
            Live (alle 10s)
          </span>
        )}
        {lastUpdate && (
          <span>Zuletzt: {lastUpdate.toLocaleTimeString('de-DE')}</span>
        )}
      </div>

      {/* Panels */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {PANELS.map(p => (
          <MetricPanel key={p.key} panel={p} data={data} spanSeconds={spanSeconds} loading={loading} />
        ))}
      </div>
    </div>
  );
}
