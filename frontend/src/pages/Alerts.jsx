import { useEffect, useState } from 'react';
import axios from 'axios';
import {
  Bell, Plus, Trash2, Play, ToggleLeft, ToggleRight,
  AlertTriangle, Clock, CheckCircle, XCircle, Server, Monitor, Info, Webhook
} from 'lucide-react';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import { useAuth } from '../context/AuthContext';
import Webhooks from './Webhooks';

const METRIC_LABELS  = { cpu: 'CPU', memory: 'RAM', disk: 'Disk', net_rx: 'Netzwerk ↓ (RX)', net_tx: 'Netzwerk ↑ (TX)', action: 'Server-Aktionen', patchmon_updates: 'PatchMon Updates', patchmon_security: 'PatchMon Security', hetzner_storage_usage: 'Storage Box', mchost_runtime: 'MC-Host Laufzeit' };
const METRIC_COLORS  = { cpu: 'text-blue-400', memory: 'text-green-400', disk: 'text-yellow-400', net_rx: 'text-purple-400', net_tx: 'text-purple-400', action: 'text-panel-accent', patchmon_updates: 'text-panel-orange', patchmon_security: 'text-panel-red', hetzner_storage_usage: 'text-panel-accent', mchost_runtime: 'text-panel-green' };
const METRIC_UNIT    = { cpu: '%', memory: '%', disk: '%', net_rx: ' MB/s', net_tx: ' MB/s', action: '', patchmon_updates: '', patchmon_security: '', hetzner_storage_usage: '%', mchost_runtime: ' Tage' };
const CONDITION_LABELS = { gt: 'über', lt: 'unter' };

const THRESHOLD_MAX  = { cpu: 100, memory: 100, disk: 100, net_rx: 1000, net_tx: 1000, patchmon_updates: 9999, patchmon_security: 9999, hetzner_storage_usage: 100, mchost_runtime: 365 };
const THRESHOLD_STEP = { cpu: 1, memory: 1, disk: 1, net_rx: 0.5, net_tx: 0.5, patchmon_updates: 1, patchmon_security: 1, hetzner_storage_usage: 1, mchost_runtime: 1 };

// Darstellung der Historien-Einträge je Status. 'failed' bedeutet: Der Alarm hat ausgelöst,
// aber der Webhook kam nicht durch — das darf nicht wie ein normaler Alarm aussehen.
const HISTORY_STYLES = {
  fired:      { label: '⚠️ Ausgelöst',          icon: AlertTriangle, box: 'bg-panel-surface border-panel-border/50',    text: 'text-panel-text',  iconCls: null },
  resolved:   { label: '✅ Erholt',              icon: CheckCircle,   box: 'bg-panel-green/5 border-panel-green/20',     text: 'text-panel-green', iconCls: 'text-panel-green' },
  failed:     { label: '❌ Zustellung fehlgeschlagen', icon: XCircle, box: 'bg-panel-red/10 border-panel-red/30',        text: 'text-panel-red',   iconCls: 'text-panel-red' },
  suppressed: { label: '🔧 Unterdrückt (Wartung)', icon: Clock,       box: 'bg-panel-bg border-panel-border/40 opacity-75', text: 'text-panel-muted', iconCls: 'text-panel-muted' },
};

const emptyCondition = () => ({ metric: 'cpu', condition: 'gt', threshold: 80 });

const defaultForm = {
  name: '', metric: 'cpu', duration_seconds: 60, cooldown_minutes: 30, webhook_id: '',
  agent_ids: [], conditions: [emptyCondition()], logic: 'and', notify_resolved: false, target_ref: [],
};

