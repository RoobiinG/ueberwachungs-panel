import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import RGLBase, { WidthProvider } from 'react-grid-layout';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';
import {
  Cpu, WifiOff, Container, ChevronRight, Server, Activity,
  MemoryStick, HardDrive, Network, ArrowDownToLine, ArrowUpFromLine,
  Clock, Monitor, Package, ShieldAlert, RotateCw, Bell,
  GripVertical, RotateCcw,
} from 'lucide-react';
import { LineChart, Line, YAxis, ResponsiveContainer } from 'recharts';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';
import { useLiveInterval } from '../hooks/useLiveInterval';

// Recharts-Farben (an Panel-Palette angelehnt)
const C_CPU  = '#388bfd';
const C_RAM  = '#3fb950';
const C_DISK = '#e3b341';
const C_NET  = '#a371f7';

const LegendDot = ({ color, label }) => (
  <span className="flex items-center gap-1">
    <span className="inline-block w-2.5 h-0.5 rounded" style={{ backgroundColor: color }} />{label}
  </span>
);

// ── Frei anordbares Widget-Raster (react-grid-layout) ────────────────────────
const GridLayout = WidthProvider(RGLBase);
const GRID_COLS = 12;

const widgetTitle = (id, serverName) => {
  if (id === 'kpi')      return 'Übersicht';
  if (id === 'activity') return 'Aktivität';
  if (id === 'status')   return 'Status';
  if (id.startsWith('server:')) return serverName(id.slice(7));
  return '';
};

// Standard-Anordnung: KPI voll oben, Server-Karten links (2 je Reihe), Aktivität + Status rechts
// Höhe (in Grid-Zeilen) so, dass eine Server-Karte komplett passt (rowHeight 30 + margin 14 → ~514px)
const SERVER_H = 12;

const mkDefaultRgl = (serverKeys) => {
  const items = [
    { i: 'kpi',      x: 0, y: 0,             w: 12, h: 2,        minW: 4, minH: 2 },
    { i: 'activity', x: 8, y: 2,             w: 4,  h: SERVER_H, minW: 3, minH: 5 },
    { i: 'status',   x: 8, y: 2 + SERVER_H,  w: 4,  h: 6,        minW: 3, minH: 3 },
  ];
  serverKeys.forEach((k, idx) => {
    items.push({ i: 'server:' + k, x: (idx % 2) * 4, y: 2 + Math.floor(idx / 2) * SERVER_H, w: 4, h: SERVER_H, minW: 3, minH: 6 });
  });
  return items;
};

// Gespeichertes RGL-Layout mit aktueller Serverliste abgleichen
const reconcileRgl = (list, serverKeys) => {
  const wantServer = new Set(serverKeys.map(k => 'server:' + k));
  const out = (list || []).filter(it => !String(it.i).startsWith('server:') || wantServer.has(it.i));
  const have = new Set(out.map(it => it.i));
  let y = out.reduce((m, it) => Math.max(m, (it.y || 0) + (it.h || 1)), 0);
  for (const k of serverKeys) {
    const id = 'server:' + k;
    if (!have.has(id)) { out.push({ i: id, x: 0, y, w: 4, h: SERVER_H, minW: 3, minH: 6 }); have.add(id); y += SERVER_H; }
  }
  if (!have.has('kpi'))      { out.push({ i: 'kpi',      x: 0, y, w: 12, h: 2,        minW: 4, minH: 2 }); y += 2; }
  if (!have.has('activity')) { out.push({ i: 'activity', x: 0, y, w: 4,  h: SERVER_H, minW: 3, minH: 5 }); y += SERVER_H; }
  if (!have.has('status'))   { out.push({ i: 'status',   x: 0, y, w: 4,  h: 6,        minW: 3, minH: 3 }); }
  return out;
};

