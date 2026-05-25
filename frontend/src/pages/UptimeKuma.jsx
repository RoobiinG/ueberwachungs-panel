import { useState, useEffect, useCallback } from 'react';
import {
  RefreshCw, Settings2, CheckCircle2, XCircle, Clock, Wrench,
  AlertTriangle, MonitorCheck,
} from 'lucide-react';
import axios from 'axios';
import { Card } from '../components/ui/Card';

// Status-Definitionen (Uptime Kuma: 0=DOWN, 1=UP, 2=PENDING, 3=MAINTENANCE)
const STATUS = {
  0: { label: 'DOWN',     color: 'text-panel-red',    dot: 'bg-panel-red',    Icon: XCircle      },
  1: { label: 'UP',       color: 'text-panel-green',  dot: 'bg-panel-green',  Icon: CheckCircle2 },
  2: { label: 'AUSSTEHEND', color: 'text-panel-orange', dot: 'bg-panel-orange', Icon: Clock       },
  3: { label: 'WARTUNG',  color: 'text-panel-accent', dot: 'bg-panel-accent', Icon: Wrench       },
};

const TYPE_LABEL = {
  http: 'HTTP', https: 'HTTPS', tcp: 'TCP', ping: 'PING', dns: 'DNS',
  push: 'PUSH', steam: 'STEAM', mqtt: 'MQTT', sqlserver: 'MSSQL',
  postgres: 'PSQL', mysql: 'MySQL', mongodb: 'Mongo', redis: 'Redis',
  gamedig: 'Game',
};

const fmtUptime = (v) => (v == null ? null : `${parseFloat(v).toFixed(1)}%`);

export default function UptimeKuma() {
  const [monitors,    setMonitors]    = useState([]);
  const [incident,    setIncident]    = useState(null);
  const [loading,     setLoading]     = useState(false);
  const [error,       setError]       = useState('');
  const [lastUpdate,  setLastUpdate]  = useState(null);
  const [config,      setConfig]      = useState({ url: '', slug: 'default' });
  const [editMode,    setEditMode]    = useState(false);
  const [draft,       setDraft]       = useState({ url: '', slug: 'default' });
  const [saving,      setSaving]      = useState(false);

  // Konfiguration laden
  useEffect(() => {
    axios.get('/api/uptime-kuma/config').then(r => {
      setConfig(r.data);
      setDraft(r.data);
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
      await axios.post('/api/uptime-kuma/config', draft);
      setConfig(draft);
      setEditMode(false);
    } catch {}
    setSaving(false);
  };

  const up   = monitors.filter(m => m.status === 1).length;
  const down = monitors.filter(m => m.status === 0).length;

  return (
    <div className="space-y-4">

      {/* Titelzeile */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <MonitorCheck size={18} className="text-panel-accent" />
          <h1 className="text-panel-text font-semibold text-sm">Uptime Kuma</h1>
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
            onClick={() => { setDraft(config); setEditMode(e => !e); }}
            className={`p-1.5 rounded transition-colors ${editMode ? 'text-panel-accent' : 'text-panel-muted hover:text-panel-text'}`}
            title="Verbindung konfigurieren">
            <Settings2 size={14} />
          </button>
        </div>
      </div>

      {/* Konfigurationsformular */}
      {editMode && (
        <Card title="Verbindung konfigurieren">
          <div className="space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-panel-muted mb-1">Uptime Kuma URL</label>
                <input
                  value={draft.url}
                  onChange={e => setDraft(d => ({ ...d, url: e.target.value }))}
                  placeholder="https://status.example.com"
                  className="w-full bg-panel-surface border border-panel-border rounded px-3 py-1.5 text-sm text-panel-text placeholder:text-panel-muted/50 focus:outline-none focus:border-panel-accent"
                />
              </div>
              <div>
                <label className="block text-xs text-panel-muted mb-1">Status-Seite Slug</label>
                <input
                  value={draft.slug}
                  onChange={e => setDraft(d => ({ ...d, slug: e.target.value }))}
                  placeholder="default"
                  className="w-full bg-panel-surface border border-panel-border rounded px-3 py-1.5 text-sm text-panel-text placeholder:text-panel-muted/50 focus:outline-none focus:border-panel-accent"
                />
              </div>
            </div>
            <p className="text-xs text-panel-muted">
              Den Slug findest du in Uptime Kuma unter{' '}
              <span className="text-panel-text">Einstellungen → Status-Seiten</span>.
              Standard-Slug ist <code className="bg-panel-surface px-1 rounded font-mono">default</code>.
              Die Monitore müssen der Status-Seite hinzugefügt sein.
            </p>
            <div className="flex gap-2">
              <button
                onClick={saveConfig}
                disabled={saving || !draft.url}
                className="px-3 py-1.5 bg-panel-accent text-white text-sm rounded hover:bg-panel-accent/80 transition-colors disabled:opacity-50">
                {saving ? 'Speichern…' : 'Speichern & Verbinden'}
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
            {incident.content && (
              <div className="text-xs text-panel-muted mt-0.5">{incident.content}</div>
            )}
          </div>
        </div>
      )}

      {/* Fehlermeldung */}
      {error && (
        <div className="bg-panel-red/10 border border-panel-red/30 rounded-lg px-4 py-3 text-sm text-panel-red">
          {error}
        </div>
      )}

      {/* Kein URL konfiguriert */}
      {!config.url && !editMode && (
        <div className="text-center py-12 text-panel-muted text-sm">
          <MonitorCheck size={32} className="mx-auto mb-3 opacity-30" />
          Noch keine Uptime Kuma-Instanz verbunden.
          <br />
          <button onClick={() => setEditMode(true)}
            className="mt-2 text-panel-accent hover:underline">
            Jetzt konfigurieren
          </button>
        </div>
      )}

      {/* Wird geladen */}
      {loading && config.url && monitors.length === 0 && !error && (
        <div className="text-panel-muted text-sm text-center py-10">
          Verbinde mit Uptime Kuma…
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

                {/* Metriken-Zeile */}
                <div className="flex items-center gap-3 text-xs text-panel-muted flex-wrap mt-auto pt-1 border-t border-panel-border/50">
                  {m.ping != null && (
                    <span className="text-panel-text font-mono">{m.ping} ms</span>
                  )}
                  {fmtUptime(m.uptime24h) && (
                    <span title="Verfügbarkeit 24h">
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
                      {new Date(m.lastCheck).toLocaleTimeString('de-DE', {
                        hour: '2-digit', minute: '2-digit',
                      })}
                    </span>
                  )}
                </div>

                {/* Gruppe */}
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
