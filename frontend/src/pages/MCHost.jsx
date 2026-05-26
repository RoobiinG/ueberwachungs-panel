import { useEffect, useState } from 'react';
import axios from 'axios';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { RefreshCw, Play, Square, PowerOff, RotateCcw, HardDrive, ChevronDown, ChevronUp, Plus } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

const statusColor = (s) => {
  if (!s) return 'gray';
  const str = String(s).toLowerCase();
  if (str.includes('running') || str.includes('on')) return 'green';
  if (str.includes('stop') || str.includes('off')) return 'red';
  return 'orange';
};

export default function MCHost() {
  const { hasPermission, isAdmin } = useAuth();
  const canView    = isAdmin || hasPermission('mchost.view');
  const canControl = isAdmin || hasPermission('mchost.control');

  const [servers, setServers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actError, setActError] = useState('');
  const [busy, setBusy] = useState({});
  const [expanded, setExpanded] = useState({});
  const [backups, setBackups] = useState({});
  const [backupLoading, setBackupLoading] = useState({});

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
    if (!canControl) return;
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
        setBackups(b => ({ ...b, [id]: Array.isArray(data) ? data : [] }));
      } catch { setBackups(b => ({ ...b, [id]: [] })); }
    }
  };

  const createBackup = async (id) => {
    if (!canControl) return;
    setActError('');
    setBackupLoading(b => ({ ...b, [id]: true }));
    try {
      await axios.post(`/api/mchost/vserver/${id}/backups`);
      const { data } = await axios.get(`/api/mchost/vserver/${id}/backups`);
      setBackups(b => ({ ...b, [id]: Array.isArray(data) ? data : [] }));
    } catch (err) {
      setActError(err.response?.data?.error || 'Backup-Erstellung fehlgeschlagen');
    }
    setBackupLoading(b => ({ ...b, [id]: false }));
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
                    <div className="flex items-center gap-2">
                      <Badge color={statusColor(s.status || s.state)}>{s.status || s.state || '—'}</Badge>
                      <span className="text-sm text-panel-text font-medium">{s.name || s.hostname || `VServer ${s.id}`}</span>
                    </div>
                    <div className="text-xs text-panel-muted mt-0.5">
                      {[s.ip, s.os].filter(Boolean).join(' · ')}
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    {canControl && (
                      <>
                        <Button size="sm" variant="success" onClick={() => act(s.id, 'start')} disabled={busy[`${s.id}_start`]}><Play size={12} /></Button>
                        <Button size="sm" variant="danger" onClick={() => act(s.id, 'stop')} disabled={busy[`${s.id}_stop`]}><Square size={12} /></Button>
                        <Button size="sm" variant="warning" onClick={() => act(s.id, 'shutdown')} disabled={busy[`${s.id}_shutdown`]}><PowerOff size={12} /></Button>
                        <Button size="sm" variant="ghost" onClick={() => act(s.id, 'restart')} disabled={busy[`${s.id}_restart`]}><RotateCcw size={12} /></Button>
                      </>
                    )}
                    <Button size="sm" variant="ghost" onClick={() => toggleBackups(s.id)}>
                      <HardDrive size={12} />
                      {expanded[s.id] ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                    </Button>
                  </div>
                </div>

                {/* Backup-Bereich */}
                {expanded[s.id] && (
                  <div className="px-4 pb-3 bg-panel-surface/50">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-medium text-panel-muted">Backups</span>
                      {canControl && (
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
