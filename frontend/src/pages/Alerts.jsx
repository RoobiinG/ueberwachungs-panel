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

const defaultForm = {
  name: '', metric: 'cpu', condition: 'gt', threshold: 80,
  duration_seconds: 60, cooldown_minutes: 30, webhook_id: '',
  agent_ids: [], // [] = alle / leeres Array = Lokal + alle (abh. von Auswahl)
};

// ─── Regel-Modal ───────────────────────────────────────────────────────────────
function RuleModal({ open, onClose, onSave, webhooks, agents, initial }) {
  const [form, setForm] = useState(initial || defaultForm);
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState('');

  useEffect(() => {
    if (open) {
      setForm(initial
        ? { ...initial, agent_ids: (() => { try { return JSON.parse(initial.agent_ids || '[]'); } catch { return []; } })() }
        : defaultForm
      );
      setError('');
    }
  }, [open, initial]);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const isAction = form.metric === 'action';
  const isNetwork = form.metric === 'net_rx' || form.metric === 'net_tx';
  const unit = METRIC_UNIT[form.metric] ?? '%';

  const toggleServer = (id) => {
    const ids = form.agent_ids || [];
    set('agent_ids', ids.includes(id) ? ids.filter(x => x !== id) : [...ids, id]);
  };

  const handleSave = async () => {
    if (!form.name.trim()) return setError('Name ist erforderlich');
    if (!form.webhook_id)  return setError('Webhook auswählen');
    setSaving(true);
    setError('');
    try {
      await onSave({
        ...form,
        threshold:        isAction ? 0 : parseFloat(form.threshold),
        condition:        isAction ? 'gt' : form.condition,
        duration_seconds: isAction ? 0 : parseInt(form.duration_seconds),
        cooldown_minutes: parseInt(form.cooldown_minutes),
        webhook_id:       parseInt(form.webhook_id),
        agent_ids:        form.agent_ids || [],
      });
      onClose();
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    }
    setSaving(false);
  };

  const inputCls = 'w-full bg-panel-surface border border-panel-border rounded-md px-3 py-2 text-sm text-panel-text focus:outline-none focus:border-panel-accent';
  const allServers = [{ id: 'local', name: 'Lokal (Panel-Server)' }, ...agents.map(a => ({ id: String(a.id), name: a.name }))];

  return (
    <Modal open={open} title={initial?.id ? 'Regel bearbeiten' : 'Neue Alert-Regel'} onClose={onClose}>
      <div className="space-y-3">
        {error && <p className="text-panel-red text-xs bg-panel-red/10 rounded p-2">{error}</p>}

        {/* Name */}
        <div>
          <label className="text-xs text-panel-muted block mb-1">Name</label>
          <input className={inputCls} value={form.name}
            onChange={e => set('name', e.target.value)} placeholder="z.B. CPU-Überlastung" />
        </div>

        {/* Server — Mehrfachauswahl */}
        <div>
          <label className="text-xs text-panel-muted block mb-1">
            Server <span className="text-panel-muted/60">(keiner = alle)</span>
          </label>
          <div className="flex flex-wrap gap-1.5 p-2 bg-panel-surface border border-panel-border rounded-md">
            {allServers.map(s => {
              const checked = (form.agent_ids || []).includes(s.id);
              return (
                <button key={s.id} type="button" onClick={() => toggleServer(s.id)}
                  className={`text-xs px-2 py-1 rounded border transition-all ${
                    checked
                      ? 'bg-panel-accent/15 border-panel-accent text-panel-accent'
                      : 'border-panel-border text-panel-muted hover:border-panel-muted/60 hover:text-panel-text'
                  }`}>
                  {s.name}
                </button>
              );
            })}
          </div>
        </div>

        {/* Metrik + Bedingung */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-panel-muted block mb-1">Metrik</label>
            <select className={inputCls} value={form.metric} onChange={e => set('metric', e.target.value)}>
              <optgroup label="System">
                <option value="cpu">CPU</option>
                <option value="memory">RAM</option>
                <option value="disk">Disk</option>
              </optgroup>
              <optgroup label="Netzwerk">
                <option value="net_rx">Netzwerk ↓ (RX)</option>
                <option value="net_tx">Netzwerk ↑ (TX)</option>
              </optgroup>
              <optgroup label="Ereignisse">
                <option value="action">Server-Aktionen</option>
              </optgroup>
            </select>
          </div>
          <div>
            <label className="text-xs text-panel-muted block mb-1">Bedingung</label>
            <select className={inputCls} value={form.condition} onChange={e => set('condition', e.target.value)}
              disabled={isAction}>
              <option value="gt">Über (&gt;)</option>
              <option value="lt">Unter (&lt;)</option>
            </select>
          </div>
        </div>

        {/* Schwellenwert — nicht für Action */}
        {!isAction && (
          <div>
            <label className="text-xs text-panel-muted block mb-1">
              Schwellenwert:{' '}
              <span className="text-panel-accent font-semibold">
                {form.threshold}{unit}
              </span>
            </label>
            {isNetwork ? (
              <input type="number" min="0" step="0.1" className={inputCls}
                value={form.threshold} onChange={e => set('threshold', e.target.value)}
                placeholder="z.B. 10 (MB/s)" />
            ) : (
              <>
                <input type="range" min="1" max="100" step="1" className="w-full accent-panel-accent"
                  value={form.threshold} onChange={e => set('threshold', e.target.value)} />
                <div className="flex justify-between text-xs text-panel-muted mt-0.5"><span>1%</span><span>100%</span></div>
              </>
            )}
          </div>
        )}

        {/* Info für Action-Metrik */}
        {isAction && (
          <div className="bg-panel-accent/10 border border-panel-accent/30 rounded-md px-3 py-2 text-xs text-panel-accent">
            Wird ausgelöst wenn jemand einen Server startet, stoppt oder neustartet. Kein Schwellenwert nötig.
          </div>
        )}

        {/* Dauer + Cooldown — Dauer nur für nicht-Action */}
        <div className="grid grid-cols-2 gap-3">
          {!isAction && (
            <div>
              <label className="text-xs text-panel-muted block mb-1">Dauer (Sek.) bis Auslösung</label>
              <input type="number" min="0" max="3600" className={inputCls}
                value={form.duration_seconds} onChange={e => set('duration_seconds', e.target.value)} />
            </div>
          )}
          <div className={isAction ? 'col-span-2' : ''}>
            <label className="text-xs text-panel-muted block mb-1">Cooldown (Min.) zwischen Alarmen</label>
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

  const fmtDate = (s) => s
    ? new Date(s).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
    : '—';

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
                    {/* Titelzeile */}
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold text-panel-text">{rule.name}</span>
                      {rule.metric !== 'action' && (
                        <span className="text-xs text-panel-muted">
                          {METRIC_LABELS[rule.metric]} {CONDITION_LABELS[rule.condition]}{' '}
                          <span className="font-semibold text-panel-accent">
                            {rule.threshold}{METRIC_UNIT[rule.metric] ?? '%'}
                          </span>
                        </span>
                      )}
                      {rule.metric === 'action' && (
                        <span className="text-xs text-panel-accent">bei Server-Aktion</span>
                      )}
                      {rule.duration_seconds > 0 && rule.metric !== 'action' && (
                        <span className="text-xs text-panel-muted flex items-center gap-1">
                          <Clock size={11} />für {rule.duration_seconds}s
                        </span>
                      )}
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
                    {/* Threshold-Balken (nur für Prozent-Metriken) */}
                    {rule.metric !== 'action' && (
                      <div className="mt-2 flex items-center gap-2">
                        {(rule.metric === 'cpu' || rule.metric === 'memory' || rule.metric === 'disk') && (
                          <div className="flex-1 h-1 bg-panel-bg rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full ${
                                rule.threshold >= 80 ? 'bg-panel-red' :
                                rule.threshold >= 60 ? 'bg-panel-orange' : 'bg-panel-accent'
                              }`}
                              style={{ width: `${Math.min(rule.threshold, 100)}%` }}
                            />
                          </div>
                        )}
                        <span className="text-[10px] text-panel-muted tabular-nums">
                          {rule.threshold}{METRIC_UNIT[rule.metric] ?? '%'}
                        </span>
                        <span className="text-[10px] text-panel-muted">Cooldown: {rule.cooldown_minutes} Min.</span>
                      </div>
                    )}
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
