import { useState, useEffect, useCallback } from 'react';
import {
  RefreshCw, Settings2, CheckCircle2, XCircle, Clock, Wrench,
  AlertTriangle, MonitorCheck, Eye, EyeOff,
} from 'lucide-react';
import axios from 'axios';
import { Card } from '../components/ui/Card';

// Status-Definitionen (Uptime Kuma: 0=DOWN, 1=UP, 2=PENDING, 3=MAINTENANCE)
const STATUS = {
  0: { label: 'DOWN',       color: 'text-panel-red',    dot: 'bg-panel-red',    Icon: XCircle      },
  1: { label: 'UP',         color: 'text-panel-green',  dot: 'bg-panel-green',  Icon: CheckCircle2 },
  2: { label: 'AUSSTEHEND', color: 'text-panel-orange', dot: 'bg-panel-orange', Icon: Clock        },
  3: { label: 'WARTUNG',    color: 'text-panel-accent', dot: 'bg-panel-accent', Icon: Wrench       },
};

const TYPE_LABEL = {
  http: 'HTTP', https: 'HTTPS', tcp: 'TCP', ping: 'PING', dns: 'DNS',
  push: 'PUSH', steam: 'STEAM', mqtt: 'MQTT', sqlserver: 'MSSQL',
  postgres: 'PSQL', mysql: 'MySQL', mongodb: 'Mongo', redis: 'Redis',
  gamedig: 'Game',
};

const fmtUptime = (v) => (v == null ? null : `${parseFloat(v).toFixed(1)}%`);

const InputField = ({ label, value, onChange, placeholder, type = 'text', hint }) => (
  <div>
    <label className="block text-xs text-panel-muted mb-1">{label}</label>
    <input
      type={type}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      autoComplete="off"
      className="w-full bg-panel-surface border border-panel-border rounded px-3 py-1.5 text-sm text-panel-text placeholder:text-panel-muted/40 focus:outline-none focus:border-panel-accent"
    />
    {hint && <p className="text-[11px] text-panel-muted/70 mt-1">{hint}</p>}
  </div>
);

