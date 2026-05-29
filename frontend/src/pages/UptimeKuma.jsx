import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  RefreshCw, Settings2, CheckCircle2, XCircle, Clock, Wrench,
  AlertTriangle, MonitorCheck, Eye, EyeOff, Key,
  ChevronDown, ChevronRight, Search,
} from 'lucide-react';
import axios from 'axios';
import { Card } from '../components/ui/Card';
import { useErrors } from '../context/ErrorContext';

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

// ── Monitor-Karte ──────────────────────────────────────────────────────────────
function MonitorCard({ m }) {
  const s = STATUS[m.status] ?? STATUS[2];
  return (
    <div className="bg-panel-card border border-panel-border rounded-lg p-3 flex flex-col gap-2 hover:border-panel-muted/40 transition-colors">
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
    </div>
  );
}

// ── Gruppen-Accordion ─────────────────────────────────────────────────────────
function GroupAccordion({ name, monitors, defaultOpen }) {
  const [open, setOpen] = useState(defaultOpen);
  const upCount   = monitors.filter(m => m.status === 1).length;
  const downCount = monitors.filter(m => m.status === 0).length;
  const hasDown   = downCount > 0;

  return (
    <div className="border border-panel-border rounded-lg overflow-hidden">
      {/* Gruppen-Header */}
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-3 px-3 py-2.5 bg-panel-surface hover:bg-panel-card/50 transition-colors select-none text-left"
      >
        <span className="text-panel-muted flex-shrink-0">
          {open
            ? <ChevronDown size={13} />
            : <ChevronRight size={13} />
          }
        </span>
        <span className="text-xs font-semibold text-panel-text flex-1 truncate">{name}</span>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {upCount > 0 && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-panel-green/15 text-panel-green font-medium tabular-nums">
              {upCount} ↑
            </span>
          )}
          {downCount > 0 && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-panel-red/15 text-panel-red font-medium tabular-nums">
              {downCount} ↓
            </span>
          )}
          {!hasDown && upCount === 0 && (
            <span className="text-[10px] text-panel-muted tabular-nums">{monitors.length}</span>
          )}
        </div>
        {/* Globaler Status-Dot */}
        <span className={`w-2 h-2 rounded-full flex-shrink-0 ${hasDown ? 'bg-panel-red' : 'bg-panel-green'}`} />
      </button>

      {/* Monitore */}
      {open && (
        <div className="p-3 bg-panel-bg/20 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {monitors.map(m => <MonitorCard key={m.id} m={m} />)}
        </div>
      )}
    </div>
  );
}