// Zeitreihe auf ~48 Punkte ausdünnen (für kompakte Sparklines)
const decimate = (rows, max = 48) => {
  const clean = (rows || []).filter(r => r && r.cpu != null);
  const src = clean.length <= max ? clean
    : clean.filter((_, i) => i % Math.ceil(clean.length / max) === 0);
  return src.map(r => ({ cpu: r.cpu, mem: r.mem, disk: r.disk, rx: r.net_rx, tx: r.net_tx }));
};

// ── Hilfsfunktionen ──────────────────────────────────────────────────────────

const fmtBytes = (b, d = 1) => {
  if (b == null || b === 0) return '0 B';
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

// ── Stat-Zeile (CPU / RAM / Disk) ─────────────────────────────────────────────

function StatRow({ icon: Icon, label, value, sub, warn = 80, crit = 90 }) {
  const pct      = Math.min(Math.round(value ?? 0), 100);
  const isCrit   = pct >= crit;
  const isWarn   = pct >= warn && !isCrit;
  const barColor  = isCrit ? 'bg-panel-red'   : isWarn ? 'bg-panel-orange' : 'bg-panel-accent';
  const textColor = isCrit ? 'text-panel-red' : isWarn ? 'text-panel-orange' : 'text-panel-text';

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-panel-muted">
          <Icon size={11} className="flex-shrink-0" />
          <span className="text-[11px] font-medium tracking-wide uppercase">{label}</span>
        </div>
        <span className={`text-sm font-bold tabular-nums leading-none ${textColor}`}>
          {pct}<span className="text-[10px] font-normal text-panel-muted ml-px">%</span>
        </span>
      </div>
      <div className="h-2 bg-panel-surface rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-700 ${barColor}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      {sub && (
        <p className="text-[10px] text-panel-muted/60 tabular-nums leading-none">{sub}</p>
      )}
    </div>
  );
}

// ── Hardware-Chip ─────────────────────────────────────────────────────────────

function HwChip({ icon: Icon, children }) {
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-panel-surface border border-panel-border/70 text-[10px] text-panel-muted whitespace-nowrap">
      <Icon size={9} className="flex-shrink-0 opacity-60" />
      {children}
    </span>
  );
}

// ── Skeleton ──────────────────────────────────────────────────────────────────

function Skeleton() {
  return (
    <div className="space-y-3 px-4 py-3">
      {[1, 2, 3].map(i => (
        <div key={i} className="space-y-1.5">
          <div className="flex justify-between">
            <div className="h-2.5 bg-panel-surface rounded w-10 animate-pulse" />
            <div className="h-2.5 bg-panel-surface rounded w-8 animate-pulse" />
          </div>
          <div className="h-2 bg-panel-surface rounded-full animate-pulse" />
        </div>
      ))}
    </div>
  );
}

// ── Mini-Verlaufs-Chart (CPU / RAM) ───────────────────────────────────────────

