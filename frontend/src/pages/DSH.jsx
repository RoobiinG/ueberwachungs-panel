import { useEffect, useState } from 'react';
import axios from 'axios';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { ActionMenu } from '../components/ui/ActionMenu';
import {
  RefreshCw, Play, PowerOff, RotateCcw, Shield, ShieldAlert,
  Terminal, ChevronDown, ChevronUp, Copy, Check, ExternalLink,
  Activity, Globe, Calendar, HardDrive, Cpu, AlertTriangle, X,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';

// ─── Formatierung der Restlaufzeit ───────────────────────────────────────────
function formatDue(dateStr) {
  if (!dateStr) return { text: '—', urgent: false, days: null };
  const due = new Date(dateStr);
  if (isNaN(due.getTime())) return { text: dateStr, urgent: false, days: null };

  const now = new Date();
  now.setHours(0, 0, 0, 0);
  due.setHours(0, 0, 0, 0);

  const diffMs = due.getTime() - now.getTime();
  const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

  const fmtDate = due.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });

  if (diffDays < 0) {
    return { text: `${fmtDate} (Überfällig)`, urgent: true, days: diffDays };
  }
  if (diffDays === 0) {
    return { text: `${fmtDate} (Heute fällig)`, urgent: true, days: 0 };
  }
  if (diffDays <= 7) {
    return { text: `${fmtDate} (noch ${diffDays} Tag${diffDays === 1 ? '' : 'e'})`, urgent: true, days: diffDays };
  }
  return { text: `${fmtDate} (in ${diffDays} Tagen)`, urgent: false, days: diffDays };
}

// ─── Prüfung auf ausgelaufene / gekündigte Server ────────────────────────────
function isExpired(srv) {
  const status = (srv.status || '').toLowerCase();
  if (['cancelled', 'terminated', 'fraud', 'abgelaufen', 'gekündigt'].includes(status)) return true;
  if (status !== 'active' && srv.nextduedate) {
    const due = new Date(srv.nextduedate);
    if (!isNaN(due.getTime()) && due.getTime() < Date.now()) return true;
  }
  return false;
}

// ─── Status-Farbe & Text ──────────────────────────────────────────────────────
function getPowerState(srv) {
  const p = srv.powerStatus;
  const rawStatus = (srv.status || '').toLowerCase();

  if (p) {
    if (typeof p.message === 'string') {
      const msg = p.message.toLowerCase();
      if (msg.includes('power on')) return { label: 'Online', color: 'green', running: true };
      if (msg.includes('power off')) return { label: 'Offline', color: 'red', running: false };
    }
    if (p.vmstatus) {
      const vms = String(p.vmstatus).toLowerCase();
      if (vms === 'running') return { label: 'Online', color: 'green', running: true };
      if (vms === 'stopped') return { label: 'Offline', color: 'red', running: false };
    }
  }

  if (rawStatus === 'active') return { label: 'Aktiv', color: 'green', running: true };
  if (rawStatus === 'suspended') return { label: 'Gesperrt', color: 'red', running: false };
  if (rawStatus === 'cancelled') return { label: 'Gekündigt', color: 'gray', running: false };
  if (rawStatus === 'terminated') return { label: 'Beendet', color: 'gray', running: false };
  return { label: srv.status || 'Unbekannt', color: 'orange', running: false };
}

