import { useEffect, useState } from 'react';
import axios from 'axios';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import { ServerSelector } from '../components/ui/ServerSelector';
import { useAuth } from '../context/AuthContext';
import { Plus, Trash2, RefreshCw, Shield, ScanSearch } from 'lucide-react';

const inputCls = 'w-full bg-panel-surface border border-panel-border rounded-md px-3 py-2 text-sm text-panel-text focus:outline-none focus:border-panel-accent';

const TOOL_LABELS = {
  ufw:       { label: 'UFW',       color: 'text-blue-400',   bg: 'bg-blue-400/10 border-blue-400/30' },
  iptables:  { label: 'iptables',  color: 'text-orange-400', bg: 'bg-orange-400/10 border-orange-400/30' },
  nftables:  { label: 'nftables',  color: 'text-purple-400', bg: 'bg-purple-400/10 border-purple-400/30' },
  firewalld: { label: 'firewalld', color: 'text-red-400',    bg: 'bg-red-400/10 border-red-400/30' },
  none:      { label: 'Kein Tool', color: 'text-gray-500',   bg: 'bg-gray-500/10 border-gray-500/30' },
};

export default function Firewall() {
  const { canWrite } = useAuth();

  const [selectedServer, setSelectedServer] = useState(null);
  const [detectedTool, setDetectedTool]     = useState(null);   // { tool, active }
  const [detecting, setDetecting]           = useState(false);
  const [status, setStatus]   = useState('');
  const [rules,  setRules]    = useState([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm]       = useState({ port: '', proto: 'tcp', from: '', action: 'allow' });

  const apiBase = selectedServer ? `/api/agents/${selectedServer}` : '/api';

  // ── Firewall erkennen ──────────────────────────────────────────────────────
  const detect = async () => {
    setDetecting(true);
    try {
      const { data } = await axios.get(`${apiBase}/firewall/detect`);
      setDetectedTool(data);
    } catch {
      setDetectedTool({ tool: 'none', active: false });
    }
    setDetecting(false);
  };

  // ── Daten laden ────────────────────────────────────────────────────────────
  const load = async () => {
    setLoading(true);
    setError('');
    try {
      await detect();
      const [s, r] = await Promise.all([
        axios.get(`${apiBase}/firewall/status`),
        axios.get(`${apiBase}/firewall/rules`),
      ]);
      setStatus(s.data.rawOutput || s.data.status || '');
      // Neue API gibt { tool, rules }, alte gibt Array direkt
      setRules(Array.isArray(r.data) ? r.data : (r.data.rules || []));
    } catch (err) {
      setError(err.response?.data?.error || 'Firewall nicht erreichbar');
    }
    setLoading(false);
  };

  useEffect(() => {
    setStatus(''); setRules([]); setDetectedTool(null);
    load();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedServer]);

  const addRule = async () => {
    try {
      await axios.post(`${apiBase}/firewall/${form.action}`, {
        port: form.port, proto: form.proto, from: form.from || undefined,
      });
      setShowAdd(false);
      setForm({ port: '', proto: 'tcp', from: '', action: 'allow' });
      await load();
    } catch (err) {
      setError(err.response?.data?.error || 'Fehler beim Hinzufügen');
    }
  };

  const deleteRule = async (id) => {
    if (!confirm(`Regel ${id} löschen?`)) return;
    try {
      await axios.delete(`${apiBase}/firewall/rules/${encodeURIComponent(id)}`);
      await load();
    } catch (err) {
      setError(err.response?.data?.error || 'Fehler beim Löschen');
    }
  };

  const set = (key, val) => setForm(f => ({ ...f, [key]: val }));
  const toolInfo = TOOL_LABELS[detectedTool?.tool] || null;

  return (
    <div className="space-y-3">
      {/* ── Kopfzeile ─────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <ServerSelector selected={selectedServer} onChange={setSelectedServer} />

          {/* Tool-Badge */}
          {toolInfo && (
            <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded border text-xs font-semibold ${toolInfo.bg} ${toolInfo.color}`}>
              <Shield size={11} />
              {toolInfo.label}
              {detectedTool && (
                <span className={`w-1.5 h-1.5 rounded-full ${detectedTool.active ? 'bg-green-400' : 'bg-red-400'}`} />
              )}
              {detectedTool?.active ? 'aktiv' : 'inaktiv'}
            </span>
          )}

          {/* Erkennungs-Button */}
          <button onClick={detect} disabled={detecting}
            className="flex items-center gap-1.5 px-2 py-1 text-xs text-panel-muted hover:text-panel-text border border-panel-border hover:border-panel-accent rounded transition-colors disabled:opacity-50">
            <ScanSearch size={12} className={detecting ? 'animate-spin' : ''} />
            {detecting ? 'Erkenne…' : 'Erkennen'}
          </button>
        </div>

        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={load}><RefreshCw size={14} className="mr-1" />Aktualisieren</Button>
          {canWrite && (
            <Button size="sm" onClick={() => setShowAdd(true)}><Plus size={14} className="mr-1" />Regel hinzufügen</Button>
          )}
        </div>
      </div>

      {/* ── Kein Tool gefunden ────────────────────────────────────────────── */}
      {detectedTool?.tool === 'none' && !loading && (
        <div className="bg-panel-orange/10 border border-panel-orange/30 text-panel-orange text-sm rounded-md px-3 py-3">
          ⚠️ Kein unterstütztes Firewall-Tool gefunden. Bitte installiere UFW, iptables, nftables oder firewalld.
        </div>
      )}

      {/* ── Fehler ───────────────────────────────────────────────────────── */}
      {error && (
        <div className="bg-panel-orange/10 border border-panel-orange/30 text-panel-orange text-sm rounded-md px-3 py-2">
          {!selectedServer && (error.includes('nsenter') || error.includes('Operation not permitted'))
            ? <>nsenter fehlgeschlagen — <code className="bg-panel-surface px-1 rounded font-mono text-xs">privileged: true</code> und <code className="bg-panel-surface px-1 rounded font-mono text-xs">pid: "host"</code> in der Compose-Datei ergänzen.</>
            : error}
        </div>
      )}

      {/* ── Status ───────────────────────────────────────────────────────── */}
      {status && (
        <div className="bg-panel-card border border-panel-border rounded-lg p-3">
          <div className="flex items-center gap-2 mb-2">
            <span className={`w-2 h-2 rounded-full ${detectedTool?.active ? 'bg-panel-green' : 'bg-panel-red'}`} />
            <span className="text-xs font-semibold text-panel-text">
              {toolInfo?.label || 'Firewall'} {detectedTool?.active ? 'aktiv' : 'inaktiv'}
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

      {/* ── Regeln ───────────────────────────────────────────────────────── */}
      <Card title={`Firewall-Regeln (${rules.length})`}>
        {rules.length === 0 ? (
          <div className="text-panel-muted text-sm py-4 text-center">
            {loading ? 'Lade…' : 'Keine Regeln gefunden'}
          </div>
        ) : (
          <div className="-mx-4 -mb-4">
            <div className="grid grid-cols-[2.5rem_1fr_6rem_1fr_2.5rem] gap-2 px-4 py-2 border-b border-panel-border text-[10px] font-semibold text-panel-muted uppercase tracking-wide">
              <span>#</span>
              <span>Port / Ziel</span>
              <span>Aktion</span>
              <span>Von</span>
              {canWrite && <span />}
            </div>
            {rules.map((r, i) => {
              const isAllow = r.action === 'allow' || r.action?.toUpperCase().includes('ALLOW');
              const displayId   = r.id   ?? r.num ?? i + 1;
              const displayPort = r.port ?? r.to  ?? '—';
              return (
                <div key={i} className="grid grid-cols-[2.5rem_1fr_6rem_1fr_2.5rem] gap-2 items-center px-4 py-2.5 border-b border-panel-border/30 last:border-0 hover:bg-panel-surface/50 transition-colors">
                  <span className="text-[11px] text-panel-muted tabular-nums font-mono">{displayId}</span>
                  <span className="text-xs text-panel-text truncate font-mono">{displayPort}{r.proto && r.proto !== 'any' ? `/${r.proto}` : ''}</span>
                  <span className={`text-xs font-semibold ${isAllow ? 'text-panel-green' : 'text-panel-red'}`}>
                    {isAllow ? '✓ Allow' : '✗ Deny'}
                  </span>
                  <span className="text-xs text-panel-muted truncate">{r.from || 'any'}</span>
                  {canWrite && (
                    <button onClick={() => deleteRule(displayId)}
                      className="text-panel-muted hover:text-panel-red transition-colors p-1 rounded hover:bg-panel-red/10">
                      <Trash2 size={12} />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* ── Regel hinzufügen Modal ───────────────────────────────────────── */}
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
            <input value={form.port} onChange={e => set('port', e.target.value)}
              placeholder="z.B. 80 oder 8080:8090" className={inputCls} />
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
            <input value={form.from} onChange={e => set('from', e.target.value)}
              placeholder="z.B. 192.168.1.0/24" className={inputCls} />
          </div>
          {detectedTool?.tool && detectedTool.tool !== 'none' && (
            <p className="text-xs text-panel-muted">
              🛡 Wird auf <strong className="text-panel-text">{TOOL_LABELS[detectedTool.tool]?.label}</strong> angewendet
            </p>
          )}
        </div>
      </Modal>
    </div>
  );
}
