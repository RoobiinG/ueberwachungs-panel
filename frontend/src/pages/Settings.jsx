import { useEffect, useState } from 'react';
import axios from 'axios';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { useAuth } from '../context/AuthContext';
import {
  Cloud, Server, Eye, EyeOff, CheckCircle, XCircle,
  RefreshCw, Trash2, Lock, Mail, Key, ShieldCheck, Send,
} from 'lucide-react';

const inputCls = 'w-full bg-panel-surface border border-panel-border rounded-md px-3 py-2 text-sm text-panel-text focus:outline-none focus:border-panel-accent transition-colors';

const StatusBadge = ({ set }) => set
  ? <span className="flex items-center gap-1 text-xs text-panel-green"><CheckCircle size={13} />Konfiguriert</span>
  : <span className="flex items-center gap-1 text-xs text-panel-muted"><XCircle size={13} />Nicht gesetzt</span>;

const Msg = ({ msg }) => msg ? (
  <p className={`text-xs mt-2 ${msg.type === 'ok' ? 'text-panel-green' : 'text-panel-red'}`}>{msg.text}</p>
) : null;

export default function Settings() {
  const { isAdmin } = useAuth();

  const [status, setStatus] = useState({});
  const [loading, setLoading] = useState({});
  const [msgs,    setMsgs]    = useState({});

  // Passwort
  const [pwCurrent,  setPwCurrent]  = useState('');
  const [pwNew,      setPwNew]      = useState('');
  const [pwConfirm,  setPwConfirm]  = useState('');
  const [showPw,     setShowPw]     = useState(false);

  // E-Mail
  const [email,     setEmail]    = useState('');
  const [showEmail, setShowEmail] = useState(false);

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

  // Passkeys
  const [passkeys, setPasskeys] = useState([]);

  // ── Laden ─────────────────────────────────────────────────────────────────

  const load = async () => {
    try {
      const { data } = await axios.get('/api/settings');
      setStatus(data);
      if (data.mchost_username) setMcUsername(data.mchost_username);
      if (data.smtp_host)       setSmtp(s => ({ ...s, host: data.smtp_host  || '' }));
      if (data.smtp_port)       setSmtp(s => ({ ...s, port: data.smtp_port  || 587 }));
      if (data.smtp_user)       setSmtp(s => ({ ...s, user: data.smtp_user  || '' }));
      if (data.smtp_from)       setSmtp(s => ({ ...s, from: data.smtp_from  || '' }));
      if (data.smtp_secure !== undefined) setSmtp(s => ({ ...s, secure: !!data.smtp_secure }));
    } catch {}
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
    load();
    loadPasskeys();
    loadEmail();
  }, []);

  // ── Hilfsfunktionen ───────────────────────────────────────────────────────

  const feedback = (key, type, text) => {
    setMsgs(m => ({ ...m, [key]: { type, text } }));
    setTimeout(() => setMsgs(m => ({ ...m, [key]: null })), 4000);
  };
  const busy = (key, val) => setLoading(l => ({ ...l, [key]: val }));

  // ── Aktionen ──────────────────────────────────────────────────────────────

  const changePassword = async () => {
    if (pwNew !== pwConfirm) return feedback('pw', 'err', 'Passwörter stimmen nicht überein');
    if (pwNew.length < 6)    return feedback('pw', 'err', 'Mindestens 6 Zeichen erforderlich');
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

  const saveHetzner = async () => {
    if (!hetznerToken.trim()) return;
    busy('hetzner', true);
    try {
      await axios.put('/api/settings/hetzner', { token: hetznerToken });
      setHetznerToken('');
      await load();
      feedback('hetzner', 'ok', 'Token gespeichert');
    } catch (err) {
      feedback('hetzner', 'err', err.response?.data?.error || 'Fehler');
    }
    busy('hetzner', false);
  };

  const deleteHetzner = async () => {
    busy('hetzner_del', true);
    try { await axios.delete('/api/settings/hetzner'); await load(); feedback('hetzner', 'ok', 'Token gelöscht'); }
    catch { feedback('hetzner', 'err', 'Fehler beim Löschen'); }
    busy('hetzner_del', false);
  };

  const loginMcHost = async () => {
    if (!mcUsername || !mcPassword) return;
    busy('mchost', true);
    try {
      const { data } = await axios.post('/api/settings/mchost/login', { username: mcUsername, password: mcPassword });
      setMcPassword('');
      await load();
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
      await load();
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
      await load();
      feedback('mchost', 'ok', 'Zugangsdaten gelöscht');
    } catch { feedback('mchost', 'err', 'Fehler beim Löschen'); }
    busy('mchost_del', false);
  };

  const saveSmtp = async () => {
    busy('smtp', true);
    try {
      // Leeres Passwort-Feld → nicht überschreiben
      const payload = { ...smtp };
      if (!payload.pass) delete payload.pass;
      await axios.put('/api/settings/smtp', payload);
      await load();
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

  const registerPasskey = async () => {
    busy('passkey', true);
    try {
      const { startRegistration } = await import('@simplewebauthn/browser');
      const optRes = await axios.get('/api/passkeys/register/start');
      const attResp = await startRegistration(optRes.data);
      await axios.post('/api/passkeys/register/finish', attResp);
      await loadPasskeys();
      feedback('passkey', 'ok', 'Passkey erfolgreich registriert');
    } catch (err) {
      feedback('passkey', 'err', err.response?.data?.error || err.message || 'Registrierung fehlgeschlagen');
    }
    busy('passkey', false);
  };

  const deletePasskey = async (id) => {
    if (!confirm('Passkey löschen?')) return;
    try {
      await axios.delete(`/api/passkeys/${id}`);
      await loadPasskeys();
      feedback('passkey', 'ok', 'Passkey gelöscht');
    } catch { feedback('passkey', 'err', 'Fehler beim Löschen'); }
  };

  const fmtDate = (s) => s ? new Date(s).toLocaleString('de-DE') : '—';

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-4 max-w-xl">

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
          <p className="text-xs text-panel-muted">
            Wird für Passwort-Reset-E-Mails verwendet.
          </p>
          <div className="relative">
            <input
              type={showEmail ? 'text' : 'email'}
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="deine@email.de"
              className={inputCls + ' pr-9'}
              onKeyDown={e => e.key === 'Enter' && saveEmail()}
            />
            <button type="button" onClick={() => setShowEmail(v => !v)}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-panel-muted hover:text-panel-text">
              {showEmail ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>
          <Button onClick={saveEmail} disabled={loading.email} size="sm">
            E-Mail speichern
          </Button>
          <Msg msg={msgs.email} />
        </div>
      </Card>

      {/* ── Passkeys ── */}
      <Card title={<span className="flex items-center gap-2"><ShieldCheck size={14} />Passkeys (WebAuthn)</span>}>
        <div className="space-y-3">
          {passkeys.length > 0 ? (
            <div className="divide-y divide-panel-border -mx-4">
              {passkeys.map(pk => (
                <div key={pk.id} className="flex items-center justify-between px-4 py-2.5">
                  <div>
                    <p className="text-xs text-panel-text">{pk.device_type || 'Passkey'}</p>
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
          <Button onClick={registerPasskey} disabled={loading.passkey} size="sm">
            <Key size={13} className="mr-1" />Passkey registrieren
          </Button>
          <Msg msg={msgs.passkey} />
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
          <Button onClick={saveHetzner} disabled={!hetznerToken.trim() || loading.hetzner} size="sm">
            Speichern
          </Button>
          <Msg msg={msgs.hetzner} />
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
            <label className="block text-xs text-panel-muted mb-1">Benutzername</label>
            <input type="text" value={mcUsername} onChange={e => setMcUsername(e.target.value)}
              placeholder="dein@email.de" className={inputCls} />
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

      {/* ── SMTP (nur Admin) ── */}
      {isAdmin && (
        <Card title={<span className="flex items-center gap-2"><Send size={14} />SMTP E-Mail (Passwort-Reset)</span>}>
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-2">
              <div className="col-span-2">
                <label className="block text-xs text-panel-muted mb-1">SMTP Host</label>
                <input
                  value={smtp.host}
                  onChange={e => setSmtp(s => ({ ...s, host: e.target.value }))}
                  placeholder="smtp.example.com"
                  className={inputCls}
                />
              </div>
              <div>
                <label className="block text-xs text-panel-muted mb-1">Port</label>
                <input
                  type="number"
                  value={smtp.port}
                  onChange={e => setSmtp(s => ({ ...s, port: Number(e.target.value) }))}
                  placeholder="587"
                  className={inputCls}
                />
              </div>
            </div>
            <div>
              <label className="block text-xs text-panel-muted mb-1">Benutzername</label>
              <input
                value={smtp.user}
                onChange={e => setSmtp(s => ({ ...s, user: e.target.value }))}
                placeholder="user@example.com"
                className={inputCls}
              />
            </div>
            <div>
              <label className="block text-xs text-panel-muted mb-1">Passwort</label>
              <div className="relative">
                <input
                  type={showSmtpPw ? 'text' : 'password'}
                  value={smtp.pass}
                  onChange={e => setSmtp(s => ({ ...s, pass: e.target.value }))}
                  placeholder={status.smtp_pass === '***gesetzt***' ? '***gesetzt*** (leer lassen = behalten)' : ''}
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
              <input
                value={smtp.from}
                onChange={e => setSmtp(s => ({ ...s, from: e.target.value }))}
                placeholder="Monitoring Panel <noreply@example.com>"
                className={inputCls}
              />
            </div>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={smtp.secure}
                onChange={e => setSmtp(s => ({ ...s, secure: e.target.checked }))}
                className="rounded border-panel-border"
              />
              <span className="text-xs text-panel-text">SSL/TLS (Port 465) — deaktiviert für STARTTLS (Port 587)</span>
            </label>
            <div className="flex gap-2">
              <Button onClick={saveSmtp} disabled={loading.smtp} size="sm">
                SMTP speichern
              </Button>
              <Button onClick={testSmtp} disabled={loading.smtp_test} size="sm" variant="ghost">
                <Send size={12} className="mr-1" />Test-Mail senden
              </Button>
            </div>
            <Msg msg={msgs.smtp} />
          </div>
        </Card>
      )}

    </div>
  );
}