export default function DSH() {
  const { hasPermission, isAdmin } = useAuth();
  const canView    = isAdmin || hasPermission('dsh.view');
  const canStart   = isAdmin || hasPermission('dsh.start');
  const canStop    = isAdmin || hasPermission('dsh.stop');
  const canReset   = isAdmin || hasPermission('dsh.reset');
  const canRescue  = isAdmin || hasPermission('dsh.rescue');
  const canConsole = isAdmin || hasPermission('dsh.console');
  const canRdns    = isAdmin || hasPermission('dsh.rdns');

  const [services, setServices]   = useState([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState('');
  const [actError, setActError]   = useState('');
  const [actSuccess, setActSuccess] = useState('');
  const [busy, setBusy]           = useState({});
  const [copied, setCopied]       = useState({});
  const [hideExpired, setHideExpired] = useState(() => localStorage.getItem('dsh_hide_expired') !== 'false');

  const expiredCount = services.filter(isExpired).length;
  const visibleServices = hideExpired ? services.filter(s => !isExpired(s)) : services;

  // Ausklappbare Tabs pro Service: 'incidents' | 'rdns' | null
  const [activeTab, setActiveTab] = useState({});

  // Incidents Cache: { [ip]: [] }
  const [incidents, setIncidents] = useState({});
  const [incidentsLoading, setIncidentsLoading] = useState({});

  // rDNS Form: { [ip]: string }
  const [rdnsInputs, setRdnsInputs] = useState({});
  const [rdnsSaving, setRdnsSaving] = useState({});
  const [rdnsMsg, setRdnsMsg]       = useState({});

  // Rescue Modal State
  const [rescueModal, setRescueModal] = useState({ open: false, service: null, password: '', error: '' });
  const [rescueResult, setRescueResult] = useState(null);

  const copyText = (key, text) => {
    if (!text) return;
    navigator.clipboard.writeText(text);
    setCopied(prev => ({ ...prev, [key]: true }));
    setTimeout(() => setCopied(prev => ({ ...prev, [key]: false })), 2000);
  };

  const load = async () => {
    if (!canView) { setLoading(false); return; }
    setLoading(true);
    setError('');
    try {
      const { data } = await axios.get('/api/dsh/services');
      setServices(Array.isArray(data?.items) ? data.items : []);
    } catch (err) {
      setError(err.response?.data?.error || 'DSH_API_TOKEN nicht konfiguriert');
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  // ── Server-Aktionen ──────────────────────────────────────────────────────────
  const act = async (srv, action) => {
    setActError('');
    setActSuccess('');
    const id = srv.serviceid;
    const actionKey = `${id}_${action}`;
    setBusy(b => ({ ...b, [actionKey]: true }));

    try {
      await axios.post(`/api/dsh/services/${id}/${action}`, {
        serverName: srv.domain || srv.name || `DSH-${id}`,
      });
      setActSuccess(`Aktion "${action}" erfolgreich an DSH übermittelt.`);
      setTimeout(() => setActSuccess(''), 5000);
      setTimeout(load, 2000);
    } catch (err) {
      setActError(err.response?.data?.error || `Aktion "${action}" fehlgeschlagen.`);
    }
    setBusy(b => ({ ...b, [actionKey]: false }));
  };

  // ── NoVNC Konsole öffnen ─────────────────────────────────────────────────────
  const openConsole = async (srv) => {
    if (!canConsole) return;
    const id = srv.serviceid;
    setActError('');
    setBusy(b => ({ ...b, [`${id}_console`]: true }));
    try {
      const { data } = await axios.get(`/api/dsh/services/${id}/console`);
      if (data?.url) {
        window.open(data.url, '_blank', 'noopener,noreferrer,width=1024,height=768');
      } else {
        setActError('Keine NoVNC-URL von DSH erhalten.');
      }
    } catch (err) {
      setActError(err.response?.data?.error || 'Konsole konnte nicht geöffnet werden.');
    }
    setBusy(b => ({ ...b, [`${id}_console`]: false }));
  };

  // ── Rescue Modus starten ─────────────────────────────────────────────────────
  const submitRescue = async () => {
    const srv = rescueModal.service;
    if (!srv) return;
    const id = srv.serviceid;

    setRescueModal(m => ({ ...m, error: '' }));
    setBusy(b => ({ ...b, [`${id}_rescue`]: true }));

    try {
      const { data } = await axios.post(`/api/dsh/services/${id}/rescue`, {
        rootpass: rescueModal.password.trim() || undefined,
        serverName: srv.domain || srv.name || `DSH-${id}`,
      });
      setRescueResult({
        serviceName: srv.domain || srv.name,
        rootpass: data.rootpass || rescueModal.password,
      });
      setRescueModal({ open: false, service: null, password: '', error: '' });
      setTimeout(load, 2500);
    } catch (err) {
      setRescueModal(m => ({ ...m, error: err.response?.data?.error || 'Rescue-Start fehlgeschlagen.' }));
    }
    setBusy(b => ({ ...b, [`${id}_rescue`]: false }));
  };

  // ── DDoS Incidents laden ─────────────────────────────────────────────────────
  const toggleIncidents = async (srv) => {
    const id = srv.serviceid;
    const ip = srv.dedicatedip;
    const current = activeTab[id];

    if (current === 'incidents') {
      setActiveTab(prev => ({ ...prev, [id]: null }));
      return;
    }

    setActiveTab(prev => ({ ...prev, [id]: 'incidents' }));

    if (ip && !incidents[ip]) {
      setIncidentsLoading(prev => ({ ...prev, [ip]: true }));
      try {
        const { data } = await axios.get(`/api/dsh/protection/incidents/${encodeURIComponent(ip)}`);
        setIncidents(prev => ({ ...prev, [ip]: data?.items || [] }));
      } catch {
        setIncidents(prev => ({ ...prev, [ip]: [] }));
      }
      setIncidentsLoading(prev => ({ ...prev, [ip]: false }));
    }
  };

  // ── Reverse DNS Tab umschalten & speichern ───────────────────────────────────
  const toggleRdns = (srv) => {
    const id = srv.serviceid;
    const current = activeTab[id];
    if (current === 'rdns') {
      setActiveTab(prev => ({ ...prev, [id]: null }));
    } else {
      setActiveTab(prev => ({ ...prev, [id]: 'rdns' }));
      if (srv.dedicatedip && !rdnsInputs[srv.dedicatedip]) {
        setRdnsInputs(prev => ({ ...prev, [srv.dedicatedip]: srv.domain || '' }));
      }
    }
  };

  const saveRdns = async (ip) => {
    if (!canRdns || !ip) return;
    const record = (rdnsInputs[ip] || '').trim();
    if (!record) return;

    setRdnsSaving(prev => ({ ...prev, [ip]: true }));
    setRdnsMsg(prev => ({ ...prev, [ip]: null }));

    try {
      await axios.put(`/api/dsh/dns/reverse/${encodeURIComponent(ip)}`, { record });
      setRdnsMsg(prev => ({ ...prev, [ip]: { type: 'ok', text: 'PTR-Record erfolgreich gesetzt!' } }));
    } catch (err) {
      setRdnsMsg(prev => ({ ...prev, [ip]: { type: 'err', text: err.response?.data?.error || 'Fehler beim Setzen' } }));
    }
    setRdnsSaving(prev => ({ ...prev, [ip]: false }));
  };

  const deleteRdns = async (ip) => {
    if (!canRdns || !ip) return;
    setRdnsSaving(prev => ({ ...prev, [ip]: true }));
    setRdnsMsg(prev => ({ ...prev, [ip]: null }));

    try {
      await axios.delete(`/api/dsh/dns/reverse/${encodeURIComponent(ip)}`);
      setRdnsInputs(prev => ({ ...prev, [ip]: '' }));
      setRdnsMsg(prev => ({ ...prev, [ip]: { type: 'ok', text: 'PTR-Record gelöscht.' } }));
    } catch (err) {
      setRdnsMsg(prev => ({ ...prev, [ip]: { type: 'err', text: err.response?.data?.error || 'Fehler beim Löschen' } }));
    }
    setRdnsSaving(prev => ({ ...prev, [ip]: false }));
  };

  if (!canView) {
    return (
      <div className="bg-panel-orange/10 border border-panel-orange/30 text-panel-orange text-sm rounded-md px-4 py-3">
        Du hast keine Berechtigung, DeinServerHost Server anzuzeigen.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* ── Kopfzeile ── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-panel-surface/60 border border-panel-border/80 rounded-xl px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-panel-accent/15 border border-panel-accent/30 flex items-center justify-center text-panel-accent">
            <Shield size={20} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-bold text-panel-text">DeinServerHost (DSH)</h2>
              <span className="text-[10px] uppercase font-semibold px-1.5 py-0.5 rounded bg-panel-accent/10 text-panel-accent border border-panel-accent/20">
                API v2
              </span>
            </div>
            <p className="text-xs text-panel-muted">
              Live-Status, Power-Steuerung, Combahton DDoS-Schutz und Reverse DNS
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {expiredCount > 0 && (
            <label className="inline-flex items-center gap-1.5 cursor-pointer text-xs text-panel-muted hover:text-panel-text transition-colors select-none bg-panel-card px-2.5 py-1.5 rounded-lg border border-panel-border">
              <input
                type="checkbox"
                checked={hideExpired}
                onChange={e => {
                  const val = e.target.checked;
                  setHideExpired(val);
                  localStorage.setItem('dsh_hide_expired', String(val));
                }}
                className="accent-panel-accent rounded w-3.5 h-3.5"
              />
              <span>Ausgelaufene ausblenden ({expiredCount})</span>
            </label>
          )}
          <a
            href="https://deinserverhost.de/clientarea.php"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 text-xs text-panel-muted hover:text-panel-text px-2.5 py-1.5 rounded-lg border border-panel-border hover:border-panel-accent transition-colors"
          >
            <ExternalLink size={12} />
            DSH Kundenbereich
          </a>
          <Button variant="ghost" size="sm" onClick={load} disabled={loading}>
            <RefreshCw size={13} className={`mr-1.5 ${loading ? 'animate-spin' : ''}`} />
            Aktualisieren
          </Button>
        </div>
      </div>

      {/* ── Fehlermeldungen / Erfolgsmeldungen ── */}
      {error && (
        <div className="bg-panel-orange/10 border border-panel-orange/30 text-panel-orange text-xs rounded-lg p-3 flex items-start gap-2">
          <AlertTriangle size={15} className="flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold">{error}</p>
            <p className="mt-0.5 text-panel-muted">
              Bitte hinterlege deinen DSH API-Token unter{' '}
              <a href="/settings" className="text-panel-accent hover:underline font-medium">
                Einstellungen → Hosting & Cloud APIs
              </a>.
            </p>
          </div>
        </div>
      )}

      {actError && (
        <div className="bg-panel-red/10 border border-panel-red/30 text-panel-red text-xs rounded-lg p-3 flex items-center justify-between">
          <span>{actError}</span>
          <button onClick={() => setActError('')} className="text-panel-muted hover:text-panel-text"><X size={14} /></button>
        </div>
      )}

      {actSuccess && (
        <div className="bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs rounded-lg p-3 flex items-center justify-between">
          <span>{actSuccess}</span>
          <button onClick={() => setActSuccess('')} className="text-panel-muted hover:text-panel-text"><X size={14} /></button>
        </div>
      )}

      {/* ── Rescue-Ergebnis Banner ── */}
      {rescueResult && (
        <div className="bg-panel-accent/10 border border-panel-accent/30 rounded-xl p-4 space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-panel-accent font-semibold text-xs">
              <ShieldAlert size={15} />
              Rescue-System für {rescueResult.serviceName} wurde gestartet!
            </div>
            <button onClick={() => setRescueResult(null)} className="text-panel-muted hover:text-panel-text"><X size={14} /></button>
          </div>
          <p className="text-xs text-panel-muted">
            Der Server bootet jetzt in das Notfallsystem. Verbinde dich per SSH mit Benutzer <code className="text-panel-text font-mono font-bold">root</code> und folgendem Passwort:
          </p>
          <div className="flex items-center gap-2 bg-panel-card border border-panel-border rounded-lg px-3 py-1.5 w-fit">
            <span className="font-mono text-sm text-panel-accent font-bold select-all">{rescueResult.rootpass}</span>
            <button
              onClick={() => copyText('rescuePass', rescueResult.rootpass)}
              className="text-panel-muted hover:text-panel-text transition-colors p-1"
              title="Passwort kopieren"
            >
              {copied['rescuePass'] ? <Check size={14} className="text-panel-green" /> : <Copy size={14} />}
            </button>
          </div>
        </div>
      )}

      {/* ── Hinweis bei ausgeblendeten Servern ── */}
      {hideExpired && expiredCount > 0 && visibleServices.length > 0 && (
        <div className="flex items-center justify-between text-xs bg-panel-card/60 border border-panel-border/70 rounded-lg px-3 py-2 text-panel-muted">
          <span>
            ℹ️ <strong>{expiredCount}</strong> ausgelaufene(r) bzw. gekündigte(r) Server ausgeblendet.
          </span>
          <button
            onClick={() => {
              setHideExpired(false);
              localStorage.setItem('dsh_hide_expired', 'false');
            }}
            className="text-panel-accent hover:underline font-medium text-xs ml-2"
          >
            Alle anzeigen ({services.length})
          </button>
        </div>
      )}

      {/* ── Server-Liste ── */}
      {loading ? (
        <div className="text-center py-12 text-panel-muted text-sm flex flex-col items-center justify-center gap-2">
          <RefreshCw size={24} className="animate-spin text-panel-accent opacity-60" />
          <span>Lade DeinServerHost Services...</span>
        </div>
      ) : visibleServices.length === 0 && !error ? (
        <div className="bg-panel-surface border border-panel-border rounded-xl p-8 text-center text-panel-muted text-sm space-y-2">
          <p>
            {expiredCount > 0
              ? `Alle ${expiredCount} gefundenen Server sind ausgelaufen/gekündigt und wurden ausgeblendet.`
              : 'Keine Produkte oder Services im DSH-Konto gefunden.'}
          </p>
          {expiredCount > 0 && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setHideExpired(false);
                localStorage.setItem('dsh_hide_expired', 'false');
              }}
            >
              Ausgelaufene Server anzeigen ({expiredCount})
            </Button>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          {visibleServices.map(s => {
            const pState = getPowerState(s);
            const dueInfo = formatDue(s.nextduedate);
            const expired = isExpired(s);
            const isBusy = Object.keys(busy).some(k => k.startsWith(`${s.serviceid}_`) && busy[k]);

            // Customfields extrahieren (CPU, Cores, Disk, RAM)
            const cfields = Array.isArray(s.customfields) ? s.customfields : [];
            const cpuField  = cfields.find(c => /cpu|vcore/i.test(c.option))?.value;
            const diskField = cfields.find(c => /disk|ssd|hdd|storage/i.test(c.option))?.value;
            const ramField  = cfields.find(c => /ram|mem/i.test(c.option))?.value;

            const isIncidentsOpen = activeTab[s.serviceid] === 'incidents';
            const isRdnsOpen      = activeTab[s.serviceid] === 'rdns';

            return (
              <div
                key={s.serviceid}
                className={`bg-panel-surface border rounded-xl shadow-sm overflow-hidden transition-all ${
                  expired ? 'border-panel-border/50 opacity-75' : 'border-panel-border hover:border-panel-border/80'
                }`}
              >
                {/* ── Hauptzeile des Servers ── */}
                <div className="p-4 sm:p-5">
                  <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                    {/* Linke Seite: Status, Name, Hostname & IP */}
                    <div className="space-y-2 min-w-0 flex-1">
                      <div className="flex items-center gap-2.5 flex-wrap">
                        <span className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2 py-0.5 rounded-full border ${
                          pState.color === 'green'
                            ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                            : pState.color === 'red'
                              ? 'bg-rose-500/10 text-rose-400 border-rose-500/30'
                              : pState.color === 'gray'
                                ? 'bg-panel-card text-panel-muted border-panel-border'
                                : 'bg-amber-500/10 text-amber-400 border-amber-500/30'
                        }`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${
                            pState.color === 'green' ? 'bg-emerald-400 animate-pulse' :
                            pState.color === 'red' ? 'bg-rose-400' :
                            pState.color === 'gray' ? 'bg-panel-muted' : 'bg-amber-400'
                          }`} />
                          {pState.label}
                        </span>

                        <h3 className="text-base font-bold text-panel-text truncate">
                          {s.domain || s.name || `Service #${s.serviceid}`}
                        </h3>

                        {s.name && s.domain && (
                          <span className="text-xs px-2 py-0.5 rounded bg-panel-card border border-panel-border text-panel-muted font-medium">
                            {s.name}
                          </span>
                        )}

                        <span className="text-[11px] text-panel-muted">
                          ID: #{s.serviceid}
                        </span>
                      </div>

                      {/* IP-Adressen */}
                      <div className="flex items-center gap-2 flex-wrap text-xs">
                        {s.dedicatedip && (
                          <div className="inline-flex items-center gap-1.5 bg-panel-card border border-panel-border/70 rounded-md px-2 py-1">
                            <Globe size={12} className="text-panel-accent" />
                            <span className="font-mono text-panel-text font-medium select-all">{s.dedicatedip}</span>
                            <button
                              onClick={() => copyText(`ip_${s.serviceid}`, s.dedicatedip)}
                              className="text-panel-muted hover:text-panel-text transition-colors ml-1 p-0.5"
                              title="IP-Adresse kopieren"
                            >
                              {copied[`ip_${s.serviceid}`] ? (
                                <Check size={12} className="text-panel-green" />
                              ) : (
                                <Copy size={12} />
                              )}
                            </button>
                          </div>
                        )}

                        {s.assignedips && s.assignedips !== s.dedicatedip && (
                          <span className="text-[11px] text-panel-muted truncate">
                            Zusätzliche IPs: {s.assignedips}
                          </span>
                        )}
                      </div>

                      {/* Specs & Abrechnung Badges */}
                      <div className="flex items-center gap-3 pt-1 text-xs text-panel-muted flex-wrap">
                        {/* Fälligkeit */}
                        {s.nextduedate && (
                          <div className={`flex items-center gap-1.5 ${dueInfo.urgent ? 'text-panel-orange font-medium' : ''}`}>
                            <Calendar size={13} className="opacity-70" />
                            <span>Fällig: {dueInfo.text}</span>
                          </div>
                        )}

                        {/* Preis */}
                        {s.recurringamount && (
                          <div className="flex items-center gap-1 text-panel-text font-medium">
                            <span className="text-panel-muted">Kosten:</span>
                            <span>{parseFloat(s.recurringamount).toFixed(2)} € / {s.billingcycle || 'Monat'}</span>
                          </div>
                        )}

                        {/* Hardware Specs */}
                        {cpuField && (
                          <div className="flex items-center gap-1">
                            <Cpu size={13} className="text-blue-400" />
                            <span>{cpuField}</span>
                          </div>
                        )}

                        {diskField && (
                          <div className="flex items-center gap-1">
                            <HardDrive size={13} className="text-yellow-400" />
                            <span>{diskField}</span>
                          </div>
                        )}

                        {ramField && (
                          <div className="flex items-center gap-1">
                            <Activity size={13} className="text-green-400" />
                            <span>{ramField}</span>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Rechte Seite: Steuerungs-Buttons */}
                    <div className="flex items-center gap-1.5 flex-wrap self-start lg:self-center">
                      {/* Start */}
                      {canStart && (
                        <Button
                          size="sm"
                          variant="success"
                          onClick={() => act(s, 'start')}
                          disabled={expired || busy[`${s.serviceid}_start`] || isBusy}
                          title={expired ? 'Server ist gekündigt/ausgelaufen' : 'Server einschalten'}
                        >
                          <Play size={12} className="mr-1" />
                          {busy[`${s.serviceid}_start`] ? 'Startet…' : 'Start'}
                        </Button>
                      )}

                      {/* Stop */}
                      {canStop && (
                        <Button
                          size="sm"
                          variant="warning"
                          onClick={() => act(s, 'stop')}
                          disabled={expired || busy[`${s.serviceid}_stop`] || isBusy}
                          title={expired ? 'Server ist gekündigt/ausgelaufen' : 'Server stoppen / ausschalten'}
                        >
                          <PowerOff size={12} className="mr-1" />
                          {busy[`${s.serviceid}_stop`] ? 'Stoppt…' : 'Stop'}
                        </Button>
                      )}

                      {/* Reset / Reboot */}
                      {canReset && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => act(s, 'reset')}
                          disabled={expired || busy[`${s.serviceid}_reset`] || isBusy}
                          title={expired ? 'Server ist gekündigt/ausgelaufen' : 'Kaltstart / Reset durchführen'}
                        >
                          <RotateCcw size={12} className="mr-1" />
                          {busy[`${s.serviceid}_reset`] ? 'Reboot…' : 'Reset'}
                        </Button>
                      )}

                      {/* NoVNC Konsole */}
                      {canConsole && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => openConsole(s)}
                          disabled={expired || busy[`${s.serviceid}_console`] || isBusy}
                          title={expired ? 'Server ist gekündigt/ausgelaufen' : 'NoVNC Notfall-Konsole in neuem Fenster öffnen'}
                          className="text-panel-accent hover:border-panel-accent/50"
                        >
                          <Terminal size={12} className="mr-1" />
                          {busy[`${s.serviceid}_console`] ? 'Lade…' : 'Konsole'}
                        </Button>
                      )}

                      {/* Action Menu für erweiterte Aktionen */}
                      <ActionMenu
                        items={[
                          canRescue && {
                            icon: ShieldAlert,
                            label: 'Rescue-System starten',
                            variant: 'warning',
                            onClick: () => setRescueModal({ open: true, service: s, password: '', error: '' }),
                          },
                          {
                            icon: ExternalLink,
                            label: 'In DSH öffnen',
                            onClick: () => window.open(`https://deinserverhost.de/clientarea.php?action=productdetails&id=${s.serviceid}`, '_blank'),
                          },
                        ].filter(Boolean)}
                      />
                    </div>
                  </div>

                  {/* ── Untere Reiter-Leiste für Details (DDoS / rDNS) ── */}
                  <div className="flex items-center gap-2 mt-4 pt-3 border-t border-panel-border/50 text-xs">
                    <button
                      onClick={() => toggleIncidents(s)}
                      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border font-medium transition-all ${
                        isIncidentsOpen
                          ? 'bg-panel-accent/15 text-panel-accent border-panel-accent/30 font-semibold shadow-sm'
                          : 'bg-panel-card text-panel-muted border-panel-border hover:text-panel-text'
                      }`}
                    >
                      <Shield size={13} />
                      Combahton DDoS-Schutz
                      {isIncidentsOpen ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                    </button>

                    <button
                      onClick={() => toggleRdns(s)}
                      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border font-medium transition-all ${
                        isRdnsOpen
                          ? 'bg-panel-accent/15 text-panel-accent border-panel-accent/30 font-semibold shadow-sm'
                          : 'bg-panel-card text-panel-muted border-panel-border hover:text-panel-text'
                      }`}
                    >
                      <Globe size={13} />
                      Reverse DNS (rDNS)
                      {isRdnsOpen ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                    </button>
                  </div>
                </div>

                {/* ── Ausklappbarer Bereich: DDoS-Schutz (Incidents) ── */}
                {isIncidentsOpen && (
                  <div className="border-t border-panel-border bg-panel-card/40 p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Shield size={14} className="text-panel-accent" />
                        <h4 className="text-xs font-bold text-panel-text">
                          Combahton / Path.net DDoS-Schutz für {s.dedicatedip}
                        </h4>
                      </div>
                      <span className="text-[11px] text-emerald-400 font-medium flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                        Dauerhafter L3/L4/L7 Schutz aktiv
                      </span>
                    </div>

                    {incidentsLoading[s.dedicatedip] ? (
                      <div className="text-xs text-panel-muted py-3 text-center flex items-center justify-center gap-2">
                        <RefreshCw size={13} className="animate-spin" /> Lade DDoS-Vorfälle...
                      </div>
                    ) : (incidents[s.dedicatedip] || []).length === 0 ? (
                      <div className="bg-panel-surface/60 border border-panel-border/70 rounded-lg p-3 text-xs text-panel-muted text-center">
                        🛡️ Keine DDoS-Angriffe im Erfassungszeitraum registriert. Der Server ist geschützt.
                      </div>
                    ) : (
                      <div className="overflow-x-auto border border-panel-border rounded-lg">
                        <table className="w-full text-left text-xs">
                          <thead className="bg-panel-surface border-b border-panel-border text-panel-muted font-medium">
                            <tr>
                              <th className="px-3 py-2">Zeitstempel</th>
                              <th className="px-3 py-2">Peak Bandbreite</th>
                              <th className="px-3 py-2">Pakete (PPS)</th>
                              <th className="px-3 py-2">Methode / Cluster</th>
                              <th className="px-3 py-2">Modus</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-panel-border">
                            {incidents[s.dedicatedip].map((inc, i) => (
                              <tr key={inc.uuid || i} className="hover:bg-panel-surface/40">
                                <td className="px-3 py-2 font-mono text-[11px] text-panel-text">
                                  {inc['@timestamp'] ? new Date(inc['@timestamp']).toLocaleString('de-DE') : '—'}
                                </td>
                                <td className="px-3 py-2 font-semibold text-panel-orange">
                                  {inc.mbps ? `${inc.mbps} Mbit/s` : '—'}
                                </td>
                                <td className="px-3 py-2 font-mono text-panel-text">
                                  {inc.pps ? `${Number(inc.pps).toLocaleString('de-DE')} pps` : '—'}
                                </td>
                                <td className="px-3 py-2 text-panel-muted">
                                  {inc.method || 'Threshold'} ({inc.cluster || 'global'})
                                </td>
                                <td className="px-3 py-2">
                                  <span className="px-1.5 py-0.5 rounded bg-panel-card border border-panel-border text-[10px] font-mono">
                                    {inc.mode || 'l4_dynamic'}
                                  </span>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}

                {/* ── Ausklappbarer Bereich: Reverse DNS ── */}
                {isRdnsOpen && (
                  <div className="border-t border-panel-border bg-panel-card/40 p-4 space-y-3">
                    <div className="flex items-center gap-2">
                      <Globe size={14} className="text-panel-accent" />
                      <h4 className="text-xs font-bold text-panel-text">
                        Reverse DNS (PTR-Record) für {s.dedicatedip}
                      </h4>
                    </div>

                    <p className="text-xs text-panel-muted leading-relaxed">
                      Der PTR-Record löst deine Server-IP rückwärts in einen Hostnamen auf. Dies ist besonders für Mailserver, Zertifikate und vertrauenswürdige Netzwerkverbindungen essenziell.
                    </p>

                    <div className="flex flex-col sm:flex-row gap-2 max-w-xl">
                      <input
                        type="text"
                        value={rdnsInputs[s.dedicatedip] ?? ''}
                        onChange={e => setRdnsInputs(prev => ({ ...prev, [s.dedicatedip]: e.target.value }))}
                        placeholder="z.B. mail.deinedomain.de"
                        disabled={!canRdns || rdnsSaving[s.dedicatedip]}
                        className="flex-1 bg-panel-surface border border-panel-border rounded-lg px-3 py-1.5 text-xs text-panel-text focus:outline-none focus:border-panel-accent font-mono"
                      />

                      {canRdns && (
                        <div className="flex items-center gap-2">
                          <Button
                            size="sm"
                            variant="primary"
                            onClick={() => saveRdns(s.dedicatedip)}
                            disabled={rdnsSaving[s.dedicatedip] || !(rdnsInputs[s.dedicatedip] || '').trim()}
                          >
                            {rdnsSaving[s.dedicatedip] ? 'Speichere…' : 'PTR setzen'}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => deleteRdns(s.dedicatedip)}
                            disabled={rdnsSaving[s.dedicatedip]}
                            className="text-panel-red hover:border-panel-red/40"
                          >
                            Löschen
                          </Button>
                        </div>
                      )}
                    </div>

                    {rdnsMsg[s.dedicatedip] && (
                      <p className={`text-xs ${rdnsMsg[s.dedicatedip].type === 'ok' ? 'text-panel-green' : 'text-panel-red'}`}>
                        {rdnsMsg[s.dedicatedip].text}
                      </p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ── Rescue Dialog Modal ── */}
      {rescueModal.open && rescueModal.service && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-panel-surface border border-panel-border rounded-xl max-w-md w-full p-5 space-y-4 shadow-2xl">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-2 text-panel-orange font-bold text-sm">
                <ShieldAlert size={18} />
                Rescue-Modus starten
              </div>
              <button
                onClick={() => setRescueModal({ open: false, service: null, password: '', error: '' })}
                className="text-panel-muted hover:text-panel-text"
              >
                <X size={16} />
              </button>
            </div>

            <p className="text-xs text-panel-muted leading-relaxed">
              Möchtest du den Server <strong>{rescueModal.service.domain || rescueModal.service.name}</strong> wirklich in das Notfallsystem booten?
              Das aktuelle Betriebssystem wird dabei temporär angehalten.
            </p>

            <div>
              <label className="block text-xs font-medium text-panel-muted mb-1">
                Temporäres Root-Passwort (optional)
              </label>
              <input
                type="text"
                value={rescueModal.password}
                onChange={e => setRescueModal(m => ({ ...m, password: e.target.value }))}
                placeholder="Leer lassen für automatisches Passwort"
                className="w-full bg-panel-card border border-panel-border rounded-lg px-3 py-2 text-xs text-panel-text focus:outline-none focus:border-panel-accent font-mono"
              />
              <p className="text-[11px] text-panel-muted mt-1">
                Mindestens 12 Zeichen, min. 1 Großbuchstabe, Zahl und Sonderzeichen.
              </p>
            </div>

            {rescueModal.error && (
              <p className="text-xs text-panel-red">{rescueModal.error}</p>
            )}

            <div className="flex justify-end gap-2 pt-2 border-t border-panel-border/60">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setRescueModal({ open: false, service: null, password: '', error: '' })}
              >
                Abbrechen
              </Button>
              <Button
                variant="warning"
                size="sm"
                onClick={submitRescue}
                disabled={busy[`${rescueModal.service.serviceid}_rescue`]}
              >
                <ShieldAlert size={13} className="mr-1" />
                {busy[`${rescueModal.service.serviceid}_rescue`] ? 'Bootet ins Rescue…' : 'Jetzt im Rescue booten'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
