import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  RefreshCw, Settings2, CheckCircle2, Key, Eye, EyeOff,
  Search, PackageCheck, Package, ShieldAlert, Server, ArrowUpCircle, Clock, RotateCw,
} from 'lucide-react';
import axios from 'axios';
import { Card } from '../components/ui/Card';
import { StatCard } from '../components/ui/StatCard';
import { Modal } from '../components/ui/Modal';
import { Button } from '../components/ui/Button';
import SystemUpdateModal from '../components/SystemUpdateModal';
import { useErrors } from '../context/ErrorContext';
import { useAuth } from '../context/AuthContext';

const InputField = ({ label, value, onChange, placeholder, hint }) => (
  <div>
    <label className="block text-xs text-panel-muted mb-1">{label}</label>
    <input
      type="text"
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      autoComplete="off"
      className="w-full bg-panel-surface border border-panel-border rounded px-3 py-1.5 text-sm text-panel-text placeholder:text-panel-muted/40 focus:outline-none focus:border-panel-accent"
    />
    {hint && <p className="text-[11px] text-panel-muted/70 mt-1">{hint}</p>}
  </div>
);

// ── Host-Karte ──────────────────────────────────────────────────────────────
function HostCard({ h, onUpdate, darfUpdaten }) {
  const hasUpdates = h.updatesAvailable;
  // Ausführen geht nur über einen verknüpften Panel-Agenten (remote_agents.patchmon_host_id).
  const kannUpdaten = !!h.agentId && darfUpdaten;
  const buttonTitel = !darfUpdaten
    ? 'Keine Berechtigung zum Ausführen von Updates'
    : !h.agentId
    ? 'Kein Panel-Agent verknüpft — unter Server → Bearbeiten einem PatchMon-Host zuordnen'
    : hasUpdates
    ? `${h.updatesCount} Updates auf „${h.agentName}" installieren`
    : `Paket-Update auf „${h.agentName}" ausführen (aktuell nichts ausstehend)`;
  // Technische Zweitzeile: echter Hostname (falls vom Anzeigenamen abweichend) + IP.
  const sub = [h.hostname && h.hostname !== h.name ? h.hostname : null, h.ip]
    .filter(Boolean).join(' · ');
  return (
    <div className="bg-panel-card border border-panel-border rounded-lg p-3 flex flex-col gap-2 hover:border-panel-muted/40 transition-colors">
      {/* Name + Status-Dot */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className={`w-2 h-2 rounded-full flex-shrink-0 ${hasUpdates ? 'bg-panel-orange' : 'bg-panel-green'}`} />
          <span className="text-sm font-medium text-panel-text truncate" title={h.name}>
            {h.name}
          </span>
        </div>
        {h.hostGroup && (
          <span className="flex-shrink-0 px-1.5 py-0.5 bg-panel-surface text-panel-muted text-[10px] rounded truncate max-w-[40%]" title={h.hostGroup}>
            {h.hostGroup}
          </span>
        )}
      </div>

      {/* Hostname/IP + OS */}
      {sub && <div className="text-xs text-panel-muted/80 truncate font-mono" title={sub}>{sub}</div>}
      {h.os && <div className="text-xs text-panel-muted truncate" title={h.os}>{h.os}</div>}

      {/* Update-Status */}
      <div className="flex items-center gap-2 flex-wrap">
        {hasUpdates ? (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-panel-orange/15 text-panel-orange text-xs font-medium tabular-nums">
            <Package size={12} /> {h.updatesCount} {h.updatesCount === 1 ? 'Update' : 'Updates'}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-panel-green/15 text-panel-green text-xs font-medium">
            <CheckCircle2 size={12} /> Aktuell
          </span>
        )}
        {h.securityCount > 0 && (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-panel-red/15 text-panel-red text-xs font-medium tabular-nums"
            title="Sicherheits-Updates">
            <ShieldAlert size={12} /> {h.securityCount} Security
          </span>
        )}
        {h.needsReboot && (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-panel-accent/15 text-panel-accent text-xs font-medium"
            title="Neustart erforderlich">
            <RotateCw size={12} /> Neustart
          </span>
        )}
      </div>

      {/* Footer: Pakete gesamt · letzter Check-in + Update-Button */}
      <div className="flex items-center gap-2 text-xs text-panel-muted mt-auto pt-1 border-t border-panel-border/50">
        {h.totalPackages > 0 && (
          <span className="tabular-nums" title="Installierte Pakete gesamt">{h.totalPackages} Pakete</span>
        )}
        {h.lastCheckIn && (
          <span className="inline-flex items-center gap-1 truncate" title={`Letzter Check-in: ${h.lastCheckIn}`}>
            <Clock size={11} />
            {new Date(h.lastCheckIn).toLocaleString('de-DE', {
              day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
            })}
          </span>
        )}
        <button
          disabled={!kannUpdaten}
          onClick={() => onUpdate(h)}
          title={buttonTitel}
          className={`ml-auto inline-flex items-center gap-1 px-2 py-0.5 rounded border transition-colors ${
            !kannUpdaten
              ? 'border-panel-border text-panel-muted/50 cursor-not-allowed'
              : hasUpdates
              ? 'border-panel-orange/40 bg-panel-orange/10 text-panel-orange hover:bg-panel-orange/20'
              : 'border-panel-border text-panel-muted hover:text-panel-text hover:border-panel-muted/50'
          }`}
        >
          <ArrowUpCircle size={11} /> Update
        </button>
      </div>
    </div>
  );
}

// ── Haupt-Komponente ──────────────────────────────────────────────────────────
export default function PatchMon() {
  const [hosts,      setHosts]      = useState([]);
  const [loading,    setLoading]    = useState(false);
  const [error,      setError]      = useState('');
  const [lastUpdate, setLastUpdate] = useState(null);
  const [config,     setConfig]     = useState({ url: '', hasToken: false });
  const [editMode,   setEditMode]   = useState(false);
  const [draft,      setDraft]      = useState({ url: '', tokenKey: '', tokenSecret: '' });
  const [saving,     setSaving]     = useState(false);
  const [showSecret, setShowSecret] = useState(false);
  const [search,     setSearch]     = useState('');

  // Update-Ausführung: erst Sicherheitsabfrage (`frage`), dann der Log-Dialog (`updateZiele`).
  const [frage,       setFrage]       = useState(null);   // { titel, text, ziele }
  const [updateZiele, setUpdateZiele] = useState(null);   // [{ id, name }]

  const { addError } = useErrors();
  const { hasPermission } = useAuth();
  const darfUpdaten = hasPermission('system.update');

  // Konfiguration laden
  useEffect(() => {
    axios.get('/api/patchmon/config').then(r => {
      setConfig(r.data);
      setDraft({ url: r.data.url, tokenKey: '', tokenSecret: '' });
      if (!r.data.url) setEditMode(true);
    }).catch(() => setEditMode(true));
  }, []);

  // Hosts laden
  const load = useCallback(async () => {
    if (!config.url || !config.hasToken) return;
    setLoading(true);
    setError('');
    try {
      const { data } = await axios.get('/api/patchmon/hosts');
      setHosts(data.hosts);
      setLastUpdate(new Date());
    } catch (e) {
      const msg = e.response?.data?.error || 'Verbindung zu PatchMon fehlgeschlagen.';
      setError(msg);
      addError('PatchMon', msg);
    }
    setLoading(false);
  }, [config.url, config.hasToken, addError]);

  useEffect(() => {
    load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, [load]);

  const saveConfig = async () => {
    setSaving(true);
    try {
      const payload = { url: draft.url };
      if (draft.tokenKey)    payload.tokenKey    = draft.tokenKey;
      if (draft.tokenSecret) payload.tokenSecret = draft.tokenSecret;
      await axios.post('/api/patchmon/config', payload);
      setConfig({
        url: draft.url,
        hasToken: !!(config.hasToken || (draft.tokenKey && draft.tokenSecret)),
      });
      setEditMode(false);
    } catch (e) {
      addError('PatchMon', e.response?.data?.error || 'Speichern fehlgeschlagen.');
    }
    setSaving(false);
  };

  // Suchfilter
  const filtered = useMemo(() => {
    if (!search.trim()) return hosts;
    const q = search.toLowerCase();
    return hosts.filter(h =>
      h.name?.toLowerCase().includes(q) ||
      h.hostname?.toLowerCase().includes(q) ||
      h.ip?.toLowerCase().includes(q) ||
      h.os?.toLowerCase().includes(q) ||
      h.hostGroup?.toLowerCase().includes(q)
    );
  }, [hosts, search]);

  // Alle Hosts, die ausstehende Updates haben *und* über einen Panel-Agenten
  // erreichbar sind — nur die lassen sich per „Alle aktualisieren" abarbeiten.
  const sammelZiele = useMemo(() => {
    const ziele = hosts.filter(h => h.agentId && h.updatesAvailable);
    // Der Server, auf dem das Panel selbst läuft, kommt zuletzt: Reißt dort durch
    // ein Docker- oder Kernel-Update die Verbindung ab, sind die anderen schon durch.
    ziele.sort((a, b) => (a.istPanelHost ? 1 : 0) - (b.istPanelHost ? 1 : 0));
    return ziele.map(h => ({ id: h.agentId, name: h.name, istPanelHost: h.istPanelHost }));
  }, [hosts]);

  // Einzelner Server
  const frageEinzeln = (h) => setFrage({
    titel: `Updates auf „${h.name}" installieren?`,
    text:  h.updatesAvailable
      ? `${h.updatesCount} ausstehende Updates${h.securityCount > 0 ? ` (davon ${h.securityCount} Security)` : ''} werden über den Agenten „${h.agentName}" installiert.`
      : `Auf „${h.agentName}" wird ein Paket-Update ausgeführt. PatchMon meldet aktuell keine ausstehenden Updates.`,
    panelHinweis: !!h.istPanelHost,
    ziele: [{ id: h.agentId, name: h.name, istPanelHost: h.istPanelHost }],
  });

  // Alle auf einmal
  const frageAlle = () => setFrage({
    titel: `Updates auf ${sammelZiele.length} Servern installieren?`,
    text:  'Die Server werden nacheinander aktualisiert. Der Vorgang lässt sich nicht abbrechen:',
    liste: sammelZiele,
    panelHinweis: sammelZiele.some(z => z.istPanelHost),
    ziele: sammelZiele,
  });

  const starteUpdate = () => {
    setUpdateZiele(frage.ziele);
    setFrage(null);
  };

  // Kennzahlen
  const withUpdates    = hosts.filter(h => h.updatesAvailable).length;
  const totalPackages  = hosts.reduce((s, h) => s + (h.updatesCount  || 0), 0);
  const totalSecurity  = hosts.reduce((s, h) => s + (h.securityCount || 0), 0);

  return (
    <div className="space-y-4">

      {/* Titelzeile */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <PackageCheck size={18} className="text-panel-accent" />
          <h1 className="text-sm font-semibold text-panel-text">PatchMon</h1>
          {config.hasToken && (
            <span className="px-1.5 py-0.5 text-[10px] bg-panel-green/15 text-panel-green rounded">API</span>
          )}
          {lastUpdate && (
            <span className="text-xs text-panel-muted">
              · Stand {lastUpdate.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {darfUpdaten && hosts.length > 0 && (
            <button
              onClick={frageAlle}
              disabled={sammelZiele.length === 0}
              title={sammelZiele.length === 0
                ? 'Kein Server mit ausstehenden Updates und verknüpftem Panel-Agenten'
                : `Updates auf ${sammelZiele.length} Servern nacheinander installieren`}
              className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded transition-colors text-panel-orange bg-panel-orange/10 hover:bg-panel-orange/20 disabled:opacity-40 disabled:cursor-not-allowed disabled:bg-transparent disabled:text-panel-muted/50"
            >
              <ArrowUpCircle size={13} />
              Alle aktualisieren{sammelZiele.length > 0 && ` (${sammelZiele.length})`}
            </button>
          )}
          <button onClick={load} disabled={loading || !config.url || !config.hasToken}
            className="inline-flex items-center gap-1 px-2 py-1 text-xs text-panel-muted hover:text-panel-text hover:bg-panel-card rounded transition-colors disabled:opacity-40"
            title="Daten neu von PatchMon abrufen">
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
            {loading ? 'Lädt…' : 'Aktualisieren'}
          </button>
          <button
            onClick={() => setEditMode(e => !e)}
            className={`inline-flex items-center gap-1 px-2 py-1 text-xs rounded transition-colors ${editMode ? 'text-panel-accent bg-panel-accent/10' : 'text-panel-muted hover:text-panel-text hover:bg-panel-card'}`}
            title="URL und API-Token der PatchMon-Verbindung ändern">
            <Settings2 size={13} />Verbindung
          </button>
        </div>
      </div>

      {/* Konfigurationsformular */}
      {editMode && (
        <Card title="Verbindung konfigurieren">
          <div className="space-y-4">
            <InputField
              label="PatchMon URL"
              value={draft.url}
              onChange={e => setDraft(d => ({ ...d, url: e.target.value }))}
              placeholder="https://patchmon.example.com"
            />
            <div className="border-t border-panel-border pt-4">
              <div className="flex items-center gap-2 mb-3">
                <Key size={13} className="text-panel-accent" />
                <p className="text-xs text-panel-text font-medium">
                  API-Token <span className="text-panel-muted font-normal">— PatchMon → Settings → Integrations → New Token → Scope <code className="font-mono">host:get</code></span>
                </p>
              </div>
              <div className="space-y-3">
                <div>
                  <label className="block text-xs text-panel-muted mb-1">Token-Key</label>
                  <input
                    type="text"
                    value={draft.tokenKey}
                    onChange={e => setDraft(d => ({ ...d, tokenKey: e.target.value }))}
                    placeholder={config.hasToken ? '(gespeichert — leer lassen zum Behalten)' : 'patchmon_ae_xxxxxxxx'}
                    autoComplete="off"
                    className="w-full bg-panel-surface border border-panel-border rounded px-3 py-1.5 text-sm text-panel-text placeholder:text-panel-muted/40 font-mono focus:outline-none focus:border-panel-accent"
                  />
                </div>
                <div>
                  <label className="block text-xs text-panel-muted mb-1">Token-Secret</label>
                  <div className="relative">
                    <input
                      type={showSecret ? 'text' : 'password'}
                      value={draft.tokenSecret}
                      onChange={e => setDraft(d => ({ ...d, tokenSecret: e.target.value }))}
                      placeholder={config.hasToken ? '(gespeichert — leer lassen zum Behalten)' : 'Secret (nur einmal in PatchMon angezeigt)'}
                      autoComplete="off"
                      className="w-full bg-panel-surface border border-panel-border rounded px-3 py-1.5 pr-9 text-sm text-panel-text placeholder:text-panel-muted/40 font-mono focus:outline-none focus:border-panel-accent"
                    />
                    <button type="button" onClick={() => setShowSecret(s => !s)}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-panel-muted hover:text-panel-text transition-colors">
                      {showSecret ? <EyeOff size={13} /> : <Eye size={13} />}
                    </button>
                  </div>
                </div>
              </div>
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

      {/* Fehlermeldung */}
      {error && (
        <div className="bg-panel-red/10 border border-panel-red/30 rounded-lg px-4 py-3 text-sm text-panel-red">
          {error}
        </div>
      )}

      {/* Nicht konfiguriert */}
      {(!config.url || !config.hasToken) && !editMode && (
        <div className="text-center py-12 text-panel-muted text-sm">
          <PackageCheck size={32} className="mx-auto mb-3 opacity-30" />
          Noch keine PatchMon-Instanz verbunden.
          <br />
          <button onClick={() => setEditMode(true)} className="mt-2 text-panel-accent hover:underline">
            Jetzt konfigurieren
          </button>
        </div>
      )}

      {/* Laden */}
      {loading && config.hasToken && hosts.length === 0 && !error && (
        <div className="text-panel-muted text-sm text-center py-10">Verbinde mit PatchMon…</div>
      )}

      {/* Zusammenfassung + Suche */}
      {hosts.length > 0 && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard title="Server gesamt"    value={hosts.length}    icon={Server}       color="blue" />
            <StatCard title="Mit Updates"      value={withUpdates}     icon={ArrowUpCircle} color={withUpdates > 0 ? 'orange' : 'green'} />
            <StatCard title="Pakete gesamt"    value={totalPackages}   icon={Package}      color={totalPackages > 0 ? 'orange' : 'green'} />
            <StatCard title="Security-Updates" value={totalSecurity}   icon={ShieldAlert}  color={totalSecurity > 0 ? 'red' : 'green'} />
          </div>

          <div className="flex items-center justify-end">
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

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {filtered.map(h => (
              <HostCard key={h.id} h={h} onUpdate={frageEinzeln} darfUpdaten={darfUpdaten} />
            ))}
          </div>

          {filtered.length === 0 && search && (
            <div className="text-center py-8 text-panel-muted text-sm">
              Keine Server für „{search}" gefunden.
            </div>
          )}
        </>
      )}

      {/* Sicherheitsabfrage vor dem Update */}
      {frage && (
        <Modal
          open
          title={frage.titel}
          onClose={() => setFrage(null)}
          footer={
            <>
              <Button variant="ghost" onClick={() => setFrage(null)}>Abbrechen</Button>
              <Button variant="warning" onClick={starteUpdate}>Jetzt installieren</Button>
            </>
          }
        >
          <p className="text-sm text-panel-muted">{frage.text}</p>
          {frage.liste && (
            <ul className="mt-3 space-y-1 max-h-48 overflow-y-auto">
              {frage.liste.map(z => (
                <li key={z.id} className="text-sm text-panel-text flex items-center gap-2">
                  <Server size={12} className="text-panel-muted flex-shrink-0" />
                  {z.name}
                  {z.istPanelHost && (
                    <span className="text-[11px] text-panel-orange">— Panel läuft hier, deshalb zuletzt</span>
                  )}
                </li>
              ))}
            </ul>
          )}
          {frage.panelHinweis && (
            <div className="mt-3 flex items-start gap-2 bg-panel-orange/10 border border-panel-orange/30 rounded px-3 py-2 text-xs text-panel-orange">
              <ShieldAlert size={13} className="flex-shrink-0 mt-0.5" />
              <span>
                Auf diesem Server läuft das Panel selbst. Aktualisiert das Update Docker oder den Kernel,
                startet der Panel-Container mit — die Live-Ausgabe bricht dann ab.
                Das Update läuft auf dem Server trotzdem zu Ende.
              </span>
            </div>
          )}
          <p className="mt-3 text-xs text-panel-muted/80">
            Ausgeführt wird <code className="font-mono">apt-get upgrade</code> (bzw. <code className="font-mono">dnf upgrade</code>)
            über den jeweiligen Panel-Agenten. Ein nötiger Neustart erfolgt dabei <span className="text-panel-text">nicht</span> automatisch.
          </p>
        </Modal>
      )}

      {/* Live-Log der Update-Ausführung */}
      {updateZiele && (
        <SystemUpdateModal
          targets={updateZiele}
          onFinished={load}
          onClose={() => { setUpdateZiele(null); load(); }}
        />
      )}

    </div>
  );
}
