import { useState, useEffect, useCallback, useRef } from 'react';
import axios from 'axios';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  ReferenceLine,
} from 'recharts';
import { RefreshCw, Wifi } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

const RANGES = [
  { value: '1h',  label: '1h'  },
  { value: '6h',  label: '6h'  },
  { value: '24h', label: '24h' },
  { value: '7d',  label: '7d'  },
  { value: '30d', label: '30d' },
];

const PANELS = [
  { key: 'cpu',  label: 'CPU',              unit: '%', color: '#FF9900', gradientId: 'gradCpu'  },
  { key: 'mem',  label: 'Arbeitsspeicher',  unit: '%', color: '#73BF69', gradientId: 'gradMem'  },
  { key: 'disk', label: 'Festplatte (/)',   unit: '%', color: '#5794F2', gradientId: 'gradDisk' },
];

const formatTs = (ts, range) => {
  const d = new Date(ts * 1000);
  if (range === '1h')  return d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  if (range === '6h')  return d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  if (range === '24h') return d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' }) + ' ' +
         d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
};

const formatTooltipTs = (ts, range) => {
  const d = new Date(ts * 1000);
  if (range === '1h') return d.toLocaleTimeString('de-DE');
  return d.toLocaleDateString('de-DE') + ' ' + d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
};

function MetricPanel({ panel, data, range, loading }) {
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
                tickFormatter={(v) => formatTs(v, range)}
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
                labelFormatter={(v) => formatTooltipTs(v, range)}
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

  const [servers, setServers]     = useState([{ id: 'local', label: 'Panel (lokal)' }]);
  const [server, setServer]       = useState('local');
  const [range, setRange]         = useState('1h');
  const [data, setData]           = useState([]);
  const [loading, setLoading]     = useState(true);
  const [lastUpdate, setLastUpdate] = useState(null);
  const timerRef = useRef(null);

  useEffect(() => {
    if (!canView) return;
    axios.get('/api/metrics/servers')
      .then(r => setServers(r.data))
      .catch(() => {});
  }, [canView]);

  const load = useCallback(async (silent = false) => {
    if (!canView) return;
    if (!silent) setLoading(true);
    try {
      const { data: res } = await axios.get(`/api/metrics?range=${range}&server=${server}`);
      setData(res.rows || []);
      setLastUpdate(new Date());
    } catch {}
    if (!silent) setLoading(false);
  }, [range, server, canView]);

  useEffect(() => {
    setLoading(true);
    setData([]);
    load();

    if (timerRef.current) clearInterval(timerRef.current);
    if (range === '1h' || range === '6h') {
      timerRef.current = setInterval(() => load(true), 10_000);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [range, server, load]);

  if (!canView) {
    return (
      <div className="bg-panel-orange/10 border border-panel-orange/30 text-panel-orange text-sm rounded-md px-4 py-3">
        Du hast keine Berechtigung, Metriken anzuzeigen.
      </div>
    );
  }

  const isLive = range === '1h' || range === '6h';

  return (
    <div className="space-y-3">
      {/* Toolbar — Grafana-Stil */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <select
          value={server}
          onChange={e => setServer(e.target.value)}
          className="bg-panel-card border border-panel-border text-panel-text text-sm rounded-md px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-panel-accent min-w-[180px]"
        >
          {servers.map(s => (
            <option key={s.id} value={s.id}>{s.label}</option>
          ))}
        </select>

        <div className="flex items-center gap-2">
          {/* Zeitraum-Buttons */}
          <div className="flex items-center bg-panel-card border border-panel-border rounded-md overflow-hidden">
            {RANGES.map(r => (
              <button
                key={r.value}
                onClick={() => setRange(r.value)}
                className={`px-3 py-1.5 text-xs font-medium transition-colors border-r border-panel-border last:border-r-0 ${
                  range === r.value
                    ? 'bg-panel-accent text-white'
                    : 'text-panel-muted hover:text-panel-text hover:bg-panel-surface'
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>

          <button
            onClick={() => load()}
            title="Aktualisieren"
            className="p-1.5 bg-panel-card border border-panel-border text-panel-muted hover:text-panel-text rounded-md transition-colors"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

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
          <MetricPanel key={p.key} panel={p} data={data} range={range} loading={loading} />
        ))}
      </div>
    </div>
  );
}
