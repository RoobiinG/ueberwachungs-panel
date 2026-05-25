import { useEffect, useState, useCallback, useRef } from 'react';
import { Cpu, HardDrive, Server, MemoryStick } from 'lucide-react';
import axios from 'axios';
import { StatCard } from '../components/ui/StatCard';
import { Card } from '../components/ui/Card';
import {
  ComposedChart, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend, Brush, ReferenceLine,
} from 'recharts';

const RANGES = [
  { key: '1h',  label: '1 Std' },
  { key: '24h', label: '24 Std' },
  { key: '7d',  label: '7 Tage' },
  { key: '30d', label: '30 Tage' },
];

const fmtTs = (ts, range) => {
  const d = new Date(ts * 1000);
  if (range === '1h')
    return d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  if (range === '24h')
    return d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });
};

const fmtBytes = (b, d = 1) => {
  if (!b) return '0 B';
  const k = 1024, sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(b) / Math.log(k));
  return `${parseFloat((b / Math.pow(k, i)).toFixed(d))} ${sizes[i]}`;
};

const fmtUptime = (s) => `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;

// Custom Tooltip für bessere Darstellung
const CustomTooltip = ({ active, payload, label, range }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-[#21262d] border border-[#30363d] rounded-md p-2 text-xs shadow-lg">
      <p className="text-panel-muted mb-1">{fmtTs(label, range)}</p>
      {payload.map(p => (
        <p key={p.dataKey} style={{ color: p.color }} className="leading-5">
          {p.name}: <span className="font-medium">{p.value?.toFixed(1)}%</span>
        </p>
      ))}
    </div>
  );
};

export default function Dashboard({ liveStats }) {
  const [info, setInfo]               = useState(null);
  const [history, setHistory]         = useState([]);
  const [loading, setLoading]         = useState(true);
  const [ltRange, setLtRange]         = useState('24h');
  const [ltData, setLtData]           = useState([]);
  const [ltLoading, setLtLoading]     = useState(false);
  const [alertThresholds, setAlertThresholds] = useState([]);
  const ltRangeRef = useRef(ltRange);
  ltRangeRef.current = ltRange;

  useEffect(() => {
    axios.get('/api/system/stats')
      .then(r => { setInfo(r.data); setLoading(false); })
      .catch(() => setLoading(false));

    // Alert-Schwellenwerte laden (werden in Feature 2 implementiert)
    axios.get('/api/alerts/rules').then(r => setAlertThresholds(r.data || [])).catch(() => {});
  }, []);

  const loadLongterm = useCallback(async (range) => {
    setLtLoading(true);
    try {
      const { data } = await axios.get(`/api/metrics?range=${range}`);
      setLtData(data.rows || []);
    } catch {}
    setLtLoading(false);
  }, []);

  // Initial-Load beim Range-Wechsel
  useEffect(() => { loadLongterm(ltRange); }, [ltRange, loadLongterm]);

  // Auto-Refresh alle 10s für 24h/7d/30d
  useEffect(() => {
    if (ltRange === '1h') return;
    const id = setInterval(() => loadLongterm(ltRangeRef.current), 10_000);
    return () => clearInterval(id);
  }, [ltRange, loadLongterm]);

  // Live-Chart: WS-Daten appendieren
  useEffect(() => {
    if (!liveStats) return;
    setHistory(h => [...h.slice(-29), {
      t: new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      cpu: liveStats.cpu,
      mem: liveStats.memory?.usedPercent,
    }]);
  }, [liveStats]);

  // 1h-Range: Live-Append via WS-Daten (Disk vom letzten bekannten Wert)
  useEffect(() => {
    if (!liveStats || ltRangeRef.current !== '1h') return;
    const now = Math.floor(Date.now() / 1000);
    setLtData(prev => {
      const lastDisk = prev.at(-1)?.disk ?? null;
      const newPoint = {
        t: now,
        cpu: liveStats.cpu,
        mem: liveStats.memory?.usedPercent ?? 0,
        disk: lastDisk,
      };
      // Duplikat verhindern (gleiche Sekunde)
      if (prev.at(-1)?.t === now) return prev;
      return [...prev.slice(-359), newPoint];
    });
  }, [liveStats]);

  if (loading) return <div className="text-panel-muted text-sm">Lade Systemdaten...</div>;

  const cpu    = liveStats?.cpu ?? info?.cpu?.usage ?? 0;
  const memPct = liveStats?.memory?.usedPercent ?? info?.memory?.usedPercent ?? 0;

  // Schwellenwert-Linien aus Alert-Regeln ableiten
  const thresholdLines = alertThresholds
    .filter(r => r.enabled && r.condition === 'gt')
    .map(r => ({
      metric: r.metric,
      value: r.threshold,
      name: r.name,
      color: r.threshold >= 90 ? '#f85149' : r.threshold >= 75 ? '#e3b341' : '#388bfd',
    }));

  const cpuThresholds  = thresholdLines.filter(t => t.metric === 'cpu');
  const memThresholds  = thresholdLines.filter(t => t.metric === 'memory');
  const diskThresholds = thresholdLines.filter(t => t.metric === 'disk');
  // Fallback: immer eine 80%-Linie zeigen wenn keine Regel existiert
  const showDefaultLine = thresholdLines.length === 0;

  return (
    <div className="space-y-4">
      {/* Stat-Karten */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard title="CPU Auslastung" value={cpu} unit="%" icon={Cpu} color="blue" percent={cpu} />
        <StatCard
          title="RAM Auslastung" value={memPct} unit="%" icon={MemoryStick} color="green"
          subtitle={info ? `${fmtBytes(info.memory.used)} / ${fmtBytes(info.memory.total)}` : ''}
          percent={memPct}
        />
        {info?.disk?.[0] && (
          <StatCard
            title="Festplatte" value={Math.round(info.disk[0].usedPercent)} unit="%" icon={HardDrive} color="orange"
            subtitle={`${fmtBytes(info.disk[0].used)} / ${fmtBytes(info.disk[0].size)}`}
            percent={info.disk[0].usedPercent}
          />
        )}
        <StatCard
          title="System" value={info?.os?.distro?.split(' ')[0] ?? '—'} unit="" icon={Server} color="purple"
          subtitle={info?.os ? `${info.os.hostname} · ${fmtUptime(info.os.uptime)}` : ''}
        />
      </div>

      {/* Live-Chart */}
      {history.length > 1 && (
        <Card title="CPU & RAM (Live)">
          <ResponsiveContainer width="100%" height={180}>
            <AreaChart data={history}>
              <defs>
                <linearGradient id="gcpu" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="#388bfd" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#388bfd" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="gmem" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="#3fb950" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#3fb950" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#30363d" />
              <XAxis dataKey="t" tick={{ fill: '#8b949e', fontSize: 10 }} />
              <YAxis domain={[0, 100]} tick={{ fill: '#8b949e', fontSize: 10 }} unit="%" />
              <Tooltip
                content={<CustomTooltip range="live" />}
                labelStyle={{ color: '#e6edf3' }}
              />
              {/* Schwellenwert-Linie */}
              {showDefaultLine && <ReferenceLine y={80} stroke="#f85149" strokeDasharray="4 4" strokeWidth={1} label={{ value: '80%', position: 'insideTopRight', fill: '#f85149', fontSize: 10 }} />}
              {cpuThresholds.map(t => <ReferenceLine key={t.name} y={t.value} stroke={t.color} strokeDasharray="4 4" strokeWidth={1} label={{ value: `${t.value}%`, position: 'insideTopRight', fill: t.color, fontSize: 10 }} />)}
              <Area type="monotone" dataKey="cpu" name="CPU" stroke="#388bfd" fill="url(#gcpu)" strokeWidth={1.5} dot={false} />
              <Area type="monotone" dataKey="mem" name="RAM" stroke="#3fb950" fill="url(#gmem)" strokeWidth={1.5} dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        </Card>
      )}

      {/* Festplatten */}
      {info?.disk && info.disk.length > 0 && (
        <Card title="Festplatten">
          <div className="space-y-3">
            {info.disk.map((d, i) => (
              <div key={i}>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-panel-text">{d.mount} <span className="text-panel-muted">({d.fs})</span></span>
                  <span className="text-panel-muted">{fmtBytes(d.used)} / {fmtBytes(d.size)}</span>
                </div>
                <div className="h-1.5 bg-panel-surface rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${d.usedPercent > 80 ? 'bg-panel-red' : d.usedPercent > 60 ? 'bg-panel-orange' : 'bg-panel-accent'}`}
                    style={{ width: `${Math.min(d.usedPercent, 100)}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Langzeit-Monitoring */}
      <Card title={
        <div className="flex items-center justify-between w-full">
          <span>Langzeit-Monitoring</span>
          <div className="flex gap-1">
            {RANGES.map(r => (
              <button key={r.key} onClick={() => setLtRange(r.key)}
                className={`px-2 py-0.5 rounded text-xs transition-colors ${
                  ltRange === r.key
                    ? 'bg-panel-accent text-white'
                    : 'text-panel-muted hover:text-panel-text'
                }`}>
                {r.label}
              </button>
            ))}
          </div>
        </div>
      }>
        {ltLoading && ltData.length === 0 ? (
          <div className="text-panel-muted text-xs text-center py-6">Lade...</div>
        ) : ltData.length < 2 ? (
          <div className="text-panel-muted text-xs text-center py-6">
            Noch zu wenig Daten — Aufzeichnung läuft alle 10 Sekunden
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <ComposedChart data={ltData} margin={{ top: 8, right: 4, bottom: 0, left: -10 }}>
              <defs>
                <linearGradient id="ltcpu" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="#388bfd" stopOpacity={0.25} />
                  <stop offset="95%" stopColor="#388bfd" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="ltmem" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="#3fb950" stopOpacity={0.25} />
                  <stop offset="95%" stopColor="#3fb950" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="ltdisk" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="#e3b341" stopOpacity={0.2} />
                  <stop offset="95%" stopColor="#e3b341" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#30363d" />
              <XAxis dataKey="t" tickFormatter={t => fmtTs(t, ltRange)}
                tick={{ fill: '#8b949e', fontSize: 10 }} interval="preserveStartEnd" />
              <YAxis domain={[0, 100]} tick={{ fill: '#8b949e', fontSize: 10 }} unit="%" />
              <Tooltip content={<CustomTooltip range={ltRange} />} />
              <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '4px' }} />

              {/* Schwellenwert-Linien */}
              {showDefaultLine && (
                <ReferenceLine y={80} stroke="#f85149" strokeDasharray="4 4" strokeWidth={1}
                  label={{ value: '80%', position: 'insideTopRight', fill: '#f85149', fontSize: 10 }} />
              )}
              {[...cpuThresholds, ...memThresholds, ...diskThresholds].map(t => (
                <ReferenceLine key={`${t.metric}-${t.value}`} y={t.value}
                  stroke={t.color} strokeDasharray="4 4" strokeWidth={1}
                  label={{ value: `${t.name} (${t.value}%)`, position: 'insideTopLeft', fill: t.color, fontSize: 9 }} />
              ))}

              <Area type="monotone" dataKey="cpu"  name="CPU"  stroke="#388bfd" fill="url(#ltcpu)"  strokeWidth={1.5} dot={false} activeDot={{ r: 3 }} />
              <Area type="monotone" dataKey="mem"  name="RAM"  stroke="#3fb950" fill="url(#ltmem)"  strokeWidth={1.5} dot={false} activeDot={{ r: 3 }} />
              <Area type="monotone" dataKey="disk" name="Disk" stroke="#e3b341" fill="url(#ltdisk)" strokeWidth={1.5} dot={false} activeDot={{ r: 3 }} />

              {/* Brush für Zoom/Pan */}
              <Brush
                dataKey="t"
                height={20}
                travellerWidth={6}
                tickFormatter={t => fmtTs(t, ltRange)}
                stroke="#30363d"
                fill="#161b22"
                travellerStyle={{ fill: '#388bfd', stroke: '#388bfd' }}
              />
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </Card>

      {/* System-Info */}
      {info?.os && (
        <Card title="System-Info">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
            {[
              ['Hostname', info.os.hostname],
              ['Betriebssystem', `${info.os.distro} ${info.os.release}`],
              ['Architektur', info.os.arch],
              ['Laufzeit', fmtUptime(info.os.uptime)],
            ].map(([k, v]) => (
              <div key={k} className="bg-panel-surface rounded-md p-3">
                <div className="text-panel-muted mb-0.5">{k}</div>
                <div className="text-panel-text font-medium truncate">{v}</div>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
