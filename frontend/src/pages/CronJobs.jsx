import { useEffect, useState, useCallback } from 'react';
import axios from 'axios';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import { ServerSelector } from '../components/ui/ServerSelector';
import { RefreshCw, Plus, Save, Trash2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

export default function CronJobs() {
  const { canWrite } = useAuth();
  
  const [selectedServer, setSelectedServer] = useState(null); // null = lokal
  const [cronUsers, setCronUsers] = useState([]);
  const [selectedCronUser, setSelectedCronUser] = useState('root');
  const [cronJobs, setCronJobs] = useState([]);
  
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState('');
  
  const [cronModal, setCronModal] = useState(false);
  const [newCron, setNewCron] = useState({ 
    mode: 'minute', minutes: '0', hours: [], days: [], interval: 5, customStr: '* * * * *', command: '' 
  });

  const load = useCallback(async (silent = false) => {
    if (!selectedServer) return; // Kein Server gewählt (Lokal wurde entfernt)
    
    if (!silent) setLoading(true);
    setError('');
    try {
      const baseUrl = `/api/agents/${selectedServer}/cron`;
      
      let currentUsers = cronUsers;
      if (!silent || currentUsers.length === 0) {
        const res = await axios.get(`${baseUrl}/users`);
        currentUsers = res.data;
        setCronUsers(currentUsers);
        if (currentUsers.length > 0 && !currentUsers.includes(selectedCronUser)) {
           setSelectedCronUser(currentUsers[0]);
        }
      }
      
      const userToFetch = currentUsers.length > 0 && !currentUsers.includes(selectedCronUser) ? currentUsers[0] : selectedCronUser;
      
      if (userToFetch) {
        const res2 = await axios.get(`${baseUrl}/jobs/${encodeURIComponent(userToFetch)}`);
        setCronJobs(res2.data);
      } else {
        setCronJobs([]);
      }
    } catch (err) {
      setError(err.response?.data?.error || 'Fehler beim Laden der Cron Jobs');
      if (!silent) {
        setCronUsers([]);
        setCronJobs([]);
      }
    }
    if (!silent) setLoading(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedServer, selectedCronUser]);

  useEffect(() => {
    load();
  }, [load]);
  
  // Wenn der Server wechselt, lade komplett neu
  useEffect(() => {
    setCronUsers([]);
    setCronJobs([]);
  }, [selectedServer]);

  const addCronJob = async () => {
    let schedule = '';
    const m = newCron.minutes || '0';
    const h = newCron.hours.length > 0 ? newCron.hours.sort((a,b)=>a-b).join(',') : '*';
    const d = newCron.days.length > 0 ? newCron.days.sort((a,b)=>a-b).join(',') : '*';

    switch (newCron.mode) {
      case 'minute': schedule = '* * * * *'; break;
      case 'interval': schedule = `*/${newCron.interval} * * * *`; break;
      case 'hourly': schedule = '0 * * * *'; break;
      case 'daily': schedule = `${m} ${h} * * *`; break;
      case 'weekly': schedule = `${m} ${h} * * ${d}`; break;
      case 'custom': schedule = newCron.customStr; break;
      default: schedule = '* * * * *';
    }
    
    setActionLoading(true);
    try {
      const baseUrl = `/api/agents/${selectedServer}/cron`;
      await axios.post(`${baseUrl}/jobs/${encodeURIComponent(selectedCronUser)}`, { schedule, command: newCron.command });
      setCronModal(false);
      setNewCron({ mode: 'minute', minutes: '0', hours: [], days: [], interval: 5, customStr: '* * * * *', command: '' });
      load(true);
    } catch (err) {
      alert(err.response?.data?.error || 'Fehler beim Speichern');
    }
    setActionLoading(false);
  };

  const deleteCronJob = async (index) => {
    if (!confirm('Cron Job wirklich löschen?')) return;
    setActionLoading(true);
    try {
      const baseUrl = `/api/agents/${selectedServer}/cron`;
      await axios.delete(`${baseUrl}/jobs/${encodeURIComponent(selectedCronUser)}/${index}`);
      load(true);
    } catch (err) {
      alert(err.response?.data?.error || 'Fehler beim Löschen');
    }
    setActionLoading(false);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <ServerSelector selected={selectedServer} onChange={setSelectedServer} />
        <div className="flex gap-2 ml-auto">
          <Button variant="ghost" size="sm" onClick={() => load()} disabled={loading}>
            <RefreshCw size={14} className={`mr-1 ${loading ? 'animate-spin' : ''}`} />Aktualisieren
          </Button>
        </div>
      </div>

      {error && (
        <div className="bg-panel-red/10 border border-panel-red/30 text-panel-red text-xs rounded-md px-3 py-2">
          {error}
        </div>
      )}

      <Card 
        title="Geplante Aufgaben (Cron Jobs)"
        action={
          canWrite && (
            <Button size="sm" onClick={() => setCronModal(true)} disabled={loading || cronUsers.length === 0}>
              <Plus size={14} className="mr-1" />
              Neuer Cron Job
            </Button>
          )
        }
      >
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <label className="text-xs text-panel-muted font-medium">Ausführen als Benutzer:</label>
            <select
              value={selectedCronUser}
              onChange={e => setSelectedCronUser(e.target.value)}
              disabled={loading || cronUsers.length === 0}
              className="bg-panel-surface border border-panel-border rounded-lg px-3 py-1.5 text-xs text-panel-text focus:outline-none focus:border-panel-accent disabled:opacity-50"
            >
              {cronUsers.map(u => <option key={u} value={u}>{u}</option>)}
              {cronUsers.length === 0 && <option value="">Lädt...</option>}
            </select>
          </div>
          
          {loading && cronJobs.length === 0 ? (
            <div className="py-8 flex justify-center text-panel-muted text-xs"><RefreshCw size={14} className="animate-spin mr-2" /> Lade Cron Jobs...</div>
          ) : cronJobs.length === 0 ? (
            <div className="py-8 text-center text-panel-muted text-xs border border-dashed border-panel-border rounded-lg bg-panel-surface/30">
              Keine Cron Jobs für {selectedCronUser} gefunden.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-panel-border text-panel-muted">
                    <th className="py-2 px-2">Zeitplan</th>
                    <th className="py-2 px-2">Befehl</th>
                    {canWrite && <th className="py-2 px-2 text-right">Aktion</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-panel-border/40 font-mono">
                  {cronJobs.map((job, idx) => (
                    <tr key={idx} className="hover:bg-panel-surface/60 transition-colors">
                      <td className="py-2 px-2 text-panel-accent font-semibold whitespace-nowrap">{job.schedule}</td>
                      <td className="py-2 px-2 text-panel-text max-w-sm break-all" title={job.command}>{job.command}</td>
                      {canWrite && (
                        <td className="py-2 px-2 text-right">
                          <button onClick={() => deleteCronJob(idx)} className="text-panel-red hover:bg-panel-red/10 p-1.5 rounded transition-colors" title="Löschen" disabled={actionLoading}>
                            <Trash2 size={13} />
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </Card>

      {/* ── Cron Job Modal ─────────────────────────────────────────────────── */}
      <Modal
        open={cronModal}
        onClose={() => setCronModal(false)}
        title="Neuen Cron Job erstellen"
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setCronModal(false)}>Abbrechen</Button>
            <Button size="sm" onClick={addCronJob} disabled={actionLoading || !newCron.command}>
              {actionLoading ? <RefreshCw size={14} className="animate-spin mr-1" /> : <Save size={14} className="mr-1" />}
              Speichern
            </Button>
          </>
        }
      >
        <div className="space-y-4 text-xs">
          <div>
            <label className="block text-panel-muted font-medium mb-1">Typ</label>
            <select
              value={newCron.mode}
              onChange={e => setNewCron(c => ({ ...c, mode: e.target.value }))}
              className="w-full bg-panel-surface border border-panel-border rounded-lg px-3 py-2 text-panel-text focus:outline-none focus:border-panel-accent"
            >
              <option value="minute">Jede Minute (* * * * *)</option>
              <option value="interval">Intervall (Minuten)</option>
              <option value="hourly">Stündlich</option>
              <option value="daily">Täglich</option>
              <option value="weekly">Wöchentlich</option>
              <option value="custom">Benutzerdefiniert</option>
            </select>
          </div>

          {newCron.mode === 'interval' && (
            <div>
              <label className="block text-panel-muted font-medium mb-1">Alle X Minuten</label>
              <input type="number" min="1" max="59" value={newCron.interval} onChange={e => setNewCron(c => ({ ...c, interval: e.target.value }))} className="w-full bg-panel-surface border border-panel-border rounded-lg px-3 py-2 text-panel-text focus:outline-none focus:border-panel-accent" />
            </div>
          )}

          {(newCron.mode === 'daily' || newCron.mode === 'weekly') && (
            <div className="space-y-3">
              <div>
                <label className="block text-panel-muted font-medium mb-2">Stunde(n) <span className="text-[10px] opacity-70 font-normal">(Leer = Jede Stunde)</span></label>
                <div className="flex flex-wrap gap-1">
                  {Array.from({length: 24}).map((_, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => {
                        const h = newCron.hours;
                        if (h.includes(i)) setNewCron(c => ({ ...c, hours: h.filter(x => x !== i) }));
                        else setNewCron(c => ({ ...c, hours: [...h, i] }));
                      }}
                      className={`w-8 h-8 rounded-md text-xs font-medium transition-colors ${
                        newCron.hours.includes(i)
                          ? 'bg-panel-accent text-white border-transparent'
                          : 'bg-panel-surface border border-panel-border text-panel-muted hover:text-panel-text hover:border-panel-accent/50'
                      }`}
                    >
                      {i.toString().padStart(2, '0')}
                    </button>
                  ))}
                </div>
              </div>
              
              <div className="w-1/2">
                <label className="block text-panel-muted font-medium mb-1">Minute(n) <span className="text-[10px] opacity-70 font-normal">(z.B. "0", "0,30", "*/15")</span></label>
                <input type="text" value={newCron.minutes} onChange={e => setNewCron(c => ({ ...c, minutes: e.target.value }))} className="w-full bg-panel-surface border border-panel-border rounded-lg px-3 py-2 text-panel-text focus:outline-none focus:border-panel-accent" />
              </div>
            </div>
          )}

          {newCron.mode === 'weekly' && (
            <div>
              <label className="block text-panel-muted font-medium mb-2">Wochentag(e) <span className="text-[10px] opacity-70 font-normal">(Leer = Jeden Tag)</span></label>
              <div className="flex flex-wrap gap-2">
                {[
                  { val: 1, label: 'Mo' }, { val: 2, label: 'Di' }, { val: 3, label: 'Mi' },
                  { val: 4, label: 'Do' }, { val: 5, label: 'Fr' }, { val: 6, label: 'Sa' }, { val: 0, label: 'So' }
                ].map(d => (
                  <button
                    key={d.val}
                    type="button"
                    onClick={() => {
                      const days = newCron.days;
                      if (days.includes(d.val)) setNewCron(c => ({ ...c, days: days.filter(x => x !== d.val) }));
                      else setNewCron(c => ({ ...c, days: [...days, d.val] }));
                    }}
                    className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                      newCron.days.includes(d.val)
                        ? 'bg-panel-accent text-white border-transparent'
                        : 'bg-panel-surface border border-panel-border text-panel-muted hover:text-panel-text hover:border-panel-accent/50'
                    }`}
                  >
                    {d.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {newCron.mode === 'custom' && (
            <div>
              <label className="block text-panel-muted font-medium mb-1">Cron-Ausdruck</label>
              <input type="text" value={newCron.customStr} onChange={e => setNewCron(c => ({ ...c, customStr: e.target.value }))} placeholder="0 2 * * *" className="w-full bg-panel-surface border border-panel-border rounded-lg px-3 py-2 text-panel-text font-mono focus:outline-none focus:border-panel-accent" />
            </div>
          )}

          <div>
            <label className="block text-panel-muted font-medium mb-1">Auszuführender Befehl</label>
            <textarea
              rows="3"
              value={newCron.command}
              onChange={e => setNewCron(c => ({ ...c, command: e.target.value }))}
              placeholder="/usr/bin/certbot renew"
              className="w-full bg-panel-surface border border-panel-border rounded-lg px-3 py-2 text-panel-text font-mono focus:outline-none focus:border-panel-accent"
            />
          </div>
          
          <div className="bg-panel-surface/50 p-3 rounded-lg border border-panel-border">
            <span className="text-panel-muted">Der Job wird erstellt für: </span>
            <span className="text-panel-text font-semibold">{selectedCronUser}</span>
          </div>
        </div>
      </Modal>
    </div>
  );
}