// ─── Bedingungs-Zeile ──────────────────────────────────────────────────────────
function ConditionRow({ cond, onChange, onRemove, canRemove, activeType }) {
  const inputCls = 'bg-panel-surface border border-panel-border rounded px-2 py-1 text-xs text-panel-text focus:outline-none focus:border-panel-accent';
  const isNet = cond.metric === 'net_rx' || cond.metric === 'net_tx';
  const unit  = METRIC_UNIT[cond.metric] ?? '%';
  return (
    <div className="flex items-center gap-2 bg-panel-bg/60 rounded-lg px-3 py-2.5 border border-panel-border/60">
      {/* Metrik */}
      <select value={cond.metric} onChange={e => onChange({ ...cond, metric: e.target.value })} className={inputCls} disabled={activeType === 'storage' || activeType === 'mchost'}>
        {activeType === 'storage' ? (
          <option value="hetzner_storage_usage">Storage Box</option>
        ) : activeType === 'mchost' ? (
          <option value="mchost_runtime">MC-Host Laufzeit</option>
        ) : (
          <>
            <optgroup label="System">
              <option value="cpu">CPU</option>
              <option value="memory">RAM</option>
              <option value="disk">Disk</option>
            </optgroup>
            <optgroup label="Netzwerk">
              <option value="net_rx">Netz ↓</option>
              <option value="net_tx">Netz ↑</option>
            </optgroup>
          </>
        )}
      </select>
      {/* Bedingung */}
      <select value={cond.condition} onChange={e => onChange({ ...cond, condition: e.target.value })} className={inputCls + ' w-20'}>
        <option value="gt">über</option>
        <option value="lt">unter</option>
      </select>
      {/* Schwellenwert */}
      <input
        type="number" min="0" step={THRESHOLD_STEP[cond.metric] ?? 1}
        max={THRESHOLD_MAX[cond.metric] ?? 100}
        value={cond.threshold}
        onChange={e => onChange({ ...cond, threshold: parseFloat(e.target.value) || 0 })}
        className={inputCls + ' w-20 text-right'}
      />
      <span className="text-xs text-panel-muted w-8">{unit}</span>
      {canRemove && (
        <button onClick={onRemove} className="text-panel-muted hover:text-panel-red transition-colors ml-auto">
          <Trash2 size={12} />
        </button>
      )}
    </div>
  );
}

