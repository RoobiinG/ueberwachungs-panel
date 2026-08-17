import { useEffect, useState } from 'react';
import axios from 'axios';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Modal } from '../components/ui/Modal';
import { ActionMenu } from '../components/ui/ActionMenu';
import { Plus, Trash2, Lock, ShieldOff, Pencil } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

const inputCls = 'w-full bg-panel-surface border border-panel-border rounded-md px-3 py-2 text-sm text-panel-text focus:outline-none focus:border-panel-accent';

export default function Users() {
  const [users,      setUsers]      = useState([]);
  const [roles,      setRoles]      = useState([]);
  const [showAdd,    setShowAdd]    = useState(false);
  const [form,       setForm]       = useState({ username: '', password: '', role: 'guest' });
  const [editUser,   setEditUser]   = useState(null);
  const [editForm,   setEditForm]   = useState({ username: '', email: '', password: '', role: '' });
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

  const saveUser = async () => {
    try {
      await axios.put(`/api/users/${editUser.id}`, {
        username: editForm.username,
        email: editForm.email,
        password: editForm.password || undefined,
        role: editForm.role
      });
      setEditUser(null);
      load();
    } catch (err) {
      alert(err.response?.data?.error || 'Fehler');
    }
  };

  const disable2FA = async (id) => {
    if (!confirm('2FA für diesen Benutzer wirklich deaktivieren?')) return;
    try {
      await axios.post(`/api/users/${id}/disable-2fa`);
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
            <div key={u.id} className="flex items-center justify-between px-4 py-3 list-row">
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
                  <div className="text-xs text-panel-muted flex flex-wrap items-center gap-2 mt-0.5">
                    <span>Erstellt: {new Date(u.created_at).toLocaleDateString('de-DE')}</span>
                    {u.last_login ? (
                      <span className="flex items-center gap-1 text-panel-text/80 bg-panel-surface border border-panel-border px-1.5 py-0.5 rounded">
                        Letzter Login: {new Date(u.last_login).toLocaleString('de-DE')}
                        {u.last_login_ip && ` • ${u.last_login_ip}`}
                        {u.last_login_from && ` (${u.last_login_from})`}
                      </span>
                    ) : (
                      <span className="text-panel-muted/60 italic">Bisher kein Login</span>
                    )}
                    {u.email && <span className="text-panel-muted/60">• {u.email}</span>}
                    {u.twofa_type && u.twofa_type !== 'none' && (
                      <span className="text-panel-accent/80 border border-panel-accent/30 bg-panel-accent/10 px-1 rounded flex items-center gap-1">
                        <Lock size={10} /> 2FA
                      </span>
                    )}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Badge color={u.role === 'admin' ? 'orange' : 'blue'}>
                  {u.roleLabel || u.role}
                </Badge>
                {u.id !== me?.id && u.role !== 'admin' && (
                  <Button size="sm" variant="ghost" onClick={() => {
                    setEditUser(u);
                    setEditForm({ username: u.username, email: u.email || '', password: '', role: u.role });
                  }}>
                    <Pencil size={12} />Bearbeiten
                  </Button>
                )}
                <ActionMenu
                  items={[
                    me?.role === 'admin' && u.twofa_type && u.twofa_type !== 'none' && u.id !== me?.id && {
                      icon: ShieldOff,
                      label: '2FA deaktivieren',
                      onClick: () => disable2FA(u.id),
                      title: 'Zwei-Faktor-Anmeldung dieses Benutzers zurücksetzen',
                    },
                    u.id !== me?.id && u.role !== 'admin' && {
                      icon: Trash2,
                      label: 'Benutzer löschen',
                      danger: true,
                      onClick: () => remove(u.id),
                    },
                  ]}
                />
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

      {/* Modal: Benutzer bearbeiten */}
      {editUser && (
        <Modal open={!!editUser} onClose={() => setEditUser(null)}
          title={`Benutzer bearbeiten: ${editUser.username}`}
          footer={<>
            <Button variant="ghost" size="sm" onClick={() => setEditUser(null)}>Abbrechen</Button>
            <Button size="sm" onClick={saveUser}>Speichern</Button>
          </>}
        >
          <div className="space-y-3">
            <div>
              <label className="block text-xs text-panel-muted mb-1">Benutzername</label>
              <input value={editForm.username} onChange={e => setEditForm(f => ({ ...f, username: e.target.value }))} className={inputCls} />
            </div>
            <div>
              <label className="block text-xs text-panel-muted mb-1">E-Mail-Adresse</label>
              <input type="email" value={editForm.email} onChange={e => setEditForm(f => ({ ...f, email: e.target.value }))} className={inputCls} />
            </div>
            <div>
              <label className="block text-xs text-panel-muted mb-1">Neues Passwort (optional)</label>
              <input type="password" placeholder="Leer lassen, um das Passwort beizubehalten" value={editForm.password} onChange={e => setEditForm(f => ({ ...f, password: e.target.value }))} className={inputCls} />
            </div>
            <div>
              <label className="block text-xs text-panel-muted mb-1">Rolle</label>
              <select value={editForm.role} onChange={e => setEditForm(f => ({ ...f, role: e.target.value }))} className={inputCls}>
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
