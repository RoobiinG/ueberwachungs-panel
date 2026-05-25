import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Server, Eye, EyeOff, KeyRound } from 'lucide-react';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';

export default function Login() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw]     = useState(false);
  const [error, setError]       = useState('');
  const [loading, setLoading]   = useState(false);
  const [pkLoading, setPkLoading] = useState(false);
  const { login, saveSession }  = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(username, password);
      navigate('/');
    } catch (err) {
      setError(err.response?.data?.error || 'Anmeldung fehlgeschlagen');
    } finally {
      setLoading(false);
    }
  };

  const handlePasskeyLogin = async () => {
    setError('');
    setPkLoading(true);
    try {
      // WebAuthn-Browser-Paket dynamisch importieren
      const { startAuthentication } = await import('@simplewebauthn/browser');
      const optRes  = await axios.post('/api/auth/passkey/login/start');
      const assertion = await startAuthentication(optRes.data);
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

        <form onSubmit={handleSubmit} className="bg-panel-card border border-panel-border rounded-lg p-6 space-y-4">
          {error && (
            <div className="bg-panel-red/10 border border-panel-red/30 text-panel-red text-sm rounded-md px-3 py-2">
              {error}
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-panel-muted mb-1">Benutzername</label>
            <input
              type="text"
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
            disabled={loading || !username || !password}
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
      </div>
    </div>
  );
}
