import { useEffect, useState } from 'react';
import axios from 'axios';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Modal } from '../components/ui/Modal';
import { Plus, Trash2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

const roleColor = { admin: 'red', operator: 'orange', viewer: 'blue' };
const inputCls = 'w-full bg-panel-surface border border-panel-border rounded-md px-3 py-2 text-sm text-panel-text focus:outline-none focus:border-panel-accent';

export default function Users() {
  const [users, setUsers] = useState([]);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ username: '', password: '', role: 'viewer' });
  const { user: me } = useAuth();

  const load = async () => {
    const { data } = await axios.get('/api/users');
    setUsers(data);
  };

  useEffect(() => { load(); }, []);

  const save = async () => {
    await axios.post('/api/users', form);
    setShowAdd(false);
    setForm({ username: '', password: '', role: 'viewer' });
    load();
  };

  const remove = async (id) => {
    if (!confirm('Benutzer löschen?')) return;
    await axios.delete(`/api/users/${id}`);
    load();
  };

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button size="sm" onClick={() => setShowAdd(true)}><Plus size={14} className="mr-1" />Benutzer anlegen</Button>
      </div>

      <Card title={`Benutzer (${users.length})`}>
        <div className="divide-y divide-panel-border -mx-4 -mb-4">
          {users.map(u => (
            <div key={u.id} className="flex items-center justify-between px-4 py-3">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-panel-surface border border-panel-border flex items-center justify-center text-xs font-bold text-panel-accent">
                  {u.username[0].toUpperCase()}
                </div>
                <div>
                  <div className="text-sm text-panel-text">
                    {u.username}
                    {u.id === me?.id && <span className="text-panel-muted text-xs ml-1">(Du)</span>}
                  </div>
                  <div className="text-xs text-panel-muted">{new Date(u.created_at).toLocaleDateString('de-DE')}</div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Badge color={roleColor[u.role] || 'gray'}>{u.role}</Badge>
                {u.id !== me?.id && (
                  <Button size="sm" variant="danger" onClick={() => remove(u.id)}><Trash2 size={12} /></Button>
                )}
              </div>
            </div>
          ))}
        </div>
      </Card>

      <Modal open={showAdd} onClose={() => setShowAdd(false)} title="Neuen Benutzer anlegen"
        footer={<>
          <Button variant="ghost" size="sm" onClick={() => setShowAdd(false)}>Abbrechen</Button>
          <Button size="sm" onClick={save} disabled={!form.username || !form.password}>Anlegen</Button>
        </>}
      >
        <div className="space-y-3">
          <div>
            <label className="block text-xs text-panel-muted mb-1">Benutzername</label>
            <input value={form.username} onChange={e => set('username', e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className="block text-xs text-panel-muted mb-1">Passwort</label>
            <input type="password" value={form.password} onChange={e => set('password', e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className="block text-xs text-panel-muted mb-1">Rolle</label>
            <select value={form.role} onChange={e => set('role', e.target.value)} className={inputCls}>
              <option value="viewer">Viewer — Nur lesen</option>
              <option value="operator">Operator — Aktionen ausführen</option>
              <option value="admin">Admin — Vollzugriff</option>
            </select>
          </div>
        </div>
      </Modal>
    </div>
  );
}
