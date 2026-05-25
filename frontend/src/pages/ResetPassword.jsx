import { useState } from 'react';
import { Link, useSearchParams, useNavigate } from 'react-router-dom';
import { Server, Eye, EyeOff, CheckCircle } from 'lucide-react';
import axios from 'axios';

export default function ResetPassword() {
  const [params]         = useSearchParams();
  const token            = params.get('token') || '';
  const navigate         = useNavigate();
  const [password, setPassword]   = useState('');
  const [password2, setPassword2] = useState('');
  const [showPw, setShowPw]       = useState(false);
  const [error, setError]         = useState('');
  const [loading, setLoading]     = useState(false);
  const [done, setDone]           = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (password !== password2) return setError('Passwörter stimmen nicht überein');
    if (password.length < 12)   return setError('Passwort muss mindestens 12 Zeichen lang sein');
    setLoading(true);
    try {
      await axios.post('/api/auth/reset-password', { token, newPassword: password });
      setDone(true);
      setTimeout(() => navigate('/login'), 3000);
    } catch (err) {
      setError(err.response?.data?.error || 'Fehler beim Zurücksetzen');
    }
    setLoading(false);
  };

  if (!token) return (
    <div className="min-h-screen bg-panel-bg flex items-center justify-center p-4">
      <div className="text-center text-panel-muted">Ungültiger Link. <Link to="/login" className="text-panel-accent">Zurück zur Anmeldung</Link></div>
    </div>
  );

  return (
    <div className="min-h-screen bg-panel-bg flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-8">
          <div className="p-3 bg-panel-surface border border-panel-border rounded-xl mb-3">
            <Server size={28} className="text-panel-accent" />
          </div>
          <h1 className="text-xl font-bold text-panel-text">Neues Passwort</h1>
        </div>

        <div className="bg-panel-card border border-panel-border rounded-lg p-6">
          {done ? (
            <div className="text-center space-y-3">
              <CheckCircle size={32} className="text-panel-green mx-auto" />
              <p className="text-sm text-panel-text">Passwort erfolgreich geändert! Du wirst weitergeleitet...</p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              {error && <p className="text-panel-red text-xs bg-panel-red/10 rounded p-2">{error}</p>}
              <div>
                <label className="block text-xs font-medium text-panel-muted mb-1">Neues Passwort</label>
                <div className="relative">
                  <input type={showPw ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)}
                    className="w-full bg-panel-surface border border-panel-border rounded-md px-3 py-2 pr-9 text-sm text-panel-text focus:outline-none focus:border-panel-accent"
                    placeholder="Min. 12 Zeichen" autoFocus />
                  <button type="button" onClick={() => setShowPw(v => !v)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-panel-muted hover:text-panel-text">
                    {showPw ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-panel-muted mb-1">Passwort wiederholen</label>
                <input type={showPw ? 'text' : 'password'} value={password2} onChange={e => setPassword2(e.target.value)}
                  className="w-full bg-panel-surface border border-panel-border rounded-md px-3 py-2 text-sm text-panel-text focus:outline-none focus:border-panel-accent"
                  placeholder="••••••••" />
              </div>
              <button type="submit" disabled={loading || !password || !password2}
                className="w-full bg-panel-accent hover:bg-blue-600 disabled:opacity-50 text-white text-sm font-medium py-2 rounded-md transition-colors">
                {loading ? 'Speichern...' : 'Passwort speichern'}
              </button>
            </form>
          )}
          <div className="mt-4 text-center">
            <Link to="/login" className="text-xs text-panel-muted hover:text-panel-accent">← Zurück zur Anmeldung</Link>
          </div>
        </div>
      </div>
    </div>
  );
}
