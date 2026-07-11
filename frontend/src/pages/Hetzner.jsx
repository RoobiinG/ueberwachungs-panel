import { useEffect, useState } from 'react';
import axios from 'axios';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { RefreshCw, Power, PowerOff, RotateCcw, HardDrive, ChevronDown, ChevronUp } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

const statusColor = (s) => s === 'running' ? 'green' : s === 'off' ? 'red' : 'orange';
const boxStatusColor = (s) => s === 'active' ? 'green' : (s === 'locked' || s === 'disabled') ? 'red' : 'orange';
const fmtBytes = (b, d = 1) => {
  if (!b || b <= 0) return '0 B';
  const k = 1024, u = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const i = Math.floor(Math.log(b) / Math.log(k));
  return `${parseFloat((b / Math.pow(k, i)).toFixed(d))} ${u[i]}`;
};

export default function Hetzner() {
  const { hasPermission, isAdmin } = useAuth();
  const canView    = isAdmin || hasPermission('hetzner.view');
  const canStart   = isAdmin || hasPermission('hetzner.start');
  const canStop    = isAdmin || hasPermission('hetzner.stop');
  const canRestart = isAdmin || hasPermission('hetzner.restart');
  const canBackup  = isAdmin || hasPermission('hetzner.backup');

  const [servers, setServers] = useState([]);
  const [boxes, setBoxes]     = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actError, setActError] = useState('');
  const [busy, setBusy] = useState({});
  const [expanded, setExpanded] = useState({});
  const [backups, setBackups] = useState({});

  const load = async () => {
    if (!canView) { setLoading(false); return; }
    setLoading(true);
    setError('');
    // Server + Storage Boxes parallel; ein Storage-Fehler blockiert die Server nicht.
    const [srv, box] = await Promise.allSettled([
      axios.get('/api/hetzner/servers'),
      axios.get('/api/hetzner/storage_boxes'),
    ]);
    if (srv.status === 'fulfilled') setServers(srv.value.data.servers || []);
    else setError(srv.reason?.response?.data?.error || 'HETZNER_API_TOKEN nicht konfiguriert');
    setBoxes(box.status === 'fulfilled' ? (box.value.data.boxes || []) : []);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const canControl = canStart || canStop || canRestart;

  const act = async (id, action) => {
    setActError('');
    setBusy(b => ({ ...b, [`${id}_${action}`]: true }));
    try { await axios.post(`/api/hetzner/servers/${id}/${action}`); setTimeout(load, 2000); }
    catch (err) { setActError(err.response?.data?.error || `Aktion "${action}" fehlgeschlagen`); }
    setBusy(b => ({ ...b, [`${id}_${action}`]: false }));
  };

  const toggleBackup = async (id, current) => {
    if (!canBackup) return;
    setActError('');
    try { await axios.post(`/api/hetzner/servers/${id}/backup/${current ? 'disable' : 'enable'}`); setTimeout(load, 1500); }
    catch (err) { setActError(err.response?.data?.error || 'Backup-Einstellung fehlgeschlagen'); }
  };

  const loadBackups = async (id) => {
    const isOpen = expanded[id];
    setExpanded(e => ({ ...e, [id]: !isOpen }));
    if (!isOpen && !backups[id]) {
      try {
        const { data } = await axios.get(`/api/hetzner/servers/${id}/backups`);
        setBackups(b => ({ ...b, [id]: data.images || [] }));
      } catch { setBackups(b => ({ ...b, [id]: [] })); }
    }
  };

  if (!canView) {
    return (
      <div className="bg-panel-orange/10 border border-panel-orange/30 text-panel-orange text-sm rounded-md px-4 py-3">
        Du hast keine Berechtigung, Hetzner Cloud Server anzuzeigen.
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
          {error} — Bitte den API-Token unter <a href="/settings" className="underline font-medium">Einstellungen → Hetzner Cloud API</a> hinterlegen.
        </div>
      )}

      {actError && (
        <div className="bg-panel-red/10 border border-panel-red/30 text-panel-red text-xs rounded-md px-3 py-2">
          {actError}
        </div>
      )}

      <Card title={`Hetzner Cloud Server (${servers.length})`}>
        {loading ? (
          <div className="text-panel-muted text-sm py-4 text-center">Lade...</div>
        ) : servers.length === 0 && !error ? (
          <div className="text-panel-muted text-sm py-4 text-center">Keine Server vorhanden</div>
        ) : (
          <div className="divide-y divide-panel-border -mx-4 -mb-4">
            {servers.map(s => (
              <div key={s.id}>
                {/* Server-Zeile */}
                <div className="flex items-center justify-between px-4 py-3">
                  <div className="flex-1 min-w-0 mr-3">
                    <div className="flex items-center gap-2">
                      <Badge color={statusColor(s.status)}>{s.status}</Badge>
                      <span className="text-sm text-panel-text font-medium">{s.name}</span>
                    </div>
                    <div className="text-xs text-panel-muted mt-0.5">
                      {s.server_type?.name} · {s.datacenter?.location?.name} · {s.public_net?.ipv4?.ip}
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    {s.status === 'off'
                      ? canStart   && <Button size="sm" variant="success" onClick={() => act(s.id, 'poweron')} disabled={busy[`${s.id}_poweron`]}><Power size={12} /></Button>
                      : canStop    && <Button size="sm" variant="danger" onClick={() => act(s.id, 'poweroff')} disabled={busy[`${s.id}_poweroff`]}><PowerOff size={12} /></Button>
                    }
                    {canRestart && <Button size="sm" variant="ghost" onClick={() => act(s.id, 'reboot')} disabled={busy[`${s.id}_reboot`]}><RotateCcw size={12} /></Button>}
                    <Button size="sm" variant="ghost" onClick={() => loadBackups(s.id)}>
                      <HardDrive size={12} />
                      {expanded[s.id] ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                    </Button>
                  </div>
                </div>

                {/* Backup-Bereich */}
                {expanded[s.id] && (
                  <div className="px-4 pb-3 bg-panel-surface/50">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-medium text-panel-muted">Automatische Backups</span>
                      {canBackup && (
                        <Button
                          size="sm"
                          variant={s.backup_window ? 'danger' : 'success'}
                          onClick={() => toggleBackup(s.id, !!s.backup_window)}
                        >
                          {s.backup_window ? 'Deaktivieren' : 'Aktivieren'}
                        </Button>
                      )}
                    </div>
                    {s.backup_window && (
                      <p className="text-xs text-panel-muted mb-2">Fenster: {s.backup_window}</p>
                    )}
                    {backups[s.id]?.length > 0 ? (
                      <div className="space-y-1">
                        {backups[s.id].map(b => (
                          <div key={b.id} className="flex items-center justify-between bg-panel-card rounded px-2 py-1.5 text-xs">
                            <span className="text-panel-text">{b.description || `Backup ${b.id}`}</span>
                            <span className="text-panel-muted">{new Date(b.created).toLocaleString('de-DE')}</span>
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

      {/* ── Storage Boxes ─────────────────────────────────────────────── */}
      <Card title={`Storage Boxes (${boxes.length})`}>
        {loading ? (
          <div className="text-panel-muted text-sm py-4 text-center">Lade...</div>
        ) : boxes.length === 0 ? (
          <div className="text-panel-muted text-sm py-4 text-center">Keine Storage Boxes vorhanden</div>
        ) : (
          <div className="divide-y divide-panel-border -mx-4 -mb-4">
            {boxes.map(b => {
              const pct = b.usagePct ?? (b.quotaBytes > 0 ? Math.round((b.usedBytes / b.quotaBytes) * 100) : 0);
              const barColor = pct >= 90 ? 'bg-panel-red' : pct >= 75 ? 'bg-panel-orange' : 'bg-panel-accent';
              return (
                <div key={b.id} className="px-4 py-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <Badge color={boxStatusColor(b.status)}>{b.status}</Badge>
                      <span className="text-sm text-panel-text font-medium truncate">{b.name}</span>
                    </div>
                    <div className="flex items-center gap-1.5 flex-shrink-0 text-[10px] text-panel-muted">
                      {b.ssh    && <span className="px-1.5 py-0.5 rounded bg-panel-surface">SSH</span>}
                      {b.samba  && <span className="px-1.5 py-0.5 rounded bg-panel-surface">Samba</span>}
                      {b.webdav && <span className="px-1.5 py-0.5 rounded bg-panel-surface">WebDAV</span>}
                    </div>
                  </div>
                  <div className="text-xs text-panel-muted mt-0.5 truncate">
                    {[b.type, b.location, b.server].filter(Boolean).join(' · ')}
                  </div>
                  {b.quotaBytes > 0 && (
                    <div className="mt-2">
                      <div className="flex justify-between text-[11px] text-panel-muted mb-1">
                        <span>Belegt</span>
                        <span className="tabular-nums text-panel-text">
                          {fmtBytes(b.usedBytes)} / {fmtBytes(b.quotaBytes)} ({pct}%)
                        </span>
                      </div>
                      <div className="h-2 bg-panel-surface rounded-full overflow-hidden">
                        <div className={`h-full rounded-full transition-all ${barColor}`}
                          style={{ width: `${Math.min(pct, 100)}%` }} />
                      </div>
                      {b.snapshotBytes > 0 && (
                        <p className="text-[10px] text-panel-muted/70 mt-1">davon Snapshots: {fmtBytes(b.snapshotBytes)}</p>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}
