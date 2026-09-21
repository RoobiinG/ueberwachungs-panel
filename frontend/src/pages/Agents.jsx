import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import { ActionMenu } from '../components/ui/ActionMenu';
import {
  ServerCog, Plus, Trash2, Wifi, WifiOff, Eye, EyeOff,
  ChevronRight, Terminal, Lock, LockOpen, ShieldAlert, RefreshCw, Pencil, Container,
  ArrowUpCircle, PackageX, Copy, Check, ChevronDown, ChevronUp, Wrench, Package, RotateCw,
  CheckCircle2, AlertCircle, Clock
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';

const inputCls = 'w-full bg-panel-surface border border-panel-border rounded-md px-3 py-2 text-sm text-panel-text focus:outline-none focus:border-panel-accent transition-colors';

const fmtFingerprint = (fp) => fp ? fp.split(':').slice(0, 8).join(':') + '…' : '';

export default function Agents() {
  const [agents, setAgents]     = useState([]);
  const [status, setStatus]     = useState({});
  const [showForm, setShowForm] = useState(false);
  const [name, setName]         = useState('');
  const [url, setUrl]           = useState('');
  const [token, setToken]       = useState('');
  const [showToken, setShowToken] = useState(false);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState('');
  const [repinning, setRepinning]       = useState({});
  const [dockerInfo, setDockerInfo]     = useState({});
  const [agentVersions, setAgentVersions] = useState({});
  const [latestVersion, setLatestVersion] = useState(null);
  const [updating,     setUpdating]     = useState({});
  const [uninstalling, setUninstalling] = useState({});
  const { isAdmin, hasPermission, token: authToken } = useAuth();
  const [showRecovery, setShowRecovery] = useState(false);
  const [copiedStep,   setCopiedStep]   = useState(null);
  const [editAgent,    setEditAgent]    = useState(null);
  const [editName,     setEditName]     = useState('');
  const [editUrl,      setEditUrl]      = useState('');
  const [editToken,    setEditToken]    = useState('');
  const [showEditToken, setShowEditToken] = useState(false);
  const [editLoading,  setEditLoading]  = useState(false);
  const [editError,    setEditError]    = useState('');
  const [patchmonHosts,      setPatchmonHosts]      = useState([]);
  const [editPatchmonHostId, setEditPatchmonHostId] = useState('');
  const [editDockerEngine, setEditDockerEngine] = useState('agents');
  const [bulkModalOpen,  setBulkModalOpen]  = useState(false);
  const [bulkTargets,    setBulkTargets]    = useState([]);
  const [bulkRunning,    setBulkRunning]    = useState(false);
  const [bulkFinished,   setBulkFinished]   = useState(false);
  const [bulkIncludeAll, setBulkIncludeAll] = useState(false);
  const navigate = useNavigate();

  const load = useCallback(async () => {
    const { data } = await axios.get('/api/agents');
    setAgents(data);
    data.forEach(a => pingAgent(a.id));
  }, []);

  // Neueste verfügbare Version einmalig laden
  useEffect(() => {
    axios.get('/api/agents/latest-version')
      .then(r => setLatestVersion(r.data.version))
      .catch(() => {});
  }, []);

  useEffect(() => { load(); }, [load]);

  // PatchMon-Hosts einmalig laden (für Verknüpfen-Dropdown + Update-Badges); fail-soft.
  useEffect(() => {
    axios.get('/api/patchmon/hosts')
      .then(r => setPatchmonHosts(r.data.hosts || []))
      .catch(() => setPatchmonHosts([]));
  }, []);

  const pingAgent = async (id) => {
    try {
      const { data } = await axios.get(`/api/agents/${id}/ping`);
      setStatus(s => ({ ...s, [id]: data }));
      if (data.online) {
        // Docker-Info + Version im Hintergrund laden
        axios.get(`/api/agents/${id}/docker`)
          .then(r => setDockerInfo(d => ({ ...d, [id]: r.data })))
          .catch(() => {});
        axios.get(`/api/agents/${id}/version`)
          .then(r => setAgentVersions(v => ({ ...v, [id]: r.data.version })))
          .catch(() => {});
      }
    } catch {
      setStatus(s => ({ ...s, [id]: { online: false } }));
    }
  };

  const addAgent = async () => {
    if (!name.trim() || !url.trim()) return setError('Name und URL erforderlich');
    setLoading(true); setError('');
    try {
      await axios.post('/api/agents', { name: name.trim(), url: url.trim(), token: token.trim() });
      setName(''); setUrl(''); setToken(''); setShowForm(false);
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Fehler beim Hinzufügen');
    }
    setLoading(false);
  };

  const remove = async (id, agentName) => {
    if (!confirm(`"${agentName}" wirklich entfernen?`)) return;
    await axios.delete(`/api/agents/${id}`);
    load();
  };

  const openEdit = (agent) => {
    setEditAgent(agent);
    setEditName(agent.name);
    setEditUrl(agent.url);
    setEditToken('');
    // Vorbelegung: bestehende Verknüpfung, sonst Vorschlag per Hostname-Match.
    let pmId = agent.patchmon_host_id || '';
    if (!pmId) {
      const hn = (status[agent.id]?.hostname || '').toLowerCase();
      const match = hn && patchmonHosts.find(
        h => (h.hostname || '').toLowerCase() === hn || (h.name || '').toLowerCase() === hn
      );
      if (match) pmId = match.id;
    }
    setEditPatchmonHostId(pmId);
    setEditDockerEngine(agent.docker_engine || 'agents');
    setEditError('');
    setShowEditToken(false);
  };

  const saveEdit = async () => {
    if (!editName.trim() || !editUrl.trim()) return setEditError('Name und URL erforderlich');
    setEditLoading(true); setEditError('');
    try {
      await axios.put(`/api/agents/${editAgent.id}`, {
        name:  editName.trim(),
        url:   editUrl.trim(),
        token: editToken || undefined, // leer = unverändert lassen wenn Backend COALESCE nutzt
        patchmon_host_id: editPatchmonHostId || null, // '' / null = Verknüpfung entfernen
        docker_engine: editDockerEngine
      });
      setEditAgent(null);
      load();
    } catch (err) {
      setEditError(err.response?.data?.error || 'Fehler beim Speichern');
    }
    setEditLoading(false);
  };

  const repin = async (id) => {
    setRepinning(r => ({ ...r, [id]: true }));
    try {
      await axios.post(`/api/agents/${id}/repin`);
      load();
    } catch (err) {
      alert(err.response?.data?.error || 'Fehler beim Erneuern');
    }
    setRepinning(r => ({ ...r, [id]: false }));
  };

  const updateAgent = async (id) => {
    if (!confirm('Agent jetzt auf die neueste Version aktualisieren?')) return;
    setUpdating(u => ({ ...u, [id]: true }));
    try {
      const { data } = await axios.post(`/api/agents/${id}/update`);
      alert(`✓ Update erfolgreich!\n${data.oldVersion} → ${data.newVersion}\nAgent wird neu gestartet…`);
      // Nach Neustart Version neu laden
      setTimeout(() => {
        axios.get(`/api/agents/${id}/version`)
          .then(r => setAgentVersions(v => ({ ...v, [id]: r.data.version })))
          .catch(() => {});
      }, 4000);
    } catch (err) {
      alert(err.response?.data?.error || 'Update fehlgeschlagen');
    }
    setUpdating(u => ({ ...u, [id]: false }));
  };

  const uninstallAgent = async (id, agentName) => {
    if (!confirm(
      `"${agentName}" wirklich deinstallieren?\n\n` +
      `Der Agent-Service wird auf dem Server gestoppt und vollständig entfernt.\n` +
      `Der Server wird anschließend auch aus diesem Panel gelöscht.`
    )) return;
    setUninstalling(u => ({ ...u, [id]: true }));
    try {
      await axios.post(`/api/agents/${id}/uninstall`);
      load();
    } catch (err) {
      alert(err.response?.data?.error || 'Deinstallation fehlgeschlagen');
      setUninstalling(u => ({ ...u, [id]: false }));
    }
  };

  const isHttps = (u) => u?.startsWith('https://');

  const canUpdate = isAdmin || hasPermission('agents.update');

  const outdatedAgents = agents.filter(agent => {
    const s = status[agent.id];
    const online = s?.online;
    const mitm = s?.mitm;
    const agentVer = agentVersions[agent.id];
    return online && !mitm && agentVer && latestVersion && agentVer !== latestVersion;
  });

  const openBulkModal = (all = false) => {
    const targets = agents
      .filter(a => {
        const s = status[a.id];
        if (!s?.online || s?.mitm) return false;
        const ver = agentVersions[a.id];
        return all ? true : (ver && latestVersion && ver !== latestVersion);
      })
      .map(a => ({
        id: a.id,
        name: a.name,
        url: a.url,
        currentVersion: agentVersions[a.id] || 'unbekannt',
        targetVersion: latestVersion,
        status: 'pending',
        error: null,
      }));

    setBulkTargets(targets);
    setBulkRunning(false);
    setBulkFinished(false);
    setBulkModalOpen(true);
  };

  const startBulkUpdate = async () => {
    setBulkRunning(true);
    let updatedAny = false;

    for (let i = 0; i < bulkTargets.length; i++) {
      const target = bulkTargets[i];
      setBulkTargets(prev => prev.map((t, idx) => idx === i ? { ...t, status: 'updating' } : t));

      try {
        const { data } = await axios.post(`/api/agents/${target.id}/update`);
        updatedAny = true;
        setBulkTargets(prev => prev.map((t, idx) => idx === i ? {
          ...t,
          status: 'done',
          newVersion: data.newVersion || latestVersion
        } : t));
        setAgentVersions(v => ({ ...v, [target.id]: data.newVersion || latestVersion }));
      } catch (err) {
        setBulkTargets(prev => prev.map((t, idx) => idx === i ? {
          ...t,
          status: 'error',
          error: err.response?.data?.error || err.message || 'Update fehlgeschlagen'
        } : t));
      }
    }

    setBulkRunning(false);
    setBulkFinished(true);

    if (updatedAny) {
      setTimeout(() => {
        load();
      }, 4000);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-sm font-semibold text-panel-text">Remote Server ({agents.length})</h2>
        <div className="flex items-center gap-2">
          {canUpdate && outdatedAgents.length > 0 && (
            <Button
              size="sm"
              variant="warning"
              onClick={() => { setBulkIncludeAll(false); openBulkModal(false); }}
              disabled={bulkRunning}
              title={`Alle ${outdatedAgents.length} veralteten Agenten auf v${latestVersion} aktualisieren`}
            >
              <ArrowUpCircle size={13} className={bulkRunning ? 'animate-spin' : ''} />
              Alle auf v{latestVersion} aktualisieren ({outdatedAgents.length})
            </Button>
          )}
          <Button size="sm" onClick={() => setShowForm(v => !v)}>
            <Plus size={13} className="mr-1" />{showForm ? 'Abbrechen' : 'Server hinzufügen'}
          </Button>
        </div>
      </div>

      {showForm && (
        <Card title="Neuen Server hinzufügen">
          <div className="space-y-3">
            <div>
              <label className="block text-xs text-panel-muted mb-1">Name</label>
              <input className={inputCls} value={name} onChange={e => setName(e.target.value)}
                placeholder="Mein Server" />
            </div>
            <div>
              <label className="block text-xs text-panel-muted mb-1">
                Agent URL
                <span className="ml-2 text-panel-green font-normal">https:// empfohlen</span>
              </label>
              <input className={inputCls} value={url} onChange={e => setUrl(e.target.value)}
                placeholder="https://192.168.1.100:7331" />
              {url && !isHttps(url) && (
                <p className="text-xs text-panel-orange mt-1 flex items-center gap-1">
                  <LockOpen size={11} />Verbindung ist unverschlüsselt
                </p>
              )}
              {url && isHttps(url) && (
                <p className="text-xs text-panel-green mt-1 flex items-center gap-1">
                  <Lock size={11} />TLS-Fingerprint wird automatisch beim Hinzufügen gespeichert
                </p>
              )}
            </div>
            <div>
              <label className="block text-xs text-panel-muted mb-1">Token (aus install.sh)</label>
              <div className="relative">
                <input className={inputCls + ' pr-9'} type={showToken ? 'text' : 'password'}
                  value={token} onChange={e => setToken(e.target.value)} placeholder="••••••••" />
                <button type="button" onClick={() => setShowToken(v => !v)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-panel-muted hover:text-panel-text">
                  {showToken ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
            </div>
            {error && <p className="text-xs text-panel-red">{error}</p>}
            <Button size="sm" onClick={addAgent} disabled={loading}>
              {loading ? 'Verbinde…' : 'Hinzufügen'}
            </Button>
          </div>
        </Card>
      )}

      {/* Install-Anleitung */}
      {(() => {
        const installCmd = `curl -sL ${window.location.origin}/api/agents/install-script | bash`;
        return (
          <Card title={<span className="flex items-center gap-2"><Terminal size={14} />Agent installieren</span>}>
            <p className="text-xs text-panel-muted mb-2">
              Diesen Befehl auf dem Remote-Server als root ausführen — installiert Agent mit HTTPS-Zertifikat:
            </p>
            <div className="relative group">
              <pre className="bg-panel-surface rounded-md px-3 py-2 text-xs text-panel-green font-mono select-all overflow-x-auto pr-10">
                {installCmd}
              </pre>
              <button
                onClick={() => navigator.clipboard.writeText(installCmd)}
                className="absolute top-1.5 right-2 p-1.5 rounded border border-panel-border text-panel-muted hover:text-panel-text opacity-0 group-hover:opacity-100 transition-opacity bg-panel-bg/80"
                title="Kopieren"
              >
                <Copy size={11} />
              </button>
            </div>
            <p className="text-xs text-panel-muted mt-2">
              Das Skript wird direkt vom Panel geliefert. Am Ende gibt es URL, Token und TLS-Fingerprint aus.
            </p>
            <p className="text-xs text-panel-muted mt-3 pt-3 border-t border-panel-border">
              <span className="text-panel-text font-medium">Deinstallieren:</span>{' '}
              Über den <PackageX size={11} className="inline mx-0.5 text-panel-red" />-Button in der Serverkarte (Agent muss online sein) —
              oder manuell: <code className="text-panel-text">systemctl disable panel-agent --now && rm -rf /opt/panel-agent</code>
            </p>
          </Card>
        );
      })()}

      {/* Manuelle Wiederherstellung */}
      {isAdmin && (() => {
        const panelUrl = window.location.origin;
        const steps = [
          {
            label: '1. Panel Docker neu bauen',
            note:  'Auf dem Panel-Server',
            cmd:   'docker compose up -d --build',
          },
          {
            label: '2. Korrektes Script herunterladen',
            note:  'Auf dem Remote-Server (SSH)',
            cmd:   `systemctl stop panel-agent\n\ncurl -o /opt/panel-agent/panel-agent.js \\\n  -H "Authorization: Bearer ${authToken}" \\\n  ${panelUrl}/api/agents/download-script\n\nhead -2 /opt/panel-agent/panel-agent.js\n# Erwartete Ausgabe: #!/usr/bin/env node\n\nsystemctl start panel-agent`,
          },
        ];
        const copy = (text, i) => {
          navigator.clipboard.writeText(text).then(() => {
            setCopiedStep(i);
            setTimeout(() => setCopiedStep(null), 2000);
          });
        };
        return (
          <div className="border border-panel-border/50 rounded-lg overflow-hidden">
            <button
              onClick={() => setShowRecovery(r => !r)}
              className="w-full flex items-center justify-between px-4 py-2.5 text-xs text-panel-muted hover:text-panel-text hover:bg-panel-surface/50 transition-colors"
            >
              <span className="flex items-center gap-2">
                <Wrench size={13} />
                Manuelle Wiederherstellung / Agent reparieren
              </span>
              {showRecovery ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
            </button>
            {showRecovery && (
              <div className="px-4 pb-4 space-y-3 bg-panel-bg/20">
                <p className="text-xs text-panel-muted pt-2">
                  Wenn der Agent-Service nach einem manuellen <code className="text-panel-text">curl</code>-Update kaputt ist
                  (GitHub 404, falscher Dateiinhalt), diese Schritte ausführen:
                </p>
                {steps.map((step, i) => (
                  <div key={i} className="bg-panel-surface border border-panel-border rounded-lg overflow-hidden">
                    <div className="flex items-center justify-between px-3 py-2 border-b border-panel-border/50">
                      <span className="text-xs font-medium text-panel-text">{step.label}</span>
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
                        {copiedStep === i
                          ? <Check size={11} className="text-panel-green" />
                          : <Copy size={11} />}
                      </button>
                    </div>
                  </div>
                ))}
                <p className="text-[10px] text-panel-muted">
                  Token und URL sind bereits eingetragen. Für zukünftige Updates immer den{' '}
                  <span className="text-panel-text font-medium">Update-Button</span> in der Serverkarte nutzen — kein manuelles Eingreifen nötig.
                </p>
              </div>
            )}
          </div>
        );
      })()}

      {agents.length === 0 && !showForm && (
        <div className="text-center py-12 text-panel-muted text-sm">
          <ServerCog size={32} className="mx-auto mb-3 opacity-40" />
          <p>Noch keine Remote-Server konfiguriert</p>
          <p className="text-xs mt-1">Installiere den Agent auf deinen Servern und füge sie hier hinzu</p>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        {agents.map(agent => {
          const s          = status[agent.id];
          const online     = s?.online;
          const secured    = isHttps(agent.url) && !!agent.fingerprint;
          const mitm       = s?.mitm;
          const dk         = dockerInfo[agent.id];
          const agentVer   = agentVersions[agent.id];
          const hasUpdate  = agentVer && latestVersion && agentVer !== latestVersion;
          const pmHost     = agent.patchmon_host_id
            ? patchmonHosts.find(h => h.id === agent.patchmon_host_id)
            : null;

          return (
            <div key={agent.id}
              className={`bg-panel-card border rounded-lg p-4 flex flex-col gap-3 transition-colors ${
                mitm ? 'border-panel-red' : 'border-panel-border hover:border-panel-accent/40'
              }`}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    {online === undefined
                      ? <span className="w-2 h-2 rounded-full bg-panel-muted animate-pulse flex-shrink-0" />
                      : online
                      ? <Wifi size={14} className="text-panel-green flex-shrink-0" />
                      : <WifiOff size={14} className="text-panel-red flex-shrink-0" />
                    }
                    <span className="text-sm font-medium text-panel-text truncate">{agent.name}</span>
                  </div>
                  <p className="text-xs text-panel-muted mt-0.5 truncate">{agent.url}</p>
                  {s?.hostname && <p className="text-xs text-panel-muted">{s.hostname}</p>}

                  {/* Docker-Info */}
                  {dk && (
                    <div className="mt-1 flex items-center gap-1 text-xs text-panel-muted">
                      <Container size={11} className="text-panel-accent" />
                      <span>
                        <span className="text-panel-green">{dk.containers?.running ?? 0}</span> running
                        {dk.containers?.stopped > 0 && (
                          <span> · <span className="text-panel-red">{dk.containers.stopped}</span> stopped</span>
                        )}
                        <span className="ml-1 text-panel-muted/60">· {dk.images ?? 0} images</span>
                      </span>
                    </div>
                  )}

                  {/* PatchMon-Update-Status (nur wenn verknüpft & Host gefunden) */}
                  {pmHost && (
                    <div className="mt-1 flex items-center gap-1.5 text-xs flex-wrap">
                      {pmHost.updatesAvailable ? (
                        <span className="inline-flex items-center gap-1 text-panel-orange">
                          <Package size={11} />
                          <span className="font-medium">{pmHost.updatesCount}</span> Updates
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-panel-green">
                          <Package size={11} /> aktuell
                        </span>
                      )}
                      {pmHost.securityCount > 0 && (
                        <span className="inline-flex items-center gap-1 text-panel-red">
                          <ShieldAlert size={11} />
                          <span className="font-medium">{pmHost.securityCount}</span> Security
                        </span>
                      )}
                      {pmHost.needsReboot && (
                        <span className="inline-flex items-center gap-1 text-panel-accent">
                          <RotateCw size={11} /> Neustart
                        </span>
                      )}
                    </div>
                  )}

                  {/* Version + Update */}
                  {agentVer && (
                    <div className="mt-1 flex items-center gap-1.5 flex-wrap">
                      <span className="text-xs text-panel-muted font-mono">v{agentVer}</span>
                      {hasUpdate && (
                        <span className="text-xs text-panel-orange font-medium">
                          → v{latestVersion} verfügbar
                        </span>
                      )}
                    </div>
                  )}

                  {/* Security-Status */}
                  <div className="mt-1.5 flex items-center gap-1.5">
                    {mitm ? (
                      <span className="flex items-center gap-1 text-xs text-panel-red font-medium">
                        <ShieldAlert size={11} />MITM-Warnung!
                      </span>
                    ) : secured ? (
                      <span className="flex items-center gap-1 text-xs text-panel-green">
                        <Lock size={11} />TLS · {fmtFingerprint(agent.fingerprint)}
                      </span>
                    ) : isHttps(agent.url) ? (
                      <span className="flex items-center gap-1 text-xs text-panel-orange">
                        <LockOpen size={11} />HTTPS ohne Pinning
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 text-xs text-panel-muted">
                        <LockOpen size={11} />Unverschlüsselt
                      </span>
                    )}
                  </div>
                </div>

                {/* Aktionen — Update (falls verfügbar) und Bearbeiten sichtbar,
                    alles Seltenere benannt im Menü. */}
                <div className="flex flex-wrap items-start justify-end gap-1 flex-shrink-0">
                  {isAdmin && online && !mitm && hasUpdate && (
                    <Button size="sm" variant="warning" onClick={() => updateAgent(agent.id)}
                      disabled={updating[agent.id]} title={`Agent auf v${latestVersion} aktualisieren`}>
                      <ArrowUpCircle size={12} className={updating[agent.id] ? 'animate-spin' : ''} />
                      {updating[agent.id] ? 'Aktualisiert…' : `Update auf v${latestVersion}`}
                    </Button>
                  )}
                  {hasPermission('agents.edit') && (
                    <Button size="sm" variant="ghost" onClick={() => openEdit(agent)} title="Token, URL und Namen ändern">
                      <Pencil size={12} />Bearbeiten
                    </Button>
                  )}
                  <ActionMenu
                    items={[
                      isAdmin && online && !mitm && !hasUpdate && {
                        icon: ArrowUpCircle,
                        label: updating[agent.id] ? 'Aktualisiert…' : 'Agent aktualisieren',
                        onClick: () => updateAgent(agent.id),
                        disabled: updating[agent.id],
                        title: 'Agent-Skript neu ausrollen, auch ohne neue Version',
                      },
                      isHttps(agent.url) && hasPermission('agents.edit') && {
                        icon: RefreshCw,
                        label: repinning[agent.id] ? 'Erneuert…' : 'Fingerprint erneuern',
                        onClick: () => repin(agent.id),
                        disabled: repinning[agent.id],
                        title: 'Gespeicherten TLS-Fingerprint durch den aktuellen ersetzen',
                      },
                      isAdmin && online && !mitm && {
                        icon: PackageX,
                        label: uninstalling[agent.id] ? 'Deinstalliert…' : 'Agent deinstallieren',
                        onClick: () => uninstallAgent(agent.id, agent.name),
                        disabled: uninstalling[agent.id],
                        danger: true,
                        title: 'Entfernt den Agent-Dienst auf dem Server selbst',
                      },
                      hasPermission('agents.delete') && {
                        icon: Trash2,
                        label: 'Aus Panel entfernen',
                        onClick: () => remove(agent.id, agent.name),
                        danger: true,
                        title: 'Der Agent bleibt auf dem Server installiert',
                      },
                    ]}
                  />
                </div>
              </div>

              {mitm && (
                <p className="text-xs text-panel-red bg-panel-red/10 rounded px-2 py-1.5">
                  Zertifikat stimmt nicht mit gespeichertem Fingerprint überein. Verbindung blockiert.
                </p>
              )}

              <Button size="sm" variant={online && !mitm ? 'default' : 'ghost'}
                disabled={!online || !!mitm} onClick={() => navigate(`/agents/${agent.id}`)}>
                Details anzeigen <ChevronRight size={13} className="ml-1" />
              </Button>
            </div>
          );
        })}
      </div>

      {/* ── Edit-Modal ── */}
      {editAgent && (
        <Modal
          open={!!editAgent}
          onClose={() => setEditAgent(null)}
          title={`Server bearbeiten: ${editAgent.name}`}
          footer={<>
            <Button variant="ghost" size="sm" onClick={() => setEditAgent(null)}>Abbrechen</Button>
            <Button size="sm" onClick={saveEdit} disabled={editLoading}>
              {editLoading ? 'Speichere…' : 'Speichern'}
            </Button>
          </>}
        >
          <div className="space-y-3">
            {editError && <p className="text-xs text-panel-red">{editError}</p>}
            <div>
              <label className="block text-xs text-panel-muted mb-1">Name</label>
              <input className={inputCls} value={editName} onChange={e => setEditName(e.target.value)} />
            </div>
            <div>
              <label className="block text-xs text-panel-muted mb-1">Agent URL</label>
              <input className={inputCls} value={editUrl} onChange={e => setEditUrl(e.target.value)} />
            </div>
            <div>
              <label className="block text-xs text-panel-muted mb-1">
                Token <span className="text-panel-muted font-normal">(leer lassen = unverändert)</span>
              </label>
              <div className="relative">
                <input
                  className={inputCls + ' pr-9'}
                  type={showEditToken ? 'text' : 'password'}
                  value={editToken}
                  onChange={e => setEditToken(e.target.value)}
                  placeholder="Neues Token eingeben…"
                />
                <button type="button" onClick={() => setShowEditToken(v => !v)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-panel-muted hover:text-panel-text">
                  {showEditToken ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
              <p className="text-xs text-panel-muted mt-1">
                Token findest du auf dem Server in: <code className="text-panel-text">/opt/panel-agent/.env</code>
              </p>
            </div>
            <div>
              <label className="block text-xs text-panel-muted mb-1">Docker Verwaltung</label>
              <select className={inputCls} value={editDockerEngine} onChange={e => setEditDockerEngine(e.target.value)}>
                <option value="agents">Direkt via Agent (Nativ)</option>
                <option value="dockhand">Dockhand Pro (Legacy)</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-panel-muted mb-1">
                PatchMon-Host <span className="text-panel-muted font-normal">(optional — zeigt Update-Infos am Server)</span>
              </label>
              <select
                className={inputCls}
                value={editPatchmonHostId}
                onChange={e => setEditPatchmonHostId(e.target.value)}
              >
                <option value="">Nicht verknüpft</option>
                {patchmonHosts.map(h => (
                  <option key={h.id} value={h.id}>
                    {h.name}{h.hostname && h.hostname !== h.name ? ` (${h.hostname})` : ''}{h.ip ? ` · ${h.ip}` : ''}
                  </option>
                ))}
              </select>
              {patchmonHosts.length === 0 && (
                <p className="text-xs text-panel-muted mt-1">
                  Keine PatchMon-Hosts geladen (PatchMon nicht konfiguriert?).
                </p>
              )}
            </div>
          </div>
        </Modal>
      )}

      {/* Sammel-Update Modal */}
      {bulkModalOpen && (
        <Modal
          open
          onClose={() => { if (!bulkRunning) setBulkModalOpen(false); }}
          title={
            <span className="flex items-center gap-2">
              <ArrowUpCircle size={16} className="text-panel-orange" />
              Agenten-Sammel-Update auf v{latestVersion}
            </span>
          }
          size="lg"
          footer={
            <div className="flex items-center justify-between w-full">
              <div className="text-xs text-panel-muted">
                {bulkRunning && (
                  <span className="flex items-center gap-1.5 text-panel-orange">
                    <RotateCw size={12} className="animate-spin" />
                    Aktualisiere Server {bulkTargets.findIndex(t => t.status === 'updating') + 1} von {bulkTargets.length}…
                  </span>
                )}
                {bulkFinished && (
                  <span className="text-panel-green font-medium">
                    ✓ Sammel-Update abgeschlossen
                  </span>
                )}
              </div>
              <div className="flex gap-2">
                <Button
                  variant="ghost"
                  onClick={() => setBulkModalOpen(false)}
                  disabled={bulkRunning}
                >
                  {bulkFinished ? 'Schließen' : 'Abbrechen'}
                </Button>
                {!bulkFinished && (
                  <Button
                    variant="warning"
                    onClick={startBulkUpdate}
                    disabled={bulkRunning || bulkTargets.length === 0}
                  >
                    <ArrowUpCircle size={13} className={bulkRunning ? 'animate-spin' : ''} />
                    {bulkRunning ? 'Wird aktualisiert…' : `Jetzt ${bulkTargets.length} Agenten aktualisieren`}
                  </Button>
                )}
              </div>
            </div>
          }
        >
          <div className="space-y-4">
            <p className="text-xs text-panel-muted">
              Das neueste Agent-Skript (v{latestVersion}) wird nacheinander auf die ausgewählten Server übertragen und der Dienst <code className="text-panel-text font-mono">panel-agent</code> auf dem jeweiligen Server neu gestartet.
            </p>

            {/* Fortschrittsanzeige */}
            {(bulkRunning || bulkFinished) && (
              <div className="space-y-1.5">
                <div className="flex justify-between text-xs text-panel-muted">
                  <span>Fortschritt</span>
                  <span>
                    {bulkTargets.filter(t => t.status === 'done' || t.status === 'error').length} von {bulkTargets.length} Servern
                  </span>
                </div>
                <div className="w-full bg-panel-surface rounded-full h-2 overflow-hidden border border-panel-border">
                  <div
                    className="bg-panel-accent h-full transition-all duration-300 rounded-full"
                    style={{
                      width: `${(bulkTargets.filter(t => t.status === 'done' || t.status === 'error').length / (bulkTargets.length || 1)) * 100}%`
                    }}
                  />
                </div>
              </div>
            )}

            {/* Server-Liste */}
            <div className="border border-panel-border rounded-lg divide-y divide-panel-border overflow-hidden max-h-72 overflow-y-auto">
              {bulkTargets.map((target) => (
                <div key={target.id} className="p-3 flex items-center justify-between gap-3 bg-panel-card hover:bg-panel-surface/50 transition-colors">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-panel-text truncate">{target.name}</span>
                      <span className="text-[11px] px-1.5 py-0.5 rounded bg-panel-surface border border-panel-border text-panel-muted font-mono">
                        v{target.currentVersion} → v{target.targetVersion}
                      </span>
                    </div>
                    <p className="text-xs text-panel-muted truncate font-mono mt-0.5">{target.url}</p>
                    {target.error && (
                      <p className="text-xs text-panel-red mt-1 flex items-center gap-1">
                        <AlertCircle size={11} className="flex-shrink-0" />
                        {target.error}
                      </p>
                    )}
                  </div>

                  {/* Status Badge */}
                  <div className="flex-shrink-0">
                    {target.status === 'pending' && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs text-panel-muted bg-panel-surface border border-panel-border rounded">
                        <Clock size={11} /> Ausstehend
                      </span>
                    )}
                    {target.status === 'updating' && (
                      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 text-xs text-panel-orange bg-panel-orange/10 border border-panel-orange/30 rounded font-medium">
                        <RotateCw size={11} className="animate-spin" /> Aktualisiert…
                      </span>
                    )}
                    {target.status === 'done' && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs text-panel-green bg-panel-green/10 border border-panel-green/30 rounded font-medium">
                        <CheckCircle2 size={11} /> Aktualisiert
                      </span>
                    )}
                    {target.status === 'error' && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs text-panel-red bg-panel-red/10 border border-panel-red/30 rounded font-medium">
                        <AlertCircle size={11} /> Fehler
                      </span>
                    )}
                  </div>
                </div>
              ))}
              {bulkTargets.length === 0 && (
                <div className="p-6 text-center text-panel-muted text-xs">
                  Keine Server zur Aktualisierung ausgewählt.
                </div>
              )}
            </div>

            {/* Option: Auch bereits aktuelle Server einbeziehen */}
            {!bulkRunning && !bulkFinished && (
              <div className="flex items-center justify-between text-xs text-panel-muted pt-1">
                <label className="flex items-center gap-2 cursor-pointer hover:text-panel-text select-none">
                  <input
                    type="checkbox"
                    checked={bulkIncludeAll}
                    onChange={e => {
                      const check = e.target.checked;
                      setBulkIncludeAll(check);
                      openBulkModal(check);
                    }}
                    className="rounded border-panel-border text-panel-accent focus:ring-0 focus:outline-none"
                  />
                  <span>Auch bereits aktuelle Server einbeziehen ({agents.length} gesamt)</span>
                </label>
              </div>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}