export default function UptimeKuma() {
  const [monitors,   setMonitors]   = useState([]);
  const [incident,   setIncident]   = useState(null);
  const [loading,    setLoading]    = useState(false);
  const [error,      setError]      = useState('');
  const [lastUpdate, setLastUpdate] = useState(null);
  const [config,     setConfig]     = useState({ url: '', username: '', hasPassword: false, slug: 'default' });
  const [editMode,   setEditMode]   = useState(false);
  const [draft,      setDraft]      = useState({ url: '', username: '', password: '', slug: 'default' });
  const [saving,     setSaving]     = useState(false);
  const [showPw,     setShowPw]     = useState(false);

  // Konfiguration laden
  useEffect(() => {
    axios.get('/api/uptime-kuma/config').then(r => {
      setConfig(r.data);
      setDraft({ ...r.data, password: '' }); // Passwort nie zurück ins Formular
      if (!r.data.url) setEditMode(true);
    }).catch(() => setEditMode(true));
  }, []);

  // Monitore laden
  const load = useCallback(async () => {
    if (!config.url) return;
    setLoading(true);
    setError('');
    try {
      const { data } = await axios.get('/api/uptime-kuma/monitors');
      setMonitors(data.monitors);
      setIncident(data.incident);
      setLastUpdate(new Date());
    } catch (e) {
      setError(e.response?.data?.error || 'Verbindung zu Uptime Kuma fehlgeschlagen.');
    }
    setLoading(false);
  }, [config.url]);

  useEffect(() => {
    load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, [load]);

  const saveConfig = async () => {
    setSaving(true);
    try {
      // Leeres Passwort nicht schicken (würde gespeichertes überschreiben)
      const payload = { ...draft };
      if (!payload.password) delete payload.password;
      await axios.post('/api/uptime-kuma/config', payload);
      setConfig({ ...draft, hasPassword: !!(config.hasPassword || draft.password) });
      setEditMode(false);
    } catch {}
    setSaving(false);
  };

  const usesApi = config.username && config.hasPassword;
  const up      = monitors.filter(m => m.status === 1).length;
  const down    = monitors.filter(m => m.status === 0).length;

  return (
    <div className="space-y-4">

      {/* Titelzeile */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <MonitorCheck size={18} className="text-panel-accent" />
          <h1 className="text-sm font-semibold text-panel-text">Uptime Kuma</h1>
          {usesApi && (
            <span className="px-1.5 py-0.5 text-[10px] bg-panel-green/15 text-panel-green rounded">
              API
            </span>
          )}
          {lastUpdate && (
            <span className="text-xs text-panel-muted">
              · Stand {lastUpdate.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button onClick={load} disabled={loading || !config.url}
            className="p-1.5 text-panel-muted hover:text-panel-text rounded transition-colors disabled:opacity-40"
            title="Aktualisieren">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
          <button
            onClick={() => { setDraft({ ...config, password: '' }); setEditMode(e => !e); }}
            className={`p-1.5 rounded transition-colors ${editMode ? 'text-panel-accent' : 'text-panel-muted hover:text-panel-text'}`}
            title="Verbindung konfigurieren">
            <Settings2 size={14} />
          </button>
        </div>
      </div>

      {/* Konfigurationsformular */}
      {editMode && (
        <Card title="Verbindung konfigurieren">
          <div className="space-y-4">
            <InputField
              label="Uptime Kuma URL"
              value={draft.url}
              onChange={e => setDraft(d => ({ ...d, url: e.target.value }))}
              placeholder="https://status.example.com"
            />

            <div className="border-t border-panel-border pt-4">
              <p className="text-xs text-panel-text font-medium mb-3">
                Zugangsdaten <span className="text-panel-muted font-normal">(empfohlen — gibt Zugriff auf alle Monitore)</span>
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <InputField
                  label="Benutzername"
                  value={draft.username}
                  onChange={e => setDraft(d => ({ ...d, username: e.target.value }))}
                  placeholder="admin"
                />
                <div>
                  <label className="block text-xs text-panel-muted mb-1">Passwort</label>
                  <div className="relative">
                    <input
                      type={showPw ? 'text' : 'password'}
                      value={draft.password}
                      onChange={e => setDraft(d => ({ ...d, password: e.target.value }))}
                      placeholder={config.hasPassword ? '(gespeichert — leer lassen zum Behalten)' : 'Passwort eingeben'}
                      autoComplete="new-password"
                      className="w-full bg-panel-surface border border-panel-border rounded px-3 py-1.5 pr-9 text-sm text-panel-text placeholder:text-panel-muted/40 focus:outline-none focus:border-panel-accent"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPw(s => !s)}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-panel-muted hover:text-panel-text transition-colors">
                      {showPw ? <EyeOff size={13} /> : <Eye size={13} />}
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <div className="border-t border-panel-border pt-4">
              <p className="text-xs text-panel-text font-medium mb-3">
                Öffentliche Status-Seite <span className="text-panel-muted font-normal">(Fallback ohne Zugangsdaten)</span>
              </p>
              <InputField
                label="Status-Seite Slug"
                value={draft.slug}
                onChange={e => setDraft(d => ({ ...d, slug: e.target.value }))}
                placeholder="default"
                hint='Den Slug findest du in Uptime Kuma unter Einstellungen → Status-Seiten. Standard ist "default".'
              />
            </div>

            <div className="flex gap-2 pt-1">
              <button
                onClick={saveConfig}
                disabled={saving || !draft.url}
                className="px-3 py-1.5 bg-panel-accent text-white text-sm rounded hover:bg-panel-accent/80 transition-colors disabled:opacity-50">
                {saving ? 'Verbinden…' : 'Speichern & Verbinden'}
              </button>
              {config.url && (
                <button onClick={() => setEditMode(false)}
                  className="px-3 py-1.5 text-panel-muted text-sm hover:text-panel-text transition-colors">
                  Abbrechen
                </button>
              )}
            </div>
          </div>
        </Card>
      )}

      {/* Aktiver Incident */}
      {incident && (
        <div className="flex items-start gap-2 bg-panel-red/10 border border-panel-red/30 rounded-lg p-3">
          <AlertTriangle size={15} className="text-panel-red flex-shrink-0 mt-0.5" />
          <div>
            <div className="text-sm font-medium text-panel-red">{incident.title}</div>
            {incident.content && <div className="text-xs text-panel-muted mt-0.5">{incident.content}</div>}
          </div>
        </div>
      )}

      {/* Fehlermeldung */}
      {error && (
        <div className="bg-panel-red/10 border border-panel-red/30 rounded-lg px-4 py-3 text-sm text-panel-red">
          {error}
        </div>
      )}

      {/* Kein URL */}
      {!config.url && !editMode && (
        <div className="text-center py-12 text-panel-muted text-sm">
          <MonitorCheck size={32} className="mx-auto mb-3 opacity-30" />
          Noch keine Uptime Kuma-Instanz verbunden.
          <br />
          <button onClick={() => setEditMode(true)} className="mt-2 text-panel-accent hover:underline">
            Jetzt konfigurieren
          </button>
        </div>
      )}

      {/* Laden */}
      {loading && config.url && monitors.length === 0 && !error && (
        <div className="text-panel-muted text-sm text-center py-10">
          Verbinde mit Uptime Kuma{usesApi ? ' (API)' : ''}…
        </div>
      )}

      {/* Zusammenfassung */}
      {monitors.length > 0 && (
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-panel-card border border-panel-border rounded-lg p-3 text-center">
            <div className="text-2xl font-bold text-panel-green">{up}</div>
            <div className="text-xs text-panel-muted mt-0.5">Online</div>
          </div>
          <div className={`bg-panel-card border rounded-lg p-3 text-center ${down > 0 ? 'border-panel-red/50' : 'border-panel-border'}`}>
            <div className={`text-2xl font-bold ${down > 0 ? 'text-panel-red' : 'text-panel-muted'}`}>{down}</div>
            <div className="text-xs text-panel-muted mt-0.5">Offline</div>
          </div>
          <div className="bg-panel-card border border-panel-border rounded-lg p-3 text-center">
            <div className="text-2xl font-bold text-panel-text">{monitors.length}</div>
            <div className="text-xs text-panel-muted mt-0.5">Gesamt</div>
          </div>
        </div>
      )}

      {/* Monitor-Karten */}
      {monitors.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {monitors.map(m => {
            const s = STATUS[m.status] ?? STATUS[2];
            return (
              <div key={m.id}
                className="bg-panel-card border border-panel-border rounded-lg p-3 flex flex-col gap-2 hover:border-panel-muted/40 transition-colors">

                {/* Name + Typ-Badge */}
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className={`w-2 h-2 rounded-full flex-shrink-0 ${s.dot}`} />
                    <span className="text-sm font-medium text-panel-text truncate" title={m.name}>
                      {m.name}
                    </span>
                  </div>
                  {m.type && (
                    <span className="flex-shrink-0 px-1.5 py-0.5 bg-panel-surface text-panel-muted text-[10px] rounded font-mono uppercase">
                      {TYPE_LABEL[m.type] || m.type}
                    </span>
                  )}
                </div>

                {/* Status-Label */}
                <div className={`text-xs font-semibold ${s.color}`}>{s.label}</div>

                {/* Fehlermeldung (nur bei nicht-UP) */}
                {m.msg && m.status !== 1 && (
                  <div className="text-xs text-panel-muted truncate" title={m.msg}>{m.msg}</div>
                )}

                {/* Metriken */}
                <div className="flex items-center gap-3 text-xs text-panel-muted flex-wrap mt-auto pt-1 border-t border-panel-border/50">
                  {m.ping != null && (
                    <span className="text-panel-text font-mono">{m.ping} ms</span>
                  )}
                  {fmtUptime(m.uptime24h) && (
                    <span title="Verfügbarkeit 24 h">
                      {fmtUptime(m.uptime24h)} <span className="text-[10px] opacity-60">24h</span>
                    </span>
                  )}
                  {fmtUptime(m.uptime30d) && (
                    <span title="Verfügbarkeit 30 Tage">
                      {fmtUptime(m.uptime30d)} <span className="text-[10px] opacity-60">30d</span>
                    </span>
                  )}
                  {m.lastCheck && (
                    <span className="ml-auto" title="Letzter Check">
                      {new Date(m.lastCheck).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  )}
                </div>

                {/* Gruppe / Tag */}
                {m.group && (
                  <div className="text-[10px] text-panel-muted/60 -mt-1">{m.group}</div>
                )}
              </div>
            );
          })}
        </div>
      )}

    </div>
  );
}