function MiniChart({ data }) {
  return (
    <div>
      <div className="flex items-center gap-3 text-[10px] text-panel-muted/70 mb-0.5">
        <LegendDot color={C_CPU} label="CPU" />
        <LegendDot color={C_RAM} label="RAM" />
        <LegendDot color={C_DISK} label="Disk" />
        <span className="ml-auto">letzte 15 min</span>
      </div>
      <div className="h-14 -mx-1">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 4 }}>
            <YAxis hide domain={[0, 100]} />
            <Line type="monotone" dataKey="cpu"  stroke={C_CPU}  strokeWidth={1.5} dot={false} isAnimationActive={false} />
            <Line type="monotone" dataKey="mem"  stroke={C_RAM}  strokeWidth={1.5} dot={false} isAnimationActive={false} />
            <Line type="monotone" dataKey="disk" stroke={C_DISK} strokeWidth={1.5} dot={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div className="flex items-center gap-3 text-[10px] text-panel-muted/70 mt-1.5 mb-0.5">
        <LegendDot color={C_NET} label="Netzwerk ↓↑" />
        <span className="ml-auto">KB/s</span>
      </div>
      <div className="h-8 -mx-1">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 2, right: 4, bottom: 0, left: 4 }}>
            <YAxis hide domain={[0, 'auto']} />
            <Line type="monotone" dataKey={(d) => (d.rx || 0) + (d.tx || 0)} name="net"
              stroke={C_NET} strokeWidth={1.5} dot={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// ── Server-Karte ──────────────────────────────────────────────────────────────

function ServerCard({ name, stats, online, isLocal, docker, history, onNavigate, className = '' }) {
  const cpu     = stats?.cpu?.usage ?? 0;
  const memPct  = stats?.memory?.usedPercent ?? 0;
  const diskPct = stats?.disk?.[0]?.usedPercent ?? 0;
  const memSub  = stats?.memory
    ? `${fmtBytes(stats.memory.used)} / ${fmtBytes(stats.memory.total)}`
    : null;
  const diskSub = stats?.disk?.[0]
    ? `${fmtBytes(stats.disk[0].used)} / ${fmtBytes(stats.disk[0].size)}`
    : null;

  // Primäres Netzwerk-Interface — aktives bevorzugen, kein Loopback
  const netIface =
    stats?.network?.find(n => n.iface !== 'lo' && ((n.rxSec ?? 0) > 0 || (n.txSec ?? 0) > 0)) ??
    stats?.network?.find(n => n.iface !== 'lo');

  const runningContainers = Array.isArray(docker) ? docker.filter(c => c.state === 'running').length : null;
  const totalContainers   = Array.isArray(docker) ? docker.length : null;

  const cardCls = online === false
    ? 'border-panel-red/40 bg-panel-card'
    : 'border-panel-border hover:border-panel-accent/40 bg-panel-card';

  return (
    <div
      className={`border rounded-2xl flex flex-col overflow-hidden transition-all duration-200 ${cardCls} ${className}`}
      onClick={!isLocal && online ? onNavigate : undefined}
      style={{ cursor: !isLocal && online ? 'pointer' : 'default' }}
    >
      {/* ── Kopfzeile ──────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-2 px-4 pt-4 pb-2">
        <div className="flex items-center gap-2.5 min-w-0">
          {/* Online-Indikator */}
          <span className={`w-2 h-2 rounded-full flex-shrink-0 mt-0.5 ${
            online === undefined ? 'bg-panel-muted animate-pulse'
              : online            ? 'bg-panel-green'
              : 'bg-panel-red'
          }`} />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-panel-text truncate leading-tight">{name}</p>
            {stats?.os
              ? <p className="text-[11px] text-panel-muted truncate leading-tight mt-0.5">{stats.os.hostname}</p>
              : online !== false && (
                  <p className="text-[11px] text-panel-muted mt-0.5 animate-pulse">Verbinde…</p>
                )
            }
          </div>
        </div>
        <div className="flex-shrink-0 flex items-center gap-1 mt-0.5">
          {isLocal && (
            <span className="text-[10px] bg-panel-surface border border-panel-border text-panel-muted px-1.5 py-0.5 rounded-full">
              Lokal
            </span>
          )}
          {!isLocal && online && <ChevronRight size={14} className="text-panel-muted/40" />}
        </div>
      </div>

      {/* ── Hardware-Chips ─────────────────────────────────────────────── */}
      {stats && online !== false && (
        <div className="flex flex-wrap gap-1.5 px-4 pb-3">
          {(stats.cpu?.cores ?? 0) > 0 && (
            <HwChip icon={Cpu}>{stats.cpu.cores} Kerne</HwChip>
          )}
          {(stats.memory?.total ?? 0) > 0 && (
            <HwChip icon={MemoryStick}>{fmtBytes(stats.memory.total, 0)} RAM</HwChip>
          )}
          {stats.os?.distro && (
            <HwChip icon={Monitor}>{stats.os.distro.split(' ').slice(0, 2).join(' ')}</HwChip>
          )}
          {stats.os?.arch && (
            <HwChip icon={Server}>{stats.os.arch}</HwChip>
          )}
        </div>
      )}

      {/* Trennlinie */}
      {stats && online !== false && <div className="h-px bg-panel-border/40 mx-4 mb-3" />}

      {/* ── Metriken ───────────────────────────────────────────────────── */}
      {online === false ? (
        <div className="flex items-center gap-2 text-xs text-panel-red bg-panel-red/10 rounded-lg mx-4 mb-4 px-3 py-2.5">
          <WifiOff size={13} />
          Nicht erreichbar
        </div>
      ) : !stats ? (
        <Skeleton />
      ) : (
        <div className="px-4 pb-3 space-y-3 flex-1">
          <StatRow icon={Cpu}         label="CPU"  value={cpu}    />
          <StatRow icon={MemoryStick} label="RAM"  value={memPct} sub={memSub}  />
          {stats.disk?.[0] && (
            <StatRow icon={HardDrive} label="Disk" value={diskPct} sub={diskSub} />
          )}
          {Array.isArray(history) && history.length >= 2 && <MiniChart data={history} />}
        </div>
      )}

      {/* ── Netzwerk ───────────────────────────────────────────────────── */}
      {stats && online !== false && netIface && (
        <div className="mx-4 border-t border-panel-border/40 py-2.5 flex items-center gap-2">
          <Network size={11} className="text-panel-muted/50 flex-shrink-0" />
          <div className="flex items-center gap-3 flex-1 min-w-0">
            {/* Download */}
            <span className="flex items-center gap-1 text-xs">
              <ArrowDownToLine size={10} className="text-panel-green" />
              <span className="tabular-nums font-medium text-panel-text">
                {fmtBytes(netIface.rxSec ?? 0)}/s
              </span>
            </span>
            {/* Upload */}
            <span className="flex items-center gap-1 text-xs">
              <ArrowUpFromLine size={10} className="text-panel-accent" />
              <span className="tabular-nums font-medium text-panel-text">
                {fmtBytes(netIface.txSec ?? 0)}/s
              </span>
            </span>
            {/* Interface-Name */}
            <span className="ml-auto text-[10px] text-panel-muted/40 font-mono truncate">
              {netIface.iface}
            </span>
          </div>
        </div>
      )}

      {/* ── Fußzeile ───────────────────────────────────────────────────── */}
      {online !== false && stats && (
        <div className="border-t border-panel-border/50 px-4 py-2 flex items-center gap-3 text-[11px] text-panel-muted bg-panel-surface/20">
          {stats.os?.uptime !== undefined && (
            <span className="flex items-center gap-1">
              <Clock size={10} />
              Up {fmtUptime(stats.os.uptime)}
            </span>
          )}
          {runningContainers !== null && (
            <span className="flex items-center gap-1.5">
              <Container size={10} />
              <span className="text-panel-green font-medium">{runningContainers}</span>
              <span className="text-panel-muted/40">/</span>
              <span>{totalContainers}</span>
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

// ── Haupt-Komponente ──────────────────────────────────────────────────────────

// ── KPI-Kachel ────────────────────────────────────────────────────────────────

function KpiTile({ icon: Icon, value, label, color = 'text-panel-accent' }) {
  return (
    <div className="bg-panel-card border border-panel-border/70 rounded-2xl px-3.5 py-3 flex items-center gap-3">
      <div className={`w-9 h-9 rounded-xl bg-panel-surface flex items-center justify-center flex-shrink-0 ${color}`}>
        <Icon size={18} />
      </div>
      <div className="min-w-0">
        <div className="text-xl font-bold leading-none text-panel-text tabular-nums">{value}</div>
        <div className="text-[11px] text-panel-muted mt-1 truncate">{label}</div>
      </div>
    </div>
  );
}

// ── Aktivitäts-Feed ───────────────────────────────────────────────────────────

const FEED_COLOR = {
  danger:  'bg-panel-red',    success: 'bg-panel-green', warning: 'bg-panel-orange',
  info:    'bg-panel-accent', login:   'bg-panel-purple',
};

const fmtAgo = (at) => {
  if (!at) return '';
  const s = Math.floor((Date.now() - at) / 1000);
  if (s < 60)     return 'jetzt';
  if (s < 3600)   return `${Math.floor(s / 60)} min`;
  if (s < 86400)  return `${Math.floor(s / 3600)} h`;
  return `${Math.floor(s / 86400)} d`;
};

function ActivityFeed({ events }) {
  if (!events?.length) {
    return <div className="text-xs text-panel-muted/70 px-4 py-8 text-center">Noch keine Ereignisse.</div>;
  }
  return (
    <div className="px-4 pb-1">
      {events.map((e, i) => (
        <div key={i} className="flex gap-2.5 items-start py-2 border-t border-panel-border/40 first:border-t-0">
          <span className={`w-2 h-2 rounded-full flex-shrink-0 mt-1.5 ${FEED_COLOR[e.severity] || 'bg-panel-muted'}`} />
          <div className="min-w-0 flex-1">
            <div className="text-xs text-panel-text truncate">{e.title}</div>
            <div className="text-[11px] text-panel-muted truncate">{e.sub}</div>
          </div>
          <span className="text-[10px] text-panel-muted/70 flex-shrink-0 mt-0.5 tabular-nums">{fmtAgo(e.at)}</span>
        </div>
      ))}
    </div>
  );
}

export default function Dashboard({ liveStats }) {
  const navigate  = useNavigate();
  const { hideLocal } = useAuth();
  const liveInterval = useLiveInterval();

  const [localInfo,   setLocalInfo]   = useState(null);
  const [agents,      setAgents]      = useState([]);
  const [agentStats,  setAgentStats]  = useState({});   // { [id]: stats }
  const [agentOnline, setAgentOnline] = useState({});   // { [id]: bool }
  const [agentDocker, setAgentDocker] = useState({});   // { [id]: containers[] }
  const [patchmonHosts, setPatchmonHosts] = useState([]);
  const [histories,   setHistories]   = useState({});   // { [serverKey]: [{cpu,mem}] } für Mini-Charts
  const [activity,    setActivity]    = useState([]);   // Ereignis-Feed
  const [uptime,      setUptime]      = useState(null);  // { up, total }
  const [firewall,    setFirewall]    = useState(null);  // { active }
  const [rgl, setRgl] = useState(null);   // gespeichertes RGL-Layout (null = Standard)
  const persistRef    = useRef(null);
  const readyRef      = useRef(false);    // erst nach dem Laden darf persistiert werden

  // ── Initial-Daten ──────────────────────────────────────────────────────────
  useEffect(() => {
    axios.get('/api/system/stats').then(r => setLocalInfo(r.data)).catch(() => {});
    axios.get('/api/agents').then(r => setAgents(r.data)).catch(() => {});
    // PatchMon-Gesamtübersicht (fail-soft — nicht konfiguriert = Kachel ausblenden)
    axios.get('/api/patchmon/hosts').then(r => setPatchmonHosts(r.data.hosts || [])).catch(() => setPatchmonHosts([]));
  }, []);

  // ── Remote-Agent-Stats pollen ──────────────────────────────────────────────
  const pollAgents = useCallback((list) => {
    list.forEach(agent => {
      axios.get(`/api/agents/${agent.id}/stats`)
        .then(r => {
          setAgentStats(s => ({ ...s, [agent.id]: r.data }));
          setAgentOnline(o => ({ ...o, [agent.id]: true }));
        })
        .catch(() => setAgentOnline(o => ({ ...o, [agent.id]: false })));
      axios.get(`/api/agents/${agent.id}/docker/containers`)
        .then(r => setAgentDocker(d => ({ ...d, [agent.id]: r.data })))
        .catch(() => {});
    });
  }, []);

  useEffect(() => {
    if (!agents.length) return;
    pollAgents(agents);
    const t = setInterval(() => pollAgents(agents), liveInterval);
    return () => clearInterval(t);
  }, [agents, pollAgents, liveInterval]);

  // ── Verlaufs-Historie für Mini-Charts (echte Metriken, alle 30s) ────────────
  const loadHistories = useCallback(async () => {
    const targets = [...(hideLocal ? [] : ['local']), ...agents.map(a => String(a.id))];
    if (targets.length === 0) return;
    const results = await Promise.all(targets.map(key =>
      axios.get(`/api/metrics?range=15m&server=${key}`)
        .then(r => [key, decimate(r.data.rows)])
        .catch(() => [key, null])
    ));
    setHistories(h => {
      const next = { ...h };
      for (const [key, data] of results) if (data) next[key] = data;
      return next;
    });
  }, [agents, hideLocal]);

  useEffect(() => {
    loadHistories();
    const t = setInterval(loadHistories, 30_000);
    return () => clearInterval(t);
  }, [loadHistories]);

  // ── Aktivitäts-Feed (Alerts + Audit + PatchMon), alle 45s ───────────────────
  useEffect(() => {
    const load = () => axios.get('/api/dashboard/activity')
      .then(r => setActivity(r.data.events || [])).catch(() => {});
    load();
    const t = setInterval(load, 45_000);
    return () => clearInterval(t);
  }, []);

  // ── Status-Panel (Uptime-Kuma + Firewall), fail-soft, alle 60s ──────────────
  useEffect(() => {
    const load = () => {
      axios.get('/api/uptime-kuma/monitors')
        .then(r => { const m = r.data.monitors || []; setUptime({ up: m.filter(x => x.status === 1).length, total: m.length }); })
        .catch(() => setUptime(null));
      axios.get('/api/firewall/status')
        .then(r => setFirewall({ active: !!r.data.active })).catch(() => setFirewall(null));
    };
    load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, []);

  // ── Gespeichertes Widget-Layout laden (nur echtes RGL-Format) ───────────────
  useEffect(() => {
    axios.get('/api/dashboard/home-layout')
      .then(r => {
        const l = r.data.layout;
        const isRgl = Array.isArray(l) && l.length && l[0]?.i !== undefined && l[0]?.h !== undefined;
        setRgl(isRgl ? l : null);
      })
      .catch(() => setRgl(null))
      .finally(() => { readyRef.current = true; });
  }, []);

  // ── Lokaler Server: Live-Stats einmischen ──────────────────────────────────
  const localCpu    = liveStats?.cpu ?? localInfo?.cpu?.usage ?? 0;
  const localMemPct = liveStats?.memory?.usedPercent ?? localInfo?.memory?.usedPercent ?? 0;
  const localStats  = localInfo
    ? {
        ...localInfo,
        cpu:    { ...localInfo.cpu,    usage: localCpu },
        memory: { ...localInfo.memory, usedPercent: localMemPct },
      }
    : null;

  // ── Zusammenfassung ────────────────────────────────────────────────────────
  const totalServers  = (hideLocal ? 0 : 1) + agents.length;
  const onlineRemote  = Object.values(agentOnline).filter(Boolean).length;
  const totalOnline   = onlineRemote + (hideLocal ? 0 : 1);
  const totalContainerRunning = Object.values(agentDocker)
    .flat()
    .filter(c => c?.state === 'running').length;

  const unreachable = Object.values(agentOnline).filter(v => v === false).length;

  // ── PatchMon-Aggregat ──────────────────────────────────────────────────────
  const pmConfigured  = patchmonHosts.length > 0;
  const pmWithUpdates = patchmonHosts.filter(h => h.updatesAvailable).length;
  const pmSecurity    = patchmonHosts.reduce((s, h) => s + (h.securityCount || 0), 0);
  const pmReboot      = patchmonHosts.filter(h => h.needsReboot).length;

  // ── KPI-Kennzahlen ──────────────────────────────────────────────────────────
  const onlineStats = [
    ...(hideLocal || !localStats ? [] : [{ cpu: localCpu, mem: localMemPct }]),
    ...agents.filter(a => agentOnline[a.id]).map(a => ({
      cpu: agentStats[a.id]?.cpu?.usage ?? 0,
      mem: agentStats[a.id]?.memory?.usedPercent ?? 0,
    })),
  ];
  const avg = (arr, k) => arr.length ? Math.round(arr.reduce((s, x) => s + (x[k] || 0), 0) / arr.length) : 0;
  const avgCpu = avg(onlineStats, 'cpu');
  const avgRam = avg(onlineStats, 'mem');

  // Aktive Alerts: Regeln, deren jüngstes Ereignis "ausgelöst" (nicht "erholt") ist
  const activeAlerts = (() => {
    const seen = {};
    for (const e of activity) {
      if (e.kind !== 'alert') continue;
      const key = e.title.replace(/^Alert (ausgelöst|erholt) — /, '') + '|' + e.sub;
      if (!(key in seen)) seen[key] = e.severity === 'danger';
    }
    return Object.values(seen).filter(Boolean).length;
  })();

  // ── Frei anordbares Layout (react-grid-layout) ──────────────────────────────
  const serverKeys = [...(hideLocal ? [] : ['local']), ...agents.map(a => String(a.id))];
  const gridLayout = useMemo(
    () => reconcileRgl(rgl ?? mkDefaultRgl(serverKeys), serverKeys),
    [rgl, serverKeys.join(',')], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const onLayoutChange = (l) => {
    setRgl(l);
    if (!readyRef.current) return; // gespeichertes Layout nicht überschreiben, bevor es geladen ist
    clearTimeout(persistRef.current);
    persistRef.current = setTimeout(() => { axios.put('/api/dashboard/home-layout', { layout: l }).catch(() => {}); }, 700);
  };
  const resetLayout = () => { setRgl(null); axios.put('/api/dashboard/home-layout', { layout: [] }).catch(() => {}); };

  const serverName = (key) => (key === 'local' ? 'Panel-Server' : (agents.find(a => String(a.id) === key)?.name || 'Server'));

  // Inhalt eines Widgets (füllt die Höhe der Kachel)
  const widgetContent = (id) => {
    if (id === 'kpi') return (
      <div className="h-full flex items-center">
        <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-2.5 w-full">
          <KpiTile icon={Server}      value={`${totalOnline}/${totalServers}`} label="Server online"
            color={totalOnline < totalServers ? 'text-panel-orange' : 'text-panel-green'} />
          <KpiTile icon={Container}   value={totalContainerRunning} label="Container" />
          <KpiTile icon={Cpu}         value={`${avgCpu}%`} label="Ø CPU" />
          <KpiTile icon={MemoryStick} value={`${avgRam}%`} label="Ø RAM" color="text-panel-green" />
          <KpiTile icon={Bell}        value={activeAlerts} label="Aktive Alerts"
            color={activeAlerts > 0 ? 'text-panel-red' : 'text-panel-muted'} />
          <KpiTile icon={Package}     value={pmConfigured ? pmWithUpdates : '–'} label="Server m. Updates"
            color={pmWithUpdates > 0 ? 'text-panel-orange' : 'text-panel-muted'} />
        </div>
      </div>
    );
    if (id === 'activity') return (
      <div className="h-full flex flex-col bg-panel-card border border-panel-border/70 rounded-2xl overflow-hidden">
        <div className="px-4 py-2.5 border-b border-panel-border/50 flex items-center gap-2 flex-shrink-0">
          <Activity size={13} className="text-panel-accent" />
          <span className="text-xs font-semibold text-panel-text">Aktivität</span>
        </div>
        <div className="flex-1 overflow-auto"><ActivityFeed events={activity} /></div>
      </div>
    );
    if (id === 'status') return (
      <div className="h-full flex flex-col bg-panel-card border border-panel-border/70 rounded-2xl overflow-hidden">
        <div className="px-4 py-2.5 border-b border-panel-border/50 flex items-center gap-2 flex-shrink-0">
          <ShieldAlert size={13} className="text-panel-accent" />
          <span className="text-xs font-semibold text-panel-text">Status</span>
        </div>
        <div className="flex-1 overflow-auto px-4 py-3 space-y-2.5 text-xs">
          {pmConfigured && (
            <button onClick={() => navigate('/patchmon')} className="w-full flex items-center justify-between gap-2">
              <span className="text-panel-muted flex items-center gap-2"><Package size={12} />PatchMon</span>
              <span className={pmWithUpdates > 0 ? 'text-panel-orange' : 'text-panel-green'}>
                {pmWithUpdates > 0
                  ? `${pmWithUpdates} Server · ${pmSecurity} Security${pmReboot > 0 ? ` · ${pmReboot} Neustart` : ''}`
                  : 'alles aktuell'}
              </span>
            </button>
          )}
          {uptime && (
            <div className="flex items-center justify-between gap-2">
              <span className="text-panel-muted flex items-center gap-2"><Activity size={12} />Uptime Kuma</span>
              <span className={uptime.up < uptime.total ? 'text-panel-orange' : 'text-panel-green'}>{uptime.up}/{uptime.total} up</span>
            </div>
          )}
          {firewall && (
            <div className="flex items-center justify-between gap-2">
              <span className="text-panel-muted flex items-center gap-2"><ShieldAlert size={12} />Firewall</span>
              <span className={firewall.active ? 'text-panel-green' : 'text-panel-muted'}>{firewall.active ? 'aktiv' : 'inaktiv'}</span>
            </div>
          )}
          {!pmConfigured && !uptime && !firewall && (
            <div className="text-panel-muted/70 text-center py-2">Keine Status-Dienste verbunden.</div>
          )}
        </div>
      </div>
    );
    if (id.startsWith('server:')) {
      const k = id.slice(7);
      if (k === 'local') return (
        <ServerCard name="Panel-Server" stats={localStats} online={true} isLocal={true} docker={null} history={histories.local} />
      );
      const a = agents.find(x => String(x.id) === k);
      if (!a) return <div className="h-full bg-panel-card border border-panel-border/70 rounded-2xl" />;
      return (
        <ServerCard name={a.name} stats={agentStats[a.id] ?? null} online={agentOnline[a.id]}
          isLocal={false} docker={agentDocker[a.id] ?? null} history={histories[k]}
          onNavigate={() => navigate(`/agents/${a.id}`)} />
      );
    }
    return null;
  };

  return (
    <div className="space-y-4">

      {/* ── Kopfzeile ──────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 text-xs text-panel-muted flex-wrap">
        {unreachable > 0 && (
          <span className="flex items-center gap-1.5 text-panel-red">
            <WifiOff size={13} />{unreachable} nicht erreichbar
          </span>
        )}
        <span className="flex items-center gap-1.5 ml-auto">
          <Activity size={13} />Live · Auto-Refresh {Math.round(liveInterval / 1000)}s
        </span>
        <button onClick={resetLayout} title="Auf Standard-Anordnung zurücksetzen"
          className="flex items-center gap-1 hover:text-panel-text transition-colors">
          <RotateCcw size={12} />Layout zurücksetzen
        </button>
      </div>

      {/* ── Frei anordbares Widget-Raster (Griff = verschieben, Kanten = Größe) ── */}
      <GridLayout
        className="layout"
        layout={gridLayout}
        cols={GRID_COLS}
        rowHeight={30}
        margin={[14, 14]}
        containerPadding={[0, 0]}
        isDraggable
        isResizable
        draggableHandle=".wdrag"
        resizeHandles={['se', 'e', 's', 'sw']}
        compactType="vertical"
        onLayoutChange={onLayoutChange}
        useCSSTransforms
      >
        {gridLayout.map(it => (
          <div key={it.i} className="group relative">
            <button type="button"
              className="wdrag absolute top-2 right-2 z-10 p-1 rounded-md bg-panel-surface/90 border border-panel-border/60 text-panel-muted opacity-0 group-hover:opacity-100 transition-opacity cursor-move"
              title={`${widgetTitle(it.i, serverName)} verschieben`}
              aria-label="Widget verschieben"
            >
              <GripVertical size={13} />
            </button>
            {widgetContent(it.i)}
          </div>
        ))}
      </GridLayout>
    </div>
  );
}
