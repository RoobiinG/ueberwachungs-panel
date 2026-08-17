import { useEffect, useState } from 'react';
import axios from 'axios';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { ActionMenu } from '../components/ui/ActionMenu';
import {
  RefreshCw, Play, Square, PowerOff, RotateCcw, HardDrive,
  ChevronDown, ChevronUp, Plus, Tag, X, Copy, Check,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';

const statusColor = (s) => {
  if (!s) return 'gray';
  const str = String(s).toLowerCase();
  if (str.includes('running') || str.includes('on')) return 'green';
  if (str.includes('stop') || str.includes('off')) return 'red';
  return 'orange';
};

const TAG_COLORS = {
  blue:   'bg-blue-500/15 text-blue-400 border-blue-500/30',
  green:  'bg-green-500/15 text-green-400 border-green-500/30',
  red:    'bg-red-500/15 text-red-400 border-red-500/30',
  orange: 'bg-orange-500/15 text-orange-400 border-orange-500/30',
  purple: 'bg-purple-500/15 text-purple-400 border-purple-500/30',
  gray:   'bg-panel-card text-panel-muted border-panel-border',
};

// ─── Laufzeit-Formatierung ─────────────────────────────────────────────────────
function formatRuntime(expireTimestamp) {
  if (!expireTimestamp) return '';
  const expireSec = expireTimestamp > 1e11 ? Math.floor(expireTimestamp / 1000) : expireTimestamp;
  const nowSec = Math.floor(Date.now() / 1000);
  const diffSec = expireSec - nowSec;
  if (diffSec <= 0) return 'Abgelaufen';
  const days = Math.floor(diffSec / 86400);
  const hours = Math.floor((diffSec % 86400) / 3600);
  if (days > 0) return `noch ${days} T., ${hours} Std.`;
  const mins = Math.floor((diffSec % 3600) / 60);
  return `noch ${hours} Std., ${mins} Min.`;
}

// ─── Tag-Chip ──────────────────────────────────────────────────────────────────
function TagChip({ tag, color, onRemove }) {
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border font-medium ${TAG_COLORS[color] ?? TAG_COLORS.gray}`}>
      {tag}
      {onRemove && (
        <button onClick={onRemove} className="opacity-60 hover:opacity-100 transition-opacity leading-none">
          <X size={9} />
        </button>
      )}
    </span>
  );
}

// ─── Tag-Hinzufügen-Popup ─────────────────────────────────────────────────────
function AddTagPopup({ serverId, onAdded, onClose }) {
  const [tag, setTag] = useState('');
  const [color, setColor] = useState('blue');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const save = async () => {
    if (!tag.trim()) return;
    setSaving(true);
    setErr('');
    try {
      await axios.post(`/api/mchost/vserver/${serverId}/tags`, { tag: tag.trim(), color });
      onAdded();
      onClose();
    } catch (e) {
      setErr(e.response?.data?.error || 'Fehler');
      setSaving(false);
    }
  };

  return (
    <div className="mt-1 p-2 bg-panel-card border border-panel-border rounded-md space-y-2 w-56 shadow-lg">
      <input
        autoFocus
        value={tag}
        onChange={e => setTag(e.target.value)}
        onKeyDown={e => e.key === 'Enter' && save()}
        placeholder="Tag-Name"
        maxLength={32}
        className="w-full bg-panel-surface border border-panel-border rounded px-2 py-1 text-xs text-panel-text focus:border-panel-accent outline-none"
      />
      <div className="flex gap-1">
        {Object.keys(TAG_COLORS).map(c => (
          <button
            key={c}
            onClick={() => setColor(c)}
            className={`w-4 h-4 rounded-full border-2 transition-all ${
              c === 'blue' ? 'bg-blue-500' : c === 'green' ? 'bg-green-500' : c === 'red' ? 'bg-red-500' :
              c === 'orange' ? 'bg-orange-500' : c === 'purple' ? 'bg-purple-500' : 'bg-panel-muted'
            } ${color === c ? 'border-white scale-110' : 'border-transparent'}`}
          />
        ))}
      </div>
      {err && <p className="text-[10px] text-panel-red">{err}</p>}
      <div className="flex gap-1">
        <Button size="sm" variant="primary" onClick={save} disabled={saving || !tag.trim()} className="flex-1">Hinzufügen</Button>
        <Button size="sm" variant="ghost" onClick={onClose}>Abbrechen</Button>
      </div>
    </div>
  );
}

// ─── Haupt-Komponente ─────────────────────────────────────────────────────────
export default function MCHost() {
  const { hasPermission, isAdmin } = useAuth();
  const canView    = isAdmin || hasPermission('mchost.view');
  const canStart   = isAdmin || hasPermission('mchost.start');
  const canStop    = isAdmin || hasPermission('mchost.stop');
  const canRestart = isAdmin || hasPermission('mchost.restart');
  const canBackup  = isAdmin || hasPermission('mchost.backup');

  const [servers, setServers]           = useState([]);
  const [loading, setLoading]           = useState(true);
  const [error, setError]               = useState('');
  const [actError, setActError]         = useState('');
  const [busy, setBusy]                 = useState({});
  const [expanded, setExpanded]         = useState({});
  const [backups, setBackups]           = useState({});
  const [backupLoading, setBackupLoading] = useState({});
  const [addTagFor, setAddTagFor]       = useState(null);  // VServer-ID
  const [copied, setCopied]             = useState({});

  const copyIp = (id, ip) => {
    if (!ip) return;
    navigator.clipboard.writeText(ip);
    setCopied(prev => ({ ...prev, [id]: true }));
    setTimeout(() => setCopied(prev => ({ ...prev, [id]: false })), 2000);
  };

  const load = async () => {
    if (!canView) { setLoading(false); return; }
    setLoading(true);
    setError('');
    try {
      const { data } = await axios.get('/api/mchost/vserver');
      setServers(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(err.response?.data?.error || 'MCHOST_API_TOKEN nicht konfiguriert');
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const act = async (id, action) => {
    setActError('');
    setBusy(b => ({ ...b, [`${id}_${action}`]: true }));
    try { await axios.post(`/api/mchost/vserver/${id}/${action}`); setTimeout(load, 1500); }
    catch (err) { setActError(err.response?.data?.error || `Aktion "${action}" fehlgeschlagen`); }
    setBusy(b => ({ ...b, [`${id}_${action}`]: false }));
  };

  const toggleBackups = async (id) => {
    const isOpen = expanded[id];
    setExpanded(e => ({ ...e, [id]: !isOpen }));
    if (!isOpen && !backups[id]) {
      try {
        const { data } = await axios.get(`/api/mchost/vserver/${id}/backups`);
        const list = Array.isArray(data) ? data : Array.isArray(data?.data) ? data.data : [];
        setBackups(b => ({ ...b, [id]: list }));
      } catch { setBackups(b => ({ ...b, [id]: [] })); }
    }
  };

  const createBackup = async (id) => {
    if (!canBackup) return;
    setActError('');
    setBackupLoading(b => ({ ...b, [id]: true }));
    try {
      await axios.post(`/api/mchost/vserver/${id}/backups`);
      const { data } = await axios.get(`/api/mchost/vserver/${id}/backups`);
      const list = Array.isArray(data) ? data : Array.isArray(data?.data) ? data.data : [];
      setBackups(b => ({ ...b, [id]: list }));
    } catch (err) {
      setActError(err.response?.data?.error || 'Backup-Erstellung fehlgeschlagen');
    }
    setBackupLoading(b => ({ ...b, [id]: false }));
  };

  const removeTag = async (serverId, tag) => {
    try {
      await axios.delete(`/api/mchost/vserver/${serverId}/tags/${encodeURIComponent(tag)}`);
      setServers(prev => prev.map(s =>
        String(s.id) === String(serverId)
          ? { ...s, tags: (s.tags || []).filter(t => t.tag !== tag) }
          : s
      ));
    } catch { /* ignorieren */ }
  };

  if (!canView) {
    return (
      <div className="bg-panel-orange/10 border border-panel-orange/30 text-panel-orange text-sm rounded-md px-4 py-3">
        Du hast keine Berechtigung, MC-Host24 VServer anzuzeigen.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button variant="ghost" size="sm" onClick={load}><RefreshCw size={14} className="mr-1" />Aktualisieren</Button>
      </div>

      {error && (
        <div className="bg-panel-orange/10 border border-panel-orange/30 text-panel-orange text-sm rounded-md px-3 py-2">
          {error} — Bitte unter <a href="/settings" className="underline font-medium">Einstellungen → MC-Host24</a> einloggen.
        </div>
      )}

      {actError && (
        <div className="bg-panel-red/10 border border-panel-red/30 text-panel-red text-xs rounded-md px-3 py-2">
          {actError}
        </div>
      )}

      <Card title={`MC-Host24 VServer (${servers.length})`}>
        {loading ? (
          <div className="text-panel-muted text-sm py-4 text-center">Lade...</div>
        ) : servers.length === 0 && !error ? (
          <div className="text-panel-muted text-sm py-4 text-center">Keine VServer gefunden</div>
        ) : (
          <div className="divide-y divide-panel-border -mx-4 -mb-4">
            {servers.map(s => (
              <div key={s.id}>
                {/* Server-Zeile */}
                <div className="flex items-center justify-between px-4 py-3">
                  <div className="flex-1 min-w-0 mr-3">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge color={statusColor(s.status || s.state)}>{s.status || s.state || '—'}</Badge>
                      <span className="text-sm text-panel-text font-medium">{s.name || s.hostname || `VServer ${s.id}`}</span>
                      {/* Tags */}
                      {(s.tags || []).map(t => (
                        <TagChip
                          key={t.tag}
                          tag={t.tag}
                          color={t.color}
                          onRemove={isAdmin ? () => removeTag(s.id, t.tag) : undefined}
                        />
                      ))}
                      {isAdmin && (
                        <div className="relative">
                          <button
                            onClick={() => setAddTagFor(addTagFor === String(s.id) ? null : String(s.id))}
                            className="text-panel-muted hover:text-panel-accent transition-colors"
                            title="Tag hinzufügen"
                          >
                            <Tag size={11} />
                          </button>
                          {addTagFor === String(s.id) && (
                            <div className="absolute left-0 top-6 z-20">
                              <AddTagPopup
                                serverId={s.id}
                                onAdded={load}
                                onClose={() => setAddTagFor(null)}
                              />
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                    <div className="text-xs text-panel-muted mt-0.5 space-y-1">
                      <div className="flex items-center gap-1 flex-wrap">
                        <span>{[s.ip || (s.addresses && s.addresses[0]?.ip), s.os].filter(Boolean).join(' · ')}</span>
                        {(s.ip || (s.addresses && s.addresses[0]?.ip)) && (
                          <button
                            onClick={() => copyIp(s.id, s.ip || (s.addresses && s.addresses[0]?.ip))}
                            className="inline-flex items-center gap-1 ml-1 px-1.5 py-0.5 rounded text-[10px] bg-panel-bg border border-panel-border hover:border-panel-accent text-panel-muted hover:text-panel-text transition-colors"
                            title="IP-Adresse kopieren"
                          >
                            {copied[s.id] ? (
                              <>
                                <Check size={11} className="text-panel-green" />
                                <span className="text-panel-green font-medium">✓ Kopiert</span>
                              </>
                            ) : (
                              <>
                                <Copy size={11} />
                                <span>IP kopieren</span>
                              </>
                            )}
                          </button>
                        )}
                      </div>
                      <div className="flex gap-3 text-[11px] opacity-80 flex-wrap">
                        {s.expire_at && <span>Laufzeit: {new Date(s.expire_at > 1e11 ? s.expire_at : s.expire_at * 1000).toLocaleDateString('de-DE')} ({formatRuntime(s.expire_at)})</span>}
                        {s.cores && <span>{s.cores} Cores</span>}
                        {s.memory && <span>{s.memory} MB RAM</span>}
                        {s.disk_size && <span>{s.disk_size} GB Disk</span>}
                        {s.traffic !== undefined && s.curr_traffic !== undefined && <span>Traffic: {s.curr_traffic} / {s.traffic} GB</span>}
                      </div>
                    </div>
                  </div>
                  {/* „Herunterfahren" (sanft) und „Hart ausschalten" waren als reine
                      Symbole praktisch nicht auseinanderzuhalten — jetzt benannt, und
                      die harte Variante liegt eine Ebene tiefer im Menü. */}
                  <div className="flex items-center gap-1 flex-wrap justify-end">
                    {canStart && (
                      <Button size="sm" variant="success" onClick={() => act(s.id, 'start')} disabled={busy[`${s.id}_start`]}>
                        <Play size={12} />{busy[`${s.id}_start`] ? 'Startet…' : 'Start'}
                      </Button>
                    )}
                    {canStop && (
                      <Button size="sm" variant="warning" onClick={() => act(s.id, 'shutdown')} disabled={busy[`${s.id}_shutdown`]}
                        title="Betriebssystem geordnet herunterfahren">
                        <PowerOff size={12} />{busy[`${s.id}_shutdown`] ? 'Fährt herunter…' : 'Herunterfahren'}
                      </Button>
                    )}
                    {canRestart && (
                      <Button size="sm" variant="ghost" onClick={() => act(s.id, 'restart')} disabled={busy[`${s.id}_restart`]}>
                        <RotateCcw size={12} />{busy[`${s.id}_restart`] ? 'Startet neu…' : 'Neustart'}
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" onClick={() => toggleBackups(s.id)}
                      title="Backups dieses VServers anzeigen">
                      <HardDrive size={12} />Backups
                      {expanded[s.id] ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                    </Button>
                    <ActionMenu
                      items={[
                        canStop && {
                          icon: Square,
                          label: 'Hart ausschalten',
                          danger: true,
                          disabled: busy[`${s.id}_stop`],
                          title: 'Sofort abschalten, ohne das Betriebssystem herunterzufahren — Datenverlust möglich',
                          onClick: () => act(s.id, 'stop'),
                        },
                      ]}
                    />
                  </div>
                </div>

                {/* Backup-Bereich */}
                {expanded[s.id] && (
                  <div className="px-4 pb-3 bg-panel-surface/50">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-medium text-panel-muted">Backups</span>
                      {canBackup && (
                        <Button size="sm" variant="ghost" onClick={() => createBackup(s.id)} disabled={backupLoading[s.id]}>
                          <Plus size={12} className="mr-1" />Backup erstellen
                        </Button>
                      )}
                    </div>
                    {backups[s.id]?.length > 0 ? (
                      <div className="space-y-1">
                        {backups[s.id].map((b, i) => (
                          <div key={b.id || i} className="flex items-center justify-between bg-panel-card rounded px-2 py-1.5 text-xs">
                            <span className="text-panel-text">{b.name || b.description || `Backup ${i + 1}`}</span>
                            <span className="text-panel-muted">{b.created_at || b.date || ''}</span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-panel-muted">Keine Backups vorhanden</p>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
