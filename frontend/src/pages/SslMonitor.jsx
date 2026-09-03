import { useEffect, useState } from 'react';
import axios from 'axios';
import { ShieldCheck, Plus, Trash2, ShieldAlert, RefreshCw, Lock, ExternalLink, Pencil, Globe } from 'lucide-react';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import { ActionMenu } from '../components/ui/ActionMenu';

export default function SslMonitor() {
  const [monitors, setMonitors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(null);
  
  // Modal State
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState({ name: '', domain: '', port: 443, active: true });
  const [formError, setFormError] = useState('');

  const load = () => {
    axios.get('/api/ssl').then(r => {
      setMonitors(r.data);
      setLoading(false);
    }).catch(e => {
      console.error(e);
      setLoading(false);
    });
  };

  useEffect(() => { load(); }, []);

  const handleSave = (e) => {
    e.preventDefault();
    if (!form.domain.trim()) return setFormError('Domain ist erforderlich (z.B. example.com)');
    
    // Clean domain
    let cleanDomain = form.domain.trim().toLowerCase();
    if (cleanDomain.startsWith('http://')) cleanDomain = cleanDomain.substring(7);
    if (cleanDomain.startsWith('https://')) cleanDomain = cleanDomain.substring(8);
    cleanDomain = cleanDomain.split('/')[0];
    
    const payload = { ...form, domain: cleanDomain, active: form.active ? 1 : 0 };
    const req = editingId 
      ? axios.put(`/api/ssl/${editingId}`, payload)
      : axios.post('/api/ssl', payload);
      
    req.then(() => {
      setModalOpen(false);
      load();
    }).catch(err => setFormError(err.response?.data?.error || err.message));
  };

  const handleDelete = (id) => {
    if (!confirm('Diesen SSL-Monitor wirklich löschen?')) return;
    axios.delete(`/api/ssl/${id}`).then(load);
  };

  const handleForceCheck = (id) => {
    setRefreshing(id);
    axios.post(`/api/ssl/${id}/check`)
      .then(r => {
        setMonitors(prev => prev.map(m => m.id === id ? r.data : m));
        setRefreshing(null);
      })
      .catch(e => {
        console.error(e);
        setRefreshing(null);
        load();
      });
  };

  const toggleActive = (m) => {
    axios.put(`/api/ssl/${m.id}`, { ...m, active: m.active ? 0 : 1 }).then(load);
  };

  const openModal = (m = null) => {
    if (m) {
      setEditingId(m.id);
      setForm({ name: m.name || '', domain: m.domain, port: m.port, active: m.active === 1 });
    } else {
      setEditingId(null);
      setForm({ name: '', domain: '', port: 443, active: true });
    }
    setFormError('');
    setModalOpen(true);
  };

  if (loading) return <div className="text-panel-muted p-8 text-center">Lade SSL-Zertifikate...</div>;

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-panel-text flex items-center gap-2">
            <Lock className="text-panel-accent" size={24} />
            SSL/TLS-Wächter
          </h1>
          <p className="text-sm text-panel-muted mt-1">Überwacht die Gültigkeit von HTTPS-Zertifikaten (Zentral über das Panel).</p>
        </div>
        <Button onClick={() => openModal()} icon={Plus}>Domain hinzufügen</Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {monitors.map(m => {
          let statusCls = 'border-panel-border/50 bg-panel-surface';
          let statusTextCls = 'text-panel-green';
          let icon = <ShieldCheck className="text-panel-green" size={20} />;
          
          if (!m.active) {
            statusCls = 'opacity-60 grayscale';
            statusTextCls = 'text-panel-muted';
            icon = <Lock className="text-panel-muted" size={20} />;
          } else if (m.status === 'error' || m.status === 'expired') {
            statusCls = 'border-panel-red/50 bg-panel-red/5';
            statusTextCls = 'text-panel-red';
            icon = <ShieldAlert className="text-panel-red" size={20} />;
          } else if (m.status === 'critical') {
            statusCls = 'border-panel-red/50 bg-panel-red/5';
            statusTextCls = 'text-panel-red';
            icon = <ShieldAlert className="text-panel-red" size={20} />;
          } else if (m.status === 'warning') {
            statusCls = 'border-orange-500/50 bg-orange-500/5';
            statusTextCls = 'text-orange-400';
            icon = <ShieldAlert className="text-orange-400" size={20} />;
          }

          return (
            <Card key={m.id} className={`p-4 flex flex-col justify-between transition-all border ${statusCls}`}>
              <div>
                <div className="flex justify-between items-start mb-3">
                  <div className="flex gap-3 items-center">
                    <div className="p-2 bg-panel-bg rounded-lg border border-panel-border">
                      {icon}
                    </div>
                    <div>
                      <h3 className="font-semibold text-panel-text text-sm truncate max-w-[180px]" title={m.domain}>
                        {m.name || m.domain}
                      </h3>
                      <a 
                        href={`https://${m.domain}:${m.port}`} 
                        target="_blank" rel="noreferrer"
                        className="text-xs text-panel-muted hover:text-panel-accent transition-colors flex items-center gap-1"
                      >
                        {m.domain}{m.port !== 443 ? `:${m.port}` : ''} <ExternalLink size={10} />
                      </a>
                    </div>
                  </div>
                  <ActionMenu items={[
                    { label: 'Jetzt prüfen', icon: RefreshCw, onClick: () => handleForceCheck(m.id) },
                    { label: m.active ? 'Pausieren' : 'Aktivieren', icon: m.active ? ShieldAlert : ShieldCheck, onClick: () => toggleActive(m) },
                    { label: 'Bearbeiten', icon: Pencil, onClick: () => openModal(m) },
                    { label: 'Löschen', icon: Trash2, onClick: () => handleDelete(m.id), danger: true }
                  ]} />
                </div>
                
                {m.active ? (
                  m.status === 'error' ? (
                    <div className="text-xs text-panel-red mt-4 bg-panel-bg p-2 rounded border border-panel-red/20 break-words">
                      {m.error_msg || 'Verbindungsfehler'}
                    </div>
                  ) : m.valid_to ? (
                    <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
                      <div className="bg-panel-bg p-2 rounded border border-panel-border/50">
                        <span className="block text-panel-muted mb-0.5">Gültig bis</span>
                        <span className={\`font-medium \${statusTextCls}\`}>
                          {m.days_remaining} {m.days_remaining === 1 ? 'Tag' : 'Tage'}
                        </span>
                        <span className="block text-[10px] text-panel-muted mt-0.5">
                          {new Date(m.valid_to).toLocaleDateString()}
                        </span>
                      </div>
                      <div className="bg-panel-bg p-2 rounded border border-panel-border/50">
                        <span className="block text-panel-muted mb-0.5">Aussteller</span>
                        <span className="font-medium text-panel-text truncate block" title={m.issuer}>
                          {m.issuer || '-'}
                        </span>
                      </div>
                    </div>
                  ) : (
                    <div className="text-xs text-panel-muted mt-4 bg-panel-bg p-2 rounded border border-panel-border/20">
                      Zertifikat wird beim nächsten Durchlauf geprüft...
                    </div>
                  )
                ) : (
                  <div className="text-xs text-panel-muted mt-4 italic">
                    Überwachung pausiert
                  </div>
                )}
              </div>
              
              <div className="mt-4 pt-3 border-t border-panel-border/50 flex justify-between items-center text-[10px] text-panel-muted">
                <span>{m.last_check ? `Letzter Check: ${new Date(m.last_check).toLocaleTimeString()}` : 'Nie geprüft'}</span>
                {refreshing === m.id && <RefreshCw size={12} className="animate-spin text-panel-accent" />}
              </div>
            </Card>
          );
        })}
        {monitors.length === 0 && (
          <div className="col-span-full py-12 text-center border-2 border-dashed border-panel-border rounded-xl text-panel-muted">
            <Globe className="mx-auto mb-3 opacity-20" size={48} />
            <p>Keine Domains hinterlegt.</p>
            <p className="text-sm mt-1">Füge eine Domain hinzu, um ihr SSL-Zertifikat automatisch zu überwachen.</p>
          </div>
        )}
      </div>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editingId ? 'Monitor bearbeiten' : 'Domain hinzufügen'}>
        <form onSubmit={handleSave} className="space-y-4">
          {formError && <div className="text-xs text-panel-red bg-panel-red/10 p-2 rounded">{formError}</div>}
          
          <div>
            <label className="block text-xs text-panel-muted mb-1">Domain (z.B. example.com)</label>
            <input 
              type="text" 
              className="w-full bg-panel-surface border border-panel-border rounded px-3 py-2 text-sm focus:border-panel-accent focus:outline-none" 
              value={form.domain} 
              onChange={e => setForm({...form, domain: e.target.value})} 
              autoFocus
            />
          </div>

          <div className="flex gap-4">
            <div className="flex-1">
              <label className="block text-xs text-panel-muted mb-1">Name (Optional)</label>
              <input 
                type="text" 
                className="w-full bg-panel-surface border border-panel-border rounded px-3 py-2 text-sm focus:border-panel-accent focus:outline-none" 
                value={form.name} 
                onChange={e => setForm({...form, name: e.target.value})} 
                placeholder="z.B. Haupt-Webseite"
              />
            </div>
            <div className="w-24">
              <label className="block text-xs text-panel-muted mb-1">Port</label>
              <input 
                type="number" 
                className="w-full bg-panel-surface border border-panel-border rounded px-3 py-2 text-sm focus:border-panel-accent focus:outline-none text-right" 
                value={form.port} 
                onChange={e => setForm({...form, port: parseInt(e.target.value) || 443})} 
              />
            </div>
          </div>
          
          <div className="pt-2 flex justify-end gap-3">
            <Button variant="secondary" onClick={() => setModalOpen(false)} type="button">Abbrechen</Button>
            <Button type="submit">{editingId ? 'Speichern' : 'Hinzufügen'}</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
