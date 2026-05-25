import { useEffect, useState } from 'react';
import axios from 'axios';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Cloud, Server, Eye, EyeOff, CheckCircle, XCircle, RefreshCw, Trash2, Lock } from 'lucide-react';

const inputCls = 'w-full bg-panel-surface border border-panel-border rounded-md px-3 py-2 text-sm text-panel-text focus:outline-none focus:border-panel-accent transition-colors';

const StatusBadge = ({ set }) => set
  ? <span className="flex items-center gap-1 text-xs text-panel-green"><CheckCircle size={13} />Konfiguriert</span>
  : <span className="flex items-center gap-1 text-xs text-panel-muted"><XCircle size={13} />Nicht gesetzt</span>;

export default function Settings() {
  const [status, setStatus] = useState({});
  const [pwCurrent, setPwCurrent] = useState('');
  const [pwNew, setPwNew] = useState('');
  const [pwConfirm, setPwConfirm] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [hetznerToken, setHetznerToken] = useState('');
  const [showHetzner, setShowHetzner] = useState(false);
  const [mcUsername, setMcUsername] = useState('');
  const [mcPassword, setMcPassword] = useState('');
  const [showMcPw, setShowMcPw] = useState(false);
  const [loading, setLoading] = useState({});
  const [msg, setMsg] = useState({});

  const load = async () => {
    try {
      const { data } = await axios.get('/api/settings');
      setStatus(data);
      if (data.mchost_username) setMcUsername(data.mchost_username);
    } catch {}
  };

  useEffect(() => { load(); }, []);

  const feedback = (key, type, text) => {
    setMsg(m => ({ ...m, [key]: { type, text } }));
    setTimeout(() => setMsg(m => ({ ...m, [key]: null })), 4000);
  };

  const busy = (key, val) => setLoading(l => ({ ...l, [key]: val }));

  const changePassword = async () => {
    if (pwNew !== pwConfirm) return feedback('pw', 'err', 'Passwörter stimmen nicht überein');
    if (pwNew.length < 6) return feedback('pw', 'err', 'Mindestens 6 Zeichen erforderlich');
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

  // Hetzner Token speichern
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

  // Hetzner Token löschen
  const deleteHetzner = async () => {
    busy('hetzner_del', true);
    try { await axios.delete('/api/settings/hetzner'); await load(); feedback('hetzner', 'ok', 'Token gelöscht'); }
    catch { feedback('hetzner', 'err', 'Fehler beim Löschen'); }
    busy('hetzner_del', false);
  };

  // MC-Host24 Login
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

  // MC-Host24 Token erneuern
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

  // MC-Host24 Credentials löschen
  const deleteMcHost = async () => {
    busy('mchost_del', true);
    try { await axios.delete('/api/settings/mchost'); setMcUsername(''); setMcPassword(''); await load(); feedback('mchost', 'ok', 'Zugangsdaten gelöscht'); }
    catch { feedback('mchost', 'err', 'Fehler beim Löschen'); }
    busy('mchost_del', false);
  };

  const Msg = ({ k }) => msg[k] ? (
    <p className={`text-xs mt-2 ${msg[k].type === 'ok' ? 'text-panel-green' : 'text-panel-red'}`}>{msg[k].text}</p>
  ) : null;

  return (
    <div className="space-y-4 max-w-xl">

      {/* Passwort ändern */}
      <Card title={<span className="flex items-center gap-2"><Lock size={14} />Passwort ändern</span>}>
        <div className="space-y-3">
          {[
            ['Aktuelles Passwort', pwCurrent, setPwCurrent],
            ['Neues Passwort', pwNew, setPwNew],
            ['Neues Passwort bestätigen', pwConfirm, setPwConfirm],
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
          <Button onClick={changePassword} disabled={!pwCurrent || !pwNew || !pwConfirm || loading.pw} size="sm">
            Passwort speichern
          </Button>
          <Msg k="pw" />
        </div>
      </Card>

      {/* Hetzner */}
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
              {status.hetzner_api_token ? 'Neuen Token eintragen (überschreibt aktuellen)' : 'API Token'}
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
          <Msg k="hetzner" />
        </div>
      </Card>

      {/* MC-Host24 */}
      <Card title={<span className="flex items-center gap-2"><Server size={14} />MC-Host24</span>}>
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <StatusBadge set={status.mchost_token_set} />
              {status.mchost_token_set && (
                <p className="text-xs text-panel-muted">API-Token aktiv · wird bei Bedarf automatisch erneuert</p>
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
            <input
              type="text"
              value={mcUsername}
              onChange={e => setMcUsername(e.target.value)}
              placeholder="dein@email.de oder Username"
              className={inputCls}
            />
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
          <Msg k="mchost" />
        </div>
      </Card>

    </div>
  );
}
