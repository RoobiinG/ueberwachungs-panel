import { useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Cpu, HardDrive, MemoryStick, WifiOff, Container,
  ChevronRight, Server, Activity,
} from 'lucide-react';
import axios from 'axios';
import { Card } from '../components/ui/Card';
import {
  ComposedChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend, Brush, ReferenceLine,
} from 'recharts';

// ── Hilfsfunktionen ──────────────────────────────────────────────────────────
const fmtBytes = (b, d = 1) => {
  if (!b || b === 0) return '0 B';
  const k = 1024, sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(Math.abs(b)) / Math.log(k));
  return `${parseFloat((b / Math.pow(k, i)).toFixed(d))} ${sizes[i]}`;
};

const fmtUptime = (s) => {
  if (!s) return '—';
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  return `${h}h ${m}m`;
};

const fmtTs = (ts, range) => {
  const d = new Date(ts * 1000);
  if (range === '1h')
    return d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  if (range === '24h')
    return d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });
};

const RANGES = [
  { key: '1h',  label: '1 Std' },
  { key: '24h', label: '24 Std' },
  { key: '7d',  label: '7 Tage' },
  { key: '30d', label: '30 Tage' },
];

// ── Mini Progress Bar ────────────────────────────────────────────────────────
function MiniBar({ label, value, sub, warn = 80, crit = 90 }) {
  const pct = Math.min(Math.round(value ?? 0), 100);
  const color = pct >= crit ? 'bg-panel-red' : pct >= warn ? 'bg-panel-orange' : 'bg-panel-accent';
  return (
    <div>
      <div className="flex justify-between items-baseline mb-1 gap-2">
        <span className="text-xs text-panel-muted flex-shrink-0">{label}</span>
        <span className="text-xs text-panel-text font-medium">
          {pct}%{sub && <span className="font-normal text-panel-muted ml-1.5 text-[10px]">{sub}</span>}
        </span>
      </div>
      <div className="h-1.5 bg-panel-surface rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color} transition-all duration-700`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

// ── Server-Karte ─────────────────────────────────────────────────────────────
function ServerCard({ name, stats, online, isLocal, docker, onNavigate }) {
  const cpu     = stats?.cpu?.usage ?? 0;
  const memPct  = stats?.memory?.usedPercent ?? 0;
  const diskPct = stats?.disk?.[0]?.usedPercent ?? 0;
  const memSub  = stats?.memory
    ? `${fmtBytes(stats.memory.used)} / ${fmtBytes(stats.memory.total)}`
    : null;
  const diskSub = stats?.disk?.[0]
    ? `${fmtBytes(stats.disk[0].used)} / ${fmtBytes(stats.disk[0].size)}`
    : null;

  const runningContainers = Array.isArray(docker) ? docker.filter(c => c.state === 'running').length : null;
  const totalContainers   = Array.isArray(docker) ? docker.length : null;

  const borderCls = online === false
    ? 'border-panel-red/40'
    : 'border-panel-border hover:border-panel-accent/40';

  return (
    <div
      className={`bg-panel-card border rounded-xl flex flex-col overflow-hidden transition-colors cursor-default ${borderCls}`}
      onClick={!isLocal && online ? onNavigate : undefined}
      style={{ cursor: !isLocal && online ? 'pointer' : 'default' }}
    >
      {/* ── Kopfzeile ───────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-2 p-4 pb-3">
        <div className="flex items-center gap-2.5 min-w-0">
          {/* Status-Punkt */}
          <div className={`w-2 h-2 rounded-full flex-shrink-0 mt-0.5 ${
            online === undefined
              ? 'bg-panel-muted animate-pulse'
              : online
              ? 'bg-panel-green'
              : 'bg-panel-red'
          }`} />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-panel-text truncate">{name}</p>
            {stats?.os
              ? <p className="text-xs text-panel-muted truncate">{stats.os.hostname} · {stats.os.distro?.split(' ')[0]}</p>
              : online !== false && <p className="text-xs text-panel-muted">Lade...</p>
            }
          </div>
        </div>

        <div className="flex items-center gap-1.5 flex-shrink-0">
          {isLocal && (
            <span className="text-[10px] bg-panel-surface border border-panel-border text-panel-muted px-1.5 py-0.5 rounded">
              Lokal
            </span>
          )}
          {!isLocal && online && (
            <ChevronRight size={15} className="text-panel-muted/60" />
          )}
        </div>
      </div>

      {/* ── Stats ───────────────────────────────────────────────────────── */}
      <div className="px-4 pb-4 space-y-2.5 flex-1">
        {online === false ? (
          <div className="flex items-center gap-2 text-xs text-panel-red bg-panel-red/10 rounded-lg px-3 py-2.5">
            <WifiOff size={13} />
            Nicht erreichbar
          </div>
        ) : !stats ? (
          /* Skeleton */
          <div className="space-y-3 pt-1">
            {[100, 80, 90].map((w, i) => (
              <div key={i}>
                <div className="flex justify-between mb-1">
                  <div className="h-2.5 bg-panel-surface rounded w-8 animate-pulse" />
                  <div className={`h-2.5 bg-panel-surface rounded w-${w === 100 ? 12 : w === 80 ? 10 : 14} animate-pulse`} />
                </div>
                <div className="h-1.5 bg-panel-surface rounded-full animate-pulse" />
              </div>
            ))}
          </div>
        ) : (
          <>
            <MiniBar label="CPU"  value={cpu}     />
            <MiniBar label="RAM"  value={memPct}  sub={memSub}  />
            {stats.disk?.[0] && (
              <MiniBar label="Disk" value={diskPct} sub={diskSub} />
            )}
          </>
        )}
      </div>

      {/* ── Fußzeile ────────────────────────────────────────────────────── */}
      {online !== false && stats && (
        <div className="border-t border-panel-border/50 px-4 py-2.5 flex items-center gap-3 text-xs text-panel-muted">
          {stats.os?.uptime !== undefined && (
            <span>Up {fmtUptime(stats.os.uptime)}</span>
          )}
          {stats.cpu?.cores && (
            <span className="flex items-center gap-1">
              <Cpu size={11} />{stats.cpu.cores} Kerne
            </span>
          )}
          {runningContainers !== null && (
            <span className="flex items-center gap-1">
              <Container size={11} />
              <span className="text-panel-green">{runningContainers}</span>/<span>{totalContainers}</span>
            </span>
          )}
          {!isLocal && (
            <span className="ml-auto text-panel-accent font-medium">Details →</span>
          )}
        </div>
      )}
    </div>
  );
}

// ── Custom Tooltip ───────────────────────────────────────────────────────────
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

// ── Haupt-Komponente ─────────────────────────────────────────────────────────
export default function Dashboard({ liveStats }) {
  const navigate = useNavigate();

  // Lokaler Server
  const [localInfo,   setLocalInfo]   = useState(null);
  const [ltRange,     setLtRange]     = useState('24h');
  const [ltData,      setLtData]      = useState([]);
  const [ltLoading,   setLtLoading]   = useState(false);
  const [liveHistory, setLiveHistory] = useState([]);
  const [alertThresholds, setAlertThresholds] = useState([]);
  const ltRangeRef = useRef(ltRange);
  ltRangeRef.current = ltRange;

  // Remote Agents
  const [agents,      setAgents]      = useState([]);
  const [agentStats,  setAgentStats]  = useState({});   // { [id]: stats }
  const [agentOnline, setAgentOnline] = useState({});   // { [id]: bool }
  const [agentDocker, setAgentDocker] = useState({});   // { [id]: containers[] }

  // ── Initial-Daten ────────────────────────────────────────────────────────
  useEffect(() => {
    axios.get('/api/system/stats').then(r => setLocalInfo(r.data)).catch(() => {});
    axios.get('/api/alerts/rules').then(r => setAlertThresholds(r.data || [])).catch(() => {});
    axios.get('/api/agents').then(r => setAgents(r.data)).catch(() => {});
  }, []);

  // ── Agent-Stats pollen ───────────────────────────────────────────────────
  const pollAgents = useCallback((list) => {
    list.forEach(agent => {
      axios.get(`/api/agents/${agent.id}/stats`)
        .then(r => {
          setAgentStats(s => ({ ...s, [agent.id]: r.data }));
          setAgentOnline(o => ({ ...o, [agent.id]: true }));
        })
        .catch(() => setAgentOnline(o => ({ ...o, [agent.id]: false })));
      // Docker-Container-Zähler (optional, kein Fehler wenn nicht verfügbar)
      axios.get(`/api/agents/${agent.id}/docker/containers`)
        .then(r => setAgentDocker(d => ({ ...d, [agent.id]: r.data })))
        .catch(() => {});
    });
  }, []);

  useEffect(() => {
    if (!agents.length) return;
    pollAgents(agents);
    const t = setInterval(() => pollAgents(agents), 15_000);
    return () => clearInterval(t);
  }, [agents, pollAgents]);

  // ── Live-History für lokalen Server (WS) ────────────────────────────────
  useEffect(() => {
    if (!liveStats) return;
    setLiveHistory(h => [...h.slice(-29), {
      t:   new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      cpu: liveStats.cpu,
      mem: liveStats.memory?.usedPercent,
    }]);
    // 1h-Langzeit live aktualisieren
    if (ltRangeRef.current === '1h') {
      const now = Math.floor(Date.now() / 1000);
      setLtData(prev => {
        if (prev.at(-1)?.t === now) return prev;
        return [...prev.slice(-359), {
          t:    now,
          cpu:  liveStats.cpu,
          mem:  liveStats.memory?.usedPercent ?? 0,
          disk: prev.at(-1)?.disk ?? null,
        }];
      });
    }
  }, [liveStats]);

  // ── Langzeit-Daten laden ─────────────────────────────────────────────────
  const loadLongterm = useCallback(async (range) => {
    setLtLoading(true);
    try {
      const { data } = await axios.get(`/api/metrics?range=${range}`);
      setLtData(data.rows || []);
    } catch {}
    setLtLoading(false);
  }, []);

  useEffect(() => { loadLongterm(ltRange); }, [ltRange, loadLongterm]);

  useEffect(() => {
    if (ltRange === '1h') return;
    const t = setInterval(() => loadLongterm(ltRangeRef.current), 10_000);
    return () => clearInterval(t);
  }, [ltRange, loadLongterm]);

  // ── Lokaler Server: kombinierte Stats ───────────────────────────────────
  const localCpu    = liveStats?.cpu ?? localInfo?.cpu?.usage ?? 0;
  const localMemPct = liveStats?.memory?.usedPercent ?? localInfo?.memory?.usedPercent ?? 0;
  const localStats  = localInfo
    ? {
        ...localInfo,
        cpu:    { ...localInfo.cpu,    usage: localCpu },
        memory: { ...localInfo.memory, usedPercent: localMemPct },
      }
    : null;

  // ── Schwellenwert-Linien ─────────────────────────────────────────────────
  const thresholdLines = alertThresholds
    .filter(r => r.enabled && r.condition === 'gt')
    .map(r => ({
      metric: r.metric,
      value:  r.threshold,
      name:   r.name,
      color:  r.threshold >= 90 ? '#f85149' : r.threshold >= 75 ? '#e3b341' : '#388bfd',
    }));
  const cpuThresholds  = thresholdLines.filter(t => t.metric === 'cpu');
  const memThresholds  = thresholdLines.filter(t => t.metric === 'memory');
  const diskThresholds = thresholdLines.filter(t => t.metric === 'disk');
  const showDefaultLine = thresholdLines.length === 0;

  // ── Zusammenfassung ──────────────────────────────────────────────────────
  const totalServers  = 1 + agents.length;
  const onlineRemote  = Object.values(agentOnline).filter(Boolean).length;
  const totalOnline   = onlineRemote + 1; // +1 für lokalen Server
  const totalContainerRunning = Object.values(agentDocker)
    .flat()
    .filter(c => c?.state === 'running').length;

  return (
    <div className="space-y-5">

      {/* ── Zusammenfassung ─────────────────────────────────────────────── */}
      <div className="flex items-center gap-4 text-xs text-panel-muted">
        <div className="flex items-center gap-1.5">
          <Server size={13} className="text-panel-accent" />
          <span><strong className="text-panel-text">{totalOnline}</strong> / {totalServers} Server online</span>
        </div>
        {totalContainerRunning > 0 && (
          <div className="flex items-center gap-1.5">
            <Container size={13} className="text-panel-green" />
            <span><strong className="text-panel-text">{totalContainerRunning}</strong> Container running</span>
          </div>
        )}
        {Object.values(agentOnline).includes(false) && (
          <div className="flex items-center gap-1.5 text-panel-red">
            <WifiOff size={13} />
            <span>{Object.values(agentOnline).filter(v => !v).length} nicht erreichbar</span>
          </div>
        )}
        <div className="flex items-center gap-1.5 ml-auto">
          <Activity size={13} className="text-panel-muted" />
          <span>Live · Auto-Refresh 15s</span>
        </div>
      </div>

      {/* ── Server-Grid ─────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
        {/* Lokaler Server */}
        <ServerCard
          name="Panel-Server"
          stats={localStats}
          online={true}
          isLocal={true}
          docker={null}
        />

        {/* Remote Agents */}
        {agents.map(agent => (
          <ServerCard
            key={agent.id}
            name={agent.name}
            stats={agentStats[agent.id] ?? null}
            online={agentOnline[agent.id]}
            isLocal={false}
            docker={agentDocker[agent.id] ?? null}
            onNavigate={() => navigate(`/agents/${agent.id}`)}
          />
        ))}
      </div>

      {/* ── Langzeit-Monitoring (Lokaler Server) ────────────────────────── */}
      <Card title={
        <div className="flex items-center justify-between w-full gap-3">
          <div>
            <span>Langzeit-Monitoring</span>
            <span className="ml-2 text-xs font-normal text-panel-muted">Panel-Server</span>
          </div>
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
          <div className="text-panel-muted text-xs text-center py-8">Lade...</div>
        ) : ltData.length < 2 ? (
          <div className="text-panel-muted text-xs text-center py-8">
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

              <Brush
                dataKey="t" height={20} travellerWidth={6}
                tickFormatter={t => fmtTs(t, ltRange)}
                stroke="#30363d" fill="#161b22"
                travellerStyle={{ fill: '#388bfd', stroke: '#388bfd' }}
              />
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </Card>

    </div>
  );
}
