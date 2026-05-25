import { useEffect, useState, useCallback } from 'react';
import axios from 'axios';
import {
  Lock, Plus, Trash2, Pencil, Check, X, ShieldCheck,
  ChevronDown, ChevronRight, Users, Save, Server, Globe,
} from 'lucide-react';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';

const inputCls = 'w-full bg-panel-surface border border-panel-border rounded-md px-3 py-2 text-sm text-panel-text focus:outline-none focus:border-panel-accent transition-colors';

// ─── Hilfsfunktionen ──────────────────────────────────────────────────────────
function groupByCategory(permissions) {
  const map = {};
  for (const p of permissions) {
    if (!map[p.category]) map[p.category] = [];
    map[p.category].push(p);
  }
  return map;
}

// ─── Kategorie-Block ──────────────────────────────────────────────────────────
function CategoryBlock({ category, perms, selected, onChange, locked }) {
  const [open, setOpen] = useState(true);
  const keys  = perms.map(p => p.key);
  const count = keys.filter(k => selected.has(k)).length;
  const all   = count === keys.length;
  const some  = count > 0 && !all;

  const toggleAll = () => {
    const next = new Set(selected);
    if (all) keys.forEach(k => next.delete(k));
    else     keys.forEach(k => next.add(k));
    onChange(next);
  };

  return (
    <div className="border border-panel-border rounded-lg overflow-hidden">
      <div
        className="flex items-center gap-3 px-3 py-2.5 bg-panel-surface cursor-pointer select-none"
        onClick={() => setOpen(o => !o)}>
        {open ? <ChevronDown size={13} className="text-panel-muted" /> : <ChevronRight size={13} className="text-panel-muted" />}
        <span className="text-xs font-semibold text-panel-text flex-1">{category}</span>
        <span className="text-xs text-panel-muted">{count}/{keys.length}</span>
        {!locked && (
          <button
            onClick={e => { e.stopPropagation(); toggleAll(); }}
            className={`text-xs px-2 py-0.5 rounded transition-colors ml-2 ${
              all
                ? 'bg-panel-accent/20 text-panel-accent hover:bg-panel-accent/30'
                : some
                ? 'bg-panel-orange/20 text-panel-orange hover:bg-panel-orange/30'
                : 'bg-panel-surface text-panel-muted hover:bg-panel-card'
            }`}>
            {all ? 'Alle entfernen' : 'Alle auswählen'}
          </button>
        )}
      </div>

      {open && (
        <div className="divide-y divide-panel-border/50">
          {perms.map(p => {
            const active = selected.has(p.key);
            return (
              <label key={p.key} className={`flex items-start gap-3 px-3 py-2.5 transition-colors ${
                locked ? 'opacity-70' : 'cursor-pointer hover:bg-panel-surface/50'
              }`}>
                <div className="mt-0.5 flex-shrink-0">
                  <input
                    type="checkbox"
                    checked={active}
                    disabled={locked}
                    onChange={() => {
                      const next = new Set(selected);
                      if (active) next.delete(p.key); else next.add(p.key);
                      onChange(next);
                    }}
                    className="accent-panel-accent w-3.5 h-3.5"
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium text-panel-text">{p.label}</p>
                  {p.description && <p className="text-xs text-panel-muted mt-0.5">{p.description}</p>}
                </div>
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Haupt-Komponente ─────────────────────────────────────────────────────────
export default function Roles() {
  const [roles,       setRoles]       = useState([]);
  const [permDefs,    setPermDefs]    = useState([]);
  const [allAgents,   setAllAgents]   = useState([]);
  const [selected,    setSelected]    = useState(null);
  const [selPerms,    setSelPerms]    = useState(new Set());
  const [dirty,       setDirty]       = useState(false);
  const [saving,      setSaving]      = useState(false);
  const [saveMsg,     setSaveMsg]     = useState('');

  // Server-Zugriff
  const [agentRestrict,  setAgentRestrict]  = useState(false);
  const [grantedAgents,  setGrantedAgents]  = useState(new Set());
  const [agentsDirty,    setAgentsDirty]    = useState(false);
  const [agentsSaving,   setAgentsSaving]   = useState(false);
  const [agentsSaveMsg,  setAgentsSaveMsg]  = useState('');

  // Rename-Modal
  const [renaming,    setRenaming]    = useState(false);
  const [renameLabel, setRenameLabel] = useState('');
  const [renameErr,   setRenameErr]   = useState('');

  // Create-Modal
  const [creating,    setCreating]    = useState(false);
  const [newLabel,    setNewLabel]    = useState('');
  const [createErr,   setCreateErr]   = useState('');
  const [createLoading, setCreateLoading] = useState(false);

  // ── Laden ──────────────────────────────────────────────────────────────────
  const loadRoles = useCallback(async () => {
    const [rolesRes, permRes, agentsRes] = await Promise.all([
      axios.get('/api/roles'),
      axios.get('/api/roles/permissions'),
      axios.get('/api/agents'),
    ]);
    setRoles(rolesRes.data);
    setPermDefs(permRes.data);
    setAllAgents(agentsRes.data);
  }, []);

  useEffect(() => { loadRoles(); }, [loadRoles]);

  // Wenn Rolle ausgewählt wird → Permissions + Agent-Zugriff laden
  const selectRole = async (role) => {
    setSelected(role);
    setDirty(false);
    setSaveMsg('');
    setAgentsDirty(false);
    setAgentsSaveMsg('');
    if (role.is_admin) {
      setSelPerms(new Set(permDefs.map(p => p.key)));
      setAgentRestrict(false);
      setGrantedAgents(new Set());
      return;
    }
    const [permRes, agentRes] = await Promise.all([
      axios.get(`/api/roles/${role.id}/permissions`),
      axios.get(`/api/roles/${role.id}/agents`),
    ]);
    setSelPerms(new Set(permRes.data));
    setAgentRestrict(agentRes.data.restrictAgents);
    setGrantedAgents(new Set(agentRes.data.agentIds));
  };

  const handlePermChange = (next) => {
    setSelPerms(next);
    setDirty(true);
    setSaveMsg('');
  };

  // ── Berechtigungen speichern ───────────────────────────────────────────────
  const savePerms = async () => {
    if (!selected || selected.is_admin) return;
    setSaving(true); setSaveMsg('');
    try {
      await axios.put(`/api/roles/${selected.id}/permissions`, {
        permissions: [...selPerms],
      });
      setSaveMsg('✓ Gespeichert');
      setDirty(false);
    } catch (err) {
      setSaveMsg(err.response?.data?.error || 'Fehler');
    }
    setSaving(false);
  };

  // ── Server-Zugriff speichern ───────────────────────────────────────────────
  const saveAgentAccess = async () => {
    if (!selected || selected.is_admin) return;
    setAgentsSaving(true); setAgentsSaveMsg('');
    try {
      await axios.put(`/api/roles/${selected.id}/agents`, {
        restrictAgents: agentRestrict,
        agentIds: [...grantedAgents],
      });
      setAgentsSaveMsg('✓ Gespeichert');
      setAgentsDirty(false);
    } catch (err) {
      setAgentsSaveMsg(err.response?.data?.error || 'Fehler');
    }
    setAgentsSaving(false);
  };

  // ── Umbenennen ────────────────────────────────────────────────────────────
  const openRename = () => {
    setRenameLabel(selected.label);
    setRenameErr('');
    setRenaming(true);
  };

  const saveRename = async () => {
    if (!renameLabel.trim()) return setRenameErr('Label erforderlich');
    try {
      await axios.put(`/api/roles/${selected.id}`, { label: renameLabel.trim() });
      setRenaming(false);
      const updated = { ...selected, label: renameLabel.trim() };
      setSelected(updated);
      setRoles(r => r.map(ro => ro.id === selected.id ? updated : ro));
    } catch (err) {
      setRenameErr(err.response?.data?.error || 'Fehler');
    }
  };

  // ── Löschen ───────────────────────────────────────────────────────────────
  const deleteRole = async () => {
    if (!selected || selected.is_system) return;
    if (!confirm(`Rolle "${selected.label}" wirklich löschen?\nBenutzer mit dieser Rolle werden auf "Gast" zurückgesetzt.`)) return;
    await axios.delete(`/api/roles/${selected.id}`);
    setSelected(null);
    setSelPerms(new Set());
    loadRoles();
  };

  // ── Erstellen ─────────────────────────────────────────────────────────────
  const createRole = async () => {
    if (!newLabel.trim()) return setCreateErr('Name erforderlich');
    setCreateLoading(true); setCreateErr('');
    try {
      await axios.post('/api/roles', { label: newLabel.trim(), permissions: [] });
      setNewLabel('');
      setCreating(false);
      loadRoles();
    } catch (err) {
      setCreateErr(err.response?.data?.error || 'Fehler');
    }
    setCreateLoading(false);
  };

  const categories = groupByCategory(permDefs);

  return (
    <div className="flex gap-4 h-[calc(100vh-76px)]">

      {/* ── Linke Spalte: Rollenliste ─────────────────────────────────── */}
      <div className="w-56 flex-shrink-0 flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-panel-text">Rollen ({roles.length})</h2>
          <Button size="sm" onClick={() => { setCreating(true); setNewLabel(''); setCreateErr(''); }}>
            <Plus size={12} className="mr-1" />Neu
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto space-y-1">
          {roles.map(role => (
            <button key={role.id}
              onClick={() => selectRole(role)}
              className={`w-full text-left px-3 py-2.5 rounded-lg text-sm transition-colors flex items-center gap-2 ${
                selected?.id === role.id
                  ? 'bg-panel-accent/15 text-panel-accent border border-panel-accent/30'
                  : 'text-panel-muted hover:text-panel-text hover:bg-panel-card border border-transparent'
              }`}>
              {role.is_admin
                ? <Lock size={13} className="flex-shrink-0 text-panel-orange" />
                : role.is_system
                ? <ShieldCheck size={13} className="flex-shrink-0 text-panel-accent" />
                : <Users size={13} className="flex-shrink-0" />
              }
              <span className="truncate font-medium">{role.label}</span>
              {role.is_admin && (
                <span className="ml-auto text-xs text-panel-orange">Admin</span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* ── Rechte Spalte: Berechtigungen ─────────────────────────────── */}
      <div className="flex-1 min-w-0 flex flex-col gap-3 overflow-hidden">
        {!selected ? (
          <div className="flex-1 flex items-center justify-center text-panel-muted text-sm">
            <div className="text-center">
              <ShieldCheck size={32} className="mx-auto mb-3 opacity-30" />
              <p>Rolle auswählen um Berechtigungen zu verwalten</p>
            </div>
          </div>
        ) : (
          <>
            {/* Header */}
            <div className="flex items-center gap-3 flex-shrink-0">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  {selected.is_admin
                    ? <Lock size={15} className="text-panel-orange" />
                    : selected.is_system
                    ? <ShieldCheck size={15} className="text-panel-accent" />
                    : <Users size={15} className="text-panel-muted" />
                  }
                  <h3 className="text-sm font-semibold text-panel-text">{selected.label}</h3>
                  {selected.is_admin && (
                    <span className="text-xs bg-panel-orange/20 text-panel-orange px-2 py-0.5 rounded">
                      System · Schreibgeschützt
                    </span>
                  )}
                  {!selected.is_admin && selected.is_system && (
                    <span className="text-xs bg-panel-accent/20 text-panel-accent px-2 py-0.5 rounded">
                      Standardrolle
                    </span>
                  )}
                </div>
                {selected.is_admin && (
                  <p className="text-xs text-panel-muted mt-0.5">
                    Root-Administratorrolle — hat alle Berechtigungen. Kann weder bearbeitet, umbenannt noch gelöscht werden. Änderungen nur über ein direktes Code-Update möglich.
                  </p>
                )}
              </div>

              <div className="flex items-center gap-2 flex-shrink-0">
                {saveMsg && (
                  <span className={`text-xs ${saveMsg.startsWith('✓') ? 'text-panel-green' : 'text-panel-red'}`}>
                    {saveMsg}
                  </span>
                )}
                {!selected.is_admin && (
                  <>
                    <Button size="sm" variant="ghost" onClick={openRename}>
                      <Pencil size={12} className="mr-1" />Umbenennen
                    </Button>
                    {!selected.is_system && (
                      <Button size="sm" variant="ghost" onClick={deleteRole}
                        className="text-panel-red hover:bg-panel-red/10">
                        <Trash2 size={12} className="mr-1" />Löschen
                      </Button>
                    )}
                    <Button size="sm" onClick={savePerms} disabled={!dirty || saving}>
                      <Save size={12} className="mr-1" />
                      {saving ? 'Speichere…' : 'Speichern'}
                    </Button>
                  </>
                )}
              </div>
            </div>

            {/* Unsaved-Banner */}
            {dirty && (
              <div className="flex-shrink-0 bg-panel-orange/10 border border-panel-orange/30 rounded-lg px-3 py-2 text-xs text-panel-orange flex items-center gap-2">
                <span>Ungespeicherte Änderungen</span>
                <button onClick={() => { selectRole(selected); setDirty(false); }}
                  className="ml-auto hover:underline">Verwerfen</button>
              </div>
            )}

            {/* Berechtigungen + Server-Zugriff */}
            <div className="flex-1 overflow-y-auto space-y-2 pr-1">
              {Object.entries(categories).map(([cat, perms]) => (
                <CategoryBlock
                  key={cat}
                  category={cat}
                  perms={perms}
                  selected={selPerms}
                  onChange={handlePermChange}
                  locked={!!selected.is_admin}
                />
              ))}

              {/* ── Server-Zugriff ─────────────────────────────────────────── */}
              {!selected.is_admin && (
                <div className="border border-panel-border rounded-lg overflow-hidden">
                  {/* Header */}
                  <div className="flex items-center gap-3 px-3 py-2.5 bg-panel-surface select-none">
                    <Server size={13} className="text-panel-muted flex-shrink-0" />
                    <span className="text-xs font-semibold text-panel-text flex-1">Server-Zugriff</span>
                    <span className="text-xs text-panel-muted">
                      {agentRestrict ? `${grantedAgents.size} / ${allAgents.length}` : 'Alle'}
                    </span>
                    <button
                      onClick={() => { setAgentRestrict(r => !r); setAgentsDirty(true); setAgentsSaveMsg(''); }}
                      className={`text-xs px-2 py-0.5 rounded transition-colors ml-2 ${
                        agentRestrict
                          ? 'bg-panel-orange/20 text-panel-orange hover:bg-panel-orange/30'
                          : 'bg-panel-surface text-panel-muted hover:bg-panel-card border border-panel-border'
                      }`}>
                      {agentRestrict ? 'Einschränkung: AN' : 'Alle Server'}
                    </button>
                  </div>

                  {/* Agent-Liste (nur bei eingeschränktem Modus) */}
                  {agentRestrict && allAgents.length === 0 && (
                    <p className="px-3 py-3 text-xs text-panel-muted">
                      Noch keine Server konfiguriert.
                    </p>
                  )}
                  {agentRestrict && allAgents.length > 0 && (
                    <div className="divide-y divide-panel-border/50">
                      {allAgents.map(agent => {
                        const checked = grantedAgents.has(agent.id);
                        return (
                          <label key={agent.id}
                            className="flex items-center gap-3 px-3 py-2.5 cursor-pointer hover:bg-panel-surface/50 transition-colors">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => {
                                const next = new Set(grantedAgents);
                                if (checked) next.delete(agent.id); else next.add(agent.id);
                                setGrantedAgents(next);
                                setAgentsDirty(true);
                                setAgentsSaveMsg('');
                              }}
                              className="accent-panel-accent w-3.5 h-3.5 flex-shrink-0"
                            />
                            <div className="min-w-0 flex-1">
                              <p className="text-xs font-medium text-panel-text">{agent.name}</p>
                              <p className="text-xs text-panel-muted truncate">{agent.url}</p>
                            </div>
                          </label>
                        );
                      })}
                    </div>
                  )}

                  {/* Info-Text wenn alle Server erlaubt */}
                  {!agentRestrict && (
                    <div className="flex items-center gap-2 px-3 py-2.5 text-xs text-panel-muted">
                      <Globe size={12} />
                      Diese Rolle hat Zugriff auf alle Server.
                    </div>
                  )}

                  {/* Speichern-Leiste */}
                  {(agentsDirty || agentsSaveMsg) && (
                    <div className="px-3 py-2 border-t border-panel-border flex items-center gap-2">
                      {agentsSaveMsg && (
                        <span className={`text-xs ${agentsSaveMsg.startsWith('✓') ? 'text-panel-green' : 'text-panel-red'}`}>
                          {agentsSaveMsg}
                        </span>
                      )}
                      {agentsDirty && (
                        <Button size="sm" className="ml-auto" onClick={saveAgentAccess} disabled={agentsSaving}>
                          <Save size={12} className="mr-1" />
                          {agentsSaving ? 'Speichere…' : 'Server-Zugriff speichern'}
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* ── Modal: Umbenennen ─────────────────────────────────────────── */}
      {renaming && (
        <Modal open={renaming} onClose={() => setRenaming(false)}
          title={`"${selected?.label}" umbenennen`}
          footer={<>
            <Button variant="ghost" size="sm" onClick={() => setRenaming(false)}>Abbrechen</Button>
            <Button size="sm" onClick={saveRename}>Speichern</Button>
          </>}>
          <div className="space-y-3">
            {renameErr && <p className="text-xs text-panel-red">{renameErr}</p>}
            <div>
              <label className="block text-xs text-panel-muted mb-1">Anzeigename</label>
              <input className={inputCls} value={renameLabel}
                onChange={e => setRenameLabel(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && saveRename()} />
            </div>
          </div>
        </Modal>
      )}

      {/* ── Modal: Neue Rolle ──────────────────────────────────────────── */}
      {creating && (
        <Modal open={creating} onClose={() => setCreating(false)}
          title="Neue Rolle erstellen"
          footer={<>
            <Button variant="ghost" size="sm" onClick={() => setCreating(false)}>Abbrechen</Button>
            <Button size="sm" onClick={createRole} disabled={createLoading}>
              {createLoading ? 'Erstelle…' : 'Erstellen'}
            </Button>
          </>}>
          <div className="space-y-3">
            {createErr && <p className="text-xs text-panel-red">{createErr}</p>}
            <div>
              <label className="block text-xs text-panel-muted mb-1">Name der Rolle</label>
              <input className={inputCls} value={newLabel}
                onChange={e => setNewLabel(e.target.value)}
                placeholder="z.B. Monitoring, Support, DevOps…"
                onKeyDown={e => e.key === 'Enter' && createRole()} />
            </div>
            <p className="text-xs text-panel-muted">
              Berechtigungen können nach dem Erstellen zugewiesen werden.
            </p>
          </div>
        </Modal>
      )}
    </div>
  );
}