// ── Haupt-Komponente ──────────────────────────────────────────────────────────
export default function UptimeKuma() {
  const [monitors,   setMonitors]   = useState([]);
  const [incident,   setIncident]   = useState(null);
  const [loading,    setLoading]    = useState(false);
  const [error,      setError]      = useState('');
  const [lastUpdate, setLastUpdate] = useState(null);
  const [config,     setConfig]     = useState({ url: '', hasApiKey: false, slug: 'default' });
  const [editMode,   setEditMode]   = useState(false);
  const [draft,      setDraft]      = useState({ url: '', apiKey: '', slug: 'default' });
  const [saving,     setSaving]     = useState(false);
  const [showKey,    setShowKey]    = useState(false);
  const [search,     setSearch]     = useState('');

  const { addError } = useErrors();

  // Konfiguration laden
  useEffect(() => {
    axios.get('/api/uptime-kuma/config').then(r => {
      setConfig(r.data);
      setDraft({ url: r.data.url, apiKey: '', slug: r.data.slug });
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
      const msg = e.response?.data?.error || 'Verbindung zu Uptime Kuma fehlgeschlagen.';
      setError(msg);
      addError('Uptime Kuma', msg);
    }
    setLoading(false);
  }, [config.url, addError]);

  useEffect(() => {
    load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, [load]);

  const saveConfig = async () => {
    setSaving(true);
    try {
      const payload = { url: draft.url, slug: draft.slug };
      if (draft.apiKey) payload.apiKey = draft.apiKey;
      await axios.post('/api/uptime-kuma/config', payload);
      setConfig({ url: draft.url, hasApiKey: !!(config.hasApiKey || draft.apiKey), slug: draft.slug });
      setEditMode(false);
    } catch {}
    setSaving(false);
  };

  // Suchfilter
  const filtered = useMemo(() => {
    if (!search.trim()) return monitors;
    const q = search.toLowerCase();
    return monitors.filter(m =>
      m.name?.toLowerCase().includes(q) ||
      m.group?.toLowerCase().includes(q) ||
      m.type?.toLowerCase().includes(q)
    );
  }, [monitors, search]);

  // Gruppierung: nach group-Feld partitionieren
  const { groups, ungrouped } = useMemo(() => {
    const map = {};
    const ung = [];
    for (const m of filtered) {
      if (m.group) {
        (map[m.group] ??= []).push(m);
      } else {
        ung.push(m);
      }
    }
    // Gruppen sortieren: DOWN-Gruppen zuerst, dann alphabetisch
    const sortedGroups = Object.entries(map).sort(([aName, aMs], [bName, bMs]) => {
      const aDown = aMs.some(m => m.status === 0) ? 0 : 1;
      const bDown = bMs.some(m => m.status === 0) ? 0 : 1;
      if (aDown !== bDown) return aDown - bDown;
      return aName.localeCompare(bName, 'de');
    });
    // Innerhalb jeder Gruppe: DOWN zuerst
    for (const [, ms] of sortedGroups) {
      ms.sort((a, b) => (a.status === 0 ? -1 : b.status === 0 ? 1 : a.name.localeCompare(b.name, 'de')));
    }
    return { groups: sortedGroups, ungrouped: ung };
  }, [filtered]);

  const usesApi  = config.hasApiKey;
  const up       = monitors.filter(m => m.status === 1).length;
  const down     = monitors.filter(m => m.status === 0).length;
  const hasGroups = groups.length > 0;

  return (
    <div className="space-y-4">

      {/* Titelzeile */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <MonitorCheck size={18} className="text-panel-accent" />
          <h1 className="text-sm font-semibold text-panel-text">Uptime Kuma</h1>
          {usesApi && (
            <span className="px-1.5 py-0.5 text-[10px] bg-panel-green/15 text-panel-green rounded">API</span>
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
              <div className="flex items-center gap-2 mb-3">
                <Key size={13} className="text-panel-accent" />
                <p className="text-xs text-panel-text font-medium">
                  API-Key <span className="text-panel-muted font-normal">— Uptime Kuma → Einstellungen → API-Keys → Erstellen</span>
                </p>
              </div>
              <div>
                <label className="block text-xs text-panel-muted mb-1">API-Key</label>
                <div className="relative">
                  <input
                    type={showKey ? 'text' : 'password'}
                    value={draft.apiKey}
                    onChange={e => setDraft(d => ({ ...d, apiKey: e.target.value }))}
                    placeholder={config.hasApiKey ? '(gespeichert — leer lassen zum Behalten)' : 'uk1_xxxxxxxxxxxxxxxx'}
                    autoComplete="off"
                    className="w-full bg-panel-surface border border-panel-border rounded px-3 py-1.5 pr-9 text-sm text-panel-text placeholder:text-panel-muted/40 font-mono focus:outline-none focus:border-panel-accent"
                  />
                  <button type="button" onClick={() => setShowKey(s => !s)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-panel-muted hover:text-panel-text transition-colors">
                    {showKey ? <EyeOff size={13} /> : <Eye size={13} />}
                  </button>
                </div>
              </div>
            </div>
            <div className="border-t border-panel-border pt-4">
              <InputField
                label="Status-Seite Slug (Fallback ohne API-Key)"
                value={draft.slug}
                onChange={e => setDraft(d => ({ ...d, slug: e.target.value }))}
                placeholder="default"
                hint='Nur genutzt wenn kein API-Key gesetzt ist.'
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

      {/* Zusammenfassung + Suche */}
      {monitors.length > 0 && (
        <div className="flex items-center gap-3">
          <div className="grid grid-cols-3 gap-3 flex-1">
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
          {/* Suchfeld */}
          <div className="relative w-48 flex-shrink-0">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-panel-muted pointer-events-none" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Suchen…"
              className="w-full bg-panel-card border border-panel-border rounded-md pl-8 pr-3 py-1.5 text-xs text-panel-text placeholder:text-panel-muted/50 focus:outline-none focus:border-panel-accent transition-colors"
            />
          </div>
        </div>
      )}

      {/* Gruppen-Accordions */}
      {monitors.length > 0 && hasGroups && (
        <div className="space-y-2">
          {groups.map(([groupName, groupMonitors]) => (
            <GroupAccordion
              key={groupName}
              name={groupName}
              monitors={groupMonitors}
              defaultOpen={groupMonitors.some(m => m.status === 0)}
            />
          ))}
        </div>
      )}

      {/* Ungrouped — als flaches Grid (kein Accordion wenn keine Gruppen vorhanden) */}
      {monitors.length > 0 && ungrouped.length > 0 && (
        <div>
          {hasGroups && (
            <p className="text-xs text-panel-muted mb-2 px-0.5">Weitere Monitore</p>
          )}
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {ungrouped.map(m => <MonitorCard key={m.id} m={m} />)}
          </div>
        </div>
      )}

      {/* Keine Treffer bei Suche */}
      {monitors.length > 0 && filtered.length === 0 && search && (
        <div className="text-center py-8 text-panel-muted text-sm">
          Keine Monitore für „{search}" gefunden.
        </div>
      )}

    </div>
  );
}