// ─── Regel-Modal ───────────────────────────────────────────────────────────────
function RuleModal({ open, onClose, onSave, webhooks, agents, initial }) {
  const [form,   setForm]   = useState(defaultForm);
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState('');

  useEffect(() => {
    if (!open) return;
    if (initial) {
      let conds = [];
      try { conds = JSON.parse(initial.conditions || '[]'); } catch {}
      if (conds.length === 0) conds = [{ metric: initial.metric || 'cpu', condition: initial.condition || 'gt', threshold: initial.threshold ?? 80 }];
      let agentIds = [];
      try { agentIds = JSON.parse(initial.agent_ids || '[]'); } catch {}
      let targetRefArr = [];
      try { targetRefArr = JSON.parse(initial.target_ref || '[]'); } catch {
        if (initial.target_ref) targetRefArr = [String(initial.target_ref)];
      }
      setForm({ ...initial, conditions: conds, agent_ids: agentIds, target_ref: targetRefArr, logic: initial.logic || 'and', notify_resolved: !!initial.notify_resolved });
    } else {
      setForm(defaultForm);
    }
    setError('');
  }, [open, initial]);

  const [storageBoxes, setStorageBoxes] = useState([]);
  const [mchostServers, setMchostServers] = useState([]);
  useEffect(() => {
    if (!open) return;
    axios.get('/api/hetzner/storage_boxes').then(r => setStorageBoxes(r.data.boxes || [])).catch(() => setStorageBoxes([]));
    axios.get('/api/mchost/vserver').then(r => setMchostServers(Array.isArray(r.data) ? r.data : [])).catch(() => setMchostServers([]));
  }, [open]);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const isAction   = form.metric === 'action';
  const isPatchmon = form.metric === 'patchmon_updates' || form.metric === 'patchmon_security';
  const isStorage  = form.metric === 'hetzner_storage_usage';
  const isMCHost   = form.metric === 'mchost_runtime';
  const activeType = isAction ? 'action' : isPatchmon ? 'patchmon' : isStorage ? 'storage' : isMCHost ? 'mchost' : 'threshold';

  // Typ umschalten: Metric + passende Bedingungen setzen
  const selectType = (type) => {
    if (type === 'action') {
      set('metric', 'action');
    } else if (type === 'patchmon') {
      setForm(f => ({ ...f, metric: 'patchmon_updates', conditions: [{ metric: 'patchmon_updates', condition: 'gt', threshold: 0 }] }));
    } else if (type === 'storage') {
      setForm(f => ({ ...f, metric: 'hetzner_storage_usage', conditions: [{ metric: 'hetzner_storage_usage', condition: 'gt', threshold: 80 }] }));
    } else if (type === 'mchost') {
      setForm(f => ({ ...f, metric: 'mchost_runtime', conditions: [{ metric: 'mchost_runtime', condition: 'lt', threshold: 7 }] }));
    } else {
      setForm(f => {
        const keep = (f.conditions || []).filter(c => !String(c.metric).startsWith('patchmon') && c.metric !== 'hetzner_storage_usage' && c.metric !== 'mchost_runtime');
        return { ...f, metric: 'cpu', conditions: keep.length ? keep : [emptyCondition()] };
      });
    }
  };

  // PatchMon-Feld ändern (Metrik-Auswahl bzw. Schwelle)
  const setPatchmon = (patch) => setForm(f => {
    const cur = f.conditions?.[0] || { metric: 'patchmon_updates', condition: 'gt', threshold: 0 };
    const next = { ...cur, condition: 'gt', ...patch };
    return { ...f, metric: next.metric, conditions: [next] };
  });

  const toggleServer = (id) => {
    const ids = form.agent_ids || [];
    set('agent_ids', ids.includes(id) ? ids.filter(x => x !== id) : [...ids, id]);
  };

  const updateCond = (i, val) => {
    const next = [...(form.conditions || [])];
    next[i] = val;
    set('conditions', next);
  };
  const addCond    = () => {
    const m = activeType === 'storage' ? 'hetzner_storage_usage' : activeType === 'mchost' ? 'mchost_runtime' : 'cpu';
    const c = activeType === 'mchost' ? 'lt' : 'gt';
    const t = activeType === 'mchost' ? 7 : 80;
    set('conditions', [...(form.conditions || []), { metric: m, condition: c, threshold: t }]);
  };
  const removeCond = (i) => set('conditions', (form.conditions || []).filter((_, idx) => idx !== i));

  const handleSave = async () => {
    if (!form.name.trim()) return setError('Name ist erforderlich');
    if (!form.webhook_id)  return setError('Webhook auswählen');
    if (!isAction && (!form.conditions || form.conditions.length === 0))
      return setError('Mindestens eine Bedingung erforderlich');
    setSaving(true);
    setError('');
    try {
      await onSave({
        ...form,
        metric:           isAction ? 'action' : (form.conditions?.[0]?.metric || 'cpu'),
        conditions:       isAction ? [] : (form.conditions || []),
        logic:            form.logic || 'and',
        duration_seconds: (isAction || isPatchmon || isStorage || isMCHost) ? 0 : parseInt(form.duration_seconds) || 0,
        cooldown_minutes: parseInt(form.cooldown_minutes) || 30,
        webhook_id:       parseInt(form.webhook_id),
        agent_ids:        form.agent_ids || [],
        target_ref:       (isStorage || isMCHost) ? JSON.stringify(form.target_ref || []) : null,
      });
      onClose();
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    }
    setSaving(false);
  };

  const inputCls  = 'w-full bg-panel-surface border border-panel-border rounded-md px-3 py-2 text-sm text-panel-text focus:outline-none focus:border-panel-accent';
  const allServers = [{ id: 'local', name: 'Lokal' }, ...agents.map(a => ({ id: String(a.id), name: a.name }))];

  return (
    <Modal open={open} title={initial?.id ? 'Regel bearbeiten' : 'Neue Alert-Regel'} onClose={onClose}>
      <div className="space-y-3 max-h-[70vh] overflow-y-auto pr-1">
        {error && <p className="text-panel-red text-xs bg-panel-red/10 rounded p-2">{error}</p>}

        {/* Name */}
        <div>
          <label className="text-xs text-panel-muted block mb-1">Name</label>
          <input className={inputCls} value={form.name}
            onChange={e => set('name', e.target.value)} placeholder="z.B. CPU + RAM Überlastung" />
        </div>

        {/* Typ */}
        <div>
          <label className="text-xs text-panel-muted block mb-2">Typ</label>
          <div className="flex flex-wrap gap-2">
            {[
              { key: 'threshold', label: '📊 Schwellenwert' },
              { key: 'patchmon',  label: '🔧 PatchMon-Updates' },
              { key: 'storage',   label: '💾 Storage-Box' },
              { key: 'mchost',    label: '🎮 MC-Host24' },
              { key: 'action',    label: '⚡ Server-Aktionen' },
            ].map(t => (
              <button key={t.key} type="button"
                onClick={() => selectType(t.key)}
                className={`flex-1 min-w-[130px] px-3 py-2 rounded-lg border text-xs font-medium transition-all ${
                  t.key === activeType
                    ? 'border-panel-accent bg-panel-accent/10 text-panel-accent'
                    : 'border-panel-border text-panel-muted hover:border-panel-muted/50 hover:text-panel-text'
                }`}>
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* Server / Target Auswahl */}
        {!isAction && (
        <div>
          <label className="text-xs text-panel-muted block mb-1">
            {isStorage ? 'Storage Boxes' : isMCHost ? 'MC-Host24 VServer' : 'Server'}{' '}
            <span className="text-panel-muted/60 font-normal">
              {isPatchmon ? '(keine Auswahl = alle verknüpften Server)' : '(keine Auswahl = alle automatisch)'}
            </span>
          </label>
          <div className="flex flex-wrap gap-1.5 p-2 bg-panel-surface border border-panel-border rounded-md">
            {isStorage ? (
              storageBoxes.map(s => {
                const checked = (form.target_ref || []).includes(String(s.id));
                return (
                  <button key={s.id} type="button" onClick={() => {
                    const arr = form.target_ref || [];
                    set('target_ref', checked ? arr.filter(x => x !== String(s.id)) : [...arr, String(s.id)]);
                  }}
                    className={`text-xs px-2 py-1 rounded border transition-all ${
                      checked ? 'bg-panel-accent/15 border-panel-accent text-panel-accent'
                              : 'border-panel-border text-panel-muted hover:border-panel-muted/60 hover:text-panel-text'
                    }`}>
                    {s.name}
                  </button>
                );
              })
            ) : isMCHost ? (
              mchostServers.map(s => {
                const checked = (form.target_ref || []).includes(String(s.id));
                return (
                  <button key={s.id} type="button" onClick={() => {
                    const arr = form.target_ref || [];
                    set('target_ref', checked ? arr.filter(x => x !== String(s.id)) : [...arr, String(s.id)]);
                  }}
                    className={`text-xs px-2 py-1 rounded border transition-all ${
                      checked ? 'bg-panel-accent/15 border-panel-accent text-panel-accent'
                              : 'border-panel-border text-panel-muted hover:border-panel-muted/60 hover:text-panel-text'
                    }`}>
                    {s.name || s.hostname || `VServer ${s.id}`}
                  </button>
                );
              })
            ) : (
              <>
                {allServers.map(s => {
                  const checked = (form.agent_ids || []).includes(s.id);
                  return (
                    <button key={s.id} type="button" onClick={() => toggleServer(s.id)}
                      className={`text-xs px-2 py-1 rounded border transition-all ${
                        checked ? 'bg-panel-accent/15 border-panel-accent text-panel-accent'
                                : 'border-panel-border text-panel-muted hover:border-panel-muted/60 hover:text-panel-text'
                      }`}>
                      {s.name}
                    </button>
                  );
                })}
                {(form.agent_ids || []).filter(id => !allServers.find(s => s.id === id)).map(id => (
                  <button key={id} type="button" onClick={() => toggleServer(id)}
                    className="text-xs px-2 py-1 rounded border transition-all bg-panel-red/15 border-panel-red text-panel-red">
                    {`#${id} (gelöscht)`}
                  </button>
                ))}
              </>
            )}
          </div>
        </div>
        )}

        {/* PatchMon-Feld (nur für PatchMon-Typ) */}
        {isPatchmon && (
          <div>
            <label className="text-xs text-panel-muted block mb-1">PatchMon-Überwachung</label>
            <div className="flex items-center gap-2 flex-wrap bg-panel-bg/60 rounded-lg px-3 py-2.5 border border-panel-border/60">
              <select
                value={form.metric}
                onChange={e => setPatchmon({ metric: e.target.value })}
                className="bg-panel-surface border border-panel-border rounded px-2 py-1 text-xs text-panel-text focus:outline-none focus:border-panel-accent"
              >
                <option value="patchmon_updates">Neue Updates</option>
                <option value="patchmon_security">Neue Security-Updates</option>
              </select>
              <span className="text-xs text-panel-muted">mehr als</span>
              <input
                type="number" min="0"
                value={form.conditions?.[0]?.threshold ?? 0}
                onChange={e => setPatchmon({ threshold: parseInt(e.target.value) || 0 })}
                className="w-16 bg-panel-surface border border-panel-border rounded px-2 py-1 text-xs text-panel-text text-right focus:outline-none focus:border-panel-accent"
              />
              <span className="text-xs text-panel-muted">
                {form.metric === 'patchmon_security' ? 'Security-Updates' : 'Updates'}
              </span>
            </div>
            <p className="text-xs text-panel-muted mt-1">
              Meldet nur Server, die mit einem PatchMon-Host verknüpft sind — die Zuordnung steht unter
              <span className="text-panel-text"> Einstellungen › PatchMon-Server-Verknüpfung</span> (oder im Server-Editor).
              Ohne Verknüpfung löst die Regel nie aus.
            </p>
          </div>
        )}

        {/* Bedingungen (nur für Schwellenwert) */}
        {(activeType === 'threshold' || activeType === 'storage' || activeType === 'mchost') && (
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs text-panel-muted">Bedingungen</label>
              {/* Logik-Toggle */}
              {(form.conditions || []).length > 1 && (
                <div className="flex bg-panel-surface border border-panel-border rounded overflow-hidden text-[10px] font-semibold">
                  {['and', 'or'].map(l => (
                    <button key={l} type="button" onClick={() => set('logic', l)}
                      className={`px-2.5 py-1 transition-colors ${
                        form.logic === l ? 'bg-panel-accent text-white' : 'text-panel-muted hover:text-panel-text'
                      }`}>
                      {l === 'and' ? 'ALLE (UND)' : 'EINE (ODER)'}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="space-y-2">
              {(form.conditions || []).map((cond, i) => (
                <ConditionRow key={i} cond={cond}
                  onChange={val => updateCond(i, val)}
                  onRemove={() => removeCond(i)}
                  canRemove={(form.conditions || []).length > 1}
                  activeType={activeType}
                />
              ))}
            </div>
            <button type="button" onClick={addCond}
              className="mt-2 flex items-center gap-1 text-xs text-panel-accent hover:text-blue-400 transition-colors">
              <Plus size={12} />Bedingung hinzufügen
            </button>
          </div>
        )}

        {isAction && (
          <div className="bg-panel-accent/10 border border-panel-accent/30 rounded-md px-3 py-2 text-xs text-panel-accent">
            Wird ausgelöst wenn jemand einen Server startet, stoppt oder neustartet. Kein Schwellenwert nötig.
          </div>
        )}

        {/* Dauer + Cooldown */}
        <div className="grid grid-cols-2 gap-3">
          {(activeType === 'threshold' || activeType === 'storage' || activeType === 'mchost') && (
            <div>
              <label className="text-xs text-panel-muted block mb-1">Dauer (Sek.) bis Auslösung</label>
              <input type="number" min="0" max="3600" className={inputCls}
                value={form.duration_seconds} onChange={e => set('duration_seconds', e.target.value)} />
            </div>
          )}
          <div className={(activeType === 'action' || activeType === 'patchmon') ? 'col-span-2' : ''}>
            <label className="text-xs text-panel-muted mb-1 flex items-center gap-1 group relative">
              Cooldown (Min.)
              <div className="relative">
                <Info size={12} className="text-panel-muted/70 hover:text-panel-text cursor-help" />
                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 w-48 p-2 bg-panel-card border border-panel-border rounded shadow-lg text-[10px] text-panel-muted opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-10">
                  Verhindert Spam: Nach einer Benachrichtigung wird für diese Dauer (in Minuten) keine weitere Warnung für denselben Server gesendet, selbst wenn das Problem weiterhin besteht.
                </div>
              </div>
            </label>
            <input type="number" min="1" max="1440" className={inputCls}
              value={form.cooldown_minutes} onChange={e => set('cooldown_minutes', e.target.value)} />
          </div>
        </div>

        {/* Webhook */}
        <div>
          <label className="text-xs text-panel-muted block mb-1">Benachrichtigung via</label>
          <select className={inputCls} value={form.webhook_id} onChange={e => set('webhook_id', e.target.value)}>
            <option value="">— Webhook auswählen —</option>
            {webhooks.map(w => <option key={w.id} value={w.id}>{w.name} ({w.type})</option>)}
          </select>
          {webhooks.length === 0 && (
            <p className="text-xs text-panel-muted mt-1">Zuerst einen Webhook unter "Webhooks" anlegen.</p>
          )}
          {/* Wiederherstellungs-Benachrichtigung ist immer aktiv (einmal-Modell) */}
          {!isAction && (
            <p className="text-xs text-panel-muted mt-2 flex items-center gap-1.5">
              <span className="text-panel-green">✓</span>
              Erholungs-Benachrichtigung wird immer gesendet
            </p>
          )}
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose}>Abbrechen</Button>
          <Button onClick={handleSave} disabled={saving}>{saving ? 'Speichern...' : 'Speichern'}</Button>
        </div>
      </div>
    </Modal>
  );
}

// ─── Haupt-Seite ───────────────────────────────────────────────────────────────
export default function Alerts() {
  const { user } = useAuth();
  const isAdmin  = user?.role === 'admin';

  const [rules, setRules]       = useState([]);
  const [history, setHistory]   = useState([]);
  const [webhooks, setWebhooks] = useState([]);
  const [agents, setAgents]     = useState([]);
  const [loading, setLoading]   = useState(true);
  const [modalOpen, setModalOpen]   = useState(false);
  const [webhooksModalOpen, setWebhooksModalOpen] = useState(false);
  const [editRule, setEditRule]     = useState(null);
  const [testStatus, setTestStatus] = useState({});

  const load = async () => {
    try {
      const [r, h] = await Promise.all([
        axios.get('/api/alerts/rules'),
        axios.get('/api/alerts/history'),
      ]);
      setRules(r.data);
      setHistory(h.data);
    } catch {}
    setLoading(false);
  };

  useEffect(() => {
    load();
    if (isAdmin) {
      axios.get('/api/webhooks').then(r => setWebhooks(r.data)).catch(() => {});
      axios.get('/api/agents').then(r => setAgents(r.data)).catch(() => {});
    }
  }, [isAdmin]);

  const handleSave = async (form) => {
    // agent_ids als JSON-String für Backend
    const payload = { ...form };
    if (form.id) {
      await axios.put(`/api/alerts/rules/${form.id}`, payload);
    } else {
      await axios.post('/api/alerts/rules', payload);
    }
    await load();
  };

  const toggleEnabled = async (rule) => {
    await axios.put(`/api/alerts/rules/${rule.id}`, { enabled: rule.enabled ? 0 : 1 });
    await load();
  };

  const deleteRule = async (id) => {
    if (!confirm('Regel wirklich löschen?')) return;
    await axios.delete(`/api/alerts/rules/${id}`);
    await load();
  };

  const testRule = async (id) => {
    setTestStatus(s => ({ ...s, [id]: 'loading' }));
    try {
      await axios.post(`/api/alerts/rules/${id}/test`);
      setTestStatus(s => ({ ...s, [id]: 'ok' }));
    } catch {
      setTestStatus(s => ({ ...s, [id]: 'err' }));
    }
    setTimeout(() => setTestStatus(s => { const n = { ...s }; delete n[id]; return n; }), 3000);
  };

  const fmtDate = (s) => {
    if (!s) return '—';
    // SQLite speichert UTC ohne Timezone-Markierung → 'Z' anhängen damit JS korrekt parst
    const iso = s.includes('Z') || s.includes('+') ? s : s.replace(' ', 'T') + 'Z';
    return new Date(iso).toLocaleString('de-DE', {
      day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
      timeZone: 'Europe/Berlin',
    });
  };

  return (
    <div className="space-y-4">
      <RuleModal
        open={modalOpen}
        onClose={() => { setModalOpen(false); setEditRule(null); }}
        onSave={handleSave}
        webhooks={webhooks}
        agents={agents}
        initial={editRule}
      />

      {/* ── Alert-Regeln ──────────────────────────────────────────────────────── */}
      <Card title="Alert-Regeln" action={
        isAdmin && (
          <div className="flex items-center gap-2">
            <Button size="sm" variant="ghost" onClick={() => setWebhooksModalOpen(true)}>
              <Webhook size={14} className="mr-1" />Webhooks verwalten
            </Button>
            <Button size="sm" onClick={() => { setEditRule(null); setModalOpen(true); }}>
              <Plus size={14} className="mr-1" />Neue Regel
            </Button>
          </div>
        )
      }>
        {loading ? (
          <p className="text-panel-muted text-sm py-4 text-center">Lade...</p>
        ) : rules.length === 0 ? (
          <div className="text-center py-8">
            <Bell size={32} className="text-panel-muted mx-auto mb-2 opacity-40" />
            <p className="text-panel-muted text-sm">Noch keine Alert-Regeln angelegt</p>
            {isAdmin && <p className="text-panel-muted text-xs mt-1">Klicke auf "Neue Regel" um loszulegen</p>}
          </div>
        ) : (
          <div className="space-y-2">
            {rules.map(rule => (
              <div key={rule.id}
                className={`p-3 rounded-lg border transition-colors
                  ${rule.enabled ? 'border-panel-border bg-panel-surface' : 'border-panel-border/40 bg-panel-bg opacity-60'}`}>
                <div className="flex items-center gap-3">
                  <AlertTriangle size={15} className={`flex-shrink-0 ${METRIC_COLORS[rule.metric]}`} />
                  <div className="flex-1 min-w-0">
                    {/* Name + Server + Webhook */}
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold text-panel-text">{rule.name}</span>
                      {rule.metric === 'action' && <span className="text-xs text-panel-accent">⚡ Server-Aktion</span>}
                      {/* Logic-Badge */}
                      {rule.metric !== 'action' && (() => {
                        let conds = [];
                        try { conds = JSON.parse(rule.conditions || '[]'); } catch {}
                        if (conds.length > 1) return (
                          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-panel-surface border border-panel-border text-panel-muted">
                            {(rule.logic || 'and') === 'and' ? 'UND' : 'ODER'}
                          </span>
                        );
                      })()}
                      {/* Server-Chips */}
                      {(() => {
                        let ids = [];
                        try { ids = JSON.parse(rule.agent_ids || '[]'); } catch {}
                        if (ids.length === 0) return (
                          <span className="flex items-center gap-1 text-xs text-panel-muted bg-panel-card px-1.5 py-0.5 rounded border border-panel-border/50">
                            <Monitor size={10} />Alle Server
                          </span>
                        );
                        return ids.map(id => (
                          <span key={id} className="flex items-center gap-1 text-xs text-panel-muted bg-panel-card px-1.5 py-0.5 rounded border border-panel-border/50">
                            {id === 'local' ? <><Monitor size={10} />Lokal</> : <><Server size={10} />{agents.find(a => String(a.id) === id)?.name || `#${id}`}</>}
                          </span>
                        ));
                      })()}
                      <span className="text-xs text-panel-muted">→ {rule.webhook_name}</span>
                    </div>
                    {/* Bedingungen-Liste */}
                    {rule.metric !== 'action' && (() => {
                      let conds = [];
                      try { conds = JSON.parse(rule.conditions || '[]'); } catch {}
                      if (conds.length === 0) conds = [{ metric: rule.metric, condition: rule.condition, threshold: rule.threshold }];
                      return (
                        <div className="mt-2 space-y-1">
                          {conds.map((c, i) => {
                            const unit = METRIC_UNIT[c.metric] ?? '%';
                            const isPct = c.metric === 'cpu' || c.metric === 'memory' || c.metric === 'disk';
                            return (
                              <div key={i} className="flex items-center gap-2">
                                <span className="text-[11px] text-panel-muted w-20 flex-shrink-0">
                                  {METRIC_LABELS[c.metric] ?? c.metric}
                                </span>
                                {isPct && (
                                  <div className="flex-1 h-1 bg-panel-bg rounded-full overflow-hidden">
                                    <div className={`h-full rounded-full ${c.threshold >= 80 ? 'bg-panel-red' : c.threshold >= 60 ? 'bg-panel-orange' : 'bg-panel-accent'}`}
                                      style={{ width: `${Math.min(c.threshold, 100)}%` }} />
                                  </div>
                                )}
                                <span className="text-[11px] text-panel-accent font-semibold tabular-nums flex-shrink-0">
                                  {CONDITION_LABELS[c.condition] ?? c.condition} {c.threshold}{unit}
                                </span>
                              </div>
                            );
                          })}
                          <div className="text-[10px] text-panel-muted pt-0.5">Cooldown: {rule.cooldown_minutes} Min.</div>
                        </div>
                      );
                    })()}
                    {rule.metric === 'action' && (
                      <div className="mt-1 text-[10px] text-panel-muted">Cooldown: {rule.cooldown_minutes} Min.</div>
                    )}
                  </div>
                {isAdmin && (
                  <div className="flex items-center gap-1 flex-shrink-0">
                    {/* Test */}
                    <button onClick={() => testRule(rule.id)} title="Test senden"
                      className="p-1.5 rounded hover:bg-panel-card text-panel-muted hover:text-panel-text transition-colors">
                      {testStatus[rule.id] === 'ok'  ? <CheckCircle size={15} className="text-panel-green" /> :
                       testStatus[rule.id] === 'err' ? <XCircle size={15} className="text-panel-red" /> :
                       <Play size={15} />}
                    </button>
                    {/* Toggle */}
                    <button onClick={() => toggleEnabled(rule)} title={rule.enabled ? 'Deaktivieren' : 'Aktivieren'}
                      className="p-1.5 rounded hover:bg-panel-card text-panel-muted hover:text-panel-text transition-colors">
                      {rule.enabled
                        ? <ToggleRight size={15} className="text-panel-accent" />
                        : <ToggleLeft size={15} />
                      }
                    </button>
                    {/* Bearbeiten */}
                    <button onClick={() => { setEditRule(rule); setModalOpen(true); }} title="Bearbeiten"
                      className="p-1.5 rounded hover:bg-panel-card text-panel-muted hover:text-panel-text transition-colors text-xs font-medium">
                      ✎
                    </button>
                    {/* Löschen */}
                    <button onClick={() => deleteRule(rule.id)} title="Löschen"
                      className="p-1.5 rounded hover:bg-panel-card text-panel-muted hover:text-panel-red transition-colors">
                      <Trash2 size={15} />
                    </button>
                  </div>
                )}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* ── Alert-Verlauf ──────────────────────────────────────────────────────── */}
      <Card title="Alert-Verlauf">
        {history.length === 0 ? (
          <p className="text-panel-muted text-sm py-4 text-center">Noch keine Alarme ausgelöst</p>
        ) : (
          <div className="space-y-1.5">
            {history.map(h => {
              const isResolved = h.type === 'resolved';
              const isFailed   = h.type === 'failed';
              const style = HISTORY_STYLES[h.type] || HISTORY_STYLES.fired;
              const Icon  = style.icon;

              let cleanMsg = String(h.message || '').replace(/<[^>]+>/g, '');
              // Vorangestellte Notiz in eckigen Klammern abtrennen — z.B. der Grund einer
              // fehlgeschlagenen Zustellung oder der Hinweis auf den Wartungsmodus.
              let notice = null;
              const noticeMatch = cleanMsg.match(/^\[([^\]]+)\]\s*\n?/);
              if (noticeMatch) {
                notice   = noticeMatch[1];
                cleanMsg = cleanMsg.slice(noticeMatch[0].length);
              }
              // Detail-Zeilen extrahieren (erste Zeile = Header, "Server: …" überspringen)
              const detailLines = cleanMsg
                ? cleanMsg.split('\n').slice(1).filter(l => l.trim() && !l.startsWith('Server:') && !l.startsWith('🖥️'))
                : [];

              return (
                <div key={h.id} className={`p-2.5 rounded-lg text-xs border ${style.box}`}>
                  {/* ── Kopfzeile ── */}
                  <div className="flex items-center gap-2 flex-wrap">
                    <Icon size={13} className={`${style.iconCls || METRIC_COLORS[h.metric] || 'text-panel-orange'} flex-shrink-0`} />
                    <span className={`font-semibold ${style.text}`}>{style.label}</span>
                    <span className="text-panel-text font-medium">{h.rule_name || 'Gelöschte Regel'}</span>
                    <span className="text-panel-muted">{fmtDate(h.triggered_at)}</span>
                    {(h.agent_name || h.agent_id) && (
                      <span className="flex items-center gap-1 text-panel-muted bg-panel-bg px-1.5 py-0.5 rounded border border-panel-border/40">
                        <Server size={10} />{h.agent_name || `Agent #${h.agent_id}`}
                      </span>
                    )}
                  </div>
                  {/* ── Notiz (Zustellfehler / Wartung / abgeschaltete Entwarnung) ── */}
                  {notice && (
                    <p className={`mt-1.5 pl-5 text-[11px] ${isFailed ? 'text-panel-red' : 'text-panel-muted'}`}>
                      {notice}
                    </p>
                  )}
                  {/* ── Detail-Zeilen (Metrik / Wert / Schwelle) ── */}
                  {detailLines.length > 0 && (
                    <div className="mt-1.5 pl-5 space-y-0.5">
                      {detailLines.map((line, i) => (
                        <p key={i} className={`font-mono text-[11px] ${isResolved ? 'text-panel-green/80' : 'text-panel-accent'}`}>
                          {line}
                        </p>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Card>

      <Modal open={webhooksModalOpen} onClose={() => { setWebhooksModalOpen(false); load(); }} title="Webhooks verwalten"
        footer={<Button size="sm" onClick={() => { setWebhooksModalOpen(false); load(); }}>Schließen</Button>}
      >
        <div className="max-h-[70vh] overflow-y-auto -mx-2 px-2">
          <Webhooks />
        </div>
      </Modal>
    </div>
  );
}
