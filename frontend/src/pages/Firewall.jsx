import { useEffect, useState } from 'react';
import axios from 'axios';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import { ServerSelector } from '../components/ui/ServerSelector';
import { useAuth } from '../context/AuthContext';
import { Plus, Trash2, RefreshCw } from 'lucide-react';

const inputCls = 'w-full bg-panel-surface border border-panel-border rounded-md px-3 py-2 text-sm text-panel-text focus:outline-none focus:border-panel-accent';

export default function Firewall() {
  const { canWrite } = useAuth();

  const [selectedServer, setSelectedServer] = useState(null); // null = lokal
  const [status, setStatus] = useState('');
  const [rules, setRules]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm]       = useState({ port: '', proto: 'tcp', from: '', action: 'allow' });

  const apiBase = selectedServer ? `/api/agents/${selectedServer}` : '/api';

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const [s, r] = await Promise.all([
        axios.get(`${apiBase}/firewall/status`),
        axios.get(`${apiBase}/firewall/rules`),
      ]);
      setStatus(s.data.status);
      setRules(r.data);
    } catch (err) {
      setError(err.response?.data?.error || 'UFW nicht erreichbar');
    }
    setLoading(false);
  };

  useEffect(() => {
    setStatus('');
    setRules([]);
    load();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedServer]);

  const addRule = async () => {
    try {
      await axios.post(`${apiBase}/firewall/${form.action}`, {
        port: form.port,
        proto: form.proto,
        from: form.from || undefined,
      });
      setShowAdd(false);
      setForm({ port: '', proto: 'tcp', from: '', action: 'allow' });
      await load();
    } catch (err) {
      setError(err.response?.data?.error || 'Fehler beim Hinzufügen der Regel');
    }
  };

  const deleteRule = async (num) => {
    if (!confirm(`Regel ${num} löschen?`)) return;
    try {
      await axios.delete(`${apiBase}/firewall/rules/${num}`);
      await load();
    } catch (err) {
      setError(err.response?.data?.error || 'Fehler beim Löschen der Regel');
    }
  };

  const set = (key, val) => setForm(f => ({ ...f, [key]: val }));

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <ServerSelector selected={selectedServer} onChange={setSelectedServer} />
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={load}><RefreshCw size={14} className="mr-1" />Aktualisieren</Button>
          {canWrite && (
            <Button size="sm" onClick={() => setShowAdd(true)}><Plus size={14} className="mr-1" />Regel hinzufügen</Button>
          )}
        </div>
      </div>

      {error && (
        <div className="bg-panel-orange/10 border border-panel-orange/30 text-panel-orange text-sm rounded-md px-3 py-2">
          {!selectedServer && (error.includes('nsenter') || error.includes('Operation not permitted'))
            ? <>nsenter fehlgeschlagen — <code className="bg-panel-surface px-1 rounded font-mono text-xs">privileged: true</code> und <code className="bg-panel-surface px-1 rounded font-mono text-xs">pid: "host"</code> in der Compose-Datei ergänzen.</>
            : error}
        </div>
      )}

      {/* UFW Status */}
      {status && (
        <div className="bg-panel-card border border-panel-border rounded-lg p-3">
          <div className="flex items-center gap-2 mb-2">
            <span className={`w-2 h-2 rounded-full ${status.includes('active') ? 'bg-panel-green' : 'bg-panel-red'}`} />
            <span className="text-xs font-semibold text-panel-text">
              {status.includes('active') ? 'UFW aktiv' : 'UFW inaktiv'}
            </span>
          </div>
          <details>
            <summary className="text-xs text-panel-muted cursor-pointer hover:text-panel-text transition-colors select-none">
              Vollständige Ausgabe anzeigen
            </summary>
            <pre className="text-xs font-mono text-panel-muted whitespace-pre-wrap bg-panel-surface rounded-md p-3 mt-2 max-h-40 overflow-y-auto">
              {status}
            </pre>
          </details>
        </div>
      )}

      <Card title={`Firewall-Regeln (${rules.length})`}>
        {rules.length === 0 ? (
          <div className="text-panel-muted text-sm py-4 text-center">
            {loading ? 'Lade…' : 'Keine Regeln gefunden'}
          </div>
        ) : (
          <div className="-mx-4 -mb-4">
            <div className="grid grid-cols-[2rem_1fr_6rem_1fr_2.5rem] gap-2 px-4 py-2 border-b border-panel-border text-[10px] font-semibold text-panel-muted uppercase tracking-wide">
              <span>#</span>
              <span>Ziel</span>
              <span>Aktion</span>
              <span>Von</span>
              {canWrite && <span />}
            </div>
            {rules.map((r, i) => (
              <div key={i} className="grid grid-cols-[2rem_1fr_6rem_1fr_2.5rem] gap-2 items-center px-4 py-2.5 table-row">
                <span className="text-[11px] text-panel-muted tabular-nums">{r.num}</span>
                <span className="text-xs text-panel-text truncate font-mono">{r.to}</span>
                <span className={`text-xs font-semibold ${r.action?.includes('ALLOW') ? 'text-panel-green' : 'text-panel-red'}`}>
                  {r.action}
                </span>
                <span className="text-xs text-panel-muted truncate">{r.from}</span>
                {canWrite && (
                  <Button size="sm" variant="ghost" onClick={() => deleteRule(r.num)}
                    className="text-panel-red hover:bg-panel-red/10 border-0 p-1">
                    <Trash2 size={12} />
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>

      <Modal open={showAdd} onClose={() => setShowAdd(false)} title="Neue Firewall-Regel"
        footer={<>
          <Button variant="ghost" size="sm" onClick={() => setShowAdd(false)}>Abbrechen</Button>
          <Button size="sm" onClick={addRule} disabled={!form.port}>Hinzufügen</Button>
        </>}
      >
        <div className="space-y-3">
          <div>
            <label className="block text-xs text-panel-muted mb-1">Aktion</label>
            <select value={form.action} onChange={e => set('action', e.target.value)} className={inputCls}>
              <option value="allow">Erlauben</option>
              <option value="deny">Sperren</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-panel-muted mb-1">Port</label>
            <input value={form.port} onChange={e => set('port', e.target.value)} placeholder="z.B. 80 oder 8080" className={inputCls} />
          </div>
          <div>
            <label className="block text-xs text-panel-muted mb-1">Protokoll</label>
            <select value={form.proto} onChange={e => set('proto', e.target.value)} className={inputCls}>
              <option value="tcp">TCP</option>
              <option value="udp">UDP</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-panel-muted mb-1">Von IP (optional)</label>
            <input value={form.from} onChange={e => set('from', e.target.value)} placeholder="z.B. 192.168.1.0/24" className={inputCls} />
          </div>
        </div>
      </Modal>
    </div>
  );
}
