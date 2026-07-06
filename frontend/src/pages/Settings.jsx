import { useEffect, useState } from 'react';
import axios from 'axios';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { useAuth } from '../context/AuthContext';
import {
  Cloud, Server, Eye, EyeOff, CheckCircle, XCircle,
  RefreshCw, Trash2, Lock, Mail, Key, ShieldCheck, Send,
  User, Settings2, Layers, Timer, Bell, Monitor, Smartphone,
  Globe, LogOut, Laptop, PackageCheck,
} from 'lucide-react';
import { invalidateLiveIntervalCache } from '../hooks/useLiveInterval';

// ── Toggle-Hilfkomponente ──────────────────────────────────────────────────────
function Toggle({ on, onToggle, disabled }) {
  return (
    <button
      onClick={onToggle}
      disabled={disabled}
      className={`relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full transition-colors duration-200 ease-in-out focus:outline-none disabled:opacity-50 ${
        on ? 'bg-panel-accent' : 'bg-panel-border'
      }`}
    >
      <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition duration-200 ease-in-out mt-0.5 ${
        on ? 'translate-x-4' : 'translate-x-0.5'
      }`} />
    </button>
  );
}

// ── Aktions-Benachrichtigungen Toggle ─────────────────────────────────────────
function ActionNotificationsToggle() {
  const [enabled,   setEnabled]   = useState(false);
  const [webhookId, setWebhookId] = useState('');
  const [webhooks,  setWebhooks]  = useState([]);
  const [saving,    setSaving]    = useState(false);
  const [msg,       setMsg]       = useState('');

  useEffect(() => {
    Promise.all([
      axios.get('/api/settings/notifications'),
      axios.get('/api/webhooks').catch(() => ({ data: [] })),
    ]).then(([notif, wh]) => {
      setEnabled(!!notif.data.actionNotifications);
      setWebhookId(notif.data.actionWebhookId ? String(notif.data.actionWebhookId) : '');
      setWebhooks(wh.data || []);
    }).catch(() => {});
  }, []);

  const save = async (nextEnabled = enabled, nextWebhookId = webhookId) => {
    setSaving(true);
    setMsg('');
    try {
      await axios.put('/api/settings/notifications', {
        actionNotifications: nextEnabled,
        actionWebhookId:     nextWebhookId ? parseInt(nextWebhookId) : null,
      });
      setMsg('✓ Gespeichert');
    } catch { setMsg('Fehler beim Speichern'); }
    setSaving(false);
  };

  const toggle = () => {
    const next = !enabled;
    setEnabled(next);
    save(next, webhookId);
  };

  return (
    <div className="space-y-3">
      {/* Toggle-Zeile */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-panel-text">Server-Aktionen benachrichtigen</p>
          <p className="text-xs text-panel-muted mt-0.5">
            Browser-Benachrichtigung + optionaler Webhook wenn ein Benutzer einen Server startet, stoppt oder neustartet.
          </p>
        </div>
        <Toggle on={enabled} onToggle={toggle} disabled={saving} />
      </div>

      {/* Webhook-Auswahl (immer sichtbar wenn Webhooks vorhanden) */}
      {webhooks.length > 0 && (
        <div className="flex items-center gap-3 pl-0 pt-1">
          <div className="flex-1">
            <label className="block text-xs text-panel-muted mb-1">Webhook für Aktions-Meldungen</label>
            <select
              value={webhookId}
              onChange={e => setWebhookId(e.target.value)}
              className="w-full bg-panel-surface border border-panel-border rounded-md px-3 py-1.5 text-sm text-panel-text focus:outline-none focus:border-panel-accent"
            >
              <option value="">— Nur Browser-Benachrichtigung —</option>
              {webhooks.map(w => (
                <option key={w.id} value={String(w.id)}>
                  {w.name} ({w.type})
                </option>
              ))}
            </select>
          </div>
          <button
            onClick={() => save(enabled, webhookId)}
            disabled={saving}
            className="mt-5 px-3 py-1.5 text-xs bg-panel-accent text-white rounded-md hover:bg-blue-500 transition-colors disabled:opacity-50"
          >
            {saving ? '…' : 'Speichern'}
          </button>
        </div>
      )}

      {webhooks.length === 0 && (
        <p className="text-xs text-panel-muted pl-0">
          Noch kein Webhook konfiguriert —{' '}
          <a href="/webhooks" className="text-panel-accent hover:underline">Webhook anlegen</a>
        </p>
      )}

      {msg && <p className={`text-xs ${msg.startsWith('✓') ? 'text-panel-green' : 'text-panel-red'}`}>{msg}</p>}
    </div>
  );
}

const inputCls = 'w-full bg-panel-surface border border-panel-border rounded-md px-3 py-2 text-sm text-panel-text focus:outline-none focus:border-panel-accent transition-colors';

const StatusBadge = ({ set }) => set
  ? <span className="flex items-center gap-1 text-xs text-panel-green"><CheckCircle size={13} />Konfiguriert</span>
  : <span className="flex items-center gap-1 text-xs text-panel-muted"><XCircle size={13} />Nicht gesetzt</span>;

const Msg = ({ msg }) => msg ? (
  <p className={`text-xs mt-2 ${msg.type === 'ok' ? 'text-panel-green' : 'text-panel-red'}`}>{msg.text}</p>
) : null;

// ── UA-Hilfsfunktionen ─────────────────────────────────────────────────────────
function parseBrowser(ua = '') {
  if (!ua) return 'Unbekannt';
  if (/PanelApp-Android/.test(ua))              return 'Panel App';
  if (/okhttp|Dalvik/.test(ua))                 return 'Android App';
  if (/Edg\//.test(ua))                         return 'Edge';
  if (/OPR\//.test(ua))                         return 'Opera';
  if (/Chrome\//.test(ua))                      return 'Chrome';
  if (/Firefox\//.test(ua))                     return 'Firefox';
  if (/Safari\//.test(ua))                      return 'Safari';
  if (/curl\//.test(ua))                        return 'cURL';
  return 'Browser';
}
function parseOS(ua = '') {
  if (/PanelApp-Android/.test(ua))              return 'Android';
  if (/Windows/.test(ua))                       return 'Windows';
  if (/Android/.test(ua))                       return 'Android';
  if (/iPhone|iPad/.test(ua))                   return 'iOS';
  if (/Mac OS/.test(ua))                        return 'macOS';
  if (/Linux/.test(ua))                         return 'Linux';
  return '';
}
function DeviceIcon({ ua }) {
  if (/PanelApp-Android|iPhone|iPad|Android/.test(ua)) return <Smartphone size={15} className="text-panel-muted" />;
  if (/Windows|Mac OS|Linux/.test(ua))                 return <Laptop     size={15} className="text-panel-muted" />;
  return <Globe size={15} className="text-panel-muted" />;
}
function fmtRelTime(dateStr) {
  if (!dateStr) return '—';
  const iso = dateStr.includes('Z') || dateStr.includes('+') ? dateStr : dateStr.replace(' ', 'T') + 'Z';
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60)   return 'gerade eben';
  if (diff < 3600) return `vor ${Math.floor(diff / 60)} Min.`;
  if (diff < 86400) return `vor ${Math.floor(diff / 3600)} Std.`;
  return `vor ${Math.floor(diff / 86400)} Tagen`;
}
function fmtAbsTime(dateStr) {
  if (!dateStr) return '—';
  const iso = dateStr.includes('Z') || dateStr.includes('+') ? dateStr : dateStr.replace(' ', 'T') + 'Z';
  return new Date(iso).toLocaleString('de-DE', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin',
  });
}

// ── SessionsSection ────────────────────────────────────────────────────────────
function SessionsSection({ isAdmin }) {
  const [sessions, setSessions] = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [busy,     setBusy]     = useState({});

  const load = () => {
    setLoading(true);
    axios.get('/api/sessions')
      .then(r => setSessions(r.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const revoke = async (id) => {
    setBusy(b => ({ ...b, [id]: true }));
    try {
      await axios.delete(`/api/sessions/${id}`);
      setSessions(s => s.filter(x => x.id !== id));
    } catch {}
    setBusy(b => ({ ...b, [id]: false }));
  };

  const revokeOthers = async () => {
    setBusy(b => ({ ...b, _all: true }));
    try {
      await axios.delete('/api/sessions/others');
      load();
    } catch {}
    setBusy(b => ({ ...b, _all: false }));
  };

  const others = sessions.filter(s => !s.is_current);

  return (
    <Card title={
      <div className="flex items-center justify-between w-full">
        <span>{isAdmin ? 'Alle aktiven Sitzungen' : 'Aktive Sitzungen'}</span>
        {others.length > 0 && !isAdmin && (
          <Button size="sm" variant="danger" onClick={revokeOthers} disabled={!!busy._all}>
            <LogOut size={12} className="mr-1" />Alle anderen abmelden
          </Button>
        )}
      </div>
    }>
      {loading ? (
        <p className="text-panel-muted text-sm py-4 text-center">Lade…</p>
      ) : sessions.length === 0 ? (
        <p className="text-panel-muted text-sm py-4 text-center">Keine aktiven Sitzungen</p>
      ) : (
        <div className="space-y-2">
          {sessions.map(s => (
            <div key={s.id}
              className={`flex items-center gap-3 p-3 rounded-lg border transition-colors
                ${s.is_current
                  ? 'border-panel-accent/50 bg-panel-accent/5'
                  : 'border-panel-border bg-panel-surface'}`}>
              <DeviceIcon ua={s.user_agent} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium text-panel-text">
                    {parseBrowser(s.user_agent)}
                    {parseOS(s.user_agent) ? ` · ${parseOS(s.user_agent)}` : ''}
                  </span>
                  {s.is_current && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-panel-accent/20 text-panel-accent font-semibold">
                      Diese Sitzung
                    </span>
                  )}
                  {isAdmin && s.username && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-panel-surface border border-panel-border text-panel-muted">
                      <User size={9} className="inline mr-0.5" />{s.username}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-3 mt-0.5 text-[11px] text-panel-muted flex-wrap">
                  {s.ip && <span>IP: {s.ip}</span>}
                  <span title={fmtAbsTime(s.created_at)}>Angemeldet: {fmtAbsTime(s.created_at)}</span>
                  <span title={fmtAbsTime(s.last_used)}>Zuletzt aktiv: {fmtRelTime(s.last_used)}</span>
                </div>
              </div>
              {!s.is_current && (
                <button
                  onClick={() => revoke(s.id)}
                  disabled={!!busy[s.id]}
                  title="Sitzung beenden"
                  className="p-1.5 rounded text-panel-muted hover:text-panel-red hover:bg-panel-red/10 transition-colors disabled:opacity-40 flex-shrink-0">
                  <LogOut size={14} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

export default function Settings() {
  const { isAdmin } = useAuth();
  const [tab, setTab]     = useState('profile'); // 'profile' | 'system'

  const [status,  setStatus]  = useState({});
  const [loading, setLoading] = useState({});
  const [msgs,    setMsgs]    = useState({});

  // Passwort
  const [pwCurrent,  setPwCurrent]  = useState('');
  const [pwNew,      setPwNew]      = useState('');
  const [pwConfirm,  setPwConfirm]  = useState('');
  const [showPw,     setShowPw]     = useState(false);

  // E-Mail
  const [email,     setEmail]    = useState('');

  // Hetzner
  const [hetznerToken, setHetznerToken] = useState('');
  const [showHetzner,  setShowHetzner]  = useState(false);

  // MC-Host24
  const [mcUsername, setMcUsername] = useState('');
  const [mcPassword, setMcPassword] = useState('');
  const [showMcPw,   setShowMcPw]   = useState(false);

  // SMTP
  const [smtp, setSmtp] = useState({ host: '', port: 587, user: '', pass: '', from: '', secure: false });
  const [showSmtpPw, setShowSmtpPw] = useState(false);

  // Claude KI
  const [claudeKey,      setClaudeKey]      = useState('');
  const [claudeModel,    setClaudeModel]    = useState('claude-haiku-4-5');
  const [showClaudeKey,  setShowClaudeKey]  = useState(false);

  // Passkeys
  const [passkeys,     setPasskeys]     = useState([]);
  const [passkeyName,  setPasskeyName]  = useState('');

  // Live-Refresh-Interval
  const [liveInterval,    setLiveInterval]    = useState(15);

  // Dockhand
  const [dockhandUrl,      setDockhandUrl]      = useState('');
  const [dockhandToken,    setDockhandToken]    = useState('');
  const [dockhandEnvId,    setDockhandEnvId]    = useState('');
  const [dockhandEnvs,     setDockhandEnvs]     = useState([]); // [{id,name}] aus Dockhand
  const [dockhandAgents,   setDockhandAgents]   = useState([]); // remote_agents mit dockhand_env_id
  const [showDockhandToken, setShowDockhandToken] = useState(false);
  // PatchMon-Verknüpfung
  const [pmHosts,       setPmHosts]       = useState([]); // PatchMon-Hosts aus /api/patchmon/hosts
  const [pmAgents,      setPmAgents]      = useState([]); // remote_agents mit patchmon_host_id
  const [pmLocalHostId, setPmLocalHostId] = useState('');

  // ── Laden ─────────────────────────────────────────────────────────────────

  const loadAdmin = async () => {
    if (!isAdmin) return;
    try {
      const { data } = await axios.get('/api/settings');
      setStatus(data);
      // Live-Interval laden
      try {
        const { data: g } = await axios.get('/api/settings/general');
        setLiveInterval(Math.round((g.liveRefreshInterval || 15000) / 1000));
      } catch {}
      if (data.mchost_username) setMcUsername(data.mchost_username);
      if (data.smtp_host)  setSmtp(s => ({ ...s, host:   data.smtp_host  || '' }));
      if (data.smtp_port)  setSmtp(s => ({ ...s, port:   data.smtp_port  || 587 }));
      if (data.smtp_user)  setSmtp(s => ({ ...s, user:   data.smtp_user  || '' }));
      if (data.smtp_from)  setSmtp(s => ({ ...s, from:   data.smtp_from  || '' }));
      if (data.smtp_secure !== undefined) setSmtp(s => ({ ...s, secure: !!data.smtp_secure }));
    } catch {}
  };

  const loadDockhand = async () => {
    if (!isAdmin) return;
    try {
      const { data } = await axios.get('/api/dockhand/config');
      setDockhandUrl(data.url || '');
      setDockhandEnvId(data.localEnvId || '');
    } catch {}
    // Agents mit dockhand_env_id laden
    try {
      const { data } = await axios.get('/api/agents');
      setDockhandAgents(data);
    } catch {}
    // Environments laden (nur wenn konfiguriert)
    try {
      const { data } = await axios.get('/api/dockhand/environments');
      if (Array.isArray(data)) setDockhandEnvs(data);
    } catch {}
  };

  const loadPatchmonLinks = async () => {
    if (!isAdmin) return;
    try { const { data } = await axios.get('/api/patchmon/hosts'); setPmHosts(data.hosts || []); }
    catch { setPmHosts([]); }
    try { const { data } = await axios.get('/api/agents'); setPmAgents(data); } catch {}
    try { const { data } = await axios.get('/api/patchmon/local-binding'); setPmLocalHostId(data.hostId || ''); } catch {}
  };

  const saveAgentPm = async (agentId, hostId) => {
    setPmAgents(list => list.map(a => a.id === agentId ? { ...a, patchmon_host_id: hostId || null } : a));
    try { await axios.put(`/api/agents/${agentId}`, { patchmon_host_id: hostId || null }); } catch {}
  };
  const saveLocalPm = async (hostId) => {
    setPmLocalHostId(hostId);
    try { await axios.post('/api/patchmon/local-binding', { hostId: hostId || '' }); } catch {}
  };

  const loadPasskeys = async () => {
    try {
      const { data } = await axios.get('/api/passkeys');
      setPasskeys(data);
    } catch {}
  };

  const loadEmail = async () => {
    try {
      const { data } = await axios.get('/api/auth/me');
      setEmail(data.email || '');
    } catch {}
  };

  useEffect(() => {
    loadAdmin();
    loadPasskeys();
    loadEmail();
    loadDockhand();
    loadPatchmonLinks();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin]);

  // ── Hilfsfunktionen ───────────────────────────────────────────────────────

  const feedback = (key, type, text) => {
    setMsgs(m => ({ ...m, [key]: { type, text } }));
    setTimeout(() => setMsgs(m => ({ ...m, [key]: null })), 4000);
  };
  const busy = (key, val) => setLoading(l => ({ ...l, [key]: val }));

  // ── Profil-Aktionen ───────────────────────────────────────────────────────

  const changePassword = async () => {
    if (pwNew !== pwConfirm) return feedback('pw', 'err', 'Passwörter stimmen nicht überein');
    if (pwNew.length < 12)   return feedback('pw', 'err', 'Mindestens 12 Zeichen erforderlich');
    busy('pw', true);
    try {
      await axios.put('/api/auth/password', { currentPassword: pwCurrent, newPassword: pwNew });
      setPwCurrent(''); setPwNew(''); setPwConfirm('');
      feedback('pw', 'ok', 'Passwort geändert');
    } catch (err) {
      feedback('pw', 'err', err.response?.data?.error || 'Fehler');
    }
    busy('pw', false);
  };

  const saveEmail = async () => {
    busy('email', true);
    try {
      await axios.put('/api/auth/me/email', { email });
      feedback('email', 'ok', 'E-Mail gespeichert');
    } catch (err) {
      feedback('email', 'err', err.response?.data?.error || 'Fehler');
    }
    busy('email', false);
  };

  const registerPasskey = async () => {
    busy('passkey', true);
    try {
      const { startRegistration } = await import('@simplewebauthn/browser');
      const optRes   = await axios.get('/api/passkeys/register/start');
      const attResp  = await startRegistration({ optionsJSON: optRes.data });
      const name     = passkeyName.trim() || 'Passkey';
      await axios.post('/api/passkeys/register/finish', { registration: attResp, name });
      setPasskeyName('');
      await loadPasskeys();
      feedback('passkey', 'ok', `Passkey "${name}" erfolgreich registriert`);
    } catch (err) {
      const raw = err?.response?.data?.error || err?.message || '';
      // NotAllowedError = User hat den Dialog geschlossen / Windows-Dialog erschien
      const isNotAllowed = /not allowed|timed out|NotAllowedError/i.test(raw);
      const msg = isNotAllowed
        ? 'Dialog abgebrochen. Enpass als Passkey-Anbieter: Brave → brave://settings/passkeys oder Einstellungen → Datenschutz → Passkeys → Enpass auswählen'
        : (raw || 'Registrierung fehlgeschlagen');
      feedback('passkey', 'err', msg);
    }
    busy('passkey', false);
  };

  const deletePasskey = async (id) => {
    if (!confirm('Passkey wirklich löschen?')) return;
    try {
      await axios.delete(`/api/passkeys/${id}`);
      await loadPasskeys();
      feedback('passkey', 'ok', 'Passkey gelöscht');
    } catch { feedback('passkey', 'err', 'Fehler beim Löschen'); }
  };

  // ── System-Aktionen (Admin) ───────────────────────────────────────────────

  const saveHetzner = async () => {
    if (!hetznerToken.trim()) return;
    busy('hetzner', true);
    try {
      await axios.put('/api/settings/hetzner', { token: hetznerToken });
      setHetznerToken('');
      await loadAdmin();
      feedback('hetzner', 'ok', 'Token gespeichert');
    } catch (err) {
      feedback('hetzner', 'err', err.response?.data?.error || 'Fehler');
    }
    busy('hetzner', false);
  };

  const deleteHetzner = async () => {
    busy('hetzner_del', true);
    try { await axios.delete('/api/settings/hetzner'); await loadAdmin(); feedback('hetzner', 'ok', 'Token gelöscht'); }
    catch { feedback('hetzner', 'err', 'Fehler beim Löschen'); }
    busy('hetzner_del', false);
  };

  const loginMcHost = async () => {
    if (!mcUsername || !mcPassword) return;
    busy('mchost', true);
    try {
      const { data } = await axios.post('/api/settings/mchost/login', { username: mcUsername, password: mcPassword });
      setMcPassword('');
      await loadAdmin();
      feedback('mchost', 'ok', data.message || 'Login erfolgreich');
    } catch (err) {
      feedback('mchost', 'err', err.response?.data?.error || 'Login fehlgeschlagen');
    }
    busy('mchost', false);
  };

  const refreshMcHost = async () => {
    busy('mchost_refresh', true);
    try {
      const { data } = await axios.post('/api/settings/mchost/refresh');
      await loadAdmin();
      feedback('mchost', 'ok', data.message || 'Token erneuert');
    } catch (err) {
      feedback('mchost', 'err', err.response?.data?.error || 'Fehler');
    }
    busy('mchost_refresh', false);
  };

  const deleteMcHost = async () => {
    busy('mchost_del', true);
    try {
      await axios.delete('/api/settings/mchost');
      setMcUsername(''); setMcPassword('');
      await loadAdmin();
      feedback('mchost', 'ok', 'Zugangsdaten gelöscht');
    } catch { feedback('mchost', 'err', 'Fehler beim Löschen'); }
    busy('mchost_del', false);
  };

  const saveSmtp = async () => {
    busy('smtp', true);
    try {
      const payload = { ...smtp };
      if (!payload.pass) delete payload.pass;
      await axios.put('/api/settings/smtp', payload);
      await loadAdmin();
      feedback('smtp', 'ok', 'SMTP gespeichert');
    } catch (err) {
      feedback('smtp', 'err', err.response?.data?.error || 'Fehler');
    }
    busy('smtp', false);
  };

  const testSmtp = async () => {
    busy('smtp_test', true);
    try {
      await axios.post('/api/settings/smtp/test');
      feedback('smtp', 'ok', 'Test-E-Mail gesendet');
    } catch (err) {
      feedback('smtp', 'err', err.response?.data?.error || 'Versand fehlgeschlagen');
    }
    busy('smtp_test', false);
  };

  const fmtDate = (s) => s ? new Date(s).toLocaleString('de-DE') : '—';

  // ── Dockhand-Aktionen ─────────────────────────────────────────────────────

  const testDockhand = async () => {
    busy('dockhand', true);
    try {
      const { data } = await axios.post('/api/dockhand/test', {
        url:      dockhandUrl,
        apiToken: dockhandToken || undefined,
      });
      setDockhandEnvs(data.environments > 0
        ? (await axios.get('/api/dockhand/environments')).data
        : []);
      feedback('dockhand', 'ok', `Verbunden — ${data.environments} Environment(s) gefunden`);
    } catch (err) {
      feedback('dockhand', 'err', err.response?.data?.error || 'Verbindung fehlgeschlagen');
    }
    busy('dockhand', false);
  };

  const saveDockhand = async () => {
    busy('dockhand_save', true);
    try {
      await axios.post('/api/dockhand/config', {
        url:        dockhandUrl,
        ...(dockhandToken ? { apiToken: dockhandToken } : {}),
        localEnvId: dockhandEnvId,
      });
      setDockhandToken('');
      feedback('dockhand', 'ok', 'Dockhand-Einstellungen gespeichert');
    } catch (err) {
      feedback('dockhand', 'err', err.response?.data?.error || 'Fehler');
    }
    busy('dockhand_save', false);
  };

  const saveLiveInterval = async () => {
    const secs = Math.max(5, Math.min(300, parseInt(liveInterval, 10) || 15));
    setLiveInterval(secs);
    busy('liveInterval', true);
    try {
      await axios.put('/api/settings/general', { liveRefreshInterval: secs });
      invalidateLiveIntervalCache(); // Hook-Cache leeren → nächste Seite lädt neuen Wert
      feedback('liveInterval', 'ok', `Interval gespeichert: alle ${secs} Sekunden`);
    } catch (err) {
      feedback('liveInterval', 'err', err.response?.data?.error || 'Fehler');
    }
    busy('liveInterval', false);
  };

  const saveAgentEnv = async (agentId, envId) => {
    try {
      await axios.put('/api/dockhand/agent-env', { agentId, envId: envId || null });
      setDockhandAgents(prev => prev.map(a =>
        String(a.id) === String(agentId) ? { ...a, dockhand_env_id: envId || null } : a
      ));
    } catch (err) {
      feedback('dockhand', 'err', err.response?.data?.error || 'Fehler beim Speichern');
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-4">

      {/* Tab-Header */}
      <div className="flex gap-1 bg-panel-surface border border-panel-border rounded-lg p-1">
        <button
          onClick={() => setTab('profile')}
          className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md text-sm transition-colors ${
            tab === 'profile' ? 'bg-panel-card text-panel-text font-medium' : 'text-panel-muted hover:text-panel-text'
          }`}>
          <User size={14} />Mein Profil
        </button>
        {isAdmin && (
          <button
            onClick={() => setTab('system')}
            className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md text-sm transition-colors ${
              tab === 'system' ? 'bg-panel-card text-panel-text font-medium' : 'text-panel-muted hover:text-panel-text'
            }`}>
            <Settings2 size={14} />System
          </button>
        )}
      </div>

      {/* Karten als responsives Masonry-Raster (nebeneinander + untereinander) */}
      <div className="columns-1 lg:columns-2 gap-4 [&>*]:mb-4 [&>*]:break-inside-avoid">

      {/* ═══════════════════ PROFIL-TAB ═══════════════════ */}
      {tab === 'profile' && (<>

        {/* ── Passwort ändern ── */}
        <Card title={<span className="flex items-center gap-2"><Lock size={14} />Passwort ändern</span>}>
          <div className="space-y-3">
            {[
              ['Aktuelles Passwort', pwCurrent, setPwCurrent],
              ['Neues Passwort',     pwNew,     setPwNew],
              ['Bestätigen',         pwConfirm, setPwConfirm],
            ].map(([label, val, set]) => (
              <div key={label}>
                <label className="block text-xs text-panel-muted mb-1">{label}</label>
                <div className="relative">
                  <input
                    type={showPw ? 'text' : 'password'}
                    value={val}
                    onChange={e => set(e.target.value)}
                    placeholder="••••••••"
                    className={inputCls + ' pr-9'}
                    onKeyDown={e => e.key === 'Enter' && changePassword()}
                  />
                  <button type="button" onClick={() => setShowPw(v => !v)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-panel-muted hover:text-panel-text">
                    {showPw ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
              </div>
            ))}
            <Button onClick={changePassword}
              disabled={!pwCurrent || !pwNew || !pwConfirm || loading.pw} size="sm">
              Passwort speichern
            </Button>
            <Msg msg={msgs.pw} />
          </div>
        </Card>

        {/* ── E-Mail-Adresse ── */}
        <Card title={<span className="flex items-center gap-2"><Mail size={14} />E-Mail-Adresse</span>}>
          <div className="space-y-3">
            <p className="text-xs text-panel-muted">Wird für Passwort-Reset-E-Mails verwendet.</p>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="deine@email.de"
              className={inputCls}
              onKeyDown={e => e.key === 'Enter' && saveEmail()}
            />
            <Button onClick={saveEmail} disabled={loading.email} size="sm">
              E-Mail speichern
            </Button>
            <Msg msg={msgs.email} />
          </div>
        </Card>

        {/* ── Passkeys ── */}
        <Card title={<span className="flex items-center gap-2"><ShieldCheck size={14} />Passkeys (WebAuthn)</span>}>
          <div className="space-y-3">
            <p className="text-xs text-panel-muted">
              Passkeys ermöglichen passwortlosen Login per Fingerabdruck, Face ID, Hardware-Key oder Passwort-Manager.
            </p>

            {/* Hinweis für externe Passwort-Manager */}
            <div className="rounded-md border border-panel-accent/30 bg-panel-accent/5 px-3 py-2.5 space-y-1.5">
              <p className="text-[11px] font-semibold text-panel-accent">
                Enpass / Bitwarden als Passkey-Anbieter aktivieren
              </p>
              <ol className="text-[11px] text-panel-muted leading-relaxed list-none space-y-1">
                <li><span className="text-panel-text font-medium">1.</span> In Chrome diese Adresse öffnen:</li>
                <li>
                  <span className="font-mono bg-panel-card border border-panel-border rounded px-2 py-0.5 text-panel-accent select-all">
                    chrome://settings/passkeys
                  </span>
                </li>
                <li><span className="text-panel-text font-medium">2.</span> Unter <span className="text-panel-text">„Passwort-Manager"</span> → <span className="text-panel-text">Enpass</span> auswählen</li>
                <li><span className="text-panel-text font-medium">3.</span> Dann hier auf <span className="text-panel-text">„Registrieren"</span> klicken → Chrome zeigt seinen eigenen Dialog (nicht Windows)</li>
              </ol>
            </div>

            {/* Registrierte Passkeys */}
            {passkeys.length > 0 ? (
              <div className="divide-y divide-panel-border -mx-4">
                {passkeys.map(pk => (
                  <div key={pk.id} className="flex items-center justify-between px-4 py-2.5">
                    <div>
                      <p className="text-xs text-panel-text font-medium">{pk.device_type || 'Passkey'}</p>
                      <p className="text-xs text-panel-muted">{fmtDate(pk.created_at)}</p>
                    </div>
                    <Button size="sm" variant="danger" onClick={() => deletePasskey(pk.id)}>
                      <Trash2 size={12} />
                    </Button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-panel-muted">Keine Passkeys registriert</p>
            )}

            {/* Name + Button */}
            <div className="flex gap-2">
              <input
                type="text"
                value={passkeyName}
                onChange={e => setPasskeyName(e.target.value)}
                placeholder="Name (z. B. Enpass, YubiKey …)"
                maxLength={60}
                className="flex-1 bg-panel-surface border border-panel-border rounded-md px-3 py-1.5 text-sm text-panel-text placeholder:text-panel-muted/40 focus:outline-none focus:border-panel-accent transition-colors"
              />
              <Button onClick={registerPasskey} disabled={loading.passkey} size="sm">
                <Key size={13} className="mr-1" />
                {loading.passkey ? 'Warte…' : 'Registrieren'}
              </Button>
            </div>
            <Msg msg={msgs.passkey} />
          </div>
        </Card>

      </>)}

      {/* ═══════════════════ SYSTEM-TAB (Admin) ═══════════════════ */}
      {tab === 'system' && isAdmin && (<>

        {/* ── SMTP ── */}
        <Card title={<span className="flex items-center gap-2"><Send size={14} />SMTP E-Mail (Passwort-Reset)</span>}>
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-2">
              <div className="col-span-2">
                <label className="block text-xs text-panel-muted mb-1">SMTP Host</label>
                <input value={smtp.host} onChange={e => setSmtp(s => ({ ...s, host: e.target.value }))}
                  placeholder="smtp.example.com" className={inputCls} />
              </div>
              <div>
                <label className="block text-xs text-panel-muted mb-1">Port</label>
                <input type="number" value={smtp.port}
                  onChange={e => setSmtp(s => ({ ...s, port: Number(e.target.value) }))}
                  placeholder="587" className={inputCls} />
              </div>
            </div>
            <div>
              <label className="block text-xs text-panel-muted mb-1">Benutzername</label>
              <input value={smtp.user} onChange={e => setSmtp(s => ({ ...s, user: e.target.value }))}
                placeholder="user@example.com" className={inputCls} />
            </div>
            <div>
              <label className="block text-xs text-panel-muted mb-1">Passwort</label>
              <div className="relative">
                <input
                  type={showSmtpPw ? 'text' : 'password'}
                  value={smtp.pass}
                  onChange={e => setSmtp(s => ({ ...s, pass: e.target.value }))}
                  placeholder={status.smtp_pass === '***gesetzt***' ? '(gesetzt — leer lassen = behalten)' : ''}
                  className={inputCls + ' pr-9'}
                />
                <button type="button" onClick={() => setShowSmtpPw(v => !v)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-panel-muted hover:text-panel-text">
                  {showSmtpPw ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
            </div>
            <div>
              <label className="block text-xs text-panel-muted mb-1">Absender-Adresse (From)</label>
              <input value={smtp.from} onChange={e => setSmtp(s => ({ ...s, from: e.target.value }))}
                placeholder="Monitoring Panel <noreply@example.com>" className={inputCls} />
            </div>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={smtp.secure}
                onChange={e => setSmtp(s => ({ ...s, secure: e.target.checked }))}
                className="rounded border-panel-border" />
              <span className="text-xs text-panel-text">SSL/TLS (Port 465) — deaktiviert für STARTTLS (Port 587)</span>
            </label>
            <div className="flex gap-2">
              <Button onClick={saveSmtp} disabled={loading.smtp} size="sm">SMTP speichern</Button>
              <Button onClick={testSmtp} disabled={loading.smtp_test} size="sm" variant="ghost">
                <Send size={12} className="mr-1" />Test-Mail senden
              </Button>
            </div>
            <Msg msg={msgs.smtp} />
          </div>
        </Card>

        {/* ── Hetzner ── */}
        <Card title={<span className="flex items-center gap-2"><Cloud size={14} />Hetzner Cloud API</span>}>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <StatusBadge set={!!status.hetzner_api_token} />
              {status.hetzner_api_token && (
                <Button size="sm" variant="danger" onClick={deleteHetzner} disabled={loading.hetzner_del}>
                  <Trash2 size={12} className="mr-1" />Entfernen
                </Button>
              )}
            </div>
            <div>
              <label className="block text-xs text-panel-muted mb-1">
                {status.hetzner_api_token ? 'Neuen Token eintragen (überschreibt)' : 'API Token'}
              </label>
              <div className="relative">
                <input
                  type={showHetzner ? 'text' : 'password'}
                  value={hetznerToken}
                  onChange={e => setHetznerToken(e.target.value)}
                  placeholder="hv1-..."
                  className={inputCls + ' pr-9'}
                  onKeyDown={e => e.key === 'Enter' && saveHetzner()}
                />
                <button type="button" onClick={() => setShowHetzner(v => !v)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-panel-muted hover:text-panel-text">
                  {showHetzner ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
            </div>
            <Button onClick={saveHetzner} disabled={!hetznerToken.trim() || loading.hetzner} size="sm">Speichern</Button>
            <Msg msg={msgs.hetzner} />
          </div>
        </Card>

        {/* ── Dockhand ── */}
        <Card title={<span className="flex items-center gap-2"><Layers size={14} />Dockhand Docker-Management</span>}>
          <div className="space-y-3">
            <p className="text-xs text-panel-muted">
              Verbindet das Panel mit einer laufenden Dockhand-Instanz. Der API-Token wird unter
              Dockhand → Settings → Authentication → API Tokens generiert.
            </p>

            {/* URL */}
            <div>
              <label className="block text-xs text-panel-muted mb-1">Dockhand URL</label>
              <input
                value={dockhandUrl}
                onChange={e => setDockhandUrl(e.target.value)}
                placeholder="http://localhost:3000"
                className={inputCls}
              />
            </div>

            {/* Token */}
            <div>
              <label className="block text-xs text-panel-muted mb-1">
                API-Token {status.dockhandHasToken && <span className="text-panel-green">(gesetzt)</span>}
              </label>
              <div className="relative">
                <input
                  type={showDockhandToken ? 'text' : 'password'}
                  value={dockhandToken}
                  onChange={e => setDockhandToken(e.target.value)}
                  placeholder={status.dockhandHasToken ? '(gesetzt — leer lassen = behalten)' : 'dh_xxxxxxxx…'}
                  className={inputCls + ' pr-9'}
                />
                <button type="button" onClick={() => setShowDockhandToken(v => !v)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-panel-muted hover:text-panel-text">
                  {showDockhandToken ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
            </div>

            <div className="flex gap-2">
              <Button onClick={testDockhand} disabled={!dockhandUrl || loading.dockhand} size="sm" variant="ghost">
                <RefreshCw size={12} className="mr-1" />Verbindung testen
              </Button>
              <Button onClick={saveDockhand} disabled={!dockhandUrl || loading.dockhand_save} size="sm">
                Speichern
              </Button>
            </div>

            {/* Environment-Mapping — erscheint sobald Envs geladen */}
            {dockhandEnvs.length > 0 && (
              <div className="border border-panel-border rounded-md overflow-hidden mt-1">
                <div className="bg-panel-surface px-3 py-1.5 text-xs font-medium text-panel-muted border-b border-panel-border">
                  Environment-Zuweisung
                </div>
                <div className="divide-y divide-panel-border">
                  {/* Lokaler Server */}
                  <div className="flex items-center justify-between px-3 py-2">
                    <span className="text-xs text-panel-text">Lokaler Panel-Server</span>
                    <select
                      value={dockhandEnvId}
                      onChange={e => {
                        const v = e.target.value;
                        setDockhandEnvId(v);
                        axios.post('/api/dockhand/config', { localEnvId: v }).catch(() => {});
                      }}
                      className="bg-panel-surface border border-panel-border rounded px-2 py-1 text-xs text-panel-text focus:outline-none focus:border-panel-accent">
                      <option value="">— nicht zugewiesen —</option>
                      {dockhandEnvs.map(e => (
                        <option key={e.id} value={e.id}>{e.name}</option>
                      ))}
                    </select>
                  </div>
                  {/* Remote-Agents */}
                  {dockhandAgents.map(agent => (
                    <div key={agent.id} className="flex items-center justify-between px-3 py-2">
                      <span className="text-xs text-panel-text">{agent.name}</span>
                      <select
                        value={agent.dockhand_env_id ?? ''}
                        onChange={e => saveAgentEnv(agent.id, e.target.value)}
                        className="bg-panel-surface border border-panel-border rounded px-2 py-1 text-xs text-panel-text focus:outline-none focus:border-panel-accent">
                        <option value="">— nicht zugewiesen —</option>
                        {dockhandEnvs.map(e => (
                          <option key={e.id} value={e.id}>{e.name}</option>
                        ))}
                      </select>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <Msg msg={msgs.dockhand} />
          </div>
        </Card>

        {/* ── PatchMon-Server-Verknüpfung ── */}
        <Card title={<span className="flex items-center gap-2"><PackageCheck size={14} />PatchMon-Server-Verknüpfung</span>}>
          <div className="space-y-3">
            <p className="text-xs text-panel-muted">
              Ordne jedem Panel-Server den passenden PatchMon-Host zu. Dann erscheinen Update-Infos am Server und PatchMon-Alerts funktionieren (inkl. lokalem Server).
            </p>
            {pmHosts.length === 0 ? (
              <p className="text-xs text-panel-muted">
                Keine PatchMon-Hosts geladen — zuerst unter „PatchMon" die Verbindung einrichten.
              </p>
            ) : (
              <div className="border border-panel-border rounded-md overflow-hidden">
                <div className="divide-y divide-panel-border">
                  {/* Lokaler Server */}
                  <div className="flex items-center justify-between px-3 py-2 gap-2">
                    <span className="text-xs text-panel-text truncate">Lokaler Panel-Server</span>
                    <select
                      value={pmLocalHostId}
                      onChange={e => saveLocalPm(e.target.value)}
                      className="bg-panel-surface border border-panel-border rounded px-2 py-1 text-xs text-panel-text focus:outline-none focus:border-panel-accent max-w-[60%]">
                      <option value="">— nicht verknüpft —</option>
                      {pmHosts.map(h => <option key={h.id} value={h.id}>{h.name}{h.ip ? ` · ${h.ip}` : ''}</option>)}
                    </select>
                  </div>
                  {/* Remote-Agents */}
                  {pmAgents.map(a => (
                    <div key={a.id} className="flex items-center justify-between px-3 py-2 gap-2">
                      <span className="text-xs text-panel-text truncate">{a.name}</span>
                      <select
                        value={a.patchmon_host_id ?? ''}
                        onChange={e => saveAgentPm(a.id, e.target.value)}
                        className="bg-panel-surface border border-panel-border rounded px-2 py-1 text-xs text-panel-text focus:outline-none focus:border-panel-accent max-w-[60%]">
                        <option value="">— nicht verknüpft —</option>
                        {pmHosts.map(h => <option key={h.id} value={h.id}>{h.name}{h.ip ? ` · ${h.ip}` : ''}</option>)}
                      </select>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </Card>

        {/* ── Benachrichtigungen ── */}
        <Card title={<span className="flex items-center gap-2"><Bell size={14} />Benachrichtigungen</span>}>
          <ActionNotificationsToggle />
        </Card>

        {/* ── Live-Refresh-Intervall ── */}
        <Card title={<span className="flex items-center gap-2"><Timer size={14} />Live-Refresh-Intervall</span>}>
          <div className="space-y-3">
            <p className="text-xs text-panel-muted">
              Wie oft Agent-Detail- und Dashboard-Seiten automatisch aktualisieren (5–300 Sekunden).
            </p>
            <div className="flex items-center gap-3">
              <input
                type="number"
                min={5}
                max={300}
                value={liveInterval}
                onChange={e => setLiveInterval(e.target.value)}
                onBlur={() => setLiveInterval(v => Math.max(5, Math.min(300, parseInt(v, 10) || 15)))}
                className={inputCls + ' w-28'}
              />
              <span className="text-sm text-panel-muted">Sekunden</span>
            </div>
            <Button onClick={saveLiveInterval} disabled={loading.liveInterval} size="sm">
              Speichern
            </Button>
            <Msg msg={msgs.liveInterval} />
          </div>
        </Card>

        {/* ── MC-Host24 ── */}
        <Card title={<span className="flex items-center gap-2"><Server size={14} />MC-Host24</span>}>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <StatusBadge set={status.mchost_token_set} />
                {status.mchost_token_set && (
                  <p className="text-xs text-panel-muted">Token aktiv · wird automatisch erneuert</p>
                )}
              </div>
              <div className="flex gap-1">
                {status.mchost_token_set && (
                  <Button size="sm" variant="ghost" onClick={refreshMcHost} disabled={loading.mchost_refresh}>
                    <RefreshCw size={12} className="mr-1" />Erneuern
                  </Button>
                )}
                {(status.mchost_token_set || status.mchost_username) && (
                  <Button size="sm" variant="danger" onClick={deleteMcHost} disabled={loading.mchost_del}>
                    <Trash2 size={12} className="mr-1" />Entfernen
                  </Button>
                )}
              </div>
            </div>
            <div>
              <label className="block text-xs text-panel-muted mb-1">E-Mail-Adresse</label>
              <input type="email" value={mcUsername} onChange={e => setMcUsername(e.target.value)}
                placeholder="deine@email.de" className={inputCls} />
              <p className="text-xs text-panel-muted mt-1">
                Verwende deine MC-Host24 <strong>Login-E-Mail</strong>, nicht deinen Anzeigenamen.
              </p>
            </div>
            <div>
              <label className="block text-xs text-panel-muted mb-1">Passwort</label>
              <div className="relative">
                <input
                  type={showMcPw ? 'text' : 'password'}
                  value={mcPassword}
                  onChange={e => setMcPassword(e.target.value)}
                  placeholder="••••••••"
                  className={inputCls + ' pr-9'}
                  onKeyDown={e => e.key === 'Enter' && loginMcHost()}
                />
                <button type="button" onClick={() => setShowMcPw(v => !v)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-panel-muted hover:text-panel-text">
                  {showMcPw ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
            </div>
            <Button onClick={loginMcHost} disabled={!mcUsername || !mcPassword || loading.mchost} size="sm">
              {status.mchost_token_set ? 'Neu einloggen' : 'Einloggen & Token holen'}
            </Button>
            <Msg msg={msgs.mchost} />
          </div>
        </Card>

      </>)}

      {/* ── Claude KI ────────────────────────────────────────────────────────── */}
      {isAdmin && (
        <Card title={<span className="flex items-center gap-2"><Key size={14} />KI-Assistent (Claude · Anthropic)</span>}>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <StatusBadge set={!!status.claude_api_key} />
            </div>
            <div>
              <label className="block text-xs text-panel-muted mb-1">API-Key</label>
              <div className="relative">
                <input
                  type={showClaudeKey ? 'text' : 'password'}
                  value={claudeKey}
                  onChange={e => setClaudeKey(e.target.value)}
                  placeholder={status.claude_api_key ? '***gesetzt*** (neu eingeben zum Ändern)' : 'sk-ant-…'}
                  className={inputCls + ' pr-9'}
                />
                <button type="button" onClick={() => setShowClaudeKey(v => !v)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-panel-muted hover:text-panel-text">
                  {showClaudeKey ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
              <p className="text-xs text-panel-muted mt-1">
                API-Key aus <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer" className="text-panel-accent underline">Anthropic Console</a> — beginnt mit <code className="bg-panel-surface px-1 rounded">sk-ant-</code>
              </p>
            </div>
            <div>
              <label className="block text-xs text-panel-muted mb-1">Modell</label>
              <select value={claudeModel} onChange={e => setClaudeModel(e.target.value)} className={inputCls}>
                <option value="claude-haiku-4-5">Claude Haiku 4.5 (schnell &amp; günstig, empfohlen)</option>
                <option value="claude-sonnet-4-5">Claude Sonnet 4.5 (ausgewogen)</option>
                <option value="claude-opus-4-5">Claude Opus 4.5 (leistungsstark)</option>
              </select>
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={async () => {
                if (!claudeKey) return;
                setLoading(l => ({ ...l, claude: true }));
                try {
                  await axios.put('/api/settings/claude', { apiKey: claudeKey, model: claudeModel });
                  setMsgs(m => ({ ...m, claude: '✓ Gespeichert' }));
                  setClaudeKey('');
                  await loadAdmin();
                } catch (e) { setMsgs(m => ({ ...m, claude: e.response?.data?.error || 'Fehler' })); }
                setLoading(l => ({ ...l, claude: false }));
              }} disabled={!claudeKey || loading.claude}>
                {loading.claude ? 'Speichere…' : 'Speichern'}
              </Button>
              {status.claude_api_key && (
                <Button size="sm" variant="danger" onClick={async () => {
                  if (!confirm('Claude API-Key wirklich entfernen?')) return;
                  await axios.delete('/api/settings/claude');
                  setMsgs(m => ({ ...m, claude: '✓ Entfernt' }));
                  await loadAdmin();
                }}>
                  <Trash2 size={12} className="mr-1" />Entfernen
                </Button>
              )}
            </div>
            <Msg msg={msgs.claude} />
          </div>
        </Card>
      )}

      {/* ── Aktive Sitzungen ─────────────────────────────────────────────────── */}
      <SessionsSection isAdmin={isAdmin} />

      </div>{/* /Masonry-Raster */}
    </div>
  );
}
