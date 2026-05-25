import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Server, Mail } from 'lucide-react';
import axios from 'axios';

export default function ForgotPassword() {
  const [username, setUsername] = useState('');
  const [sent, setSent]         = useState(false);
  const [loading, setLoading]   = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      await axios.post('/api/auth/forgot-password', { username });
    } catch {}
    // Immer Erfolg zeigen (Anti-Enumeration)
    setSent(true);
    setLoading(false);
  };

  return (
    <div className="min-h-screen bg-panel-bg flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-8">
          <div className="p-3 bg-panel-surface border border-panel-border rounded-xl mb-3">
            <Server size={28} className="text-panel-accent" />
          </div>
          <h1 className="text-xl font-bold text-panel-text">Passwort zurücksetzen</h1>
          <p className="text-sm text-panel-muted mt-1">Überwachungs-Panel</p>
        </div>

        <div className="bg-panel-card border border-panel-border rounded-lg p-6">
          {sent ? (
            <div className="text-center space-y-3">
              <div className="p-3 bg-panel-green/10 rounded-full inline-flex">
                <Mail size={24} className="text-panel-green" />
              </div>
              <p className="text-sm text-panel-text">
                Falls ein Konto mit diesem Benutzernamen und einer hinterlegten E-Mail-Adresse existiert, wurde eine E-Mail mit einem Reset-Link gesendet.
              </p>
              <p className="text-xs text-panel-muted">Der Link ist 1 Stunde gültig.</p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <p className="text-sm text-panel-muted">Gib deinen Benutzernamen ein. Falls eine E-Mail hinterlegt ist, erhältst du einen Reset-Link.</p>
              <div>
                <label className="block text-xs font-medium text-panel-muted mb-1">Benutzername</label>
                <input
                  type="text"
                  value={username}
                  onChange={e => setUsername(e.target.value)}
                  className="w-full bg-panel-surface border border-panel-border rounded-md px-3 py-2 text-sm text-panel-text focus:outline-none focus:border-panel-accent"
                  placeholder="admin"
                  autoFocus
                />
              </div>
              <button type="submit" disabled={loading || !username}
                className="w-full bg-panel-accent hover:bg-blue-600 disabled:opacity-50 text-white text-sm font-medium py-2 rounded-md transition-colors">
                {loading ? 'Sende...' : 'Reset-Link senden'}
              </button>
            </form>
          )}

          <div className="mt-4 text-center">
            <Link to="/login" className="text-xs text-panel-muted hover:text-panel-accent transition-colors">
              ← Zurück zur Anmeldung
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
