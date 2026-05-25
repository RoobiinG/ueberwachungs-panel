import { useEffect, useState } from 'react';
import axios from 'axios';
import { Bell, Plus, Trash2, Play, ToggleLeft, ToggleRight, AlertTriangle, Clock, CheckCircle, XCircle } from 'lucide-react';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import { useAuth } from '../context/AuthContext';

const METRIC_LABELS  = { cpu: 'CPU', memory: 'RAM', disk: 'Disk' };
const METRIC_COLORS  = { cpu: 'text-blue-400', memory: 'text-green-400', disk: 'text-yellow-400' };
const CONDITION_LABELS = { gt: 'über', lt: 'unter' };

const defaultForm = {
  name: '', metric: 'cpu', condition: 'gt', threshold: 80,
  duration_seconds: 60, cooldown_minutes: 30, webhook_id: '',
};

function RuleModal({ open, onClose, onSave, webhooks, initial }) {
  const [form, setForm] = useState(initial || defaultForm);
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState('');

  useEffect(() => { if (open) { setForm(initial || defaultForm); setError(''); } }, [open, initial]);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleSave = async () => {
    if (!form.name.trim()) return setError('Name ist erforderlich');
    if (!form.webhook_id)   return setError('Webhook auswählen');
    setSaving(true);
    setError('');
    try {
      await onSave({ ...form, threshold: parseFloat(form.threshold), duration_seconds: parseInt(form.duration_seconds), cooldown_minutes: parseInt(form.cooldown_minutes), webhook_id: parseInt(form.webhook_id) });
      onClose();
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    }
    setSaving(false);
  };

  if (!open) return null;
  return (
    <Modal title={initial?.id ? 'Regel bearbeiten' : 'Neue Alert-Regel'} onClose={onClose}>
      <div className="space-y-3">
        {error && <p className="text-panel-red text-xs bg-panel-red/10 rounded p-2">{error}</p>}

        <div>
          <label className="text-xs text-panel-muted block mb-1">Name</label>
          <input className="w-full bg-panel-surface border border-panel-border rounded-md px-3 py-2 text-sm text-panel-text focus:outline-none focus:border-panel-accent"
            value={form.name} onChange={e => set('name', e.target.value)} placeholder="z.B. CPU-Überlastung" />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-panel-muted block mb-1">Metrik</label>
            <select className="w-full bg-panel-surface border border-panel-border rounded-md px-3 py-2 text-sm text-panel-text focus:outline-none focus:border-panel-accent"
              value={form.metric} onChange={e => set('metric', e.target.value)}>
              <option value="cpu">CPU</option>
              <option value="memory">RAM</option>
              <option value="disk">Disk</option>
            </select>
          </div>
          <div>
            <label className="text-xs text-panel-muted block mb-1">Bedingung</label>
            <select className="w-full bg-panel-surface border border-panel-border rounded-md px-3 py-2 text-sm text-panel-text focus:outline-none focus:border-panel-accent"
              value={form.condition} onChange={e => set('condition', e.target.value)}>
              <option value="gt">Über (&gt;)</option>
              <option value="lt">Unter (&lt;)</option>
            </select>
          </div>
        </div>

        <div>
          <label className="text-xs text-panel-muted block mb-1">Schwellenwert (%): <span className="text-panel-accent font-semibold">{form.threshold}%</span></label>
          <input type="range" min="1" max="100" step="1"
            className="w-full accent-panel-accent"
            value={form.threshold} onChange={e => set('threshold', e.target.value)} />
          <div className="flex justify-between text-xs text-panel-muted mt-0.5"><span>1%</span><span>100%</span></div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-panel-muted block mb-1">Dauer (Sek.) bis Auslösung</label>
            <input type="number" min="0" max="3600"
              className="w-full bg-panel-surface border border-panel-border rounded-md px-3 py-2 text-sm text-panel-text focus:outline-none focus:border-panel-accent"
              value={form.duration_seconds} onChange={e => set('duration_seconds', e.target.value)} />
          </div>
          <div>
            <label className="text-xs text-panel-muted block mb-1">Cooldown (Min.) zwischen Alarmen</label>
            <input type="number" min="1" max="1440"
              className="w-full bg-panel-surface border border-panel-border rounded-md px-3 py-2 text-sm text-panel-text focus:outline-none focus:border-panel-accent"
              value={form.cooldown_minutes} onChange={e => set('cooldown_minutes', e.target.value)} />
          </div>
        </div>

        <div>
          <label className="text-xs text-panel-muted block mb-1">Webhook</label>
          <select className="w-full bg-panel-surface border border-panel-border rounded-md px-3 py-2 text-sm text-panel-text focus:outline-none focus:border-panel-accent"
            value={form.webhook_id} onChange={e => set('webhook_id', e.target.value)}>
            <option value="">— Webhook auswählen —</option>
            {webhooks.map(w => <option key={w.id} value={w.id}>{w.name} ({w.type})</option>)}
          </select>
          {webhooks.length === 0 && <p className="text-xs text-panel-muted mt-1">Zuerst einen Webhook unter "Webhooks" anlegen.</p>}
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose}>Abbrechen</Button>
          <Button onClick={handleSave} disabled={saving}>{saving ? 'Speichern...' : 'Speichern'}</Button>
        </div>
      </div>
    </Modal>
  );
}

