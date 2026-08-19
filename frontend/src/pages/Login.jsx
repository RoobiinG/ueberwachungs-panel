import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Server, Eye, EyeOff, KeyRound, Shield, ArrowLeft } from 'lucide-react';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';

// Der Zwischenschritt der Zwei-Faktor-Anmeldung überdauert ein Neuladen der Seite.
// Vorher lag er nur im Komponenten-Zustand: Jeder Neuaufbau der Seite — etwa ausgelöst
// von einer Passwortmanager-Erweiterung beim Ausfüllen — warf den Benutzer wortlos
// zurück auf die Anmeldemaske, obwohl Benutzername und Passwort längst stimmten.
// sessionStorage, nicht localStorage: Das Zwischen-Token soll mit dem Tab enden.
const SPEICHER_2FA = 'panel_2fa_schritt';

const lade2FA = () => {
  try {
    const roh = sessionStorage.getItem(SPEICHER_2FA);
    if (!roh) return null;
    const daten = JSON.parse(roh);
    // Das Zwischen-Token gilt serverseitig zehn Minuten — abgelaufenes gar nicht erst anbieten.
    if (!daten?.tempToken || Date.now() > (daten.gueltigBis || 0)) {
      sessionStorage.removeItem(SPEICHER_2FA);
      return null;
    }
    return daten;
  } catch {
    return null;
  }
};

