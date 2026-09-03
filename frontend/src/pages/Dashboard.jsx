import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import RGLBase, { WidthProvider } from 'react-grid-layout';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';
import {
  Cpu, WifiOff, Container, ChevronRight, Server, Activity,
  MemoryStick, HardDrive, Network, ArrowDownToLine, ArrowUpFromLine,
  Clock, Monitor, Package, ShieldAlert, RotateCw, Bell,
  GripVertical, RotateCcw, Trash2, Plus, FileText, Flame
} from 'lucide-react';
import { LineChart, Line, YAxis, ResponsiveContainer, Tooltip } from 'recharts';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';
import { useLiveInterval } from '../hooks/useLiveInterval';
import { useIsMobile } from '../hooks/useIsMobile';

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

const widgetTitle = (id, serverName, item) => {
  if (id === 'kpi')             return 'Übersicht';
  if (id === 'activity')        return 'Aktivität';
  if (id === 'status')          return 'Status';
  if (id === 'hetzner_storage') return 'Hetzner Storage Boxes';
  if (id.startsWith('server:')) return serverName(id.slice(7));
  if (id.startsWith('custom:')) return item?.title || 'Custom Widget';
  return '';
};

// Standard-Anordnung: KPI voll oben, Server-Karten links (2 je Reihe), Aktivität + Status rechts
// Höhe (in Grid-Zeilen) so, dass eine Server-Karte komplett passt (rowHeight 30 + margin 14 → ~514px)
const SERVER_H = 12;
// Layout-Schema-Version — bei Bump werden alte/kaputte gespeicherte Layouts verworfen
const LAYOUT_VERSION = 4;

const mkDefaultRgl = (serverKeys, wantStorage) => {
  const items = [
    { i: 'kpi',      x: 0, y: 0,             w: 12, h: 2,        minW: 4, minH: 2 },
    { i: 'custom:default_alerts', x: 8, y: 2, w: 4, h: 6,        minW: 3, minH: 3, customType: 'active_alerts_tile', title: 'Aktive Alarme' },
    { i: 'activity', x: 8, y: 8,             w: 4,  h: SERVER_H, minW: 3, minH: 5 },
    { i: 'status',   x: 8, y: 8 + SERVER_H,  w: 4,  h: 6,        minW: 3, minH: 3 },
  ];
  if (wantStorage) items.push({ i: 'hetzner_storage', x: 8, y: 14 + SERVER_H, w: 4, h: 6, minW: 3, minH: 3 });
  serverKeys.forEach((k, idx) => {
    items.push({ i: 'server:' + k, x: (idx % 2) * 4, y: 2 + Math.floor(idx / 2) * SERVER_H, w: 4, h: SERVER_H, minW: 3, minH: 6 });
  });
  return items;
};