export default function Alerts() {
  const { user } = useAuth();
  const isAdmin  = user?.role === 'admin';

  const [rules, setRules]       = useState([]);
  const [history, setHistory]   = useState([]);
  const [webhooks, setWebhooks] = useState([]);
  const [loading, setLoading]   = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editRule, setEditRule]   = useState(null);
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
    if (isAdmin) axios.get('/api/webhooks').then(r => setWebhooks(r.data)).catch(() => {});
  }, [isAdmin]);

  const handleSave = async (form) => {
    if (form.id) {
      await axios.put(`/api/alerts/rules/${form.id}`, form);
    } else {
      await axios.post('/api/alerts/rules', form);
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

  const fmtDate = (s) => s ? new Date(s).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';

  return (
    <div className="space-y-4">
      <RuleModal
        open={modalOpen}
        onClose={() => { setModalOpen(false); setEditRule(null); }}
        onSave={handleSave}
        webhooks={webhooks}
        initial={editRule}
      />

      {/* Regeln */}
      <Card title={
        <div className="flex items-center justify-between w-full">
          <span>Alert-Regeln</span>
          {isAdmin && (
            <Button size="sm" onClick={() => { setEditRule(null); setModalOpen(true); }}>
              <Plus size={14} className="mr-1" /> Neue Regel
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
                className={`flex items-center gap-3 p-3 rounded-lg border transition-colors ${rule.enabled ? 'border-panel-border bg-panel-surface' : 'border-panel-border/40 bg-panel-bg opacity-60'}`}>
                <AlertTriangle size={16} className={METRIC_COLORS[rule.metric]} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium text-panel-text">{rule.name}</span>
                    <span className="text-xs text-panel-muted">
                      {METRIC_LABELS[rule.metric]} {CONDITION_LABELS[rule.condition]} <span className="text-panel-accent font-semibold">{rule.threshold}%</span>
                    </span>
                    {rule.duration_seconds > 0 && (
                      <span className="text-xs text-panel-muted flex items-center gap-1">
                        <Clock size={11} /> für {rule.duration_seconds}s
                      </span>
                    )}
                    <span className="text-xs text-panel-muted">→ {rule.webhook_name}</span>
                  </div>
                  <div className="text-xs text-panel-muted mt-0.5">Cooldown: {rule.cooldown_minutes} Min.</div>
                </div>
                {isAdmin && (
                  <div className="flex items-center gap-1">
                    <button onClick={() => testRule(rule.id)} title="Test senden"
                      className="p-1.5 rounded hover:bg-panel-card text-panel-muted hover:text-panel-text transition-colors">
                      {testStatus[rule.id] === 'ok'  ? <CheckCircle size={15} className="text-panel-green" /> :
                       testStatus[rule.id] === 'err' ? <XCircle size={15} className="text-panel-red" /> :
                       <Play size={15} />}
                    </button>
                    <button onClick={() => toggleEnabled(rule)} title={rule.enabled ? 'Deaktivieren' : 'Aktivieren'}
                      className="p-1.5 rounded hover:bg-panel-card text-panel-muted hover:text-panel-text transition-colors">
                      {rule.enabled ? <ToggleRight size={15} className="text-panel-accent" /> : <ToggleLeft size={15} />}
                    </button>
                    <button onClick={() => { setEditRule(rule); setModalOpen(true); }} title="Bearbeiten"
                      className="p-1.5 rounded hover:bg-panel-card text-panel-muted hover:text-panel-text transition-colors text-xs font-medium">
                      ✎
                    </button>
                    <button onClick={() => deleteRule(rule.id)} title="Löschen"
                      className="p-1.5 rounded hover:bg-panel-card text-panel-muted hover:text-panel-red transition-colors">
                      <Trash2 size={15} />
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Alert-History */}
      <Card title="Alert-Verlauf">
        {history.length === 0 ? (
          <p className="text-panel-muted text-sm py-4 text-center">Noch keine Alarme ausgelöst</p>
        ) : (
          <div className="space-y-1.5">
            {history.map(h => (
              <div key={h.id} className="flex items-start gap-3 p-2.5 rounded-lg bg-panel-surface text-xs">
                <AlertTriangle size={14} className={METRIC_COLORS[h.metric] || 'text-panel-muted'} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-panel-text">{h.rule_name || 'Gelöschte Regel'}</span>
                    <span className="text-panel-muted">{fmtDate(h.triggered_at)}</span>
                    {h.value != null && <span className="text-panel-accent">{h.value?.toFixed(1)}%</span>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