export default function Login() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw]     = useState(false);
  const [error, setError]       = useState('');
  const [loading, setLoading]   = useState(false);
  const [pkLoading, setPkLoading] = useState(false);
  const [step2FA, setStep2FA]   = useState(lade2FA);
  const [code2FA, setCode2FA]   = useState('');
  const { login, verify2FA, saveSession } = useAuth();
  const navigate = useNavigate();

  // Zwischenschritt sichern bzw. aufräumen, sobald er nicht mehr gebraucht wird
  useEffect(() => {
    if (step2FA) sessionStorage.setItem(SPEICHER_2FA, JSON.stringify(step2FA));
    else         sessionStorage.removeItem(SPEICHER_2FA);
  }, [step2FA]);

  const abbrechen2FA = () => {
    sessionStorage.removeItem(SPEICHER_2FA);
    setStep2FA(null);
    setCode2FA('');
    setError('');
  };

  // Passwortmanager wie Enpass schreiben ihre Werte teilweise direkt ins DOM-Feld, ohne
  // dass React davon erfährt. Der Komponenten-Zustand bleibt dann leer, obwohl im Feld
  // etwas steht. Deshalb beim Absenden immer das Formular selbst befragen und den
  // Zustand nur als Rückfallebene benutzen.
  const feldWert = (form, feld, ersatz) => {
    const roh = form?.elements?.[feld]?.value;
    return (roh === undefined || roh === null || roh === '') ? ersatz : roh;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const form     = e.currentTarget;
    const benutzer = String(feldWert(form, 'username', username)).trim();
    const passwort = String(feldWert(form, 'password', password));
    setError('');
    if (!benutzer || !passwort) {
      setError('Bitte Benutzername und Passwort eingeben.');
      return;
    }
    setLoading(true);
    try {
      const res = await login(benutzer, passwort);
      if (res.require2FA) {
        setStep2FA({
          twofaType: res.twofaType,
          tempToken: res.tempToken,
          message: res.message,
          // Das Zwischen-Token gilt serverseitig zehn Minuten (routes/auth.js).
          gueltigBis: Date.now() + 10 * 60 * 1000,
        });
        setCode2FA('');
      } else {
        navigate('/');
      }
    } catch (err) {
      setError(err.response?.data?.error || 'Anmeldung fehlgeschlagen');
    } finally {
      setLoading(false);
    }
  };

  const handleVerify2FA = async (e) => {
    e.preventDefault();
    // Gleicher Grund wie oben: Der Einmalcode kommt bei automatischem Ausfüllen unter
    // Umständen nur im DOM an.
    const code = String(feldWert(e.currentTarget, 'otp', code2FA)).replace(/\D/g, '').slice(0, 6);
    setError('');
    if (code.length !== 6) {
      setError('Bitte den 6-stelligen Code eingeben.');
      return;
    }
    setLoading(true);
    try {
      await verify2FA(step2FA.tempToken, code);
      sessionStorage.removeItem(SPEICHER_2FA);
      navigate('/');
    } catch (err) {
      const meldung = err.response?.data?.error || 'Ungültiger 2FA-Code';
      // Ist das Zwischen-Token abgelaufen, hilft kein weiterer Code mehr — zurück zur
      // Anmeldung, statt den Benutzer vor einem toten Formular stehen zu lassen.
      if (/abgelaufen|ungültige Sitzung|Ungültiges 2FA-Token/i.test(meldung)) {
        abbrechen2FA();
        setError('Die Anmeldung ist abgelaufen. Bitte melde dich erneut an.');
      } else {
        setError(meldung);
      }
    } finally {
      setLoading(false);
    }
  };

  const handlePasskeyLogin = async () => {
    setError('');
    setPkLoading(true);
    try {
      const { startAuthentication } = await import('@simplewebauthn/browser');
      const optRes  = await axios.post('/api/auth/passkey/login/start');
      const assertion = await startAuthentication({ optionsJSON: optRes.data });
      const finRes  = await axios.post('/api/auth/passkey/login/finish', assertion);
      saveSession(finRes.data.user, finRes.data.token);
      navigate('/');
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Passkey-Anmeldung fehlgeschlagen');
    } finally {
      setPkLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-panel-bg flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-8">
          <div className="p-3 bg-panel-surface border border-panel-border rounded-xl mb-3">
            <Server size={28} className="text-panel-accent" />
          </div>
          <h1 className="text-xl font-bold text-panel-text">Überwachungs-Panel</h1>
          <p className="text-sm text-panel-muted mt-1">Anmelden um fortzufahren</p>
        </div>

        {step2FA ? (
          <form onSubmit={handleVerify2FA} className="bg-panel-card border border-panel-border rounded-lg p-6 space-y-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-panel-text mb-1">
              <Shield size={18} className="text-panel-accent" />
              Zwei-Faktor-Authentifizierung
            </div>
            <p className="text-xs text-panel-muted leading-relaxed">
              {step2FA.message || (step2FA.twofaType === 'email'
                ? 'Wir haben dir einen 6-stelligen Bestätigungscode per E-Mail gesendet.'
                : 'Bitte gib den 6-stelligen Code aus deiner Authenticator-App ein.')}
            </p>

            {error && (
              <div className="bg-panel-red/10 border border-panel-red/30 text-panel-red text-sm rounded-md px-3 py-2">
                {error}
              </div>
            )}

            <div>
              <label className="block text-xs font-medium text-panel-muted mb-1.5">6-stelliger Code</label>
              {/* `one-time-code` sagt Browsern und Passwortmanagern, dass hier ein
                  Einmalcode erwartet wird. Ohne diese Auszeichnung halten Erweiterungen
                  wie Enpass das Feld für ein gewöhnliches Anmeldefeld und füllen im
                  Zweifel Benutzername oder Passwort hinein. */}
              <input
                type="text"
                name="otp"
                autoComplete="one-time-code"
                inputMode="numeric"
                pattern="[0-9]*"
                value={code2FA}
                onChange={e => setCode2FA(e.target.value.replace(/\D/g, '').slice(0, 6))}
                className="w-full bg-panel-surface border border-panel-border rounded-md px-3 py-2 text-center text-lg font-mono tracking-widest text-panel-text focus:outline-none focus:border-panel-accent transition-colors"
                placeholder="123456"
                autoFocus
                maxLength={6}
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-panel-accent hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium py-2 rounded-md transition-colors"
            >
              {loading ? 'Prüfe Code...' : 'Code bestätigen'}
            </button>

            <button
              type="button"
              onClick={abbrechen2FA}
              className="w-full flex items-center justify-center gap-1.5 text-xs text-panel-muted hover:text-panel-text pt-1 transition-colors"
            >
              <ArrowLeft size={13} />Zurück zur Anmeldung
            </button>
          </form>
        ) : (
          <form onSubmit={handleSubmit} className="bg-panel-card border border-panel-border rounded-lg p-6 space-y-4">
            {error && (
              <div className="bg-panel-red/10 border border-panel-red/30 text-panel-red text-sm rounded-md px-3 py-2">
                {error}
              </div>
            )}

            <div>
              <label className="block text-xs font-medium text-panel-muted mb-1">Benutzername</label>
              {/* name + autoComplete, damit Passwortmanager die Felder eindeutig
                  zuordnen können und nicht ins falsche Formular schreiben. */}
              <input
                type="text"
                name="username"
                autoComplete="username"
                value={username}
                onChange={e => setUsername(e.target.value)}
                className="w-full bg-panel-surface border border-panel-border rounded-md px-3 py-2 text-sm text-panel-text focus:outline-none focus:border-panel-accent transition-colors"
                placeholder="admin"
                autoFocus
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-panel-muted mb-1">Passwort</label>
              <div className="relative">
                <input
                  type={showPw ? 'text' : 'password'}
                  name="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  className="w-full bg-panel-surface border border-panel-border rounded-md px-3 py-2 pr-9 text-sm text-panel-text focus:outline-none focus:border-panel-accent transition-colors"
                  placeholder="••••••••"
                />
                <button type="button" onClick={() => setShowPw(v => !v)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-panel-muted hover:text-panel-text">
                  {showPw ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-panel-accent hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium py-2 rounded-md transition-colors"
            >
              {loading ? 'Anmelden...' : 'Anmelden'}
            </button>

            {/* Trennlinie */}
            <div className="flex items-center gap-3">
              <div className="flex-1 h-px bg-panel-border" />
              <span className="text-xs text-panel-muted">oder</span>
              <div className="flex-1 h-px bg-panel-border" />
            </div>

            {/* Passkey-Login */}
            <button
              type="button"
              onClick={handlePasskeyLogin}
              disabled={pkLoading}
              className="w-full flex items-center justify-center gap-2 border border-panel-border hover:border-panel-accent bg-panel-surface hover:bg-panel-card text-panel-text text-sm font-medium py-2 rounded-md transition-colors disabled:opacity-50"
            >
              <KeyRound size={15} className="text-panel-accent" />
              {pkLoading ? 'Warte auf Passkey...' : 'Mit Passkey anmelden'}
            </button>

            <div className="text-center">
              <Link to="/forgot-password" className="text-xs text-panel-muted hover:text-panel-accent transition-colors">
                Passwort vergessen?
              </Link>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

