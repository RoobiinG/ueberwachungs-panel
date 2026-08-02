import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import axios from 'axios';
import {
  Cpu, HardDrive, Server, MemoryStick, ArrowLeft, RefreshCw,
  Play, Square, RotateCcw, Layers, Network, Database, Zap,
  Package, CircleAlert, ChevronDown, ChevronUp,
  Container, Activity, Pause, CheckCircle2, ArrowUpCircle,
  Terminal, Copy, Check,
  FileText, ShieldAlert, Wrench, XCircle, Trash2, Search, Save, AlertTriangle
} from 'lucide-react';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Modal } from '../components/ui/Modal';
import { useAuth } from '../context/AuthContext';

import { useLiveInterval } from '../hooks/useLiveInterval';

// ── Hilfsfunktionen ────────────────────────────────────────────────────────
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
const fmtTime = (ts) => {
  if (!ts) return '';
  const d = new Date(ts * 1000);
  return d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
};

const colorFor = (pct) => {
  if (pct >= 90) return 'bg-panel-red';
  if (pct >= 70) return 'bg-panel-orange';
  return 'bg-panel-accent';
};

// ── Mini Progress Bar ──────────────────────────────────────────────────────
function PctBar({ value, max = 100, label, sub, color }) {
  const pct = Math.min(Math.round((value / (max || 1)) * 100), 100);
  const barColor = color || colorFor(pct);
  return (
    <div className="flex-1 min-w-0">
      <div className="flex justify-between text-xs mb-1">
        <span className="text-panel-muted truncate">{label}</span>
        <span className="text-panel-text ml-2 flex-shrink-0">{sub}</span>
      </div>
      <div className="h-1.5 bg-panel-surface rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

// ── State Badge ────────────────────────────────────────────────────────────
function StateBadge({ state }) {
  const map = {
    running: 'green',
    exited:  'red',
    paused:  'orange',
    created: 'blue',
    dead:    'red',
    restarting: 'orange',
  };
  return <Badge color={map[state] || 'gray'}>{state}</Badge>;
}

// ── Stat Overview Box ──────────────────────────────────────────────────────
function OverviewBox({ icon: Icon, label, value, sub, color = 'text-panel-accent' }) {
  return (
    <div className="bg-panel-surface rounded-lg px-4 py-3 flex items-center gap-3">
      <div className={`flex-shrink-0 ${color}`}>
        <Icon size={20} />
      </div>
      <div className="min-w-0">
        <p className="text-lg font-bold text-panel-text leading-none">{value}</p>
        <p className="text-xs text-panel-muted mt-0.5">{label}</p>
        {sub && <p className="text-xs text-panel-muted/70">{sub}</p>}
      </div>
    </div>
  );
}

// ── Recovery Guide ─────────────────────────────────────────────────────────
function RecoveryGuide({ token }) {
  const [copied, setCopied] = useState(null);
  const panelUrl = window.location.origin;

  const steps = [
    {
      label: 'Panel Docker neu bauen',
      cmd: 'docker compose up -d --build',
      note: 'Auf dem Panel-Server ausführen',
    },
    {
      label: 'Korrektes Agent-Script herunterladen',
      cmd: `systemctl stop panel-agent\n\ncurl -o /opt/panel-agent/panel-agent.js \\\n  -H "Authorization: Bearer ${token}" \\\n  ${panelUrl}/api/agents/download-script\n\nhead -2 /opt/panel-agent/panel-agent.js\n# Erwartete Ausgabe: #!/usr/bin/env node\n\nsystemctl start panel-agent`,
      note: 'Auf dem Remote-Server (SSH) ausführen',
    },
  ];

  const copy = (text, key) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(key);
      setTimeout(() => setCopied(null), 2000);
    });
  };

  return (
    <div className="mt-4 space-y-3">
      <div className="flex items-center gap-2 text-xs text-panel-muted font-medium">
        <Terminal size={13} />
        Manuelle Wiederherstellung
      </div>
      {steps.map((step, i) => (
        <div key={i} className="bg-panel-surface border border-panel-border rounded-lg overflow-hidden">
          <div className="flex items-center justify-between px-3 py-2 border-b border-panel-border/50">
            <span className="text-xs font-medium text-panel-text">
              <span className="text-panel-accent font-bold mr-2">{i + 1}.</span>
              {step.label}
            </span>
            <span className="text-[10px] text-panel-muted">{step.note}</span>
          </div>
          <div className="relative group">
            <pre className="text-[11px] font-mono text-panel-text px-3 py-2.5 overflow-x-auto leading-relaxed whitespace-pre">
              {step.cmd}
            </pre>
            <button
              onClick={() => copy(step.cmd, i)}
              className="absolute top-2 right-2 p-1.5 rounded bg-panel-bg/80 border border-panel-border text-panel-muted hover:text-panel-text opacity-0 group-hover:opacity-100 transition-opacity"
              title="Kopieren"
            >
              {copied === i ? <Check size={11} className="text-green-400" /> : <Copy size={11} />}
            </button>
          </div>
        </div>
      ))}
      <p className="text-[10px] text-panel-muted">
        Token und URL sind bereits eingetragen. Tipp: Für zukünftige Updates den <strong className="text-panel-text">Update-Button</strong> im Panel nutzen — kein manuelles Eingreifen nötig.
      </p>
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────
export default function AgentDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { canWrite, token } = useAuth();
  const liveInterval = useLiveInterval();

  const [agentName, setAgentName]         = useState('');
  const [stats,     setStats]             = useState(null);
  const [services,  setServices]          = useState([]);
  const [docker,    setDocker]            = useState(null);
  const [containers, setContainers]       = useState(null);
  const [loading,   setLoading]           = useState(true);
  const [refreshing, setRefreshing]       = useState(false);
  const [error,     setError]             = useState('');
  const [serviceFilter, setServiceFilter] = useState('');
  const [actionLoading, setActionLoading] = useState({});
  const [activeTab, setActiveTab]         = useState('docker');
  const [expandedContainers, setExpandedContainers] = useState({});
  const [agentVersion, setAgentVersion]   = useState(null);
  const [latestVersion, setLatestVersion] = useState(null);
  const [updating, setUpdating]           = useState(false);
  const [showRecovery, setShowRecovery]   = useState(false);
  const [agentPmId,  setAgentPmId]        = useState(null);
  const [pmHost,     setPmHost]           = useState(null);
  const [pmSystem,   setPmSystem]         = useState(null);

  // ── Modul 3 & Modul 4 States ───────────────────────────────────────────────
  const [processes,       setProcesses]       = useState([]);
  const [processFilter,   setProcessFilter]   = useState('');
  const [processSort,     setProcessSort]     = useState('cpu'); // 'cpu' oder 'mem'
  const [killModal,       setKillModal]       = useState(null);  // { pid, command }
  const [killingPid,      setKillingPid]      = useState(false);
  const [serverNotes,     setServerNotes]     = useState({ title: '', content_md: '' });
  const [savingNotes,     setSavingNotes]     = useState(false);
  const [notesSaved,      setNotesSaved]      = useState(false);
  const [maintenance,     setMaintenance]     = useState(null);
  const [settingMaintenance, setSettingMaintenance] = useState(false);

  const load = useCallback(async (silent = false) => {

    if (!silent) setLoading(true);
    else setRefreshing(true);
    setError('');
    try {
      const [agentsRes, statsRes, servicesRes] = await Promise.all([
        axios.get('/api/agents'),
        axios.get(`/api/agents/${id}/stats`),
        axios.get(`/api/agents/${id}/services`).catch(() => ({ data: [] })),
      ]);
      const agent = agentsRes.data.find(a => String(a.id) === String(id));
      if (agent) setAgentName(agent.name);
      setAgentPmId(agent?.patchmon_host_id || null);
      setStats(statsRes.data);
      setServices(servicesRes.data);

      // Docker + Prozesse + Notizen + Wartungsfenster parallel laden
      const [dockerRes, containersRes, procRes, notesRes, maintRes] = await Promise.all([
        axios.get(`/api/agents/${id}/docker`).catch(() => null),
        axios.get(`/api/agents/${id}/docker/containers`).catch(() => null),
        axios.get(`/api/agents/${id}/processes`).catch(() => null),
        axios.get(`/api/agents/${id}/notes`).catch(() => null),
        axios.get(`/api/agents/${id}/maintenance`).catch(() => null),
      ]);
      setDocker(dockerRes?.data || null);
      setContainers(containersRes?.data || null);
      if (procRes?.data) setProcesses(Array.isArray(procRes.data) ? procRes.data : []);
      if (notesRes?.data) setServerNotes(notesRes.data);
      if (maintRes?.data) setMaintenance(maintRes.data);
    } catch (err) {
      setError(err.response?.data?.error || 'Agent nicht erreichbar');
    }
    setLoading(false);
    setRefreshing(false);
  }, [id]);

  const killProcess = async (pid, signal = 'SIGTERM') => {
    setKillingPid(true);
    try {
      await axios.post(`/api/agents/${id}/processes/${pid}/kill`, { signal });
      setKillModal(null);
      setTimeout(() => load(true), 800);
    } catch (err) {
      alert(err.response?.data?.error || 'Fehler beim Beenden des Prozesses');
    }
    setKillingPid(false);
  };

  const saveNotes = async () => {
    setSavingNotes(true);
    try {
      await axios.put(`/api/agents/${id}/notes`, serverNotes);
      setNotesSaved(true);
      setTimeout(() => setNotesSaved(false), 3000);
    } catch (err) {
      alert('Fehler beim Speichern der Notiz');
    }
    setSavingNotes(false);
  };

  const toggleMaintenance = async (hours) => {
    setSettingMaintenance(true);
    try {
      if (hours === 0 || (maintenance && maintenance.active && !hours)) {
        await axios.delete(`/api/agents/${id}/maintenance`);
      } else {
        await axios.post(`/api/agents/${id}/maintenance`, { hours, reason: 'Geplante Server-Wartung' });
      }
      setTimeout(() => load(true), 400);
    } catch (err) {
      alert('Fehler beim Ändern des Wartungsmodus');
    }
    setSettingMaintenance(false);
  };


  useEffect(() => { load(); }, [load]);

  // Version + Latest beim ersten Laden
  useEffect(() => {
    axios.get(`/api/agents/${id}/version`).then(r => setAgentVersion(r.data.version)).catch(() => {});
    axios.get('/api/agents/latest-version').then(r => setLatestVersion(r.data.version)).catch(() => {});
  }, [id]);

  // PatchMon: verknüpften Host + Kernel-Info laden (fail-soft), sobald die Bindung bekannt ist.
  useEffect(() => {
    if (!agentPmId) { setPmHost(null); setPmSystem(null); return; }
    axios.get('/api/patchmon/hosts')
      .then(r => setPmHost((r.data.hosts || []).find(h => h.id === agentPmId) || null))
      .catch(() => setPmHost(null));
    axios.get(`/api/patchmon/hosts/${encodeURIComponent(agentPmId)}/system`)
      .then(r => setPmSystem(r.data.system || null))
      .catch(() => setPmSystem(null));
  }, [agentPmId]);

  // Auto-refresh (konfigurierbares Intervall)
  useEffect(() => {
    const t = setInterval(() => load(true), liveInterval);
    return () => clearInterval(t);
  }, [load, liveInterval]);

  const serviceAction = async (name, action) => {
    setActionLoading(l => ({ ...l, [name]: action }));
    try {
      await axios.post(`/api/agents/${id}/services/${encodeURIComponent(name)}/${action}`);
      setTimeout(() => load(true), 800);
    } catch (err) {
      alert(err.response?.data?.error || 'Fehler');
    }
    setActionLoading(l => ({ ...l, [name]: null }));
  };

  const containerAction = async (cid, action) => {
    const key = `${cid}_${action}`;
    setActionLoading(l => ({ ...l, [key]: true }));
    try {
      await axios.post(`/api/agents/${id}/docker/containers/${cid}/${action}`);
      setTimeout(() => load(true), 800);
    } catch (err) {
      alert(err.response?.data?.error || 'Fehler');
    }
    setActionLoading(l => ({ ...l, [key]: false }));
  };

  const toggleExpand = (cid) => setExpandedContainers(e => ({ ...e, [cid]: !e[cid] }));

  const doUpdate = async () => {
    if (!confirm('Agent jetzt aktualisieren?')) return;
    setUpdating(true);
    try {
      const { data } = await axios.post(`/api/agents/${id}/update`);
      alert(`✓ Update erfolgreich!\n${data.oldVersion} → ${data.newVersion}\nAgent wird neu gestartet…`);
      setTimeout(() => {
        axios.get(`/api/agents/${id}/version`).then(r => setAgentVersion(r.data.version)).catch(() => {});
      }, 4000);
    } catch (err) {
      alert(err.response?.data?.error || 'Update fehlgeschlagen');
    }
    setUpdating(false);
  };

  const filteredServices = services.filter(s =>
    !serviceFilter || s.name.toLowerCase().includes(serviceFilter.toLowerCase())
  );

  // ── Loading / Error ──────────────────────────────────────────────────────
  if (loading) return (
    <div className="flex items-center justify-center py-20 text-panel-muted text-sm">
      <RefreshCw size={16} className="mr-2 animate-spin" />Verbinde mit Agent...
    </div>
  );

  if (error) return (
    <div className="space-y-4">
      <Button size="sm" variant="ghost" onClick={() => navigate('/agents')}>
        <ArrowLeft size={13} className="mr-1" />Zurück
      </Button>
      <div className="text-center py-8">
        <CircleAlert size={32} className="mx-auto mb-3 text-panel-red opacity-60" />
        <p className="text-panel-red text-sm">{error}</p>
        <Button size="sm" className="mt-4" onClick={() => load()}>Erneut versuchen</Button>
      </div>
      <Card>
        <RecoveryGuide token={token} />
      </Card>
    </div>
  );

  const dockerAvailable = docker !== null && containers !== null;
  const runningCount = containers?.filter(c => c.state === 'running').length ?? 0;
  const stoppedCount = containers?.filter(c => c.state !== 'running').length ?? 0;

  // Tabs anpassen: Docker-Tab nur wenn verfügbar
  const tabs = [
    ...(dockerAvailable ? [{ id: 'docker', label: 'Docker', icon: Container }] : []),
    { id: 'system',    label: 'System',    icon: Server },
    { id: 'services',  label: 'Services',  icon: Activity },
    { id: 'processes', label: 'Prozesse',  icon: Cpu },
    { id: 'notes',     label: 'Notizbuch', icon: FileText },
  ];

  // Initialen Tab setzen wenn Docker nicht verfügbar
  const currentTab = dockerAvailable ? activeTab : (activeTab === 'docker' ? 'system' : activeTab);

  return (
    <div className="space-y-4">
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button size="sm" variant="ghost" onClick={() => navigate('/agents')}>
            <ArrowLeft size={13} className="mr-1" />Zurück
          </Button>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold text-panel-text">{agentName || `Server #${id}`}</h2>
              {maintenance?.active && (
                <Badge color="orange">
                  <Wrench size={11} className="mr-1 inline" />Wartung bis {new Date(maintenance.window.end_time).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}
                </Badge>
              )}
            </div>
            {stats?.os && (
              <p className="text-xs text-panel-muted">{stats.os.hostname} · {stats.os.distro} · Up {fmtUptime(stats.os.uptime)}</p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {agentVersion && (
            <span className="text-xs text-panel-muted font-mono hidden sm:block">v{agentVersion}</span>
          )}
          {canWrite && agentVersion && (
            <Button size="sm" variant="ghost" onClick={doUpdate} disabled={updating}
              title={latestVersion && agentVersion !== latestVersion ? `Update auf v${latestVersion} verfügbar` : 'Agent aktualisieren'}
              className={latestVersion && agentVersion !== latestVersion ? 'text-panel-orange' : ''}>
              <ArrowUpCircle size={13} className={`mr-1 ${updating ? 'animate-spin' : ''}`} />
              {latestVersion && agentVersion !== latestVersion ? `v${latestVersion}` : 'Update'}
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={() => load(true)} disabled={refreshing}>
            <RefreshCw size={13} className={`mr-1 ${refreshing ? 'animate-spin' : ''}`} />Aktualisieren
          </Button>
        </div>
      </div>

      {/* ── Schnell-Übersicht ───────────────────────────────────────────── */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <OverviewBox icon={Cpu} label="CPU" value={`${stats.cpu?.usage ?? 0}%`}
            sub={`${stats.cpu?.cores ?? 0} Kerne`}
            color={stats.cpu?.usage >= 80 ? 'text-panel-red' : 'text-panel-accent'} />
          <OverviewBox icon={MemoryStick} label="RAM"
            value={`${stats.memory?.usedPercent ?? 0}%`}
            sub={`${fmtBytes(stats.memory?.used)} / ${fmtBytes(stats.memory?.total)}`}
            color={stats.memory?.usedPercent >= 80 ? 'text-panel-red' : 'text-panel-green'} />
          {stats.disk?.[0] && (
            <OverviewBox icon={HardDrive} label="Disk (root)"
              value={`${Math.round(stats.disk[0].usedPercent ?? 0)}%`}
              sub={`${fmtBytes(stats.disk[0].used)} / ${fmtBytes(stats.disk[0].size)}`}
              color={stats.disk[0].usedPercent >= 80 ? 'text-panel-red' : 'text-panel-orange'} />
          )}
          {dockerAvailable ? (
            <OverviewBox icon={Container} label="Docker"
              value={`${runningCount} / ${containers.length}`}
              sub={`${runningCount} running · ${stoppedCount} stopped`}
              color="text-panel-accent" />
          ) : (
            <OverviewBox icon={Server} label="OS"
              value={stats.os?.distro?.split(' ')[0] ?? '—'}
              sub={stats.os?.arch ?? ''}
              color="text-panel-purple" />
          )}
        </div>
      )}

      {/* ── PatchMon-Updates (nur wenn Server mit PatchMon-Host verknüpft) ── */}
      {pmHost && (
        <Card title="PatchMon — Updates">
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-2">
              <OverviewBox icon={Package} label="Ausstehend" value={pmHost.updatesCount ?? 0}
                color={pmHost.updatesAvailable ? 'text-panel-orange' : 'text-panel-green'} />
              <OverviewBox icon={CircleAlert} label="Security" value={pmHost.securityCount ?? 0}
                color={pmHost.securityCount > 0 ? 'text-panel-red' : 'text-panel-muted'} />
              <OverviewBox icon={Server} label="Pakete" value={pmHost.totalPackages || '—'}
                color="text-panel-accent" />
            </div>

            {/* Neustart-Status + Kernel (laufend vs. installiert) aus PatchMon /system */}
            {(pmHost.needsReboot || (pmSystem && (pmSystem.kernelRunning || pmSystem.kernelInstalled))) && (
              <div className="flex items-start gap-2 text-xs bg-panel-surface rounded-lg px-3 py-2">
                <RotateCcw size={14} className={`flex-shrink-0 mt-0.5 ${pmHost.needsReboot ? 'text-panel-accent' : 'text-panel-muted'}`} />
                <div className="min-w-0">
                  <span className={pmHost.needsReboot ? 'text-panel-accent font-medium' : 'text-panel-muted'}>
                    {pmHost.needsReboot ? 'Neustart erforderlich' : 'Kein Neustart nötig'}
                  </span>
                  {pmSystem && (pmSystem.kernelRunning || pmSystem.kernelInstalled) && (
                    <div className="text-panel-muted mt-0.5">
                      Kernel: läuft <span className="text-panel-text font-mono">{pmSystem.kernelRunning || '—'}</span>
                      {pmSystem.kernelInstalled && pmSystem.kernelInstalled !== pmSystem.kernelRunning && (
                        <> → installiert <span className="text-panel-orange font-mono">{pmSystem.kernelInstalled}</span></>
                      )}
                      {pmSystem.rebootReason && <span className="text-panel-muted/80"> ({pmSystem.rebootReason})</span>}
                    </div>
                  )}
                </div>
              </div>
            )}

            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-panel-muted truncate">
                {pmHost.lastCheckIn ? `Letzter Check-in: ${new Date(pmHost.lastCheckIn).toLocaleString('de-DE')}` : ''}
              </span>
              <button disabled title="Update-Ausführung folgt in einem späteren Schritt"
                className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded border border-panel-border text-panel-muted/50 cursor-not-allowed flex-shrink-0">
                <ArrowUpCircle size={12} /> Update
              </button>
            </div>
          </div>
        </Card>
      )}

      {/* ── Tabs ───────────────────────────────────────────────────────── */}
      <div className="flex gap-1 border-b border-panel-border">
        {tabs.map(t => (
          <button key={t.id} onClick={() => setActiveTab(t.id)}
            className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-colors -mb-px ${
              currentTab === t.id
                ? 'border-panel-accent text-panel-accent'
                : 'border-transparent text-panel-muted hover:text-panel-text'
            }`}>
            <t.icon size={13} />{t.label}
            {t.id === 'services' && services.length > 0 && (
              <span className="text-panel-muted/60">({services.length})</span>
            )}
            {t.id === 'docker' && containers && (
              <span className="text-panel-muted/60">({containers.length})</span>
            )}
          </button>
        ))}
      </div>

      {/* ══════════════════════════════════════════════════════════════════
          TAB: DOCKER
      ═══════════════════════════════════════════════════════════════════ */}
      {currentTab === 'docker' && dockerAvailable && (
        <div className="space-y-4">
          {/* Docker Overview Bar */}
          {(() => {
            const pausedCount = containers?.filter(c => c.state === 'paused').length ?? 0;
            return (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <OverviewBox icon={Container} label="Container"
                  value={`${runningCount}`}
                  sub={`${stoppedCount} gestoppt · ${pausedCount} pausiert`}
                  color="text-panel-green" />
                <OverviewBox icon={Layers} label="Images"
                  value={docker?.images ?? '—'}
                  color="text-panel-accent" />
                <OverviewBox icon={Database} label="Volumes"
                  value={docker?.volumes != null ? docker.volumes : '—'}
                  color="text-panel-purple" />
                <OverviewBox icon={Network} label="Networks"
                  value={docker?.networks != null ? docker.networks : '—'}
                  sub={docker?.serverVersion ? `Docker ${docker.serverVersion}` : docker?.envName ?? undefined}
                  color="text-panel-orange" />
              </div>
            );
          })()}

          {/* Health Badge */}
          {containers.length > 0 && (
            <div className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium ${
              runningCount === containers.length
                ? 'bg-panel-green/10 text-panel-green'
                : stoppedCount === containers.length
                ? 'bg-panel-red/10 text-panel-red'
                : 'bg-panel-orange/10 text-panel-orange'
            }`}>
              <CheckCircle2 size={13} />
              {runningCount === containers.length
                ? `Alle ${containers.length} Container laufen`
                : `${runningCount} von ${containers.length} Containern aktiv`}
            </div>
          )}

          {/* Container Liste */}
          <Card title="Container">
            <div className="space-y-2">
              {containers.length === 0 && (
                <p className="text-xs text-panel-muted text-center py-4">Keine Container gefunden</p>
              )}
              {containers.map(c => {
                const expanded = expandedContainers[c.id];
                const isRunning = c.state === 'running';
                return (
                  <div key={c.id}
                    className="border border-panel-border rounded-lg overflow-hidden">
                    {/* Container Header */}
                    <div
                      className="flex items-center gap-3 px-3 py-2.5 cursor-pointer hover:bg-panel-surface/50 transition-colors"
                      onClick={() => toggleExpand(c.id)}>
                      <StateBadge state={c.state} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-panel-text truncate">{c.name}</span>
                          {c.stack && (
                            <span className="text-xs text-panel-muted bg-panel-surface px-1.5 py-0.5 rounded">
                              {c.stack}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-panel-muted truncate">{c.image}</p>
                      </div>
                      {/* Quick Stats (nur wenn running + Daten vorhanden) */}
                      {isRunning && (c.cpu != null || c.memUsed != null) && (
                        <div className="hidden sm:flex items-center gap-4 flex-shrink-0">
                          {c.cpu != null && (
                            <div className="text-right">
                              <p className="text-xs font-medium text-panel-text">{(c.cpu).toFixed(1)}%</p>
                              <p className="text-xs text-panel-muted">CPU</p>
                            </div>
                          )}
                          {c.memUsed != null && (
                            <div className="text-right">
                              <p className="text-xs font-medium text-panel-text">{fmtBytes(c.memUsed)}</p>
                              <p className="text-xs text-panel-muted">RAM</p>
                            </div>
                          )}
                        </div>
                      )}
                      {/* Actions */}
                      {canWrite && (
                        <div className="flex gap-0.5 flex-shrink-0" onClick={e => e.stopPropagation()}>
                          {!isRunning && (
                            <button title="Starten"
                              disabled={actionLoading[`${c.id}_start`]}
                              onClick={() => containerAction(c.id, 'start')}
                              className="p-1.5 text-panel-green hover:bg-panel-green/10 rounded transition-colors disabled:opacity-40">
                              <Play size={12} />
                            </button>
                          )}
                          {isRunning && (
                            <button title="Stoppen"
                              disabled={actionLoading[`${c.id}_stop`]}
                              onClick={() => containerAction(c.id, 'stop')}
                              className="p-1.5 text-panel-red hover:bg-panel-red/10 rounded transition-colors disabled:opacity-40">
                              <Square size={12} />
                            </button>
                          )}
                          {isRunning && (
                            <button title="Pausieren"
                              disabled={actionLoading[`${c.id}_pause`]}
                              onClick={() => containerAction(c.id, 'pause')}
                              className="p-1.5 text-panel-muted hover:text-panel-orange hover:bg-panel-orange/10 rounded transition-colors disabled:opacity-40">
                              <Pause size={12} />
                            </button>
                          )}
                          {c.state === 'paused' && (
                            <button title="Fortsetzen"
                              disabled={actionLoading[`${c.id}_unpause`]}
                              onClick={() => containerAction(c.id, 'unpause')}
                              className="p-1.5 text-panel-orange hover:bg-panel-orange/10 rounded transition-colors disabled:opacity-40">
                              <Play size={12} />
                            </button>
                          )}
                          <button title="Neustarten"
                            disabled={actionLoading[`${c.id}_restart`]}
                            onClick={() => containerAction(c.id, 'restart')}
                            className="p-1.5 text-panel-muted hover:text-panel-text hover:bg-panel-surface rounded transition-colors disabled:opacity-40">
                            <RotateCcw size={12} className={actionLoading[`${c.id}_restart`] ? 'animate-spin' : ''} />
                          </button>
                        </div>
                      )}
                      <div className="text-panel-muted flex-shrink-0">
                        {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                      </div>
                    </div>

                    {/* Container Details (ausgeklappt) */}
                    {expanded && (
                      <div className="border-t border-panel-border px-3 py-3 bg-panel-surface/30 space-y-3">
                        {/* CPU + RAM Bars */}
                        {isRunning && (c.cpu != null || c.memUsed != null) && (
                          <div className="space-y-2">
                            {c.cpu != null && (
                              <PctBar label="CPU" value={c.cpu} max={100}
                                sub={`${(c.cpu ?? 0).toFixed(1)}%`} />
                            )}
                            {c.memUsed != null && (
                              <PctBar label="RAM"
                                value={c.memUsed} max={c.memLimit || c.memUsed * 1.2 || 1}
                                sub={`${fmtBytes(c.memUsed)} / ${c.memLimit ? fmtBytes(c.memLimit) : '—'}`} />
                            )}
                          </div>
                        )}
                        {/* Netzwerk & Ports */}
                        <div className="grid grid-cols-2 gap-3 text-xs">
                          {isRunning && (c.netRx > 0 || c.netTx > 0) && (
                            <div>
                              <p className="text-panel-muted mb-1">Netzwerk</p>
                              <p className="text-panel-text">↓ {fmtBytes(c.netRx)} · ↑ {fmtBytes(c.netTx)}</p>
                            </div>
                          )}
                          {c.ports?.length > 0 && (
                            <div>
                              <p className="text-panel-muted mb-1">Ports</p>
                              <div className="flex flex-wrap gap-1">
                                {c.ports.map((p, i) => (
                                  <span key={i} className="font-mono bg-panel-surface px-1.5 py-0.5 rounded text-panel-text">
                                    {p}
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                        <div className="text-xs text-panel-muted">
                          ID: <span className="font-mono text-panel-text/70">{c.id}</span>
                          {c.status && <span className="ml-3">{c.status}</span>}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </Card>

          {/* Disk Usage (docker system df) */}
          {docker.df && (
            <Card title="Docker Speicher">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {[
                  { label: 'Images', icon: Layers,    data: docker.df.images,     color: 'text-panel-accent' },
                  { label: 'Container', icon: Package, data: docker.df.containers, color: 'text-panel-green' },
                  { label: 'Volumes',   icon: Database, data: docker.df.volumes,   color: 'text-panel-purple' },
                ].map(({ label, icon: Icon, data, color }) => (
                  <div key={label} className="bg-panel-surface rounded-lg px-3 py-3">
                    <div className="flex items-center gap-2 mb-2">
                      <Icon size={14} className={color} />
                      <span className="text-xs font-medium text-panel-text">{label}</span>
                      <span className="text-xs text-panel-muted ml-auto">{data.count} Stk.</span>
                    </div>
                    <p className="text-lg font-bold text-panel-text">{fmtBytes(data.size)}</p>
                    {data.reclaimable > 0 && (
                      <p className="text-xs text-panel-muted mt-0.5">{fmtBytes(data.reclaimable)} reclaimable</p>
                    )}
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* Recent Events */}
          {docker.events?.length > 0 && (
            <Card title="Letzte Ereignisse">
              <div className="space-y-1 max-h-48 overflow-y-auto">
                {docker.events.map((e, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs py-1 border-b border-panel-border/50 last:border-0">
                    <Zap size={11} className={
                      ['die', 'kill', 'stop'].includes(e.action) ? 'text-panel-red' :
                      ['start', 'create'].includes(e.action) ? 'text-panel-green' :
                      'text-panel-muted'
                    } />
                    <span className={`font-medium w-16 flex-shrink-0 ${
                      ['die', 'kill', 'stop'].includes(e.action) ? 'text-panel-red' :
                      ['start', 'create'].includes(e.action) ? 'text-panel-green' :
                      'text-panel-text'
                    }`}>{e.action}</span>
                    <span className="text-panel-text truncate flex-1">{e.actor}</span>
                    {e.image && <span className="text-panel-muted truncate hidden sm:block">{e.image}</span>}
                    <span className="text-panel-muted flex-shrink-0">{fmtTime(e.time)}</span>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════
          TAB: SYSTEM
      ═══════════════════════════════════════════════════════════════════ */}
      {currentTab === 'system' && stats && (
        <div className="space-y-4">
          {/* OS Info */}
          <Card title="System">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
              {[
                { label: 'Betriebssystem', value: stats.os?.release || '—' },
                { label: 'Hostname',        value: stats.os?.hostname || '—' },
                { label: 'Architektur',     value: stats.os?.arch || '—' },
                { label: 'Uptime',          value: fmtUptime(stats.os?.uptime) },
              ].map(({ label, value }) => (
                <div key={label}>
                  <p className="text-panel-muted mb-0.5">{label}</p>
                  <p className="text-panel-text font-medium truncate">{value}</p>
                </div>
              ))}
            </div>
          </Card>

          {/* CPU + RAM */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Card title="CPU">
              <div className="space-y-2">
                <PctBar label="Auslastung" value={stats.cpu?.usage ?? 0}
                  sub={`${stats.cpu?.usage ?? 0}%`} />
                <p className="text-xs text-panel-muted">{stats.cpu?.cores ?? 0} Kerne verfügbar</p>
              </div>
            </Card>
            <Card title="Arbeitsspeicher">
              <div className="space-y-2">
                <PctBar label="Belegt" value={stats.memory?.used || 0} max={stats.memory?.total || 1}
                  sub={`${fmtBytes(stats.memory?.used)} / ${fmtBytes(stats.memory?.total)}`} />
                <p className="text-xs text-panel-muted">Frei: {fmtBytes(stats.memory?.free)}</p>
              </div>
            </Card>
          </div>

          {/* Disks */}
          {stats.disk?.length > 0 && (
            <Card title="Festplatten">
              <div className="space-y-4">
                {stats.disk.map((d, i) => (
                  <div key={i}>
                    <div className="flex justify-between text-xs mb-1.5">
                      <span className="text-panel-text font-medium">
                        {d.mount} <span className="text-panel-muted font-normal">({d.fs})</span>
                      </span>
                      <span className="text-panel-muted">
                        {fmtBytes(d.used)} / {fmtBytes(d.size)} — {Math.round(d.usedPercent)}%
                      </span>
                    </div>
                    <div className="h-2 bg-panel-surface rounded-full overflow-hidden">
                      <div className={`h-full rounded-full transition-all ${colorFor(d.usedPercent)}`}
                        style={{ width: `${Math.min(d.usedPercent, 100)}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════
          TAB: SERVICES
      ═══════════════════════════════════════════════════════════════════ */}
      {/* ── Manuelle Wiederherstellung (aufklappbar) ───────────────────── */}
      {canWrite && (
        <div className="border border-panel-border/50 rounded-lg overflow-hidden">
          <button
            onClick={() => setShowRecovery(r => !r)}
            className="w-full flex items-center justify-between px-4 py-2.5 text-xs text-panel-muted hover:text-panel-text hover:bg-panel-surface/50 transition-colors"
          >
            <span className="flex items-center gap-2">
              <Terminal size={13} />
              Manuelle Wiederherstellung
            </span>
            {showRecovery ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          </button>
          {showRecovery && (
            <div className="px-4 pb-4 bg-panel-bg/30">
              <RecoveryGuide token={token} />
            </div>
          )}
        </div>
      )}

      {currentTab === 'services' && (
        <Card title={`Systemd Services (${filteredServices.length})`}>
          <div className="mb-3">
            <input
              className="w-full bg-panel-surface border border-panel-border rounded-md px-3 py-1.5 text-xs text-panel-text focus:outline-none focus:border-panel-accent"
              placeholder="Service suchen..."
              value={serviceFilter}
              onChange={e => setServiceFilter(e.target.value)}
            />
          </div>
          {filteredServices.length === 0 ? (
            <p className="text-xs text-panel-muted text-center py-6">Keine Services gefunden</p>
          ) : (
            <div className="space-y-0.5 max-h-[60vh] overflow-y-auto">
              {filteredServices.map(svc => (
                <div key={svc.name}
                  className="flex items-center justify-between gap-2 px-2 py-1.5 rounded hover:bg-panel-surface transition-colors">
                  <div className="min-w-0 flex-1 flex items-center gap-2">
                    <Badge color={svc.active === 'active' ? 'green' : svc.active === 'failed' ? 'red' : 'gray'}>
                      {svc.active}
                    </Badge>
                    <span className="text-xs text-panel-text truncate font-mono">{svc.name}</span>
                  </div>
                  {canWrite && (
                    <div className="flex gap-0.5 flex-shrink-0">
                      {svc.active !== 'active' && (
                        <button title="Starten" disabled={!!actionLoading[svc.name]}
                          onClick={() => serviceAction(svc.name, 'start')}
                          className="p-1 text-panel-green hover:bg-panel-green/10 rounded transition-colors disabled:opacity-40">
                          <Play size={12} />
                        </button>
                      )}
                      {svc.active === 'active' && (
                        <button title="Stoppen" disabled={!!actionLoading[svc.name]}
                          onClick={() => serviceAction(svc.name, 'stop')}
                          className="p-1 text-panel-red hover:bg-panel-red/10 rounded transition-colors disabled:opacity-40">
                          <Square size={12} />
                        </button>
                      )}
                      <button title="Neustarten" disabled={!!actionLoading[svc.name]}
                        onClick={() => serviceAction(svc.name, 'restart')}
                        className="p-1 text-panel-muted hover:text-panel-text hover:bg-panel-surface rounded transition-colors disabled:opacity-40">
                        <RotateCcw size={12} className={actionLoading[svc.name] === 'restart' ? 'animate-spin' : ''} />
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {/* ══════════════════════════════════════════════════════════════════
          TAB: PROZESSE (Modul 3)
      ═══════════════════════════════════════════════════════════════════ */}
      {currentTab === 'processes' && (
        <Card title="Top-Prozesse (CPU & RAM)">
          <div className="space-y-3">
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2">
              <div className="relative flex-1">
                <Search size={14} className="absolute left-2.5 top-2.5 text-panel-muted" />
                <input
                  type="text"
                  value={processFilter}
                  onChange={e => setProcessFilter(e.target.value)}
                  placeholder="Prozesse durchsuchen (PID, Name, Befehl)..."
                  className="w-full bg-panel-surface border border-panel-border rounded-lg pl-8 pr-3 py-1.5 text-xs text-panel-text focus:outline-none focus:border-panel-accent"
                />
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setProcessSort('cpu')}
                  className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
                    processSort === 'cpu'
                      ? 'border-panel-accent bg-panel-accent/10 text-panel-accent'
                      : 'border-panel-border text-panel-muted hover:text-panel-text'
                  }`}
                >
                  Nach CPU sortieren
                </button>
                <button
                  onClick={() => setProcessSort('mem')}
                  className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
                    processSort === 'mem'
                      ? 'border-panel-accent bg-panel-accent/10 text-panel-accent'
                      : 'border-panel-border text-panel-muted hover:text-panel-text'
                  }`}
                >
                  Nach RAM sortieren
                </button>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-panel-border text-panel-muted">
                    <th className="py-2 px-2">PID</th>
                    <th className="py-2 px-2">USER</th>
                    <th className="py-2 px-2 text-right">CPU %</th>
                    <th className="py-2 px-2 text-right">RAM %</th>
                    <th className="py-2 px-2">COMMAND</th>
                    {canWrite && <th className="py-2 px-2 text-right">AKTION</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-panel-border/40 font-mono">
                  {processes
                    .filter(p => {
                      if (!processFilter.trim()) return true;
                      const q = processFilter.toLowerCase();
                      return (
                        String(p.pid).includes(q) ||
                        String(p.user).toLowerCase().includes(q) ||
                        String(p.command).toLowerCase().includes(q)
                      );
                    })
                    .sort((a, b) => processSort === 'cpu' ? (b.cpu - a.cpu) : (b.mem - a.mem))
                    .map(p => (
                      <tr key={p.pid} className="hover:bg-panel-surface/60 transition-colors">
                        <td className="py-2 px-2 text-panel-text">{p.pid}</td>
                        <td className="py-2 px-2 text-panel-muted">{p.user}</td>
                        <td className={`py-2 px-2 text-right font-semibold ${p.cpu > 50 ? 'text-panel-red' : p.cpu > 20 ? 'text-panel-orange' : 'text-panel-text'}`}>
                          {p.cpu.toFixed(1)}%
                        </td>
                        <td className={`py-2 px-2 text-right font-semibold ${p.mem > 50 ? 'text-panel-red' : p.mem > 20 ? 'text-panel-orange' : 'text-panel-text'}`}>
                          {p.mem.toFixed(1)}%
                        </td>
                        <td className="py-2 px-2 text-panel-text truncate max-w-xs sm:max-w-md" title={p.command}>
                          {p.command}
                        </td>
                        {canWrite && (
                          <td className="py-2 px-2 text-right">
                            <button
                              onClick={() => setKillModal(p)}
                              className="px-2 py-0.5 rounded border border-panel-red/30 text-panel-red hover:bg-panel-red/10 transition-colors text-[11px]"
                              title="Prozess beenden"
                            >
                              Kill
                            </button>
                          </td>
                        )}
                      </tr>
                    ))}
                  {processes.length === 0 && (
                    <tr>
                      <td colSpan={canWrite ? 6 : 5} className="py-8 text-center text-panel-muted">
                        Keine Prozesse gefunden (oder vom Agenten nicht zurückgegeben).
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </Card>
      )}

      {/* ══════════════════════════════════════════════════════════════════
          TAB: NOTIZBUCH & WARTUNG (Modul 4)
      ═══════════════════════════════════════════════════════════════════ */}
      {currentTab === 'notes' && (
        <div className="space-y-4">
          {/* Wartungsfenster-Steuerung */}
          <Card title="Wartungsmodus (Alarme unterdrücken)">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
              <div className="flex items-start gap-2.5">
                <div className={`p-2 rounded-lg ${maintenance?.active ? 'bg-panel-orange/15 text-panel-orange' : 'bg-panel-surface text-panel-muted'}`}>
                  <Wrench size={18} />
                </div>
                <div>
                  <h4 className="text-sm font-semibold text-panel-text">
                    {maintenance?.active ? 'Wartungsmodus ist aktiv' : 'Keine Wartung aktiv'}
                  </h4>
                  <p className="text-xs text-panel-muted">
                    {maintenance?.active
                      ? `Alle Alarm-Webhooks sind bis ${new Date(maintenance.window.end_time).toLocaleString('de-DE')} stummgeschaltet.`
                      : 'Schalte Alarm-Benachrichtigungen für diesen Server vorübergehend aus (z. B. während Reboots oder Updates).'}
                  </p>
                </div>
              </div>

              {canWrite && (
                <div className="flex flex-wrap items-center gap-1.5">
                  {maintenance?.active ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => toggleMaintenance(0)}
                      disabled={settingMaintenance}
                      className="border border-panel-border text-panel-red hover:bg-panel-red/10"
                    >
                      Wartung beenden
                    </Button>
                  ) : (
                    <>
                      {[1, 2, 4, 12, 24].map(h => (
                        <button
                          key={h}
                          onClick={() => toggleMaintenance(h)}
                          disabled={settingMaintenance}
                          className="px-2.5 py-1.5 text-xs font-medium rounded-lg border border-panel-border text-panel-text hover:border-panel-accent hover:bg-panel-accent/10 transition-colors"
                        >
                          +{h}h
                        </button>
                      ))}
                    </>
                  )}
                </div>
              )}
            </div>
          </Card>

          {/* Server-Notizbuch Editor */}
          <Card
            title="Server-Notizbuch (Runbook & Doku)"
            action={
              canWrite && (
                <Button size="sm" onClick={saveNotes} disabled={savingNotes}>
                  <Save size={14} className="mr-1" />
                  {savingNotes ? 'Speichert...' : notesSaved ? 'Gespeichert ✓' : 'Speichern'}
                </Button>
              )
            }
          >
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-panel-muted mb-1">Titel / Überschrift</label>
                <input
                  type="text"
                  value={serverNotes.title || ''}
                  onChange={e => setServerNotes(s => ({ ...s, title: e.target.value }))}
                  placeholder="z.B. Produktions-Datenbank Server (#1)"
                  disabled={!canWrite}
                  className="w-full bg-panel-surface border border-panel-border rounded-lg px-3 py-1.5 text-sm text-panel-text focus:outline-none focus:border-panel-accent"
                />
              </div>

              <div>
                <label className="block text-xs text-panel-muted mb-1">
                  Notizen & Befehlssammlung (Markdown unterstützt)
                </label>
                <textarea
                  rows={10}
                  value={serverNotes.content_md || ''}
                  onChange={e => setServerNotes(s => ({ ...s, content_md: e.target.value }))}
                  placeholder="# Wichtige Befehle&#10;`docker compose logs -f`&#10;&#10;## Besonderheiten&#10;- Nginx läuft auf Port 80/443"
                  disabled={!canWrite}
                  className="w-full bg-panel-surface border border-panel-border rounded-lg p-3 text-xs text-panel-text font-mono focus:outline-none focus:border-panel-accent"
                />
              </div>

              {serverNotes.updated_at && (
                <p className="text-[11px] text-panel-muted">
                  Zuletzt geändert: {new Date(serverNotes.updated_at).toLocaleString('de-DE')}
                </p>
              )}
            </div>
          </Card>
        </div>
      )}

      {/* ── Kill Process Modal (Modul 3) ───────────────────────────────── */}
      <Modal
        open={!!killModal}
        onClose={() => setKillModal(null)}
        title="Prozess beenden"
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setKillModal(null)}>Abbrechen</Button>
            <Button size="sm" variant="danger" onClick={() => killProcess(killModal?.pid, 'SIGTERM')} disabled={killingPid}>
              SIGTERM (Sanft beenden)
            </Button>
            <Button size="sm" variant="danger" onClick={() => killProcess(killModal?.pid, 'SIGKILL')} disabled={killingPid}>
              SIGKILL (Sofort beenden)
            </Button>
          </>
        }
      >
        {killModal && (
          <div className="space-y-3 text-xs">
            <p className="text-panel-text">
              Möchtest du den folgenden Prozess wirklich beenden?
            </p>
            <div className="bg-panel-surface p-3 rounded-lg border border-panel-border font-mono space-y-1">
              <p><span className="text-panel-muted">PID:</span> <span className="text-panel-text font-semibold">{killModal.pid}</span></p>
              <p><span className="text-panel-muted">USER:</span> <span className="text-panel-text">{killModal.user}</span></p>
              <p><span className="text-panel-muted">CPU/RAM:</span> <span className="text-panel-text">{killModal.cpu}% / {killModal.mem}%</span></p>
              <p className="break-all"><span className="text-panel-muted">COMMAND:</span> <span className="text-panel-text">{killModal.command}</span></p>
            </div>
            <p className="text-panel-muted">
              <strong className="text-panel-red">Hinweis:</strong> SIGTERM bittet den Prozess sich ordentlich zu beenden. SIGKILL schließt ihn sofort ohne Aufräumen.
            </p>
          </div>
        )}
      </Modal>
    </div>
  );
}