// Gespeichertes RGL-Layout mit aktueller Serverliste + Storage abgleichen
//
// Wichtig: Eine Kachel darf nur verschwinden, wenn sie wirklich nicht mehr existiert — nicht
// schon dann, wenn ein Abruf gerade nichts geliefert hat. Sonst fällt sie kurz aus dem Layout,
// alles darunter rutscht durch `compactType="vertical"` nach oben, und beim nächsten
// erfolgreichen Abruf landet sie ganz unten wieder. Über `onLayoutChange` wurde dieses
// Zwischenergebnis auch noch gespeichert — genau daher kamen die wandernden Widgets.
const reconcileRgl = (list, serverKeys, wantStorage, serverListeGeladen) => {
  const wantServer = new Set(serverKeys.map(k => 'server:' + k));
  const out = (list || []).filter(it => {
    // Server-Kacheln erst aussortieren, wenn die Agentenliste tatsächlich geladen ist
    if (String(it.i).startsWith('server:')) return serverListeGeladen ? wantServer.has(it.i) : true;
    // Die Storage-Kachel bleibt liegen; sie zeigt selbst an, wenn keine Box vorhanden ist
    if (it.i === 'hetzner_storage')          return true;
    return true;
  });
  const have = new Set(out.map(it => it.i));
  // Neue Server auf zwei Spalten (x 0/4) verteilen, damit keine Spalte leer bleibt
  let placed = out.filter(it => String(it.i).startsWith('server:')).length;
  for (const k of serverKeys) {
    const id = 'server:' + k;
    if (!have.has(id)) {
      out.push({ i: id, x: (placed % 2) * 4, y: 1000 + placed, w: 4, h: SERVER_H, minW: 3, minH: 6 });
      have.add(id); placed++;
    }
  }
  let y = out.reduce((m, it) => Math.max(m, (it.y || 0) + (it.h || 1)), 0);
  if (!have.has('kpi'))      { out.push({ i: 'kpi',      x: 0, y, w: 12, h: 2,        minW: 4, minH: 2 }); y += 2; }
  if (!have.has('activity')) { out.push({ i: 'activity', x: 8, y, w: 4,  h: SERVER_H, minW: 3, minH: 5 }); y += SERVER_H; }
  if (!have.has('status'))   { out.push({ i: 'status',   x: 8, y, w: 4,  h: 6,        minW: 3, minH: 3 }); y += 6; }
  if (wantStorage && !have.has('hetzner_storage')) { out.push({ i: 'hetzner_storage', x: 8, y, w: 4, h: 6, minW: 3, minH: 3 }); }
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

// ── Modal zum Hinzufügen individueller Widgets (Modul 2) ─────────────────────
function AddWidgetModal({ isOpen, onClose, onAdd, serverKeys, serverName }) {
  const [selectedType, setSelectedType] = useState('multi_server_comp');
  const [title, setTitle]               = useState('Server-Vergleich (CPU)');
  const [selectedServers, setSelectedServers] = useState([]);
  const [singleServer, setSingleServer] = useState(serverKeys[0]);
  const [metric, setMetric]             = useState('cpu');

  // Vorauswahl nur beim Öffnen setzen.
  useEffect(() => {
    if (!isOpen) return;
    setSelectedServers(prev => (prev.length ? prev : serverKeys.slice(0, 2)));
  }, [isOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!isOpen) return null;

  const toggleServer = (k) => {
    if (selectedServers.includes(k)) {
      setSelectedServers(selectedServers.filter(x => x !== k));
    } else {
      setSelectedServers([...selectedServers, k]);
    }
  };

  const handleCreate = (e) => {
    e.preventDefault();
    onAdd({
      customType: selectedType,
      title: title || 'Individuelles Widget',
      serverIds: selectedType === 'multi_server_comp' ? selectedServers : [],
      serverId: singleServer,
      metric,
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-lg bg-panel-card border border-panel-border rounded-xl shadow-2xl overflow-hidden">
        <div className="px-5 py-4 border-b border-panel-border flex items-center justify-between">
          <h3 className="text-sm font-semibold text-panel-text flex items-center gap-2">
            + Individuelles Widget hinzufügen
          </h3>
          <button onClick={onClose} className="text-panel-muted hover:text-panel-text text-sm cursor-pointer">✕</button>
        </div>
        <form onSubmit={handleCreate} className="p-5 space-y-4 text-xs">
          <div>
            <label className="block font-medium text-panel-text mb-1">Widget-Typ auswählen</label>
            <select
              value={selectedType}
              onChange={e => {
                setSelectedType(e.target.value);
                if (e.target.value === 'multi_server_comp') setTitle('Server-Vergleich (CPU)');
                if (e.target.value === 'gauge_tile') setTitle('Tachometer Gauge');
                if (e.target.value === 'patchmon_tile') setTitle('PatchMon Sicherheitsampel');
                if (e.target.value === 'uptime_tile') setTitle('Uptime Kuma Statuskachel');
                if (e.target.value === 'log_ticker') setTitle('Live-Log-Ticker');
                if (e.target.value === 'active_alerts_tile') setTitle('Aktive Alarme');
              }}
              className="w-full bg-panel-surface border border-panel-border rounded-md px-3 py-2 text-panel-text focus:outline-none focus:border-panel-accent"
            >
              <option value="multi_server_comp">📈 Multi-Server-Vergleich Chart (CPU / RAM)</option>
              <option value="gauge_tile">⏱️ Tachometer / Gauge-Widget (Live-Last)</option>
              <option value="patchmon_tile">🛡️ PatchMon Sicherheitsampel</option>
              <option value="uptime_tile">🟢 Uptime-Kuma Statuskachel</option>
              <option value="log_ticker">📜 Live-Log-Ticker (Aktuelle Fehlermeldungen)</option>
              <option value="active_alerts_tile">🔥 Aktive Alarme Liste</option>
            </select>
          </div>

          <div>
            <label className="block font-medium text-panel-text mb-1">Titel des Widgets</label>
            <input
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              className="w-full bg-panel-surface border border-panel-border rounded-md px-3 py-2 text-panel-text focus:outline-none focus:border-panel-accent"
            />
          </div>

          {selectedType === 'multi_server_comp' && (
            <div className="space-y-3">
              <div>
                <label className="block font-medium text-panel-text mb-1">Metrik für Vergleich</label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setMetric('cpu')}
                    className={`flex-1 py-1.5 rounded border text-center transition-colors cursor-pointer ${metric === 'cpu' ? 'bg-panel-accent/15 border-panel-accent text-panel-accent font-medium' : 'bg-panel-surface border-panel-border text-panel-muted'}`}
                  >
                    CPU Auslastung (%)
                  </button>
                  <button
                    type="button"
                    onClick={() => setMetric('mem')}
                    className={`flex-1 py-1.5 rounded border text-center transition-colors cursor-pointer ${metric === 'mem' ? 'bg-panel-accent/15 border-panel-accent text-panel-accent font-medium' : 'bg-panel-surface border-panel-border text-panel-muted'}`}
                  >
                    RAM Auslastung (%)
                  </button>
                </div>
              </div>

              <div>
                <label className="block font-medium text-panel-text mb-1">Server zum Vergleichen wählen</label>
                <div className="max-h-36 overflow-y-auto space-y-1.5 bg-panel-surface p-2 rounded border border-panel-border">
                  {serverKeys.map(k => (
                    <label key={k} className="flex items-center gap-2 cursor-pointer hover:text-panel-accent">
                      <input
                        type="checkbox"
                        checked={selectedServers.includes(k)}
                        onChange={() => toggleServer(k)}
                        className="rounded border-panel-border bg-panel-card text-panel-accent"
                      />
                      <span>{serverName(k)}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
          )}

          {selectedType === 'gauge_tile' && (
            <div>
              <label className="block font-medium text-panel-text mb-1">Ziel-Server für Tachometer</label>
              <select
                value={singleServer}
                onChange={e => setSingleServer(e.target.value)}
                className="w-full bg-panel-surface border border-panel-border rounded-md px-3 py-2 text-panel-text focus:outline-none focus:border-panel-accent"
              >
                {serverKeys.map(k => (
                  <option key={k} value={k}>{serverName(k)}</option>
                ))}
              </select>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-3 border-t border-panel-border">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-1.5 rounded border border-panel-border text-panel-muted hover:text-panel-text transition-colors cursor-pointer"
            >
              Abbrechen
            </button>
            <button
              type="submit"
              className="px-4 py-1.5 rounded bg-panel-accent text-white hover:bg-blue-500 font-medium transition-colors cursor-pointer"
            >
              Widget hinzufügen
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function Dashboard({ liveStats }) {
  const navigate  = useNavigate();
  const liveInterval = useLiveInterval();
  const { modules = {} } = useAuth();

  const [agents,      setAgents]      = useState([]);
  const [agentStats,  setAgentStats]  = useState({});   // { [id]: stats }
  const [agentOnline, setAgentOnline] = useState({});   // { [id]: bool }
  const [agentDocker, setAgentDocker] = useState({});   // { [id]: containers[] }
  const [patchmonHosts, setPatchmonHosts] = useState([]);
  const [hetznerBoxes,  setHetznerBoxes]  = useState([]);
  const [histories,   setHistories]   = useState({});   // { [serverKey]: [{cpu,mem}] } für Mini-Charts
  const [activity,    setActivity]    = useState([]);   // Ereignis-Feed
  const [uptime,      setUptime]      = useState(null);  // { up, total }
  const [firewall,    setFirewall]    = useState(null);  // { active }
  const [activeAlertData, setActiveAlertData] = useState({ count: 0, details: [] });  // Zuverlässig vom Backend
  const [rgl, setRgl] = useState(null);   // gespeichertes RGL-Layout (null = Standard)
  const [showAddWidget, setShowAddWidget] = useState(false);
  const persistRef    = useRef(null);
  const readyRef      = useRef(false);    // gespeichertes Layout geladen?
  const agentsRef     = useRef(false);    // Serverliste geladen?
  const [agentsGeladen, setAgentsGeladen] = useState(false);

  // ── Initial-Daten ──────────────────────────────────────────────────────────
  useEffect(() => {
    // Auch im Fehlerfall als "geladen" markieren — sonst bliebe das Layout dauerhaft gesperrt
    axios.get('/api/agents')
      .then(r => setAgents(r.data))
      .catch(() => {})
      .finally(() => { agentsRef.current = true; setAgentsGeladen(true); });
      
    // PatchMon-Gesamtübersicht (fail-soft — nicht konfiguriert = Kachel ausblenden)
    if (modules.patchmon !== false) {
      axios.get('/api/patchmon/hosts').then(r => setPatchmonHosts(r.data.hosts || [])).catch(() => setPatchmonHosts([]));
    } else {
      setPatchmonHosts([]);
    }
  }, [modules.patchmon]);

  // ── Hetzner Storage Boxes (fail-soft, alle 60s) ─────────────────────────────
  useEffect(() => {
    // Bei einem Fehlschlag den letzten bekannten Stand behalten statt auf leer zu setzen —
    // ein kurzer Aussetzer der Hetzner-API darf die Kachel nicht aus dem Layout werfen.
    if (modules.hetzner === false) {
      setHetznerBoxes([]);
      return;
    }
    const load = () => axios.get('/api/hetzner/storage_boxes')
      .then(r => setHetznerBoxes(r.data.boxes || [])).catch(() => {});
    load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, [modules.hetzner]);

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
    const targets = agents.map(a => String(a.id));
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
  }, [agents]);

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

  // ── Aktive Alerts (zuverlässig über Backend statt Activity-Feed) ─────────────
  useEffect(() => {
    const load = () => axios.get('/api/alerts/active-count')
      .then(r => setActiveAlertData({ count: r.data.count || 0, details: r.data.details || [] })).catch(() => {});
    load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, []);

  // ── Status-Panel (Uptime-Kuma + Firewall), fail-soft, alle 60s ──────────────
  useEffect(() => {
    const load = () => {
      if (modules.uptimekuma !== false) {
        axios.get('/api/uptime-kuma/monitors')
          .then(r => { const m = r.data.monitors || []; setUptime({ up: m.filter(x => x.status === 1).length, total: m.length }); })
          .catch(() => setUptime(null));
      } else {
        setUptime(null);
      }
      axios.get('/api/firewall/status')
        .then(r => setFirewall({ active: !!r.data.active })).catch(() => setFirewall(null));
    };
    load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, [modules.uptimekuma]);

  // ── Gespeichertes Widget-Layout laden (nur echtes RGL-Format) ───────────────
  useEffect(() => {
    axios.get('/api/dashboard/home-layout')
      .then(r => {
        const l = r.data.layout;
        // Nur aktuelles Schema übernehmen; ältere/kaputte Layouts verwerfen → Standard
        const valid = Array.isArray(l) && l.length && l[0]?.i !== undefined
          && l[0]?.h !== undefined && l[0]?.v === LAYOUT_VERSION;
        setRgl(valid ? l : null);
      })
      .catch(() => setRgl(null))
      .finally(() => { readyRef.current = true; });
  }, []);

  // ── Zusammenfassung ────────────────────────────────────────────────────────
  const totalServers  = agents.length;
  const onlineRemote  = Object.values(agentOnline).filter(Boolean).length;
  const totalOnline   = onlineRemote;
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
    ...agents.filter(a => agentOnline[a.id]).map(a => ({
      cpu: agentStats[a.id]?.cpu?.usage ?? 0,
      mem: agentStats[a.id]?.memory?.usedPercent ?? 0,
    })),
  ];
  const avg = (arr, k) => arr.length ? Math.round(arr.reduce((s, x) => s + (x[k] || 0), 0) / arr.length) : 0;
  const avgCpu = avg(onlineStats, 'cpu');
  const avgRam = avg(onlineStats, 'mem');

  // Aktive Alerts: direkt vom Backend-Endpunkt (statt fehleranfälligem Activity-Feed-Parsing)
  const activeAlerts = activeAlertData.count;

  // ── Frei anordbares Layout (react-grid-layout) ──────────────────────────────
  const serverKeys = agents.map(a => String(a.id));
  const hasStorage = hetznerBoxes.length > 0;
  const gridLayout = useMemo(
    () => reconcileRgl(rgl ?? mkDefaultRgl(serverKeys, hasStorage), serverKeys, hasStorage, agentsGeladen),
    [rgl, serverKeys.join(','), hasStorage, agentsGeladen], // eslint-disable-line react-hooks/exhaustive-deps
  );

  // Anordnung eines Layouts als Zeichenkette — zum Vergleich, ob sich wirklich etwas geändert hat
  const layoutSignatur = (list) =>
    (list || []).map(it => `${it.i}:${it.x},${it.y},${it.w},${it.h}`).sort().join('|');

  const onLayoutChange = (l) => {
    const merged = l.map(newItem => {
      const existing = (rgl || []).find(x => x.i === newItem.i) || gridLayout.find(x => x.i === newItem.i) || {};
      return { ...existing, ...newItem, v: LAYOUT_VERSION };
    });
    setRgl(merged);
    // Erst speichern, wenn das gespeicherte Layout UND die Serverliste geladen sind. Sonst
    // würde eine Momentaufnahme abgelegt, die noch gar nicht alle Kacheln kennt.
    if (!readyRef.current || !agentsRef.current) return;
    // react-grid-layout meldet auch Umsortierungen, die es selbst ausgelöst hat. Ohne diesen
    // Vergleich schrieb jede davon das gespeicherte Layout um.
    if (layoutSignatur(merged) === layoutSignatur(rgl)) return;
    clearTimeout(persistRef.current);
    persistRef.current = setTimeout(() => { axios.put('/api/dashboard/home-layout', { layout: merged }).catch(() => {}); }, 700);
  };
  const resetLayout = () => { setRgl(null); axios.put('/api/dashboard/home-layout', { layout: [] }).catch(() => {}); };

  const addCustomWidget = (config) => {
    const newId = `custom:${config.customType}:${Date.now()}`;
    const newItem = {
      i: newId,
      x: 0,
      y: 0,
      w: config.customType === 'multi_server_comp' ? 12 : 4,
      h: config.customType === 'multi_server_comp' ? 8 : 6,
      minW: 3,
      minH: 3,
      v: LAYOUT_VERSION,
      ...config,
    };
    const next = [newItem, ...gridLayout];
    setRgl(next);
    axios.put('/api/dashboard/home-layout', { layout: next }).catch(() => {});
    setShowAddWidget(false);
  };

  const removeCustomWidget = (id) => {
    const next = gridLayout.filter(it => it.i !== id);
    setRgl(next);
    axios.put('/api/dashboard/home-layout', { layout: next }).catch(() => {});
  };

  const serverName = (key) => agents.find(a => String(a.id) === key)?.name || 'Server';

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
    if (id === 'hetzner_storage') return (
      <div className="h-full flex flex-col bg-panel-card border border-panel-border/70 rounded-2xl overflow-hidden">
        <div className="px-4 py-2.5 border-b border-panel-border/50 flex items-center gap-2 flex-shrink-0">
          <HardDrive size={13} className="text-panel-accent" />
          <span className="text-xs font-semibold text-panel-text">Hetzner Storage Boxes</span>
        </div>
        <div className="flex-1 overflow-auto px-4 py-3 space-y-3 text-xs">
          {hetznerBoxes.length === 0 ? (
            <div className="text-panel-muted/70 text-center py-2">Keine Storage Boxes.</div>
          ) : hetznerBoxes.map(b => {
            const pct = b.usagePct ?? (b.quotaBytes > 0 ? Math.round((b.usedBytes / b.quotaBytes) * 100) : 0);
            const barColor = pct >= 90 ? 'bg-panel-red' : pct >= 75 ? 'bg-panel-orange' : 'bg-panel-accent';
            return (
              <button key={b.id} onClick={() => navigate('/hetzner')} className="w-full text-left">
                <div className="flex justify-between gap-2">
                  <span className="text-panel-text truncate">{b.name}</span>
                  <span className="tabular-nums text-panel-muted flex-shrink-0">{fmtBytes(b.usedBytes)} / {fmtBytes(b.quotaBytes)}</span>
                </div>
                <div className="h-1.5 bg-panel-surface rounded-full overflow-hidden mt-1">
                  <div className={`h-full rounded-full ${barColor}`} style={{ width: `${Math.min(pct, 100)}%` }} />
                </div>
              </button>
            );
          })}
        </div>
      </div>
    );
    if (id.startsWith('server:')) {
      const k = id.slice(7);
      const a = agents.find(x => String(x.id) === k);
      if (!a) return <div className="h-full bg-panel-card border border-panel-border/70 rounded-2xl" />;
      return (
        <ServerCard name={a.name} stats={agentStats[a.id] ?? null} online={agentOnline[a.id]}
          isLocal={false} docker={agentDocker[a.id] ?? null} history={histories[k]}
          onNavigate={() => navigate(`/agents/${a.id}`)} />
      );
    }
    if (id.startsWith('custom:')) {
      const item = gridLayout.find(x => x.i === id);
      return renderCustomWidget(id, item);
    }
    return null;
  };

  const renderCustomWidget = (id, item) => {
    if (!item) return null;
    const cType = item.customType;

    if (cType === 'multi_server_comp') {
      const chartData = (() => {
        const maxLen = 30;
        const data = [];
        const sids = item.serverIds || [];
        for (let idx = 0; idx < maxLen; idx++) {
          const row = { idx: String(idx) };
          for (const sid of sids) {
            const arr = histories[sid] || [];
            const pt = arr[arr.length - maxLen + idx] || arr[idx] || {};
            row[sid] = pt[item.metric || 'cpu'] ?? 0;
          }
          data.push(row);
        }
        return data;
      })();

      const CUSTOM_COLORS = ['#388bfd', '#3fb950', '#e3b341', '#a371f7', '#f85149', '#58a6ff', '#ec6547', '#a5d6ff'];

      return (
        <div className="h-full flex flex-col bg-panel-card border border-panel-border/70 rounded-2xl overflow-hidden relative group/custom">
          <div className="px-4 py-2.5 border-b border-panel-border/50 flex items-center justify-between flex-shrink-0">
            <div className="flex items-center gap-2">
              <Activity size={13} className="text-panel-accent" />
              <span className="text-xs font-semibold text-panel-text">{item.title || 'Multi-Server-Vergleich'}</span>
              <span className="text-[10px] uppercase font-mono px-1.5 py-0.5 rounded bg-panel-accent/10 text-panel-accent font-medium">
                {item.metric === 'mem' ? 'RAM' : 'CPU'} %
              </span>
            </div>
            <button
              type="button"
              onClick={() => removeCustomWidget(item.i)}
              className="p-1 rounded-md text-panel-muted hover:text-panel-red transition-colors opacity-0 group-hover/custom:opacity-100 cursor-pointer"
              title="Widget löschen"
            >
              <Trash2 size={13} />
            </button>
          </div>
          <div className="flex-1 p-3 flex flex-col justify-between min-h-0">
            <div className="h-[75%] w-full min-h-[120px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 5, right: 10, left: -20, bottom: 5 }}>
                  <YAxis domain={[0, 100]} stroke="#64748b" fontSize={10} tickFormatter={v => `${v}%`} />
                  <Tooltip
                    contentStyle={{ background: '#0f172a', border: '1px solid #334155', borderRadius: '8px', fontSize: '11px' }}
                    labelFormatter={() => 'Zeitverlauf'}
                  />
                  {(item.serverIds || []).map((sid, index) => (
                    <Line
                      key={sid}
                      type="monotone"
                      dataKey={sid}
                      name={serverName(sid)}
                      stroke={CUSTOM_COLORS[index % CUSTOM_COLORS.length]}
                      strokeWidth={2}
                      dot={false}
                      isAnimationActive={false}
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 pt-2 border-t border-panel-border/30 text-[11px]">
              {(item.serverIds || []).map((sid, index) => (
                <div key={sid} className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ backgroundColor: CUSTOM_COLORS[index % CUSTOM_COLORS.length] }} />
                  <span className="text-panel-text font-medium">{serverName(sid)}</span>
                </div>
              ))}
              {(item.serverIds || []).length === 0 && (
                <span className="text-panel-muted">Keine Server ausgewählt.</span>
              )}
            </div>
          </div>
        </div>
      );
    }

    if (cType === 'active_alerts_tile') {
      const details = activeAlertData.details || [];
      return (
        <div className="h-full flex flex-col bg-panel-card border border-panel-border/70 rounded-2xl overflow-hidden relative group/custom">
          <div className="px-4 py-2 border-b border-panel-border/50 flex items-center justify-between flex-shrink-0">
            <span className="text-xs font-semibold text-panel-text flex items-center gap-1.5">
              <Flame size={13} className="text-panel-red" />
              {item.title || 'Aktive Alarme'}
            </span>
            <button
              type="button"
              onClick={() => removeCustomWidget(item.i)}
              className="p-1 rounded-md text-panel-muted hover:text-panel-red transition-colors opacity-0 group-hover/custom:opacity-100 cursor-pointer"
              title="Widget löschen"
            >
              <Trash2 size={13} />
            </button>
          </div>
          <div className="flex-1 overflow-auto p-3">
            {details.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-center space-y-2">
                <div className="w-10 h-10 rounded-full bg-panel-green/15 flex items-center justify-center text-panel-green text-lg">
                  ✓
                </div>
                <div className="text-xs text-panel-muted font-medium">Keine aktiven Alarme</div>
              </div>
            ) : (
              <div className="space-y-2">
                {details.map((h, idx) => (
                  <div key={idx} className="p-2.5 rounded-lg text-xs border border-panel-red/30 bg-panel-red/5 flex flex-col gap-1.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-panel-red truncate">{h.rule_name || 'Unbekannt'}</span>
                      <span className="flex items-center gap-1 text-[10px] text-panel-muted bg-panel-bg px-1.5 py-0.5 rounded border border-panel-border/40">
                        <Server size={10} />{h.agent_name || `Agent #${h.server_key}`}
                      </span>
                    </div>
                    <div className="flex justify-between items-end">
                      <span className="text-[11px] text-panel-muted truncate">
                        {(h.message || '').split('\n')[0].replace(/<[^>]+>/g, '') || 'Keine Details'}
                      </span>
                      <span className="text-[9px] text-panel-muted whitespace-nowrap">
                        {new Date(h.triggered_at + 'Z').toLocaleString('de-DE', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      );
    }

    if (cType === 'gauge_tile') {
      const sid = item.serverId;
      let pct = 0;
      pct = agentStats[sid]?.cpu?.usage ?? 0;
      pct = Math.round(pct);
      const gaugeColor = pct >= 90 ? '#ef4444' : pct >= 75 ? '#f97316' : '#3fb950';
      const radius = 38;
      const circ = 2 * Math.PI * radius;
      const offset = circ - (pct / 100) * circ;

      return (
        <div className="h-full flex flex-col bg-panel-card border border-panel-border/70 rounded-2xl overflow-hidden relative group/custom">
          <div className="px-4 py-2 border-b border-panel-border/50 flex items-center justify-between flex-shrink-0">
            <span className="text-xs font-semibold text-panel-text truncate">{item.title || 'Tachometer'}</span>
            <button
              type="button"
              onClick={() => removeCustomWidget(item.i)}
              className="p-1 rounded-md text-panel-muted hover:text-panel-red transition-colors opacity-0 group-hover/custom:opacity-100 cursor-pointer"
              title="Widget löschen"
            >
              <Trash2 size={13} />
            </button>
          </div>
          <div className="flex-1 flex flex-col items-center justify-center p-3">
            <div className="relative flex items-center justify-center">
              <svg className="w-28 h-28 transform -rotate-90">
                <circle cx="56" cy="56" r={radius} stroke="currentColor" strokeWidth="10" className="text-panel-surface" fill="transparent" />
                <circle
                  cx="56"
                  cy="56"
                  r={radius}
                  stroke={gaugeColor}
                  strokeWidth="10"
                  strokeDasharray={circ}
                  strokeDashoffset={offset}
                  strokeLinecap="round"
                  fill="transparent"
                  className="transition-all duration-500"
                />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
                <span className="text-xl font-bold font-mono text-panel-text">{pct}%</span>
                <span className="text-[10px] text-panel-muted uppercase font-semibold">CPU</span>
              </div>
            </div>
            <div className="text-xs font-medium text-panel-text mt-2 truncate max-w-full">{serverName(sid)}</div>
          </div>
        </div>
      );
    }

    if (cType === 'patchmon_tile') {
      return (
        <div className="h-full flex flex-col bg-panel-card border border-panel-border/70 rounded-2xl overflow-hidden relative group/custom">
          <div className="px-4 py-2 border-b border-panel-border/50 flex items-center justify-between flex-shrink-0">
            <span className="text-xs font-semibold text-panel-text flex items-center gap-1.5">
              <Package size={13} className="text-panel-accent" />
              {item.title || 'PatchMon Ampel'}
            </span>
            <button
              type="button"
              onClick={() => removeCustomWidget(item.i)}
              className="p-1 rounded-md text-panel-muted hover:text-panel-red transition-colors opacity-0 group-hover/custom:opacity-100 cursor-pointer"
              title="Widget löschen"
            >
              <Trash2 size={13} />
            </button>
          </div>
          <div className="flex-1 p-4 flex flex-col justify-center items-center text-center">
            {pmWithUpdates > 0 ? (
              <div className="space-y-2">
                <div className="w-12 h-12 rounded-full bg-panel-orange/15 border border-panel-orange/40 flex items-center justify-center mx-auto text-panel-orange font-bold text-lg">
                  {pmWithUpdates}
                </div>
                <div className="text-xs font-semibold text-panel-text">{pmWithUpdates} Server mit Updates</div>
                <div className="text-[11px] text-panel-muted">
                  {pmSecurity} Security-Patches {pmReboot > 0 ? `· ${pmReboot} Neustarts nötig` : ''}
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="w-12 h-12 rounded-full bg-panel-green/15 border border-panel-green/40 flex items-center justify-center mx-auto text-panel-green font-bold text-lg">
                  ✓
                </div>
                <div className="text-xs font-semibold text-panel-text">Alle Server aktuell</div>
                <div className="text-[11px] text-panel-muted">Keine ausstehenden Patches</div>
              </div>
            )}
            <button
              onClick={() => navigate('/patchmon')}
              className="mt-3 px-3 py-1 bg-panel-surface border border-panel-border hover:border-panel-accent rounded text-xs text-panel-text transition-colors cursor-pointer"
            >
              PatchMon öffnen →
            </button>
          </div>
        </div>
      );
    }

    if (cType === 'uptime_tile') {
      const upCnt = uptime ? uptime.up : 0;
      const totCnt = uptime ? uptime.total : 0;
      const pct = totCnt > 0 ? Math.round((upCnt / totCnt) * 100) : 100;
      return (
        <div className="h-full flex flex-col bg-panel-card border border-panel-border/70 rounded-2xl overflow-hidden relative group/custom">
          <div className="px-4 py-2 border-b border-panel-border/50 flex items-center justify-between flex-shrink-0">
            <span className="text-xs font-semibold text-panel-text flex items-center gap-1.5">
              <Activity size={13} className="text-panel-accent" />
              {item.title || 'Uptime Status'}
            </span>
            <button
              type="button"
              onClick={() => removeCustomWidget(item.i)}
              className="p-1 rounded-md text-panel-muted hover:text-panel-red transition-colors opacity-0 group-hover/custom:opacity-100 cursor-pointer"
              title="Widget löschen"
            >
              <Trash2 size={13} />
            </button>
          </div>
          <div className="flex-1 p-4 flex flex-col justify-center space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs text-panel-muted">Status</span>
              <span className={`text-sm font-bold ${pct < 100 ? 'text-panel-orange' : 'text-panel-green'}`}>
                {upCnt} / {totCnt} Up
              </span>
            </div>
            <div className="h-2 bg-panel-surface rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full ${pct < 100 ? 'bg-panel-orange' : 'bg-panel-green'} transition-all duration-500`}
                style={{ width: `${Math.min(pct, 100)}%` }}
              />
            </div>
            <div className="text-[11px] text-panel-muted text-right font-mono">{pct}% Verfügbarkeit</div>
          </div>
        </div>
      );
    }

    if (cType === 'log_ticker') {
      const recent = (activity || []).slice(0, 6);
      return (
        <div className="h-full flex flex-col bg-panel-card border border-panel-border/70 rounded-2xl overflow-hidden relative group/custom">
          <div className="px-4 py-2 border-b border-panel-border/50 flex items-center justify-between flex-shrink-0">
            <span className="text-xs font-semibold text-panel-text flex items-center gap-1.5">
              <FileText size={13} className="text-panel-accent" />
              {item.title || 'Live-Log-Ticker'}
            </span>
            <button
              type="button"
              onClick={() => removeCustomWidget(item.i)}
              className="p-1 rounded-md text-panel-muted hover:text-panel-red transition-colors opacity-0 group-hover/custom:opacity-100 cursor-pointer"
              title="Widget löschen"
            >
              <Trash2 size={13} />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-3 space-y-2 font-mono text-[11px]">
            {recent.length === 0 ? (
              <div className="text-panel-muted/70 text-center py-2">Keine neueren Log-Ereignisse.</div>
            ) : recent.map((e, idx) => (
              <div key={idx} className="flex items-start gap-2 border-b border-panel-border/30 pb-1.5 last:border-0">
                <span className={`w-1.5 h-1.5 rounded-full mt-1 flex-shrink-0 ${e.severity === 'danger' ? 'bg-panel-red' : e.severity === 'warning' ? 'bg-panel-orange' : 'bg-panel-green'}`} />
                <div className="min-w-0 flex-1">
                  <div className="text-panel-text truncate">{e.title}</div>
                  <div className="text-panel-muted text-[10px] truncate">{e.sub}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      );
    }

    return null;
  };


  // Mobil: einspaltig gestapelt (kein Drag/Resize) → schnelle, saubere Anzeige
  const isMobile = useIsMobile();
  if (isMobile) {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-1.5 text-xs text-panel-muted">
          {unreachable > 0 && <span className="flex items-center gap-1.5 text-panel-red"><WifiOff size={13} />{unreachable} nicht erreichbar</span>}
          <span className="flex items-center gap-1.5 ml-auto"><Activity size={13} />Live · {Math.round(liveInterval / 1000)}s</span>
        </div>
        {gridLayout.map(it => <div key={it.i}>{widgetContent(it.i)}</div>)}
      </div>
    );
  }

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
        <button
          onClick={() => setShowAddWidget(true)}
          className="flex items-center gap-1 px-2.5 py-1 bg-panel-accent/10 border border-panel-accent/40 text-panel-accent hover:bg-panel-accent hover:text-white rounded-md transition-colors cursor-pointer font-medium"
        >
          <Plus size={13} /> Widget hinzufügen
        </button>
        <button onClick={resetLayout} title="Auf Standard-Anordnung zurücksetzen"
          className="flex items-center gap-1 hover:text-panel-text transition-colors cursor-pointer">
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
        {/* Individuelle Widgets haben oben rechts im Kopf ihren eigenen Löschen-Knopf.
            Der Verschieben-Griff muss dort daneben liegen, sonst deckt er ihn ab und das
            Widget lässt sich nicht mehr entfernen. */}
        {gridLayout.map(it => (
          <div key={it.i} className="group relative">
            <button type="button"
              className={`wdrag absolute top-2 ${String(it.i).startsWith('custom:') ? 'right-10' : 'right-2'} z-10 p-1 rounded-md bg-panel-surface/90 border border-panel-border/60 text-panel-muted opacity-0 group-hover:opacity-100 transition-opacity cursor-move`}
              title={`${widgetTitle(it.i, serverName, it)} verschieben`}
              aria-label="Widget verschieben"
            >
              <GripVertical size={13} />
            </button>
            {widgetContent(it.i)}
          </div>
        ))}
      </GridLayout>

      <AddWidgetModal
        isOpen={showAddWidget}
        onClose={() => setShowAddWidget(false)}
        onAdd={addCustomWidget}
        serverKeys={serverKeys}
        serverName={serverName}
      />
    </div>
  );
}
