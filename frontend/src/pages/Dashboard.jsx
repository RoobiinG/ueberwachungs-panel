import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Cpu, WifiOff, Container, ChevronRight, Server, Activity,
  MemoryStick, HardDrive, Network, ArrowDownToLine, ArrowUpFromLine,
  Clock, Monitor, Package, ShieldAlert, RotateCw,
} from 'lucide-react';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';
import { useLiveInterval } from '../hooks/useLiveInterval';

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

// ── Server-Karte ──────────────────────────────────────────────────────────────

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
      className={`border rounded-xl flex flex-col overflow-hidden transition-all duration-200 ${cardCls}`}
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

  // ── PatchMon-Aggregat ──────────────────────────────────────────────────────
  const pmConfigured  = patchmonHosts.length > 0;
  const pmWithUpdates = patchmonHosts.filter(h => h.updatesAvailable).length;
  const pmSecurity    = patchmonHosts.reduce((s, h) => s + (h.securityCount || 0), 0);
  const pmReboot      = patchmonHosts.filter(h => h.needsReboot).length;

  return (
    <div className="space-y-5">

      {/* ── Status-Zeile ──────────────────────────────────────────────── */}
      <div className="flex items-center gap-4 text-xs text-panel-muted flex-wrap">
        <div className="flex items-center gap-1.5">
          <Server size={13} className="text-panel-accent" />
          <span>
            <strong className="text-panel-text">{totalOnline}</strong>
            {' / '}{totalServers} Server online
          </span>
        </div>
        {totalContainerRunning > 0 && (
          <div className="flex items-center gap-1.5">
            <Container size={13} className="text-panel-green" />
            <span>
              <strong className="text-panel-text">{totalContainerRunning}</strong> Container running
            </span>
          </div>
        )}
        {Object.values(agentOnline).includes(false) && (
          <div className="flex items-center gap-1.5 text-panel-red">
            <WifiOff size={13} />
            <span>{Object.values(agentOnline).filter(v => !v).length} nicht erreichbar</span>
          </div>
        )}
        <div className="flex items-center gap-1.5 ml-auto">
          <Activity size={13} />
          <span>Live · Auto-Refresh 15s</span>
        </div>
      </div>

      {/* ── PatchMon-Kachel (nur wenn PatchMon konfiguriert) ──────────── */}
      {pmConfigured && (
        <button onClick={() => navigate('/patchmon')}
          className="w-full flex items-center gap-4 text-xs bg-panel-card border border-panel-border rounded-lg px-4 py-2.5 hover:border-panel-accent/40 transition-colors flex-wrap">
          <span className="flex items-center gap-1.5 text-panel-text font-medium">
            <Package size={13} className="text-panel-accent" /> PatchMon
          </span>
          <span className="text-panel-muted">
            <strong className={pmWithUpdates > 0 ? 'text-panel-orange' : 'text-panel-text'}>{pmWithUpdates}</strong>
            {' '}von {patchmonHosts.length} Servern mit Updates
          </span>
          {pmSecurity > 0 && (
            <span className="flex items-center gap-1.5 text-panel-red">
              <ShieldAlert size={13} /> <strong>{pmSecurity}</strong> Security-Updates
            </span>
          )}
          {pmReboot > 0 && (
            <span className="flex items-center gap-1.5 text-panel-accent">
              <RotateCw size={13} /> <strong>{pmReboot}</strong> Neustart nötig
            </span>
          )}
          <ChevronRight size={13} className="ml-auto text-panel-muted" />
        </button>
      )}

      {/* ── Server-Grid ───────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
        {!hideLocal && (
          <ServerCard
            name="Panel-Server"
            stats={localStats}
            online={true}
            isLocal={true}
            docker={null}
          />
        )}
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

    </div>
  );
}
