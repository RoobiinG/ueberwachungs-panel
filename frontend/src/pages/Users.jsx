import { useEffect, useState } from 'react';
import axios from 'axios';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Modal } from '../components/ui/Modal';
import { Plus, Trash2, Lock } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

const inputCls = 'w-full bg-panel-surface border border-panel-border rounded-md px-3 py-2 text-sm text-panel-text focus:outline-none focus:border-panel-accent';

export default function Users() {
  const [users,      setUsers]      = useState([]);
  const [roles,      setRoles]      = useState([]);
  const [showAdd,    setShowAdd]    = useState(false);
  const [form,       setForm]       = useState({ username: '', password: '', role: 'guest' });
  const [editUser,   setEditUser]   = useState(null);
  const [editRole,   setEditRole]   = useState('');
  const { user: me } = useAuth();

  const load = async () => {
    const [usersRes, rolesRes] = await Promise.all([
      axios.get('/api/users'),
      axios.get('/api/roles'),
    ]);
    setUsers(usersRes.data);
    // Rollen ohne Admin zur Auswahl (Admin wird nicht vergeben)
    setRoles(rolesRes.data.filter(r => !r.is_admin));
  };

  useEffect(() => { load(); }, []);

  const save = async () => {
    try {
      await axios.post('/api/users', form);
      setShowAdd(false);
      setForm({ username: '', password: '', role: roles[0]?.name || 'guest' });
      load();
    } catch (err) {
      alert(err.response?.data?.error || 'Fehler');
    }
  };

  const saveRole = async () => {
    try {
      await axios.put(`/api/users/${editUser.id}`, { role: editRole });
      setEditUser(null);
      load();
    } catch (err) {
      alert(err.response?.data?.error || 'Fehler');
    }
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
        <Button size="sm" onClick={() => setShowAdd(true)}>
          <Plus size={14} className="mr-1" />Benutzer anlegen
        </Button>
      </div>

      <Card title={`Benutzer (${users.length})`}>
        <div className="-mx-4 -mb-4">
          {users.map(u => (
            <div key={u.id} className="flex items-center justify-between px-4 py-3 table-row">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-panel-surface border border-panel-border flex items-center justify-center text-xs font-bold text-panel-accent">
                  {u.username[0].toUpperCase()}
                </div>
                <div>
                  <div className="text-sm text-panel-text flex items-center gap-1.5">
                    {u.username}
                    {u.id === me?.id && <span className="text-panel-muted text-xs">(Du)</span>}
                    {u.role === 'admin' && <Lock size={11} className="text-panel-orange" />}
                  </div>
                  <div className="text-xs text-panel-muted">{new Date(u.created_at).toLocaleDateString('de-DE')}</div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Badge color={u.role === 'admin' ? 'orange' : 'blue'}>
                  {u.roleLabel || u.role}
                </Badge>
                {u.id !== me?.id && u.role !== 'admin' && (
                  <Button size="sm" variant="ghost" onClick={() => { setEditUser(u); setEditRole(u.role); }}>
                    Rolle
                  </Button>
                )}
                {u.id !== me?.id && u.role !== 'admin' && (
                  <Button size="sm" variant="danger" onClick={() => remove(u.id)}>
                    <Trash2 size={12} />
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      </Card>

      {/* Modal: Benutzer anlegen */}
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
              {roles.map(r => (
                <option key={r.id} value={r.name}>{r.label}</option>
              ))}
            </select>
          </div>
        </div>
      </Modal>

      {/* Modal: Rolle ändern */}
      {editUser && (
        <Modal open={!!editUser} onClose={() => setEditUser(null)}
          title={`Rolle ändern: ${editUser.username}`}
          footer={<>
            <Button variant="ghost" size="sm" onClick={() => setEditUser(null)}>Abbrechen</Button>
            <Button size="sm" onClick={saveRole}>Speichern</Button>
          </>}
        >
          <div className="space-y-3">
            <div>
              <label className="block text-xs text-panel-muted mb-1">Neue Rolle</label>
              <select value={editRole} onChange={e => setEditRole(e.target.value)} className={inputCls}>
                {roles.map(r => (
                  <option key={r.id} value={r.name}>{r.label}</option>
                ))}
              </select>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
