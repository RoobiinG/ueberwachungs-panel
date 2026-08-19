import { useEffect, useState } from 'react';
import axios from 'axios';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { useAuth } from '../context/AuthContext';
import {
  Cloud, Server, Eye, EyeOff, CheckCircle, XCircle,
  RefreshCw, Trash2, Lock, Mail, Key, ShieldCheck, Send,
  User, Settings2, Layers, Timer, Bell, Monitor, Smartphone,
  Globe, LogOut, Laptop, PackageCheck,
  Download, Upload, Database, QrCode, Copy, Check, ShieldAlert, Gamepad2,
  FileText, ExternalLink, ArrowUpCircle, AlertTriangle
} from 'lucide-react';
import { invalidateLiveIntervalCache } from '../hooks/useLiveInterval';

// ── Toggle-Hilfkomponente ──────────────────────────────────────────────────────
function Toggle({ on, onToggle, disabled }) {
  return (
    <button
      onClick={onToggle}
      disabled={disabled}
      className={`relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full transition-colors duration-200 ease-in-out focus:outline-none disabled:opacity-50 ${
        on ? 'bg-panel-accent' : 'bg-panel-border'
      }`}
    >
      <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition duration-200 ease-in-out mt-0.5 ${
        on ? 'translate-x-4' : 'translate-x-0.5'
      }`} />
    </button>
  );
}

// ── Aktions-Benachrichtigungen Toggle ─────────────────────────────────────────
function ActionNotificationsToggle() {
  const [enabled,   setEnabled]   = useState(false);
  const [webhookId, setWebhookId] = useState('');
  const [webhooks,  setWebhooks]  = useState([]);
  const [saving,    setSaving]    = useState(false);
  const [msg,       setMsg]       = useState('');

  useEffect(() => {
    Promise.all([
      axios.get('/api/settings/notifications'),
      axios.get('/api/webhooks').catch(() => ({ data: [] })),
    ]).then(([notif, wh]) => {
      setEnabled(!!notif.data.actionNotifications);
      setWebhookId(notif.data.actionWebhookId ? String(notif.data.actionWebhookId) : '');
      setWebhooks(wh.data || []);
    }).catch(() => {});
  }, []);

  const save = async (nextEnabled = enabled, nextWebhookId = webhookId) => {
    setSaving(true);
    setMsg('');
    try {
      await axios.put('/api/settings/notifications', {
        actionNotifications: nextEnabled,
        actionWebhookId:     nextWebhookId ? parseInt(nextWebhookId) : null,
      });
      setMsg('✓ Gespeichert');
    } catch { setMsg('Fehler beim Speichern'); }
    setSaving(false);
  };

  const toggle = () => {
    const next = !enabled;
    setEnabled(next);
    save(next, webhookId);
  };

  return (
    <div className="space-y-3">
      {/* Toggle-Zeile */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-panel-text">Server-Aktionen benachrichtigen</p>
          <p className="text-xs text-panel-muted mt-0.5">
            Browser-Benachrichtigung + optionaler Webhook wenn ein Benutzer einen Server startet, stoppt oder neustartet.
          </p>
        </div>
        <Toggle on={enabled} onToggle={toggle} disabled={saving} />
      </div>

      {/* Webhook-Auswahl (immer sichtbar wenn Webhooks vorhanden) */}
      {webhooks.length > 0 && (
        <div className="flex items-center gap-3 pl-0 pt-1">
          <div className="flex-1">
            <label className="block text-xs text-panel-muted mb-1">Webhook für Aktions-Meldungen</label>
            <select
              value={webhookId}
              onChange={e => setWebhookId(e.target.value)}
              className="w-full bg-panel-surface border border-panel-border rounded-md px-3 py-1.5 text-sm text-panel-text focus:outline-none focus:border-panel-accent"
            >
              <option value="">— Nur Browser-Benachrichtigung —</option>
              {webhooks.map(w => (
                <option key={w.id} value={String(w.id)}>
                  {w.name} ({w.type})
                </option>
              ))}
            </select>
          </div>
          <button
            onClick={() => save(enabled, webhookId)}
            disabled={saving}
            className="mt-5 px-3 py-1.5 text-xs bg-panel-accent text-white rounded-md hover:bg-blue-500 transition-colors disabled:opacity-50"
          >
            {saving ? '…' : 'Speichern'}
          </button>
        </div>
      )}

      {webhooks.length === 0 && (
        <p className="text-xs text-panel-muted pl-0">
          Noch kein Webhook konfiguriert —{' '}
          <a href="/webhooks" className="text-panel-accent hover:underline">Webhook anlegen</a>
        </p>
      )}

      {msg && <p className={`text-xs ${msg.startsWith('✓') ? 'text-panel-green' : 'text-panel-red'}`}>{msg}</p>}
    </div>
  );
}

const inputCls = 'w-full bg-panel-surface border border-panel-border rounded-md px-3 py-2 text-sm text-panel-text focus:outline-none focus:border-panel-accent transition-colors';

const StatusBadge = ({ set }) => set
  ? <span className="flex items-center gap-1 text-xs text-panel-green"><CheckCircle size={13} />Konfiguriert</span>
  : <span className="flex items-center gap-1 text-xs text-panel-muted"><XCircle size={13} />Nicht gesetzt</span>;

const Msg = ({ msg }) => msg ? (
  <p className={`text-xs mt-2 ${msg.type === 'ok' ? 'text-panel-green' : 'text-panel-red'}`}>{msg.text}</p>
) : null;

// ── GitHub Token Card (für Update Check bei privaten Repos) ───────────────────
function GitHubTokenCard({ status, onReload }) {
  const [token, setToken]       = useState('');
  const [saving, setSaving]     = useState(false);
  const [updating, setUpdating] = useState(false);
  const [testing, setTesting]   = useState(false);
  const [msg, setMsg]           = useState('');

  // Ziel-Container / Stack, der beim Panel-Update neu erstellt wird
  const [targets, setTargets]               = useState([]);
  const [target, setTarget]                 = useState('');
  const [loadingTargets, setLoadingTargets] = useState(false);
  const [savingTarget, setSavingTarget]     = useState(false);

  const loadTargets = async () => {
    setLoadingTargets(true);
    try {
      const { data } = await axios.get('/api/update/targets');
      setTargets(data.targets || []);
      setTarget(data.currentTarget || '');
    } catch (err) {
      setMsg('❌ ' + (err.response?.data?.error || 'Container-Liste konnte nicht geladen werden'));
    }
    setLoadingTargets(false);
  };

  useEffect(() => { loadTargets(); }, []);

  const saveTarget = async (val) => {
    setSavingTarget(true);
    setTarget(val);
    try {
      await axios.put('/api/update/target', { target: val });
      setMsg(val
        ? '✓ Update-Ziel gespeichert — das Panel aktualisiert künftig genau diesen Container bzw. Stack'
        : '✓ Update-Ziel zurückgesetzt — die automatische Erkennung ist wieder aktiv');
    } catch (err) {
      setMsg('❌ ' + (err.response?.data?.error || 'Update-Ziel konnte nicht gespeichert werden'));
    }
    setSavingTarget(false);
  };

  const testToken = async () => {
    setTesting(true);
    setMsg('⏳ Prüfe GitHub-Token und Lesezugriff auf das private Repository...');
    try {
      const { data } = await axios.post('/api/settings/github/test', { token: token.trim() || undefined });
      setMsg('✓ ' + data.message);
    } catch (err) {
      setMsg('❌ ' + (err.response?.data?.error || 'GitHub-Token Prüfung fehlgeschlagen'));
    }
    setTesting(false);
  };

  const save = async () => {
    if (!token.trim()) return;
    setSaving(true);
    setMsg('');
    try {
      await axios.put('/api/settings/github', { token });
      setToken('');
      setMsg('✓ GitHub-Token erfolgreich gespeichert');
      onReload();
    } catch (err) {
      setMsg('❌ ' + (err.response?.data?.error || 'Fehler beim Speichern'));
    }
    setSaving(false);
  };

  const remove = async () => {
    if (!confirm('GitHub-Token wirklich löschen?')) return;
    setSaving(true);
    try {
      await axios.delete('/api/settings/github');
      setMsg('✓ Token gelöscht');
      onReload();
    } catch (err) {
      setMsg('❌ Fehler beim Löschen');
    }
    setSaving(false);
  };

  const runPanelUpdate = async () => {
    if (!confirm('Möchtest du das Panel jetzt automatisch aus dem privaten GitHub-Repository aktualisieren und neu starten?')) return;
    setUpdating(true);
    setMsg('⏳ Starte automatisches Panel-Update...');

    // Build-Nummer vor dem Update merken, um den Neustart daran zu erkennen
    let buildBefore = null;
    try {
      const { data: v } = await axios.get('/api/version');
      buildBefore = v?.build ?? null;
    } catch { /* nicht kritisch — dann zählt nur die Erreichbarkeit */ }

    try {
      const { data } = await axios.post('/api/update/run');
      localStorage.setItem('panel_update_result', JSON.stringify({
        timestamp: Date.now(),
        oldVersion: data.oldVersion,
        newVersion: data.newVersion,
        log: data.log,
        changelogEntry: data.changelogEntry
      }));

      // Früher wurde hier pauschal nach 1,5 Sekunden neu geladen. Beim Docker-Update dauert
      // Pull und Neustart aber 20–30 Sekunden: Die Seite lud noch den ALTEN Container und
      // wirkte, als sei nichts passiert — kurz darauf brach die Verbindung weg.
      // Deshalb wird jetzt aktiv auf den Neustart gewartet.
      const MAX_WARTEN_MS = 180_000;
      const INTERVALL_MS  = 3_000;
      const start = Date.now();
      let warDown = false;   // Server war zwischendurch nicht erreichbar = Neustart lief

      const warte = (ms) => new Promise(r => setTimeout(r, ms));

      while (Date.now() - start < MAX_WARTEN_MS) {
        await warte(INTERVALL_MS);
        const sek = Math.round((Date.now() - start) / 1000);
        setMsg(`⏳ ${data.message} Warte auf den Neustart… (${sek} s)`);

        try {
          const { data: v } = await axios.get('/api/version', { timeout: 2500 });
          // Neue Build-Nummer → Update ist durch. Oder: Server war weg und ist zurück.
          if ((buildBefore != null && v?.build != null && v.build !== buildBefore) || warDown) {
            setMsg('✓ Update abgeschlossen — Seite wird neu geladen…');
            await warte(800);
            window.location.reload();
            return;
          }
        } catch {
          warDown = true;   // Container startet gerade neu
        }
      }

      setMsg('⚠️ Das Update läuft noch oder der Neustart dauert ungewöhnlich lange. Lade die Seite später neu und prüfe die Panel-Logs.');
      setUpdating(false);
    } catch (err) {
      setMsg('❌ ' + (err.response?.data?.error || 'Update fehlgeschlagen'));
      setUpdating(false);
    }
  };

  const isSet = !!status?.github_token;

  return (
    <Card title={<span className="flex items-center gap-2"><RefreshCw size={14} className="text-panel-accent" />GitHub-Repository & Panel-Updater</span>}>
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <StatusBadge set={isSet} />
          {isSet && (
            <button onClick={remove} disabled={saving} className="text-xs text-panel-red hover:underline flex items-center gap-1">
              <Trash2 size={12} />Token löschen
            </button>
          )}
        </div>
        <p className="text-xs text-panel-muted leading-relaxed">
          Personal Access Token (PAT) von GitHub, damit das Panel automatisch im privaten Repository nach Updates (version.json & Agent) suchen kann.
        </p>

        {/* Erklärung: So erstellst du ein GitHub Token */}
        <div className="rounded-md border border-panel-accent/30 bg-panel-accent/5 px-3.5 py-2.5 space-y-1.5">
          <p className="text-[11px] font-semibold text-panel-accent">So erstellst du ein GitHub-Token für dein privates Repository:</p>
          <ol className="text-[11px] text-panel-muted leading-relaxed list-decimal list-inside space-y-0.5">
            <li>Auf GitHub zu <a href="https://github.com/settings/tokens?type=beta" target="_blank" rel="noreferrer" className="text-panel-text underline hover:text-panel-accent">Settings → Developer settings → Personal access tokens (Fine-grained)</a> gehen.</li>
            <li>Auf <strong>Generate new token</strong> klicken und dein privates Repository <code className="text-panel-text font-mono bg-panel-surface px-1 py-0.5 rounded">ueberwachungs-panel</code> auswählen.</li>
            <li>Unter <strong>Repository permissions</strong> bei <strong>Contents</strong> und <strong>Metadata</strong> auf <strong>Read-only</strong> (Lesezugriff) stellen.</li>
            <li>Token generieren, hier in das Feld einfügen und speichern.</li>
          </ol>
        </div>

        <div className="flex gap-2">
          <input
            type="password"
            value={token}
            onChange={e => setToken(e.target.value)}
            placeholder="ghp_xxxx..."
            className="w-full bg-panel-surface border border-panel-border rounded-md px-3 py-1.5 text-sm text-panel-text focus:outline-none focus:border-panel-accent"
          />
          <button
            onClick={testToken}
            disabled={testing || saving || (!isSet && !token.trim())}
            className="px-3 py-1.5 text-xs bg-panel-card text-panel-text border border-panel-border rounded-md hover:bg-panel-border transition-colors disabled:opacity-50 whitespace-nowrap cursor-pointer"
            title="Prüfen, ob das (eingegebene oder gespeicherte) Token gültig ist und Lesezugriff auf RoobiinG/ueberwachungs-panel hat"
          >
            {testing ? 'Prüfe…' : 'Token testen'}
          </button>
          <button
            onClick={save}
            disabled={saving || !token.trim()}
            className="px-3 py-1.5 text-xs bg-panel-accent text-white rounded-md hover:bg-blue-500 transition-colors disabled:opacity-50 whitespace-nowrap cursor-pointer"
          >
            {saving ? '…' : 'Speichern'}
          </button>
        </div>
        {msg && <p className={`text-xs ${msg.startsWith('✓') ? 'text-panel-green' : msg.startsWith('⏳') ? 'text-panel-accent' : 'text-panel-red'}`}>{msg}</p>}

        {/* ── Automatischen Panel-Updater starten ── */}
        <div className="pt-3 border-t border-panel-border/40 space-y-2">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div>
              <h4 className="text-xs font-semibold text-panel-text flex items-center gap-1.5">
                <RefreshCw size={13} className="text-panel-accent" /> Panel-Updater (Git Pull & Neustart)
              </h4>
              <p className="text-[11px] text-panel-muted">
                Aktualisiert das Panel automatisch vom GitHub-Repository auf die neueste Version, lädt die Seite neu und zeigt den Update-Log.
              </p>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <a
                href="https://github.com/RoobiinG/ueberwachungs-panel/blob/master/CHANGELOG.md"
                target="_blank"
                rel="noreferrer"
                className="px-2.5 py-1.5 text-xs bg-panel-surface border border-panel-border hover:border-panel-accent text-panel-text rounded-md flex items-center gap-1.5 transition-colors whitespace-nowrap"
                title="Release-Historie, Bugfixes & Nachwirken auf GitHub ansehen"
              >
                <FileText size={13} className="text-panel-accent" />
                Update-Log & Nachwirken (GitHub)
              </a>
              <Button
                onClick={runPanelUpdate}
                disabled={updating}
                size="sm"
                className="bg-emerald-600 hover:bg-emerald-500 text-white flex items-center gap-1.5 whitespace-nowrap"
              >
                <Download size={13} />
                {updating ? 'Aktualisiere...' : 'Jetzt aktualisieren'}
              </Button>
            </div>
          </div>

          {/* ── Ziel-Container / Stack für das Update ── */}
          <div className="rounded-md border border-panel-border/60 bg-panel-surface/40 px-3.5 py-2.5 space-y-2">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <h5 className="text-[11px] font-semibold text-panel-text flex items-center gap-1.5">
                <Layers size={12} className="text-panel-accent" /> Ziel des Updates
              </h5>
              <button
                onClick={loadTargets}
                disabled={loadingTargets}
                className="text-[11px] text-panel-muted hover:text-panel-accent flex items-center gap-1 disabled:opacity-50 cursor-pointer"
                title="Container- und Stack-Liste neu einlesen"
              >
                <RefreshCw size={11} className={loadingTargets ? 'animate-spin' : ''} />
                {loadingTargets ? 'Lade…' : 'Neu laden'}
              </button>
            </div>
            <p className="text-[11px] text-panel-muted leading-relaxed">
              Legt fest, welcher Container oder Dockhand-Stack beim Update neu erstellt wird. Ohne Auswahl sucht sich
              das Panel sein Ziel automatisch anhand des Namens — das schlägt fehl, wenn der Container bei dir anders heißt.
            </p>
            <select
              value={target}
              onChange={e => saveTarget(e.target.value)}
              disabled={savingTarget || loadingTargets}
              className={inputCls + ' py-1.5 text-xs disabled:opacity-50 cursor-pointer'}
            >
              <option value="">Automatisch erkennen (Standard)</option>
              {targets.map(t => (
                <option key={`${t.source}-${t.type}-${t.id}`} value={t.id}>{t.name}</option>
              ))}
            </select>
            {!loadingTargets && targets.length === 0 && (
              <p className="text-[11px] text-panel-muted">
                Keine Container oder Stacks gefunden — weder über die Dockhand-API noch lokal. Die automatische Erkennung bleibt aktiv.
              </p>
            )}
          </div>
        </div>
      </div>
    </Card>
  );
}

// ── Modul-Aktivierung Card ────────────────────────────────────────────────────
function ModulesToggleCard() {
  const [modules, setModules] = useState({
    docker: true,
    patchmon: true,
    uptimekuma: true,
    hetzner: true,
    mchost: true,
  });
  const [saving, setSaving] = useState(false);
  const [msg, setMsg]       = useState('');

  useEffect(() => {
    axios.get('/api/settings/modules').then(r => setModules(r.data)).catch(() => {});
  }, []);

  const toggle = (key) => setModules(m => ({ ...m, [key]: !m[key] }));

  const save = async () => {
    setSaving(true);
    setMsg('');
    try {
      await axios.put('/api/settings/modules', { modules });
      setMsg('✓ Module gespeichert! Navigation wird aktualisiert...');
      setTimeout(() => window.location.reload(), 1200);
    } catch (err) {
      setMsg('❌ ' + (err.response?.data?.error || 'Fehler beim Speichern'));
      setSaving(false);
    }
  };

  const list = [
    { key: 'docker',     label: 'Docker & Docker-Ressourcen', desc: 'Container, Images, Volumes, Networks & Stacks' },
    { key: 'patchmon',   label: 'PatchMon',                   desc: 'Linux Sicherheits- und System-Updates' },
    { key: 'uptimekuma', label: 'Uptime Kuma',                desc: 'Web-Monitoring & Ping-Status' },
    { key: 'hetzner',    label: 'Hetzner',                    desc: 'Cloud-Server und Storage Boxes' },
    { key: 'mchost',     label: 'MC-Host24',                  desc: 'vServer / Rootserver Management' },
  ];

  return (
    <div className="space-y-3">
      <p className="text-xs text-panel-muted leading-relaxed">
        Deaktiviere nicht genutzte Module, um sie aus der Seitenleiste auszublenden.
      </p>
      <div className="space-y-2.5 pt-1">
        {list.map(item => (
          <div key={item.key} className="flex items-center justify-between py-1 border-b border-panel-border/40 last:border-0">
            <div>
              <div className="text-xs font-medium text-panel-text">{item.label}</div>
              <div className="text-[11px] text-panel-muted">{item.desc}</div>
            </div>
            <Toggle on={!!modules[item.key]} onToggle={() => toggle(item.key)} disabled={saving} />
          </div>
        ))}
      </div>
      <button
        onClick={save}
        disabled={saving}
        className="mt-2 px-3 py-1.5 text-xs bg-panel-accent text-white rounded-md hover:bg-blue-500 transition-colors disabled:opacity-50"
      >
        {saving ? 'Speichern...' : 'Auswahl speichern'}
      </button>
      {msg && <p className={`text-xs ${msg.startsWith('✓') ? 'text-panel-green' : 'text-panel-red'}`}>{msg}</p>}
    </div>
  );
}

// ── Pride Flag Anzeige in der Sidebar Toggle ──────────────────────────────────
function PrideFlagToggleCard() {
  const [enabled, setEnabled] = useState(() => localStorage.getItem('show_pride_flag') !== 'false');
  const [msg, setMsg] = useState('');

  const toggle = () => {
    const next = !enabled;
    setEnabled(next);
    localStorage.setItem('show_pride_flag', next ? 'true' : 'false');
    window.dispatchEvent(new Event('pride_flag_change'));
    setMsg(`✓ Einstellung gespeichert! Pride Flag in Sidebar ist jetzt ${next ? 'aktiviert' : 'deaktiviert'}.`);
    setTimeout(() => setMsg(''), 3000);
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-panel-muted leading-relaxed">
        Steuere, ob das Progress Pride Flag Symbol unten in der Seitenleiste (neben deinem Benutzernamen) angezeigt werden soll.
      </p>
      <div className="flex items-center justify-between py-1.5 border-t border-panel-border/40">
        <div className="flex items-center gap-2">
          <span
            className="inline-flex items-center justify-center w-6 h-4 rounded-[3px] shadow-sm border border-white/10 text-white text-[10px]"
            style={{
              background: 'linear-gradient(90deg, #FF0018 0%, #FFA52C 16%, #FFFF41 33%, #008018 50%, #0000F9 66%, #86007D 83%, #5BCEFA 90%, #F5A9B8 100%)'
            }}
          >
            🏳️‍🌈
          </span>
          <div>
            <div className="text-xs font-medium text-panel-text">Pride Flag in der Sidebar anzeigen</div>
            <div className="text-[11px] text-panel-muted">Färbt den gesamten unteren Bereich der Seitenleiste mit dem Progress-Pride-Flag-Verlauf</div>
          </div>
        </div>
        <Toggle on={enabled} onToggle={toggle} />
      </div>
      {msg && <p className="text-xs text-panel-green">{msg}</p>}
    </div>
  );
}

// ── SQLite Backup Manager Card (Modul 1) ──────────────────────────────────────
function BackupManagerCard() {
  const [backups, setBackups]   = useState([]);
  const [loading, setLoading]   = useState(false);
  const [creating, setCreating] = useState(false);
  const [restoring, setRestoring] = useState(null);
  const [msg, setMsg]           = useState('');

  const loadBackups = async () => {
    setLoading(true);
    try {
      const { data } = await axios.get('/api/backups');
      setBackups(data.backups || []);
    } catch (err) {
      setMsg('❌ Fehler beim Laden der Backups: ' + (err.response?.data?.error || err.message));
    }
    setLoading(false);
  };

  useEffect(() => { loadBackups(); }, []);

  const handleCreateBackup = async () => {
    setCreating(true);
    setMsg('');
    try {
      const { data } = await axios.post('/api/backups/create');
      setMsg(`✓ Backup '${data.backup.filename}' erfolgreich angelegt.`);
      loadBackups();
    } catch (err) {
      setMsg('❌ Backup-Erstellung fehlgeschlagen: ' + (err.response?.data?.error || err.message));
    }
    setCreating(false);
  };

  const handleDeleteBackup = async (filename) => {
    if (!window.confirm(`Möchtest du das Backup '${filename}' wirklich unwiderruflich löschen?`)) return;
    try {
      await axios.delete(`/api/backups/${encodeURIComponent(filename)}`);
      setMsg(`✓ Backup '${filename}' gelöscht.`);
      loadBackups();
    } catch (err) {
      setMsg('❌ Fehler beim Löschen: ' + (err.response?.data?.error || err.message));
    }
  };

  const handleRestoreBackup = async (filename) => {
    if (!window.confirm(`⚠️ ACHTUNG: Möchtest du die Datenbank wirklich auf den Stand von '${filename}' zurücksetzen?\n\nAlle Änderungen seit diesem Datum gehen verloren! (Ein automatisches Sicherheits-Backup wird vorher angelegt).`)) return;
    setRestoring(filename);
    setMsg('⏳ Datenbank wird wiederhergestellt...');
    try {
      const { data } = await axios.post('/api/backups/restore', { filename });
      setMsg(`✓ ${data.message} — Seite wird geladen...`);
      setTimeout(() => window.location.reload(), 1500);
    } catch (err) {
      setMsg('❌ Wiederherstellung fehlgeschlagen: ' + (err.response?.data?.error || err.message));
      setRestoring(null);
    }
  };

  const fmtBytes = (b) => {
    if (!b) return '0 B';
    const k = 1024, sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(b) / Math.log(k));
    return `${parseFloat((b / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
  };

  return (
    <Card title={<span className="flex items-center gap-2"><Database size={14} className="text-panel-accent" />Sicherungen & Backups (SQLite data.db)</span>}>
      <div className="space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <p className="text-xs text-panel-muted leading-relaxed">
            Erstelle und verwalte Sicherungen deiner SQLite-Datenbank (<code className="text-panel-text font-mono">data.db</code>). Bis zu 10 Backups werden rotierend gespeichert.
          </p>
          <Button onClick={handleCreateBackup} disabled={creating || loading} size="sm" className="flex items-center gap-1.5 whitespace-nowrap">
            <Database size={13} />
            {creating ? 'Sichere...' : 'Sofort-Backup erstellen'}
          </Button>
        </div>

        {msg && <p className={`text-xs ${msg.startsWith('✓') ? 'text-panel-green' : msg.startsWith('⏳') ? 'text-panel-accent' : 'text-panel-red'}`}>{msg}</p>}

        {loading ? (
          <p className="text-xs text-panel-muted py-2">Lade Backup-Liste...</p>
        ) : backups.length === 0 ? (
          <div className="p-4 text-center border border-dashed border-panel-border rounded-lg text-xs text-panel-muted">
            Noch keine lokalen Datenbank-Backups vorhanden. Klicke auf „Sofort-Backup erstellen“, um den aktuellen Stand zu sichern.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-panel-border text-panel-muted font-medium">
                  <th className="py-2 pr-4">Dateiname</th>
                  <th className="py-2 pr-4">Erstellt am</th>
                  <th className="py-2 pr-4">Größe</th>
                  <th className="py-2 text-right">Aktionen</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-panel-border/40">
                {backups.map(b => (
                  <tr key={b.filename} className="hover:bg-panel-surface/60 transition-colors">
                    <td className="py-2 pr-4 font-mono text-panel-text">{b.filename}</td>
                    <td className="py-2 pr-4 text-panel-muted">
                      {new Date(b.createdAt).toLocaleString('de-DE')}
                    </td>
                    <td className="py-2 pr-4 text-panel-muted">{fmtBytes(b.sizeBytes)}</td>
                    <td className="py-2 text-right space-x-1 whitespace-nowrap">
                      <a
                        href={`/api/backups/download/${encodeURIComponent(b.filename)}`}
                        download
                        className="inline-flex items-center gap-1 px-2 py-1 bg-panel-surface border border-panel-border hover:border-panel-accent rounded text-panel-text transition-colors"
                        title="Diese Sicherung als Datei herunterladen"
                      >
                        <Download size={12} />Herunterladen
                      </a>
                      <button
                        onClick={() => handleRestoreBackup(b.filename)}
                        disabled={restoring === b.filename}
                        className="inline-flex items-center gap-1 px-2 py-1 bg-panel-accent/10 border border-panel-accent/40 text-panel-accent hover:bg-panel-accent hover:text-white rounded transition-colors cursor-pointer"
                        title="Diesen Stand wiederherstellen"
                      >
                        {restoring === b.filename ? 'Wiederherstellen...' : 'Wiederherstellen'}
                      </button>
                      <button
                        onClick={() => handleDeleteBackup(b.filename)}
                        className="inline-flex items-center gap-1 px-2 py-1 bg-panel-red/10 border border-panel-red/30 text-panel-red hover:bg-panel-red hover:text-white rounded transition-colors cursor-pointer"
                        title="Diese Sicherung endgültig entfernen"
                      >
                        <Trash2 size={12} />Löschen
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Card>
  );
}

// ── UA-Hilfsfunktionen ─────────────────────────────────────────────────────────
function parseBrowser(ua = '') {
  if (!ua) return 'Unbekannt';
  if (/PanelApp-Android/.test(ua))              return 'Panel App';
  if (/okhttp|Dalvik/.test(ua))                 return 'Android App';
  if (/Edg\//.test(ua))                         return 'Edge';
  if (/OPR\//.test(ua))                         return 'Opera';
  if (/Chrome\//.test(ua))                      return 'Chrome';
  if (/Firefox\//.test(ua))                     return 'Firefox';
  if (/Safari\//.test(ua))                      return 'Safari';
  if (/curl\//.test(ua))                        return 'cURL';
  return 'Browser';
}
function parseOS(ua = '') {
  if (/PanelApp-Android/.test(ua))              return 'Android';
  if (/Windows/.test(ua))                       return 'Windows';
  if (/Android/.test(ua))                       return 'Android';
  if (/iPhone|iPad/.test(ua))                   return 'iOS';
  if (/Mac OS/.test(ua))                        return 'macOS';
  if (/Linux/.test(ua))                         return 'Linux';
  return '';
}
function DeviceIcon({ ua }) {
  if (/PanelApp-Android|iPhone|iPad|Android/.test(ua)) return <Smartphone size={15} className="text-panel-muted" />;
  if (/Windows|Mac OS|Linux/.test(ua))                 return <Laptop     size={15} className="text-panel-muted" />;
  return <Globe size={15} className="text-panel-muted" />;
}
function fmtRelTime(dateStr) {
  if (!dateStr) return '—';
  const iso = dateStr.includes('Z') || dateStr.includes('+') ? dateStr : dateStr.replace(' ', 'T') + 'Z';
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60)   return 'gerade eben';
  if (diff < 3600) return `vor ${Math.floor(diff / 60)} Min.`;
  if (diff < 86400) return `vor ${Math.floor(diff / 3600)} Std.`;
  return `vor ${Math.floor(diff / 86400)} Tagen`;
}
function fmtAbsTime(dateStr) {
  if (!dateStr) return '—';
  const iso = dateStr.includes('Z') || dateStr.includes('+') ? dateStr : dateStr.replace(' ', 'T') + 'Z';
  return new Date(iso).toLocaleString('de-DE', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin',
  });
}

// ── SessionsSection ────────────────────────────────────────────────────────────
function SessionsSection({ isAdmin }) {
  const [sessions, setSessions] = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [busy,     setBusy]     = useState({});

  const load = () => {
    setLoading(true);
    axios.get('/api/sessions')
      .then(r => setSessions(r.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const revoke = async (id) => {
    setBusy(b => ({ ...b, [id]: true }));
    try {
      await axios.delete(`/api/sessions/${id}`);
      setSessions(s => s.filter(x => x.id !== id));
    } catch {}
    setBusy(b => ({ ...b, [id]: false }));
  };

  const revokeOthers = async () => {
    setBusy(b => ({ ...b, _all: true }));
    try {
      await axios.delete('/api/sessions/others');
      load();
    } catch {}
    setBusy(b => ({ ...b, _all: false }));
  };

  const others = sessions.filter(s => !s.is_current);

  return (
    <Card title={
      <div className="flex items-center justify-between w-full">
        <span>{isAdmin ? 'Alle aktiven Sitzungen' : 'Aktive Sitzungen'}</span>
        {others.length > 0 && !isAdmin && (
          <Button size="sm" variant="danger" onClick={revokeOthers} disabled={!!busy._all}>
            <LogOut size={12} className="mr-1" />Alle anderen abmelden
          </Button>
        )}
      </div>
    }>
      {loading ? (
        <p className="text-panel-muted text-sm py-4 text-center">Lade…</p>
      ) : sessions.length === 0 ? (
        <p className="text-panel-muted text-sm py-4 text-center">Keine aktiven Sitzungen</p>
      ) : (
        <div className="space-y-2">
          {sessions.map(s => (
            <div key={s.id}
              className={`flex items-center gap-3 p-3 rounded-lg border transition-colors
                ${s.is_current
                  ? 'border-panel-accent/50 bg-panel-accent/5'
                  : 'border-panel-border bg-panel-surface'}`}>
              <DeviceIcon ua={s.user_agent} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium text-panel-text">
                    {parseBrowser(s.user_agent)}
                    {parseOS(s.user_agent) ? ` · ${parseOS(s.user_agent)}` : ''}
                  </span>
                  {s.is_current && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-panel-accent/20 text-panel-accent font-semibold">
                      Diese Sitzung
                    </span>
                  )}
                  {isAdmin && s.username && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-panel-surface border border-panel-border text-panel-muted">
                      <User size={9} className="inline mr-0.5" />{s.username}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-3 mt-0.5 text-[11px] text-panel-muted flex-wrap">
                  {s.ip && <span>IP: {s.ip}</span>}
                  <span title={fmtAbsTime(s.created_at)}>Angemeldet: {fmtAbsTime(s.created_at)}</span>
                  <span title={fmtAbsTime(s.last_used)}>Zuletzt aktiv: {fmtRelTime(s.last_used)}</span>
                </div>
              </div>
              {!s.is_current && (
                <button
                  onClick={() => revoke(s.id)}
                  disabled={!!busy[s.id]}
                  title="Diese Sitzung sofort abmelden"
                  className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded text-panel-muted hover:text-panel-red hover:bg-panel-red/10 transition-colors disabled:opacity-40 flex-shrink-0">
                  <LogOut size={13} />{busy[s.id] ? 'Beendet…' : 'Beenden'}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

export default function Settings() {
  const { user, isAdmin, hasPermission } = useAuth();
  const [tab, setTab]     = useState('profile'); // 'profile' | 'system'

  const [status,  setStatus]  = useState({});
  const [loading, setLoading] = useState({});
  const [msgs,    setMsgs]    = useState({});

  // Passwort
  const [pwCurrent,  setPwCurrent]  = useState('');
  const [pwNew,      setPwNew]      = useState('');
  const [pwConfirm,  setPwConfirm]  = useState('');
  const [showPw,     setShowPw]     = useState(false);

  // E-Mail
  const [email,     setEmail]    = useState('');
  const [emailPw,   setEmailPw]  = useState('');   // Passwortbestätigung für die E-Mail-Änderung

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
  const [passkeys,     setPasskeys]     = useState([]);
  const [passkeyName,  setPasskeyName]  = useState('');
  // Speicherort des neuen Passkeys. Die Wahl merkt sich das Panel, weil sie vom Gerät
  // abhängt und nicht bei jedem Anlegen neu getroffen werden soll.
  const [passkeyZiel,  setPasskeyZiel]  = useState(() => localStorage.getItem('panel_passkey_ziel') || 'auto');
  // Brave verhält sich hier gegenteilig zu Chrome und Edge: Enpass meldet sich dort als
  // Geräte-Anmeldung, nicht als externer Anbieter. Derselbe Hinweis wäre also je nach
  // Browser falsch — deshalb wird er nachgeschlagen.
  const [istBrave, setIstBrave] = useState(false);
  useEffect(() => {
    navigator.brave?.isBrave?.().then(v => setIstBrave(!!v)).catch(() => {});
  }, []);

  // 2FA
  const [twoFaStatus, setTwoFaStatus] = useState({ twofa_type: 'none', hasEmail: false });
  const [twoFaSetup, setTwoFaSetup]   = useState(null);
  const [twoFaCode, setTwoFaCode]     = useState('');
  const [twoFaPw, setTwoFaPw]         = useState('');
  const [copied2FA, setCopied2FA]     = useState(false);

  // Live-Refresh-Interval
  const [liveInterval,    setLiveInterval]    = useState(15);

  // Automatisches Agent-Update beim Panel-Start
  const [agentAutoUpdate, setAgentAutoUpdate] = useState(true);

  // Pelican Panel — Klarnamen für Gameserver-Container
  const [pelicanUrl,      setPelicanUrl]      = useState('');
  const [pelicanToken,    setPelicanToken]    = useState('');
  const [pelicanHasToken, setPelicanHasToken] = useState(false);
  const [showPelicanToken, setShowPelicanToken] = useState(false);

  // Dockhand
  const [dockhandUrl,      setDockhandUrl]      = useState('');
  const [dockhandToken,    setDockhandToken]    = useState('');
  const [dockhandEnvId,    setDockhandEnvId]    = useState('');
  const [dockerEngine,     setDockerEngine]     = useState('agents');
  const [dockhandEnvs,     setDockhandEnvs]     = useState([]); // [{id,name}] aus Dockhand
  const [dockhandAgents,   setDockhandAgents]   = useState([]); // remote_agents mit dockhand_env_id
  const [showDockhandToken, setShowDockhandToken] = useState(false);
  const [pmHosts,       setPmHosts]       = useState([]); // PatchMon-Hosts aus /api/patchmon/hosts
  const [pmAgents,      setPmAgents]      = useState([]); // remote_agents mit patchmon_host_id
  const [pmLocalHostId, setPmLocalHostId] = useState('');

  // Backup & Migration
  const [migrationTab, setMigrationTab] = useState('send');
  const [migrationTargetUrl, setMigrationTargetUrl] = useState('');
  const [migrationUsername, setMigrationUsername] = useState('');
  const [migrationPassword, setMigrationPassword] = useState('');
  const [migrationFile, setMigrationFile] = useState(null);

  // ── Laden ─────────────────────────────────────────────────────────────────

  const loadAdmin = async () => {
    if (!isAdmin) return;
    try {
      const { data } = await axios.get('/api/settings');
      setStatus(data);
      // Live-Interval laden
      try {
        const { data: g } = await axios.get('/api/settings/general');
        setLiveInterval(Math.round((g.liveRefreshInterval || 15000) / 1000));
        setAgentAutoUpdate(g.agentAutoUpdate !== false);
      } catch {}
      try {
        const { data: p } = await axios.get('/api/pelican/config');
        setPelicanUrl(p.url || '');
        setPelicanHasToken(!!p.hasToken);
      } catch {}
      if (data.mchost_username) setMcUsername(data.mchost_username);
      if (data.smtp_host)  setSmtp(s => ({ ...s, host:   data.smtp_host  || '' }));
      if (data.smtp_port)  setSmtp(s => ({ ...s, port:   data.smtp_port  || 587 }));
      if (data.smtp_user)  setSmtp(s => ({ ...s, user:   data.smtp_user  || '' }));
      if (data.smtp_from)  setSmtp(s => ({ ...s, from:   data.smtp_from  || '' }));
      if (data.smtp_secure !== undefined) setSmtp(s => ({ ...s, secure: !!data.smtp_secure }));
    } catch {}
  };

  const loadDockhand = async () => {
    if (!isAdmin) return;
    try {
      const { data } = await axios.get('/api/dockhand/config');
      setDockhandUrl(data.url || '');
      setDockhandEnvId(data.localEnvId || '');
      setDockerEngine(data.dockerEngine || 'agents');
    } catch {}
    // Agents mit dockhand_env_id laden
    try {
      const { data } = await axios.get('/api/agents');
      setDockhandAgents(data);
    } catch {}
    // Environments laden (nur wenn konfiguriert)
    try {
      const { data } = await axios.get('/api/dockhand/environments');
      if (Array.isArray(data)) setDockhandEnvs(data);
    } catch {}
  };

  const loadPatchmonLinks = async () => {
    if (!isAdmin) return;
    try { const { data } = await axios.get('/api/patchmon/hosts'); setPmHosts(data.hosts || []); }
    catch { setPmHosts([]); }
    try { const { data } = await axios.get('/api/agents'); setPmAgents(data); } catch {}
    try { const { data } = await axios.get('/api/patchmon/local-binding'); setPmLocalHostId(data.hostId || ''); } catch {}
  };

  const saveAgentPm = async (agentId, hostId) => {
    setPmAgents(list => list.map(a => a.id === agentId ? { ...a, patchmon_host_id: hostId || null } : a));
    try { await axios.put(`/api/agents/${agentId}`, { patchmon_host_id: hostId || null }); } catch {}
  };
  const saveLocalPm = async (hostId) => {
    setPmLocalHostId(hostId);
    try { await axios.post('/api/patchmon/local-binding', { hostId: hostId || '' }); } catch {}
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

  const loadTwoFA = async () => {
    try {
      const { data } = await axios.get('/api/auth/2fa/status');
      setTwoFaStatus(data);
    } catch {}
  };

  useEffect(() => {
    loadAdmin();
    loadPasskeys();
    loadEmail();
    loadTwoFA();
    loadDockhand();
    loadPatchmonLinks();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin]);

  // ── Hilfsfunktionen ───────────────────────────────────────────────────────

  const feedback = (key, type, text) => {
    setMsgs(m => ({ ...m, [key]: { type, text } }));
    setTimeout(() => setMsgs(m => ({ ...m, [key]: null })), 4000);
  };
  const busy = (key, val) => setLoading(l => ({ ...l, [key]: val }));

  // ── Profil-Aktionen ───────────────────────────────────────────────────────

  const changePassword = async () => {
    if (pwNew !== pwConfirm) return feedback('pw', 'err', 'Passwörter stimmen nicht überein');
    if (pwNew.length < 12)   return feedback('pw', 'err', 'Mindestens 12 Zeichen erforderlich');
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
      await axios.put('/api/auth/me/email', { email, currentPassword: emailPw });
      setEmailPw('');
      feedback('email', 'ok', 'E-Mail gespeichert');
    } catch (err) {
      feedback('email', 'err', err.response?.data?.error || 'Fehler');
    }
    busy('email', false);
  };

  const registerPasskey = async () => {
    busy('passkey', true);
    try {
      const { startRegistration } = await import('@simplewebauthn/browser');
      const optRes   = await axios.get(`/api/passkeys/register/start?ziel=${encodeURIComponent(passkeyZiel)}`);
      // `useAutoRegister` entspricht `mediation: 'conditional'`: Der Passwortmanager, der
      // das gerade benutzte Passwort hält, legt den Passkey selbst an — es erscheint kein
      // Auswahl- und kein Systemdialog, und damit auch kein Windows Hello.
      const attResp  = await startRegistration({
        optionsJSON: optRes.data,
        ...(passkeyZiel === 'still' ? { useAutoRegister: true } : {}),
      });
      const name     = passkeyName.trim() || 'Passkey';
      await axios.post('/api/passkeys/register/finish', { registration: attResp, name });
      setPasskeyName('');
      await loadPasskeys();
      feedback('passkey', 'ok', `Passkey "${name}" erfolgreich registriert`);
    } catch (err) {
      const raw = err?.response?.data?.error || err?.message || '';
      // NotAllowedError = Dialog geschlossen, abgelaufen — oder es erschien gar nicht
      // erst der gewünschte Anbieter.
      const isNotAllowed = /not allowed|timed out|NotAllowedError/i.test(raw);
      const msg = isNotAllowed
        ? (passkeyZiel === 'still'
            // Beim stillen Weg heißt NotAllowedError nicht „abgebrochen", sondern
            // „Bedingungen nicht erfüllt" — es gab ja gar keinen Dialog zum Abbrechen.
            ? 'Dein Passwortmanager hat den Passkey nicht angelegt. Das passiert, wenn das Panel-Passwort dort nicht gespeichert ist, du dich nicht damit angemeldet hast, oder er diesen Weg noch nicht unterstützt. Melde dich einmal per Passwort-Autofill neu an und versuche es gleich danach — oder wähle einen der anderen Speicherorte.'
            : istBrave
            ? 'Dialog abgebrochen. In Brave meldet sich Enpass als Geräte-Anmeldung — unter „Speicherort" auf „Auf diesem Gerät" stellen. Kommt weiterhin nur der Windows-Dialog, ist das ein bekannter Brave-Fehler: dann in Chrome oder Edge anlegen, oder im Dialog „Anderes Gerät" wählen und den QR-Code mit dem Handy scannen.'
            : passkeyZiel === 'extern'
              ? 'Dialog abgebrochen. Erscheint dein Passwortmanager nicht, muss er im Browser als Passkey-Anbieter freigeschaltet sein — alternativ im Dialog „Anderes Gerät" wählen und den QR-Code mit dem Handy scannen.'
              : 'Dialog abgebrochen. Für einen Passkey im Passwortmanager (z. B. Enpass) unter „Speicherort" auf „Passwortmanager oder anderes Gerät" umstellen.')
        : (raw || 'Registrierung fehlgeschlagen');
      feedback('passkey', 'err', msg);
    }
    busy('passkey', false);
  };

  const deletePasskey = async (id) => {
    if (!confirm('Passkey wirklich löschen?')) return;
    try {
      await axios.delete(`/api/passkeys/${id}`);
      await loadPasskeys();
      feedback('passkey', 'ok', 'Passkey gelöscht');
    } catch { feedback('passkey', 'err', 'Fehler beim Löschen'); }
  };

  const start2faSetup = async (type) => {
    busy('twofa', true);
    try {
      const { data } = await axios.post('/api/auth/2fa/setup', { type });
      setTwoFaSetup(data);
      setTwoFaCode('');
      feedback('twofa', 'ok', data.message || 'Setup gestartet');
    } catch (err) {
      feedback('twofa', 'err', err.response?.data?.error || 'Fehler beim Setup');
    }
    busy('twofa', false);
  };

  const enable2fa = async () => {
    if (!twoFaCode || twoFaCode.length !== 6) return feedback('twofa', 'err', 'Bitte 6-stelligen Code eingeben');
    busy('twofa', true);
    try {
      await axios.post('/api/auth/2fa/enable', {
        type: twoFaSetup.type,
        secret: twoFaSetup.secret,
        code: twoFaCode
      });
      setTwoFaSetup(null);
      setTwoFaCode('');
      await loadTwoFA();
      feedback('twofa', 'ok', '2FA erfolgreich aktiviert');
    } catch (err) {
      feedback('twofa', 'err', err.response?.data?.error || 'Ungültiger Code');
    }
    busy('twofa', false);
  };

  const disable2fa = async () => {
    if (!twoFaPw) return feedback('twofa', 'err', 'Bitte Passwort zur Bestätigung eingeben');
    busy('twofa', true);
    try {
      await axios.post('/api/auth/2fa/disable', { password: twoFaPw });
      setTwoFaPw('');
      await loadTwoFA();
      feedback('twofa', 'ok', '2FA deaktiviert');
    } catch (err) {
      feedback('twofa', 'err', err.response?.data?.error || 'Passwort falsch');
    }
    busy('twofa', false);
  };

  // ── System-Aktionen (Admin) ───────────────────────────────────────────────

  const saveHetzner = async () => {
    if (!hetznerToken.trim()) return;
    busy('hetzner', true);
    try {
      await axios.put('/api/settings/hetzner', { token: hetznerToken });
      setHetznerToken('');
      await loadAdmin();
      feedback('hetzner', 'ok', 'Token gespeichert');
    } catch (err) {
      feedback('hetzner', 'err', err.response?.data?.error || 'Fehler');
    }
    busy('hetzner', false);
  };

  const deleteHetzner = async () => {
    busy('hetzner_del', true);
    try { await axios.delete('/api/settings/hetzner'); await loadAdmin(); feedback('hetzner', 'ok', 'Token gelöscht'); }
    catch { feedback('hetzner', 'err', 'Fehler beim Löschen'); }
    busy('hetzner_del', false);
  };

  const loginMcHost = async () => {
    if (!mcUsername || !mcPassword) return;
    busy('mchost', true);
    try {
      const { data } = await axios.post('/api/settings/mchost/login', { username: mcUsername, password: mcPassword });
      setMcPassword('');
      await loadAdmin();
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
      await loadAdmin();
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
      await loadAdmin();
      feedback('mchost', 'ok', 'Zugangsdaten gelöscht');
    } catch { feedback('mchost', 'err', 'Fehler beim Löschen'); }
    busy('mchost_del', false);
  };

  const saveSmtp = async () => {
    busy('smtp', true);
    try {
      const payload = { ...smtp };
      if (!payload.pass) delete payload.pass;
      await axios.put('/api/settings/smtp', payload);
      await loadAdmin();
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

  const fmtDate = (s) => s ? new Date(s).toLocaleString('de-DE') : '—';

  // ── Dockhand-Aktionen ─────────────────────────────────────────────────────

  const testDockhand = async () => {
    busy('dockhand', true);
    try {
      const { data } = await axios.post('/api/dockhand/test', {
        url:      dockhandUrl,
        apiToken: dockhandToken || undefined,
      });
      setDockhandEnvs(data.environments > 0
        ? (await axios.get('/api/dockhand/environments')).data
        : []);
      feedback('dockhand', 'ok', `Verbunden — ${data.environments} Environment(s) gefunden`);
    } catch (err) {
      feedback('dockhand', 'err', err.response?.data?.error || 'Verbindung fehlgeschlagen');
    }
    busy('dockhand', false);
  };

  const saveDockhand = async () => {
    busy('dockhand_save', true);
    try {
      await axios.post('/api/dockhand/config', {
        url:        dockhandUrl,
        ...(dockhandToken ? { apiToken: dockhandToken } : {}),
        localEnvId: dockhandEnvId,
        dockerEngine: dockerEngine
      });
      setDockhandToken('');
      feedback('dockhand', 'ok', 'Dockhand-Einstellungen gespeichert');
    } catch (err) {
      feedback('dockhand', 'err', err.response?.data?.error || 'Fehler');
    }
    busy('dockhand_save', false);
  };

  // ── Pelican Panel ─────────────────────────────────────────────────────────
  const testPelican = async () => {
    busy('pelican', true);
    try {
      // Erst speichern, dann prüfen — sonst testet man gegen den alten Stand.
      await axios.post('/api/pelican/config', { url: pelicanUrl, ...(pelicanToken ? { token: pelicanToken } : {}) });
      const { data } = await axios.post('/api/pelican/test');
      setPelicanToken('');
      setPelicanHasToken(true);
      feedback('pelican', 'ok',
        `Verbunden — ${data.server} Server gefunden${data.beispiel?.length ? ': ' + data.beispiel.join(', ') + ' …' : ''}`);
    } catch (err) {
      feedback('pelican', 'err', err.response?.data?.error || 'Verbindung fehlgeschlagen');
    }
    busy('pelican', false);
  };

  const savePelican = async () => {
    busy('pelican_save', true);
    try {
      await axios.post('/api/pelican/config', { url: pelicanUrl, ...(pelicanToken ? { token: pelicanToken } : {}) });
      if (pelicanToken) setPelicanHasToken(true);
      setPelicanToken('');
      feedback('pelican', 'ok', 'Pelican-Einstellungen gespeichert');
    } catch (err) {
      feedback('pelican', 'err', err.response?.data?.error || 'Fehler beim Speichern');
    }
    busy('pelican_save', false);
  };

  const deletePelican = async () => {
    if (!confirm('Verbindung zum Pelican Panel entfernen? Die Container zeigen danach wieder ihre UUID.')) return;
    busy('pelican_del', true);
    try {
      await axios.delete('/api/pelican/config');
      setPelicanUrl(''); setPelicanToken(''); setPelicanHasToken(false);
      feedback('pelican', 'ok', 'Verbindung entfernt');
    } catch (err) {
      feedback('pelican', 'err', err.response?.data?.error || 'Fehler');
    }
    busy('pelican_del', false);
  };

  const toggleAgentAutoUpdate = async (next) => {
    setAgentAutoUpdate(next);   // sofort umschalten, das Speichern läuft nebenher
    busy('agentAutoUpdate', true);
    try {
      await axios.put('/api/settings/general', { agentAutoUpdate: next });
      feedback('agentAutoUpdate', 'ok', next
        ? 'Agenten werden beim Panel-Start automatisch aktualisiert'
        : 'Automatisches Agent-Update abgeschaltet');
    } catch (err) {
      setAgentAutoUpdate(!next);   // zurückdrehen, wenn das Speichern scheiterte
      feedback('agentAutoUpdate', 'err', err.response?.data?.error || 'Fehler beim Speichern');
    }
    busy('agentAutoUpdate', false);
  };

  const saveLiveInterval = async () => {
    const secs = Math.max(5, Math.min(300, parseInt(liveInterval, 10) || 15));
    setLiveInterval(secs);
    busy('liveInterval', true);
    try {
      await axios.put('/api/settings/general', { liveRefreshInterval: secs });
      invalidateLiveIntervalCache(); // Hook-Cache leeren → nächste Seite lädt neuen Wert
      feedback('liveInterval', 'ok', `Interval gespeichert: alle ${secs} Sekunden`);
    } catch (err) {
      feedback('liveInterval', 'err', err.response?.data?.error || 'Fehler');
    }
    busy('liveInterval', false);
  };

  const saveAgentEnv = async (agentId, envId) => {
    try {
      await axios.put('/api/dockhand/agent-env', { agentId, envId: envId || null });
      setDockhandAgents(prev => prev.map(a =>
        String(a.id) === String(agentId) ? { ...a, dockhand_env_id: envId || null } : a
      ));
    } catch (err) {
      feedback('dockhand', 'err', err.response?.data?.error || 'Fehler beim Speichern');
    }
  };

  // ── Backup & Migration Aktionen ───────────────────────────────────────────
  const handleBackupDownload = () => {
    // Öffnet den Download im gleichen Fenster
    window.location.href = '/api/system/backup';
  };

  const handleMigrationImport = async () => {
    if (!migrationFile) return;
    busy('migration', true);
    try {
      const buffer = await migrationFile.arrayBuffer();
      await axios.post('/api/system/migrate/import', buffer, {
        headers: { 'Content-Type': 'application/octet-stream' },
        timeout: 120000
      });
      feedback('migration', 'ok', 'Datenbank importiert! Lade Seite neu…');
      setTimeout(() => window.location.reload(), 3000);
    } catch (err) {
      feedback('migration', 'err', err.response?.data?.error || 'Fehler beim Import');
    }
    busy('migration', false);
  };

  const handleMigrationPush = async () => {
    if (!migrationTargetUrl || !migrationUsername || !migrationPassword) return;
    busy('migration', true);
    try {
      const { data } = await axios.post('/api/system/migrate/push', {
        targetUrl: migrationTargetUrl,
        username: migrationUsername,
        password: migrationPassword
      }, { timeout: 120000 });
      
      let extra = '';
      if (data.agents && data.agents.length > 0) {
        const okCount = data.agents.filter(a => a.success).length;
        extra = ` (${okCount}/${data.agents.length} Agents geupdatet)`;
      }
      
      feedback('migration', 'ok', (data.message || 'Erfolgreich migriert') + extra);
      setMigrationPassword('');
    } catch (err) {
      feedback('migration', 'err', err.response?.data?.error || 'Fehler bei der Migration');
    }
    busy('migration', false);
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-4">

      {/* Tab-Header (4 klare Kategorien) */}
      <div className="flex flex-wrap gap-1 bg-panel-surface border border-panel-border rounded-lg p-1">
        <button
          onClick={() => setTab('profile')}
          className={`flex-1 min-w-[140px] flex items-center justify-center gap-1.5 py-1.5 rounded-md text-sm transition-colors cursor-pointer ${
            tab === 'profile' ? 'bg-panel-card text-panel-text font-medium shadow-sm' : 'text-panel-muted hover:text-panel-text'
          }`}>
          <User size={14} />Profil & Sicherheit
        </button>
        <button
          onClick={() => setTab('general')}
          className={`flex-1 min-w-[140px] flex items-center justify-center gap-1.5 py-1.5 rounded-md text-sm transition-colors cursor-pointer ${
            tab === 'general' ? 'bg-panel-card text-panel-text font-medium shadow-sm' : 'text-panel-muted hover:text-panel-text'
          }`}>
          <Eye size={14} />Allgemein & Design
        </button>
        {isAdmin && (
          <button
            onClick={() => setTab('integrations')}
            className={`flex-1 min-w-[140px] flex items-center justify-center gap-1.5 py-1.5 rounded-md text-sm transition-colors cursor-pointer ${
              tab === 'integrations' ? 'bg-panel-card text-panel-text font-medium shadow-sm' : 'text-panel-muted hover:text-panel-text'
            }`}>
            <Cloud size={14} />Cloud & APIs
          </button>
        )}
        {(isAdmin || hasPermission('system.backup') || hasPermission('system.update')) && (
          <button
            onClick={() => setTab('system')}
            className={`flex-1 min-w-[140px] flex items-center justify-center gap-1.5 py-1.5 rounded-md text-sm transition-colors cursor-pointer ${
              tab === 'system' ? 'bg-panel-card text-panel-text font-medium shadow-sm' : 'text-panel-muted hover:text-panel-text'
            }`}>
            <Settings2 size={14} />System & Backup
          </button>
        )}
      </div>

      {/* ═══════════════════ TAB 1: PROFIL & SICHERHEIT ═══════════════════ */}
      {tab === 'profile' && (
        <div className="columns-1 lg:columns-2 gap-4 [&>*]:mb-4 [&>*]:break-inside-avoid">
          {/* ── Konto-Informationen ── */}
          <Card title={<span className="flex items-center gap-2"><User size={14} />Konto-Informationen</span>}>
            <div className="space-y-3 text-sm">
              <div className="flex items-center justify-between pb-2 border-b border-panel-border">
                <span className="text-panel-muted text-xs">Benutzername</span>
                <span className="font-medium text-panel-text">{user?.username}</span>
              </div>
              <div className="flex items-center justify-between pb-2 border-b border-panel-border">
                <span className="text-panel-muted text-xs">Rolle</span>
                <span className="font-medium text-panel-accent">{user?.roleLabel || user?.role}</span>
              </div>
              <div className="flex items-center justify-between pb-2 border-b border-panel-border">
                <span className="text-panel-muted text-xs">Registriert am</span>
                <span className="text-panel-text text-xs">
                  {user?.created_at ? new Date(user.created_at).toLocaleDateString('de-DE') : '—'}
                </span>
              </div>
              <div className="flex items-center justify-between pb-2 border-b border-panel-border">
                <span className="text-panel-muted text-xs">Letzter Login</span>
                <span className="text-panel-text text-xs">
                  {user?.last_login ? new Date(user.last_login).toLocaleString('de-DE') : 'Bisher kein Login-Eintrag'}
                </span>
              </div>
              {(user?.last_login_ip || user?.last_login_from) && (
                <div className="flex items-center justify-between">
                  <span className="text-panel-muted text-xs">Login-Standort</span>
                  <span className="text-panel-text text-xs">
                    {user?.last_login_ip || '?'}{user?.last_login_from ? ` (${user.last_login_from})` : ''}
                  </span>
                </div>
              )}
            </div>
          </Card>

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
                Wird für Passwort-Reset-E-Mails verwendet. Zum Ändern ist dein aktuelles Passwort nötig,
                da über diese Adresse das Konto wiederhergestellt werden kann.
              </p>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="deine@email.de"
                className={inputCls}
              />
              <input
                type="password"
                value={emailPw}
                onChange={e => setEmailPw(e.target.value)}
                placeholder="Aktuelles Passwort zur Bestätigung"
                className={inputCls}
                autoComplete="current-password"
                onKeyDown={e => e.key === 'Enter' && saveEmail()}
              />
              <Button onClick={saveEmail} disabled={loading.email || !emailPw} size="sm">
                E-Mail speichern
              </Button>
              <Msg msg={msgs.email} />
            </div>
          </Card>

          {/* ── Passkeys ── */}
          <Card title={<span className="flex items-center gap-2"><ShieldCheck size={14} />Passkeys (WebAuthn)</span>}>
            <div className="space-y-3">
              <p className="text-xs text-panel-muted">
                Passkeys ermöglichen passwortlosen Login per Fingerabdruck, Face ID, Hardware-Key oder Passwort-Manager.
              </p>

              {passkeys.length > 0 && (
                <div className="space-y-1.5 border border-panel-border rounded-md p-2 bg-panel-surface">
                  <p className="text-xs font-medium text-panel-text">Registrierte Passkeys ({passkeys.length})</p>
                  <div className="space-y-1">
                    {passkeys.map(pk => (
                      <div key={pk.id} className="flex items-center justify-between py-1 border-b border-panel-border/30 last:border-0">
                        <div>
                          <p className="text-xs font-medium text-panel-text">{pk.name}</p>
                          <p className="text-[10px] text-panel-muted">
                            Erstellt: {fmtDate(pk.created_at)} · {pk.device_type}
                          </p>
                        </div>
                        <button
                          onClick={() => deletePasskey(pk.id)}
                          className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded text-panel-muted hover:text-panel-red hover:bg-panel-red/10 transition-colors"
                          title="Diesen Passkey entfernen"
                        >
                          <Trash2 size={13} />Löschen
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Ohne Vorgabe wählt der Browser den Speicherort — unter Windows praktisch
                  immer Windows Hello, sodass Passwortmanager gar nicht erst erscheinen. */}
              <div>
                <label className="block text-xs font-medium text-panel-muted mb-1">Speicherort</label>
                <select
                  value={passkeyZiel}
                  onChange={e => { setPasskeyZiel(e.target.value); localStorage.setItem('panel_passkey_ziel', e.target.value); }}
                  className="w-full bg-panel-surface border border-panel-border rounded-md px-3 py-1.5 text-sm text-panel-text focus:outline-none focus:border-panel-accent"
                >
                  <option value="still">Still im Passwortmanager — ohne jeden Systemdialog (empfohlen bei Enpass)</option>
                  <option value="auto">Automatisch — der Browser entscheidet</option>
                  <option value="geraet">Auf diesem Gerät — Windows Hello, Touch ID, Fingerabdruck</option>
                  <option value="extern">Passwortmanager oder anderes Gerät — Enpass, 1Password, YubiKey, Handy</option>
                </select>
                <p className="text-[11px] text-panel-muted mt-1">
                  {passkeyZiel === 'still'
                    ? 'Dein Passwortmanager legt den Passkey selbst an — es erscheint gar kein Auswahlfenster und damit auch kein Windows Hello. Voraussetzung: Das Panel-Passwort ist in ihm gespeichert und du hast dich damit angemeldet. Klappt am zuverlässigsten kurz nach dem Anmelden.'
                    : passkeyZiel === 'extern'
                    ? (istBrave
                        ? 'In Brave meldet sich Enpass als Geräte-Anmeldung — diese Einstellung schließt es hier also gerade aus. Für Enpass in Brave „Auf diesem Gerät" wählen.'
                        : 'Die Geräte-Anmeldung wird übersprungen. Wähle im folgenden Fenster deinen Passwortmanager oder „Anderes Gerät" und scanne den QR-Code mit dem Handy.')
                    : passkeyZiel === 'geraet'
                      ? (istBrave
                          ? 'In Brave ist das die richtige Wahl für Enpass: Der Passwortmanager meldet sich hier als Geräte-Anmeldung. Windows Hello steht im selben Dialog zur Auswahl.'
                          : 'Der Passkey bleibt auf diesem Gerät und lässt sich nicht auf andere übertragen.')
                      : 'Welche Einstellung deinen Passwortmanager anbietet, hängt vom Browser ab — in Chrome und Edge „Passwortmanager oder anderes Gerät", in Brave dagegen „Auf diesem Gerät".'}
                </p>

                {/* Bekannte Einschränkung, damit vergebliche Versuche nicht wie ein
                    Panel-Fehler aussehen: Brave übergibt WebAuthn unter Windows an das
                    System, das dann seinen eigenen Dialog zeigt und den Passwortmanager
                    übergeht (offener Brave-Fehler #37762). */}
                {istBrave && passkeyZiel !== 'still' && (
                  <p className="text-[11px] text-panel-orange mt-1.5 flex items-start gap-1.5">
                    <AlertTriangle size={11} className="flex-shrink-0 mt-0.5" />
                    <span>
                      Brave erkannt. Erscheint trotz passender Einstellung immer der Windows-Dialog,
                      liegt das an einem bekannten Brave-Fehler und nicht am Panel. Zwei Auswege:
                      den Passkey in Chrome oder Edge anlegen, oder im Windows-Dialog
                      „Anderes Gerät" wählen und den QR-Code mit dem Handy scannen — dort speichert
                      Enpass ihn, und über die Synchronisierung steht er auch am Rechner zur Verfügung.
                    </span>
                  </p>
                )}
              </div>

              <div className="flex gap-2">
                <input
                  type="text"
                  value={passkeyName}
                  onChange={e => setPasskeyName(e.target.value)}
                  placeholder="Name (z.B. iPhone, YubiKey, Enpass)"
                  className="flex-1 bg-panel-surface border border-panel-border rounded-md px-3 py-1.5 text-sm text-panel-text focus:outline-none focus:border-panel-accent"
                />
                <Button onClick={registerPasskey} disabled={loading.passkey} size="sm">
                  {loading.passkey ? '…' : '+ Passkey registrieren'}
                </Button>
              </div>
              <Msg msg={msgs.passkey} />
            </div>
          </Card>

          {/* ── 2FA ── */}
          <Card title={<span className="flex items-center gap-2"><ShieldAlert size={14} />Zwei-Faktor-Authentifizierung (2FA)</span>}>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-xs text-panel-muted">Aktueller Status:</span>
                <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                  twoFaStatus.twofa_type !== 'none'
                    ? 'bg-emerald-500/10 text-emerald-500 border border-emerald-500/30'
                    : 'bg-panel-border/40 text-panel-muted border border-panel-border'
                }`}>
                  {twoFaStatus.twofa_type === 'email' ? 'Aktiv (E-Mail)' :
                   twoFaStatus.twofa_type === 'totp' ? 'Aktiv (Authenticator-App)' : 'Deaktiviert'}
                </span>
              </div>

              {twoFaStatus.twofa_type === 'none' && !twoFaSetup && (
                <div className="space-y-3 pt-1">
                  <p className="text-xs text-panel-muted leading-relaxed">
                    Schütze dein Konto zusätzlich durch eine 6-stellige PIN-Abfrage bei jeder Anmeldung.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Button onClick={() => start2faSetup('totp')} disabled={loading.twofa} size="sm">
                      <QrCode size={13} className="mr-1.5" />
                      Mit App einrichten (TOTP)
                    </Button>
                    <Button onClick={() => start2faSetup('email')} disabled={loading.twofa} size="sm" variant="secondary">
                      <Mail size={13} className="mr-1.5" />
                      Mit E-Mail einrichten
                    </Button>
                  </div>
                </div>
              )}

              {twoFaSetup && (
                <div className="space-y-4 rounded-lg border border-panel-border bg-panel-surface/50 p-3.5">
                  {twoFaSetup.type === 'totp' ? (
                    <div className="space-y-3">
                      <p className="text-xs font-medium text-panel-text">1. QR-Code mit Authenticator-App scannen:</p>
                      <div className="flex justify-center bg-white p-3 rounded-lg shadow-sm border border-panel-border/20 w-fit mx-auto">
                        <div className="w-40 h-40" dangerouslySetInnerHTML={{ __html: twoFaSetup.qrSvg }} />
                      </div>
                      <div className="text-center">
                        <span className="text-[11px] text-panel-muted block mb-1">Oder manuellen Sicherheitsschlüssel eingeben:</span>
                        <div className="inline-flex items-center gap-1.5 bg-panel-card border border-panel-border rounded px-2.5 py-1">
                          <code className="text-xs font-mono font-semibold tracking-wider text-panel-accent select-all">
                            {twoFaSetup.secret}
                          </code>
                          <button
                            type="button"
                            onClick={() => {
                              navigator.clipboard.writeText(twoFaSetup.secret);
                              setCopied2FA(true);
                              setTimeout(() => setCopied2FA(false), 2000);
                            }}
                            className="text-panel-muted hover:text-panel-text transition-colors p-0.5"
                            title="Geheimsymbol kopieren"
                          >
                            {copied2FA ? <Check size={13} className="text-emerald-500" /> : <Copy size={13} />}
                          </button>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-1.5">
                      <p className="text-xs font-medium text-panel-text">1. Bestätigungscode prüfen</p>
                      <p className="text-xs text-panel-muted leading-relaxed">
                        Wir haben dir einen 6-stelligen Code an <span className="text-panel-text font-medium">{email}</span> gesendet.
                      </p>
                    </div>
                  )}

                  <div className="space-y-2 pt-1 border-t border-panel-border/50">
                    <label className="block text-xs font-medium text-panel-text">
                      {twoFaSetup.type === 'totp' ? '2. 6-stelligen Code eingeben:' : '2. E-Mail Code eingeben:'}
                    </label>
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        value={twoFaCode}
                        onChange={e => setTwoFaCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                        placeholder="123456"
                        maxLength={6}
                        className="w-32 bg-panel-card border border-panel-border rounded-md px-3 py-1.5 text-center text-sm font-mono tracking-widest text-panel-text focus:outline-none focus:border-panel-accent"
                      />
                      <Button onClick={enable2fa} disabled={loading.twofa || twoFaCode.length !== 6} size="sm">
                        Aktivieren
                      </Button>
                      <Button onClick={() => { setTwoFaSetup(null); setTwoFaCode(''); }} variant="secondary" size="sm">
                        Abbrechen
                      </Button>
                    </div>
                  </div>
                </div>
              )}

              {twoFaStatus.twofa_type !== 'none' && (
                <div className="space-y-3 pt-2 border-t border-panel-border/40">
                  <p className="text-xs text-panel-muted">
                    Um die Zwei-Faktor-Authentifizierung zu deaktivieren, bestätige bitte dein aktuelles Passwort:
                  </p>
                  <div className="flex items-center gap-2">
                    <input
                      type="password"
                      value={twoFaPw}
                      onChange={e => setTwoFaPw(e.target.value)}
                      placeholder="Passwort"
                      className="flex-1 bg-panel-surface border border-panel-border rounded-md px-3 py-1.5 text-sm text-panel-text focus:outline-none focus:border-panel-accent"
                    />
                    <Button onClick={disable2fa} disabled={loading.twofa || !twoFaPw} size="sm" variant="danger">
                      2FA Deaktivieren
                    </Button>
                  </div>
                </div>
              )}

              <Msg msg={msgs.twofa} />
            </div>
          </Card>

          {/* ── Aktive Sitzungen ── */}
          <SessionsSection isAdmin={isAdmin} />
        </div>
      )}

      {/* ═══════════════════ TAB 2: ALLGEMEIN & DESIGN ═══════════════════ */}
      {tab === 'general' && (
        <div className="columns-1 lg:columns-2 gap-4 [&>*]:mb-4 [&>*]:break-inside-avoid">
          {/* ── Darstellung & Design ── */}
          <Card title={<span className="flex items-center gap-2"><Eye size={14} />Darstellung & Design</span>}>
            <PrideFlagToggleCard />
          </Card>

          {isAdmin && (
            <>
              {/* ── Aktive Module & Funktionen ── */}
              <Card title={<span className="flex items-center gap-2"><Layers size={14} />Aktive Module</span>}>
                <ModulesToggleCard />
              </Card>

              {/* ── Benachrichtigungen ── */}
              <Card title={<span className="flex items-center gap-2"><Bell size={14} />Benachrichtigungen</span>}>
                <ActionNotificationsToggle />
              </Card>

              {/* ── Live-Refresh-Intervall ── */}
              <Card title={<span className="flex items-center gap-2"><Timer size={14} />Live-Refresh-Intervall</span>}>
                <div className="space-y-3">
                  <p className="text-xs text-panel-muted">
                    Wie oft Agent-Detail- und Dashboard-Seiten automatisch aktualisieren (5–300 Sekunden).
                  </p>
                  <div className="flex items-center gap-3">
                    <input
                      type="number"
                      min={5}
                      max={300}
                      value={liveInterval}
                      onChange={e => setLiveInterval(e.target.value)}
                      onBlur={() => setLiveInterval(v => Math.max(5, Math.min(300, parseInt(v, 10) || 15)))}
                      className={inputCls + ' w-28'}
                    />
                    <span className="text-sm text-panel-muted">Sekunden</span>
                  </div>
                  <Button onClick={saveLiveInterval} disabled={loading.liveInterval} size="sm">
                    Speichern
                  </Button>
                  <Msg msg={msgs.liveInterval} />
                </div>
              </Card>

              {/* ── Automatisches Agent-Update ── */}
              <Card title={<span className="flex items-center gap-2"><ArrowUpCircle size={14} />Agent-Updates</span>}>
                <div className="space-y-3">
                  <p className="text-xs text-panel-muted leading-relaxed">
                    Jedes Panel-Update bringt das passende Agent-Script mit. Ist der Schalter an,
                    verteilt das Panel es nach jedem Start automatisch an alle Server, auf denen eine
                    ältere Fassung läuft — signiert und über dieselbe gesicherte Verbindung wie der
                    Knopf „Agent aktualisieren".
                  </p>
                  <label className="flex items-start gap-3 cursor-pointer group">
                    <input
                      type="checkbox"
                      checked={agentAutoUpdate}
                      onChange={e => toggleAgentAutoUpdate(e.target.checked)}
                      disabled={loading.agentAutoUpdate}
                      className="accent-panel-accent w-4 h-4 mt-0.5"
                    />
                    <span className="text-sm text-panel-text group-hover:text-white transition-colors">
                      Agenten beim Panel-Start automatisch aktualisieren
                      <span className="block text-[11px] text-panel-muted mt-0.5">
                        Nicht erreichbare Server werden übersprungen und beim nächsten Start erneut versucht.
                        Antwortet ein Server nach seinem Update nicht mehr, stoppt der Vorgang — die
                        übrigen bleiben dann auf ihrem bisherigen Stand.
                      </span>
                    </span>
                  </label>
                  <Msg msg={msgs.agentAutoUpdate} />
                </div>
              </Card>
            </>
          )}
        </div>
      )}

      {/* ═══════════════════ TAB 3: CLOUD & APIS (Admin) ═══════════════════ */}
      {tab === 'integrations' && isAdmin && (
        <div className="columns-1 lg:columns-2 gap-4 [&>*]:mb-4 [&>*]:break-inside-avoid">
          {/* ── Hosting & Cloud APIs (Hetzner & MC-Host24) ── */}
          <Card title={<span className="flex items-center gap-2"><Cloud size={14} />Hosting & Cloud APIs (Hetzner & MC-Host24)</span>}>
            <div className="space-y-6">
              {/* Hetzner Cloud API */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-panel-text flex items-center gap-1.5">
                    <Cloud size={13} className="text-panel-accent" /> Hetzner Cloud API
                  </span>
                  <div className="flex items-center gap-2">
                    <StatusBadge set={!!status.hetzner_api_token} />
                    {status.hetzner_api_token && (
                      <Button size="sm" variant="danger" onClick={deleteHetzner} disabled={loading.hetzner_del}>
                        <Trash2 size={12} className="mr-1" />Entfernen
                      </Button>
                    )}
                  </div>
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
                <Button onClick={saveHetzner} disabled={!hetznerToken.trim() || loading.hetzner} size="sm">Speichern</Button>
                <Msg msg={msgs.hetzner} />
              </div>

              {/* Trennlinie */}
              <div className="border-t border-panel-border/60" />

              {/* MC-Host24 API */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-panel-text flex items-center gap-1.5">
                    <Server size={13} className="text-panel-accent" /> MC-Host24 API
                  </span>
                  <div className="flex items-center gap-2">
                    <StatusBadge set={status.mchost_token_set} />
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
                  <label className="block text-xs text-panel-muted mb-1">E-Mail-Adresse</label>
                  <input type="email" value={mcUsername} onChange={e => setMcUsername(e.target.value)}
                    placeholder="deine@email.de" className={inputCls} />
                  <p className="text-xs text-panel-muted mt-1">
                    Verwende deine MC-Host24 <strong>Login-E-Mail</strong>, nicht deinen Anzeigenamen.
                  </p>
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
            </div>
          </Card>

          {/* ── Dockhand ── */}
          <Card title={<span className="flex items-center gap-2"><Layers size={14} />Dockhand Docker-Management</span>}>
            <div className="space-y-3">
              <p className="text-xs text-panel-muted">
                Verbindet das Panel mit einer laufenden Dockhand-Instanz. Der API-Token wird unter
                Dockhand → Settings → Authentication → API Tokens generiert.
              </p>

              <div>
                <label className="block text-xs text-panel-muted mb-1">Docker Verwaltung (Remote-Server)</label>
                <select
                  value={dockerEngine}
                  onChange={e => {
                    const v = e.target.value;
                    setDockerEngine(v);
                    axios.post('/api/dockhand/config', { dockerEngine: v }).catch(() => {});
                  }}
                  className="w-full bg-panel-surface border border-panel-border rounded px-3 py-2 text-sm text-panel-text focus:outline-none focus:border-panel-accent"
                >
                  <option value="agents">Direkt via Agent (Nativ)</option>
                  <option value="mixed">Nativ & Dockhand Pro (Mixed)</option>
                  <option value="dockhand">Dockhand Pro (Legacy)</option>
                </select>
                <p className="text-[11px] text-panel-muted mt-1">
                  Gilt für Container-Daten und -Aktionen. Die Container-Konsole läuft
                  davon unabhängig <strong>immer nativ über den Panel-Agent</strong> —
                  auch im Dockhand-Modus.
                </p>
              </div>

              <div>
                <label className="block text-xs text-panel-muted mb-1">Dockhand URL</label>
                <input
                  value={dockhandUrl}
                  onChange={e => setDockhandUrl(e.target.value)}
                  placeholder="http://localhost:3000"
                  className={inputCls}
                />
              </div>

              <div>
                <label className="block text-xs text-panel-muted mb-1">
                  API-Token {status.dockhandHasToken && <span className="text-panel-green">(gesetzt)</span>}
                </label>
                <div className="relative">
                  <input
                    type={showDockhandToken ? 'text' : 'password'}
                    value={dockhandToken}
                    onChange={e => setDockhandToken(e.target.value)}
                    placeholder={status.dockhandHasToken ? '(gesetzt — leer lassen = behalten)' : 'dh_xxxxxxxx…'}
                    className={inputCls + ' pr-9'}
                  />
                  <button type="button" onClick={() => setShowDockhandToken(v => !v)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-panel-muted hover:text-panel-text">
                    {showDockhandToken ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
              </div>

              <div className="flex gap-2">
                <Button onClick={testDockhand} disabled={!dockhandUrl || loading.dockhand} size="sm" variant="ghost">
                  <RefreshCw size={12} className="mr-1" />Verbindung testen
                </Button>
                <Button onClick={saveDockhand} disabled={!dockhandUrl || loading.dockhand_save} size="sm">
                  Speichern
                </Button>
              </div>

              {dockhandEnvs.length > 0 && (
                <div className="border border-panel-border rounded-md overflow-hidden mt-1">
                  <div className="bg-panel-surface px-3 py-1.5 text-xs font-medium text-panel-muted border-b border-panel-border">
                    Environment-Zuweisung
                  </div>
                  <div className="divide-y divide-panel-border">
                    <div className="flex items-center justify-between px-3 py-2">
                      <span className="text-xs text-panel-text">Lokaler Panel-Server</span>
                      <select
                        value={dockhandEnvId}
                        onChange={e => {
                          const v = e.target.value;
                          setDockhandEnvId(v);
                          axios.post('/api/dockhand/config', { localEnvId: v }).catch(() => {});
                        }}
                        className="bg-panel-surface border border-panel-border rounded px-2 py-1 text-xs text-panel-text focus:outline-none focus:border-panel-accent">
                        <option value="">— nicht zugewiesen —</option>
                        {dockhandEnvs.map(e => (
                          <option key={e.id} value={e.id}>{e.name}</option>
                        ))}
                      </select>
                    </div>
                    {dockhandAgents.map(agent => (
                      <div key={agent.id} className="flex items-center justify-between px-3 py-2">
                        <span className="text-xs text-panel-text">{agent.name}</span>
                        <select
                          value={agent.dockhand_env_id ?? ''}
                          onChange={e => saveAgentEnv(agent.id, e.target.value)}
                          className="bg-panel-surface border border-panel-border rounded px-2 py-1 text-xs text-panel-text focus:outline-none focus:border-panel-accent">
                          <option value="">— nicht zugewiesen —</option>
                          {dockhandEnvs.map(e => (
                            <option key={e.id} value={e.id}>{e.name}</option>
                          ))}
                        </select>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <Msg msg={msgs.dockhand} />
            </div>
          </Card>

          {/* ── Pelican Panel (Gameserver-Namen) ── */}
          <Card title={<span className="flex items-center gap-2"><Gamepad2 size={14} />Pelican Panel</span>}>
            <div className="space-y-3">
              <p className="text-xs text-panel-muted leading-relaxed">
                Server aus dem Pelican Panel laufen als Container, deren Name die Server-UUID ist
                (<code className="font-mono text-panel-text">6d3bdebc-ded6-…</code>). Ist die Verbindung
                eingerichtet, zeigt die Docker-Seite stattdessen den Klarnamen — die UUID bleibt klein
                daneben stehen und im Hintergrund unverändert. Es wird ausschließlich gelesen.
              </p>

              <div>
                <label className="block text-xs text-panel-muted mb-1">Adresse des Pelican Panels</label>
                <input
                  value={pelicanUrl}
                  onChange={e => setPelicanUrl(e.target.value)}
                  placeholder="https://panel.beispiel.de"
                  className={inputCls}
                />
              </div>

              <div>
                <label className="block text-xs text-panel-muted mb-1">
                  API-Schlüssel {pelicanHasToken && <span className="text-panel-green">(gesetzt)</span>}
                </label>
                <div className="relative">
                  <input
                    type={showPelicanToken ? 'text' : 'password'}
                    value={pelicanToken}
                    onChange={e => setPelicanToken(e.target.value)}
                    placeholder={pelicanHasToken ? '(gesetzt — leer lassen = behalten)' : 'peli_…'}
                    className={inputCls + ' pr-9'}
                  />
                  <button type="button" onClick={() => setShowPelicanToken(v => !v)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-panel-muted hover:text-panel-text transition-colors">
                    {showPelicanToken ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
                <p className="text-[11px] text-panel-muted mt-1">
                  Im Pelican Panel unter <span className="text-panel-text">Admin → API Credentials</span>
                  {' '}erzeugen (Typ „Application", Leserecht auf Server genügt).
                </p>
              </div>

              <div className="flex gap-2">
                <Button onClick={testPelican} disabled={!pelicanUrl || loading.pelican} size="sm" variant="ghost">
                  {loading.pelican ? 'Prüfe…' : 'Testen'}
                </Button>
                <Button onClick={savePelican} disabled={!pelicanUrl || loading.pelican_save} size="sm">
                  Speichern
                </Button>
                {pelicanHasToken && (
                  <Button onClick={deletePelican} disabled={loading.pelican_del} size="sm" variant="ghost"
                    className="text-panel-red hover:border-panel-red/40">
                    <Trash2 size={12} />Verbindung entfernen
                  </Button>
                )}
              </div>

              <Msg msg={msgs.pelican} />
            </div>
          </Card>

          {/* ── PatchMon-Server-Verknüpfung ── */}
          <Card title={<span className="flex items-center gap-2"><PackageCheck size={14} />PatchMon-Server-Verknüpfung</span>}>
            <div className="space-y-3">
              <p className="text-xs text-panel-muted">
                Ordne jedem Panel-Server den passenden PatchMon-Host zu. Dann erscheinen Update-Infos am Server und PatchMon-Alerts funktionieren (inkl. lokalem Server).
              </p>
              {pmHosts.length === 0 ? (
                <p className="text-xs text-panel-muted">
                  Keine PatchMon-Hosts geladen — zuerst unter „PatchMon" die Verbindung einrichten.
                </p>
              ) : (
                <div className="border border-panel-border rounded-md overflow-hidden">
                  <div className="divide-y divide-panel-border">
                    <div className="flex items-center justify-between px-3 py-2 gap-2">
                      <span className="text-xs text-panel-text truncate">Lokaler Panel-Server</span>
                      <select
                        value={pmLocalHostId}
                        onChange={e => saveLocalPm(e.target.value)}
                        className="bg-panel-surface border border-panel-border rounded px-2 py-1 text-xs text-panel-text focus:outline-none focus:border-panel-accent max-w-[60%]">
                        <option value="">— nicht verknüpft —</option>
                        {pmHosts.map(h => <option key={h.id} value={h.id}>{h.name}{h.ip ? ` · ${h.ip}` : ''}</option>)}
                      </select>
                    </div>
                    {pmAgents.map(a => (
                      <div key={a.id} className="flex items-center justify-between px-3 py-2 gap-2">
                        <span className="text-xs text-panel-text truncate">{a.name}</span>
                        <select
                          value={a.patchmon_host_id ?? ''}
                          onChange={e => saveAgentPm(a.id, e.target.value)}
                          className="bg-panel-surface border border-panel-border rounded px-2 py-1 text-xs text-panel-text focus:outline-none focus:border-panel-accent max-w-[60%]">
                          <option value="">— nicht verknüpft —</option>
                          {pmHosts.map(h => <option key={h.id} value={h.id}>{h.name}{h.ip ? ` · ${h.ip}` : ''}</option>)}
                        </select>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </Card>
        </div>
      )}

      {/* ═══════════════════ TAB 4: SYSTEM & BACKUP (Admin) ═══════════════════ */}
      {tab === 'system' && (isAdmin || hasPermission('system.backup') || hasPermission('system.update')) && (
        <div className="columns-1 lg:columns-2 gap-4 [&>*]:mb-4 [&>*]:break-inside-avoid">
          {/* ── GitHub Update-Token ── */}
          <GitHubTokenCard status={status} onReload={loadAdmin} />

          {/* ── SMTP-Server (E-Mail) ── */}
          {isAdmin && (
            <Card title={<span className="flex items-center gap-2"><Send size={14} />SMTP-Server (E-Mail-Versand)</span>}>
              <div className="space-y-3">
                <p className="text-xs text-panel-muted mb-2">
                  Wird benötigt, um Passwort-Reset-Links und E-Mail-Bestätigungscodes für 2FA zu versenden.
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-xs text-panel-muted mb-1">SMTP-Host</label>
                    <input type="text" value={smtp.host} onChange={e => setSmtp(s => ({ ...s, host: e.target.value }))} placeholder="smtp.beispiel.de" className={inputCls} />
                  </div>
                  <div>
                    <label className="block text-xs text-panel-muted mb-1">Port</label>
                    <input type="number" value={smtp.port} onChange={e => setSmtp(s => ({ ...s, port: Number(e.target.value) }))} placeholder="587" className={inputCls} />
                  </div>
                </div>
                <div>
                  <label className="block text-xs text-panel-muted mb-1">Absender-E-Mail (From)</label>
                  <input type="email" value={smtp.from} onChange={e => setSmtp(s => ({ ...s, from: e.target.value }))} placeholder="noreply@beispiel.de" className={inputCls} />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-xs text-panel-muted mb-1">Benutzername (User)</label>
                    <input type="text" value={smtp.user} onChange={e => setSmtp(s => ({ ...s, user: e.target.value }))} placeholder="postmaster@beispiel.de" className={inputCls} />
                  </div>
                  <div>
                    <label className="block text-xs text-panel-muted mb-1">Passwort</label>
                    <div className="relative">
                      <input
                        type={showSmtpPw ? 'text' : 'password'}
                        value={smtp.pass}
                        onChange={e => setSmtp(s => ({ ...s, pass: e.target.value }))}
                        placeholder={status.smtp_pass ? '(Gesetzt)' : '••••••••'}
                        className={inputCls + ' pr-9'}
                      />
                      <button type="button" onClick={() => setShowSmtpPw(v => !v)}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-panel-muted hover:text-panel-text">
                        {showSmtpPw ? <EyeOff size={14} /> : <Eye size={14} />}
                      </button>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2 mt-1">
                  <input
                    type="checkbox"
                    id="smtpSecure"
                    checked={smtp.secure}
                    onChange={e => setSmtp(s => ({ ...s, secure: e.target.checked }))}
                    className="rounded border-panel-border bg-panel-surface text-panel-accent focus:ring-panel-accent/50"
                  />
                  <label htmlFor="smtpSecure" className="text-xs text-panel-text cursor-pointer">
                    SSL/TLS Verbindung (Secure / Port 465) erzwingen
                  </label>
                </div>
                <div className="flex gap-2 pt-1">
                  <Button onClick={saveSmtp} disabled={loading.smtp || !smtp.host} size="sm">
                    Speichern
                  </Button>
                  <Button onClick={testSmtp} disabled={loading.smtp_test || !smtp.host} size="sm" variant="ghost">
                    <Send size={12} className="mr-1" /> Test-Mail senden
                  </Button>
                </div>
                <Msg msg={msgs.smtp} />
              </div>
            </Card>
          )}

          {/* ── SQLite Backup Manager (Modul 1) ── */}
          {hasPermission('system.backup') && <BackupManagerCard />}

          {/* ── System-Migration & Backup ── */}
          {hasPermission('system.backup') && (
            <Card title={<span className="flex items-center gap-2"><Database size={14} />Backup & Migration</span>}>
              <div className="space-y-4">
                <div className="pb-3 border-b border-panel-border">
                  <p className="text-xs text-panel-muted mb-2">Erstelle ein komplettes Backup der aktuellen Datenbank (inkl. User, Einstellungen, Server).</p>
                  <Button onClick={handleBackupDownload} size="sm" variant="ghost">
                    <Download size={13} className="mr-1" /> Backup herunterladen
                  </Button>
                </div>
                
                <div>
                  <p className="text-sm font-medium text-panel-text mb-2">Migration auf einen anderen Server</p>
                  
                  <div className="flex gap-1 bg-panel-surface border border-panel-border rounded-lg p-1 mb-3">
                    <button onClick={() => setMigrationTab('send')}
                      className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md text-xs transition-colors ${migrationTab === 'send' ? 'bg-panel-card text-panel-text font-medium' : 'text-panel-muted hover:text-panel-text'}`}>
                      <Upload size={12} /> Senden (Export)
                    </button>
                    <button onClick={() => setMigrationTab('receive')}
                      className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md text-xs transition-colors ${migrationTab === 'receive' ? 'bg-panel-card text-panel-text font-medium' : 'text-panel-muted hover:text-panel-text'}`}>
                      <Download size={12} /> Empfangen (Import)
                    </button>
                  </div>

                  {migrationTab === 'send' && (
                    <div className="space-y-3 p-3 bg-panel-surface rounded-md border border-panel-border">
                      <p className="text-[11px] text-panel-muted leading-relaxed">
                        Kopiert die gesamte Datenbank auf ein neues, frisches Panel. Loggt sich dort ein, überträgt die Daten und updated alle angebundenen Agents auf die neue Adresse.
                      </p>
                      <div>
                        <label className="block text-[11px] text-panel-muted mb-1">Neue API-Adresse (Ziel-Panel)</label>
                        <input type="url" value={migrationTargetUrl} onChange={e => setMigrationTargetUrl(e.target.value)} placeholder="https://neu.example.com" className={inputCls} />
                      </div>
                      <div>
                        <label className="block text-[11px] text-panel-muted mb-1">Admin-Benutzername (Ziel-Panel)</label>
                        <input type="text" value={migrationUsername} onChange={e => setMigrationUsername(e.target.value)} placeholder="Admin" className={inputCls} />
                      </div>
                      <div>
                        <label className="block text-[11px] text-panel-muted mb-1">Admin-Passwort (Ziel-Panel)</label>
                        <input type="password" value={migrationPassword} onChange={e => setMigrationPassword(e.target.value)} placeholder="••••••••" className={inputCls} />
                      </div>
                      <Button onClick={handleMigrationPush} disabled={!migrationTargetUrl || !migrationUsername || !migrationPassword || loading.migration} size="sm">
                        {loading.migration ? 'Migriere...' : 'Migration starten'}
                      </Button>
                    </div>
                  )}

                  {migrationTab === 'receive' && (
                    <div className="space-y-3 p-3 bg-panel-surface rounded-md border border-panel-border">
                      <p className="text-[11px] text-panel-muted leading-relaxed">
                        Lade ein Datenbank-Backup (`.db`) hoch, um dieses Panel mit einem alten Stand zu überschreiben. **Der Server startet danach neu!**
                      </p>
                      <input type="file" accept=".db,application/octet-stream" onChange={e => setMigrationFile(e.target.files[0])} className="text-xs text-panel-text file:mr-2 file:py-1 file:px-2 file:rounded file:border-0 file:text-xs file:font-semibold file:bg-panel-accent/10 file:text-panel-accent hover:file:bg-panel-accent/20" />
                      <Button onClick={handleMigrationImport} disabled={!migrationFile || loading.migration} size="sm" variant="danger">
                        {loading.migration ? 'Importiere...' : 'Backup importieren & überschreiben'}
                      </Button>
                    </div>
                  )}
                  
                  <Msg msg={msgs.migration} />
                </div>
              </div>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
