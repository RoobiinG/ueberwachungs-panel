import { useEffect, useState } from 'react';
import axios from 'axios';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Modal } from '../components/ui/Modal';
import { useAuth } from '../context/AuthContext';
import { Plus, Trash2, Send } from 'lucide-react';

const inputCls = 'w-full bg-panel-surface border border-panel-border rounded-md px-3 py-2 text-sm text-panel-text focus:outline-none focus:border-panel-accent';

export default function Webhooks() {
  const { canWrite } = useAuth();
  const [webhooks, setWebhooks] = useState([]);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ name: '', type: 'discord', url: '' });
  const [testLoading, setTestLoading] = useState({});
  const [testResult, setTestResult] = useState({});

  const load = async () => {
    const { data } = await axios.get('/api/webhooks');
    setWebhooks(data);
  };

  useEffect(() => { load(); }, []);

  const save = async () => {
    await axios.post('/api/webhooks', form);
    setShowAdd(false);
    setForm({ name: '', type: 'discord', url: '' });
    load();
  };

  const remove = async (id) => {
    if (!confirm('Webhook löschen?')) return;
    await axios.delete(`/api/webhooks/${id}`);
    load();
  };

  const test = async (id) => {
    setTestLoading(p => ({ ...p, [id]: true }));
    try {
      await axios.post(`/api/webhooks/${id}/test`);
      setTestResult(p => ({ ...p, [id]: 'ok' }));
    } catch {
      setTestResult(p => ({ ...p, [id]: 'err' }));
    }
    setTestLoading(p => ({ ...p, [id]: false }));
    setTimeout(() => setTestResult(p => ({ ...p, [id]: null })), 3000);
  };

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  return (
    <div className="space-y-3">
      {canWrite && (
        <div className="flex justify-end">
          <Button size="sm" onClick={() => setShowAdd(true)}><Plus size={14} className="mr-1" />Webhook hinzufügen</Button>
        </div>
      )}

      <Card title={`Webhooks (${webhooks.length})`}>
        {webhooks.length === 0 ? (
          <div className="text-panel-muted text-sm py-4 text-center">Keine Webhooks konfiguriert</div>
        ) : (
          <div className="divide-y divide-panel-border -mx-4 -mb-4">
            {webhooks.map(w => (
              <div key={w.id} className="flex items-center justify-between px-4 py-3">
                <div className="flex-1 min-w-0 mr-3">
                  <div className="flex items-center gap-2">
                    <Badge color={w.type === 'discord' ? 'purple' : 'blue'}>{w.type}</Badge>
                    <span className="text-sm text-panel-text">{w.name}</span>
                  </div>
                  <div className="text-xs text-panel-muted mt-0.5 truncate">{w.url}</div>
                </div>
                <div className="flex items-center gap-1">
                  {testResult[w.id] && (
                    <span className={`text-xs ${testResult[w.id] === 'ok' ? 'text-panel-green' : 'text-panel-red'}`}>
                      {testResult[w.id] === 'ok' ? '✓' : '✗'}
                    </span>
                  )}
                  <Button size="sm" variant="ghost" onClick={() => test(w.id)} disabled={testLoading[w.id]}
                    title="Test senden">
                    <Send size={12} />
                  </Button>
                  {canWrite && (
                    <Button size="sm" variant="danger" onClick={() => remove(w.id)}>
                      <Trash2 size={12} />
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Modal open={showAdd} onClose={() => setShowAdd(false)} title="Webhook hinzufügen"
        footer={<>
          <Button variant="ghost" size="sm" onClick={() => setShowAdd(false)}>Abbrechen</Button>
          <Button size="sm" onClick={save} disabled={!form.name || !form.url}>Speichern</Button>
        </>}
      >
        <div className="space-y-3">
          <div>
            <label className="block text-xs text-panel-muted mb-1">Name</label>
            <input value={form.name} onChange={e => set('name', e.target.value)} placeholder="z.B. Server-Alerts" className={inputCls} />
          </div>
          <div>
            <label className="block text-xs text-panel-muted mb-1">Typ</label>
            <select value={form.type} onChange={e => set('type', e.target.value)} className={inputCls}>
              <option value="discord">Discord</option>
              <option value="telegram">Telegram</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-panel-muted mb-1">Webhook-URL</label>
            <input
              value={form.url}
              onChange={e => set('url', e.target.value)}
              placeholder={form.type === 'discord' ? 'https://discord.com/api/webhooks/...' : 'https://api.telegram.org/bot<token>/...?chat_id=...'}
              className={inputCls}
            />
          </div>
        </div>
      </Modal>
    </div>
  );
}
