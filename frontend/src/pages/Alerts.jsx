import { useEffect, useState } from 'react';
import axios from 'axios';
import {
  Bell, Plus, Trash2, Play, ToggleLeft, ToggleRight,
  AlertTriangle, Clock, CheckCircle, XCircle, Server, Monitor,
} from 'lucide-react';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import { useAuth } from '../context/AuthContext';

const METRIC_LABELS  = { cpu: 'CPU', memory: 'RAM', disk: 'Disk', net_rx: 'Netzwerk ↓ (RX)', net_tx: 'Netzwerk ↑ (TX)', action: 'Server-Aktionen' };
const METRIC_COLORS  = { cpu: 'text-blue-400', memory: 'text-green-400', disk: 'text-yellow-400', net_rx: 'text-purple-400', net_tx: 'text-purple-400', action: 'text-panel-accent' };
const METRIC_UNIT    = { cpu: '%', memory: '%', disk: '%', net_rx: ' MB/s', net_tx: ' MB/s', action: '' };
const CONDITION_LABELS = { gt: 'über', lt: 'unter' };

const THRESHOLD_MAX  = { cpu: 100, memory: 100, disk: 100, net_rx: 1000, net_tx: 1000 };
const THRESHOLD_STEP = { cpu: 1, memory: 1, disk: 1, net_rx: 0.5, net_tx: 0.5 };

const emptyCondition = () => ({ metric: 'cpu', condition: 'gt', threshold: 80 });

const defaultForm = {
  name: '', metric: 'cpu', duration_seconds: 60, cooldown_minutes: 30, webhook_id: '',
  agent_ids: [], conditions: [emptyCondition()], logic: 'and', notify_resolved: false,
};

// ─── Bedingungs-Zeile ──────────────────────────────────────────────────────────
function ConditionRow({ cond, onChange, onRemove, canRemove }) {
  const inputCls = 'bg-panel-surface border border-panel-border rounded px-2 py-1 text-xs text-panel-text focus:outline-none focus:border-panel-accent';
  const isNet = cond.metric === 'net_rx' || cond.metric === 'net_tx';
  const unit  = METRIC_UNIT[cond.metric] ?? '%';
  return (
    <div className="flex items-center gap-2 bg-panel-bg/60 rounded-lg px-3 py-2.5 border border-panel-border/60">
      {/* Metrik */}
      <select value={cond.metric} onChange={e => onChange({ ...cond, metric: e.target.value })} className={inputCls}>
        <optgroup label="System">
          <option value="cpu">CPU</option>
          <option value="memory">RAM</option>
          <option value="disk">Disk</option>
        </optgroup>
        <optgroup label="Netzwerk">
          <option value="net_rx">Netz ↓</option>
          <option value="net_tx">Netz ↑</option>
        </optgroup>
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
      setForm({ ...initial, conditions: conds, agent_ids: agentIds, logic: initial.logic || 'and', notify_resolved: !!initial.notify_resolved });
    } else {
      setForm(defaultForm);
    }
    setError('');
  }, [open, initial]);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const isAction = form.metric === 'action';

  const toggleServer = (id) => {
    const ids = form.agent_ids || [];
    set('agent_ids', ids.includes(id) ? ids.filter(x => x !== id) : [...ids, id]);
  };

  const updateCond = (i, val) => {
    const next = [...(form.conditions || [])];
    next[i] = val;
    set('conditions', next);
  };
  const addCond    = () => set('conditions', [...(form.conditions || []), emptyCondition()]);
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
        duration_seconds: isAction ? 0 : parseInt(form.duration_seconds) || 0,
        cooldown_minutes: parseInt(form.cooldown_minutes) || 30,
        webhook_id:       parseInt(form.webhook_id),
        agent_ids:        form.agent_ids || [],
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
          <div className="flex gap-2">
            {[
              { val: false, label: '📊 Schwellenwert' },
              { val: true,  label: '⚡ Server-Aktionen' },
            ].map(t => (
              <button key={String(t.val)} type="button"
                onClick={() => set('metric', t.val ? 'action' : (form.conditions?.[0]?.metric || 'cpu'))}
                className={`flex-1 px-3 py-2 rounded-lg border text-xs font-medium transition-all ${
                  t.val === isAction
                    ? 'border-panel-accent bg-panel-accent/10 text-panel-accent'
                    : 'border-panel-border text-panel-muted hover:border-panel-muted/50 hover:text-panel-text'
                }`}>
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* Server */}
        <div>
          <label className="text-xs text-panel-muted block mb-1">
            Server <span className="text-panel-muted/60 font-normal">(keiner = alle)</span>
          </label>
          <div className="flex flex-wrap gap-1.5 p-2 bg-panel-surface border border-panel-border rounded-md">
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
          </div>
        </div>

        {/* Bedingungen (nur für Schwellenwert) */}
        {!isAction && (
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
          {!isAction && (
            <div>
              <label className="text-xs text-panel-muted block mb-1">Dauer (Sek.) bis Auslösung</label>
              <input type="number" min="0" max="3600" className={inputCls}
                value={form.duration_seconds} onChange={e => set('duration_seconds', e.target.value)} />
            </div>
          )}
          <div className={isAction ? 'col-span-2' : ''}>
            <label className="text-xs text-panel-muted block mb-1">Cooldown (Min.)</label>
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
      <Card title={
        <div className="flex items-center justify-between w-full">
          <span>Alert-Regeln</span>
          {isAdmin && (
            <Button size="sm" onClick={() => { setEditRule(null); setModalOpen(true); }}>
              <Plus size={14} className="mr-1" />Neue Regel
            </Button>
          )}
        </div>
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
              return (
                <div key={h.id}
                  className={`flex items-start gap-3 p-2.5 rounded-lg text-xs border
                    ${isResolved
                      ? 'bg-panel-green/5 border-panel-green/20'
                      : 'bg-panel-surface border-panel-border/50'
                    }`}>
                  {isResolved
                    ? <CheckCircle size={14} className="text-panel-green flex-shrink-0 mt-0.5" />
                    : <AlertTriangle size={14} className={`${METRIC_COLORS[h.metric] || 'text-panel-orange'} flex-shrink-0 mt-0.5`} />
                  }
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`font-semibold ${isResolved ? 'text-panel-green' : 'text-panel-text'}`}>
                        {isResolved ? '✅ Erholt' : '⚠️ Ausgelöst'}
                      </span>
                      <span className="text-panel-text">{h.rule_name || 'Gelöschte Regel'}</span>
                      <span className="text-panel-muted">{fmtDate(h.triggered_at)}</span>
                      {h.value != null && (
                        <span className={isResolved ? 'text-panel-green' : 'text-panel-accent'}>
                          {h.value.toFixed(1)}%
                        </span>
                      )}
                      {/* Server-Info */}
                      {(h.agent_name || h.agent_id) && (
                        <span className="flex items-center gap-1 text-panel-muted bg-panel-bg px-1.5 py-0.5 rounded">
                          <Server size={10} />{h.agent_name || `Agent #${h.agent_id}`}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}
