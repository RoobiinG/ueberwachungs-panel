import { useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import { ServerSelector } from '../components/ui/ServerSelector';
import { useAuth } from '../context/AuthContext';
import {
  Plus, Trash2, RefreshCw, Shield, ScanSearch, Power,
  Sparkles, Pencil, Clock, CheckCircle, AlertTriangle,
  ChevronDown, ChevronUp,
} from 'lucide-react';

const inputCls = 'w-full bg-panel-surface border border-panel-border rounded-md px-3 py-2 text-sm text-panel-text focus:outline-none focus:border-panel-accent';

const TOOL_LABELS = {
  ufw:       { label: 'UFW',       color: 'text-blue-400',   bg: 'bg-blue-400/10 border-blue-400/30' },
  iptables:  { label: 'iptables',  color: 'text-orange-400', bg: 'bg-orange-400/10 border-orange-400/30' },
  nftables:  { label: 'nftables',  color: 'text-purple-400', bg: 'bg-purple-400/10 border-purple-400/30' },
  firewalld: { label: 'firewalld', color: 'text-red-400',    bg: 'bg-red-400/10 border-red-400/30' },
  none:      { label: 'Kein Tool', color: 'text-gray-500',   bg: 'bg-gray-500/10 border-gray-500/30' },
};

// ─── KI-Analyse Karte ──────────────────────────────────────────────────────────
function AiCard({ apiBase }) {
  const [tips,     setTips]     = useState('');
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState('');
  const [autoScan, setAutoScan] = useState(false);
  const [lastScan, setLastScan] = useState(null);
  const [expanded, setExpanded] = useState(true);
  const intervalRef = useRef(null);

  const analyse = async () => {
    setLoading(true);
    setError('');
    try {
      const { data } = await axios.post(`${apiBase}/firewall/ai-tips`);
      setTips(data.tips || '');
      setLastScan(new Date());
    } catch (err) {
      setError(err.response?.data?.error || 'Analyse fehlgeschlagen');
    }
    setLoading(false);
  };

  // Auto-Scan alle 5 Minuten
  useEffect(() => {
    if (autoScan) {
      analyse();
      intervalRef.current = setInterval(analyse, 5 * 60 * 1000);
    } else {
      clearInterval(intervalRef.current);
    }
    return () => clearInterval(intervalRef.current);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoScan, apiBase]);

  // Tips in nummerierte Abschnitte aufteilen
  const parsedTips = tips
    ? tips.split(/\n(?=\d+\.)/).map(t => t.trim()).filter(Boolean)
    : [];

  return (
    <div className="bg-panel-card border border-panel-border rounded-lg overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-panel-surface/50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <Sparkles size={14} className="text-yellow-400" />
          <span className="text-sm font-semibold text-panel-text">KI-Sicherheitsanalyse</span>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-orange-400/10 text-orange-400 border border-orange-400/20 font-medium">
            Claude
          </span>
          {lastScan && !loading && (
            <span className="text-[10px] text-panel-muted flex items-center gap-1">
              <Clock size={9} />
              {lastScan.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
        </div>
        {expanded ? <ChevronUp size={14} className="text-panel-muted" /> : <ChevronDown size={14} className="text-panel-muted" />}
      </button>

      {expanded && (
        <div className="px-4 pb-4 space-y-3 border-t border-panel-border">
          {/* Steuerung */}
          <div className="flex items-center gap-2 pt-3 flex-wrap">
            <Button size="sm" onClick={analyse} disabled={loading}>
              {loading
                ? <><RefreshCw size={12} className="mr-1.5 animate-spin" />Analysiere…</>
                : <><Sparkles size={12} className="mr-1.5" />Jetzt analysieren</>}
            </Button>

            {/* Auto-Scan Toggle */}
            <label className="flex items-center gap-2 text-xs text-panel-muted cursor-pointer select-none">
              <button
                onClick={() => setAutoScan(v => !v)}
                className={`relative inline-flex h-4 w-7 flex-shrink-0 rounded-full transition-colors ${
                  autoScan ? 'bg-panel-accent' : 'bg-panel-border'
                }`}
              >
                <span className={`inline-block h-3 w-3 transform rounded-full bg-white shadow transition mt-0.5 ${
                  autoScan ? 'translate-x-3.5' : 'translate-x-0.5'
                }`} />
              </button>
              <span>Alle 5 Min. automatisch</span>
              {autoScan && <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />}
            </label>
          </div>

          {/* Fehler */}
          {error && (
            <div className="flex items-start gap-2 bg-panel-red/10 border border-panel-red/30 rounded-md px-3 py-2">
              <AlertTriangle size={13} className="text-panel-red mt-0.5 flex-shrink-0" />
              <p className="text-xs text-panel-red">{error}</p>
            </div>
          )}


          {/* Tipps */}
          {parsedTips.length > 0 && (
            <div className="space-y-2">
              {parsedTips.map((tip, i) => {
                const isDanger = /kritisch|gefährlich|offen|unsicher|warnung|achtung/i.test(tip);
                return (
                  <div
                    key={i}
                    className={`flex items-start gap-2.5 rounded-md px-3 py-2.5 text-sm border ${
                      isDanger
                        ? 'bg-panel-red/8 border-panel-red/20 text-panel-text'
                        : 'bg-panel-surface border-panel-border text-panel-text'
                    }`}
                  >
                    {isDanger
                      ? <AlertTriangle size={13} className="text-panel-red mt-0.5 flex-shrink-0" />
                      : <CheckCircle size={13} className="text-panel-green mt-0.5 flex-shrink-0" />}
                    <p className="text-xs leading-relaxed whitespace-pre-wrap">{tip}</p>
                  </div>
                );
              })}
            </div>
          )}

          {/* Noch keine Analyse */}
          {!tips && !loading && !error && (
            <p className="text-xs text-panel-muted text-center py-2">
              Klicke auf „Jetzt analysieren" — Gemini überprüft deine Firewall-Regeln und gibt einfache Sicherheitstipps.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Haupt-Seite ───────────────────────────────────────────────────────────────
export default function Firewall() {
  const { canWrite } = useAuth();

  const [selectedServer, setSelectedServer] = useState(null);
  const [detectedTool, setDetectedTool]     = useState(null);
  const [detecting, setDetecting]           = useState(false);
  const [toggling,  setToggling]            = useState(false);
  const [status, setStatus]   = useState('');
  const [rules,  setRules]    = useState([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');

  // Regel hinzufügen / bearbeiten
  const [showRuleModal, setShowRuleModal] = useState(false);
  const [editingRule,   setEditingRule]   = useState(null); // null = neu, sonst { id, port, proto, from, action }
  const [form, setForm] = useState({ port: '', proto: 'tcp', from: '', action: 'allow' });

  const apiBase = selectedServer ? `/api/agents/${selectedServer}` : '/api';

  const detect = async () => {
    setDetecting(true);
    let result = { tool: 'none', active: false };
    try {
      const { data } = await axios.get(`${apiBase}/firewall/detect`);
      result = data;
      setDetectedTool(data);
    } catch {
      setDetectedTool(result);
    }
    setDetecting(false);
    return result;
  };

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const detected = await detect();
      // Kein Tool → kein weiterer Abruf nötig
      if (detected.tool === 'none') {
        setStatus('');
        setRules([]);
        setLoading(false);
        return;
      }
      const [s, r] = await Promise.all([
        axios.get(`${apiBase}/firewall/status`),
        axios.get(`${apiBase}/firewall/rules`),
      ]);
      setStatus(s.data.rawOutput || s.data.status || '');
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

  // ── Regel öffnen (neu oder bearbeiten) ──────────────────────────────────────
  const openNew = () => {
    setEditingRule(null);
    setForm({ port: '', proto: 'tcp', from: '', action: 'allow' });
    setShowRuleModal(true);
  };

  const openEdit = (r, displayId) => {
    setEditingRule({ id: displayId });
    setForm({
      port:   r.port ?? r.to ?? '',
      proto:  r.proto && r.proto !== 'any' ? r.proto : 'tcp',
      from:   r.from || '',
      action: (r.action === 'allow' || r.action?.toUpperCase().includes('ALLOW')) ? 'allow' : 'deny',
    });
    setShowRuleModal(true);
  };

  // ── Regel speichern ─────────────────────────────────────────────────────────
  const saveRule = async () => {
    try {
      if (editingRule) {
        await axios.put(`${apiBase}/firewall/rules/${encodeURIComponent(editingRule.id)}`, {
          port: form.port, proto: form.proto, from: form.from || undefined, action: form.action,
        });
      } else {
        await axios.post(`${apiBase}/firewall/${form.action}`, {
          port: form.port, proto: form.proto, from: form.from || undefined,
        });
      }
      setShowRuleModal(false);
      await load();
    } catch (err) {
      setError(err.response?.data?.error || 'Fehler beim Speichern');
    }
  };

  const deleteRule = async (id) => {
    if (!confirm(`Regel ${id} wirklich löschen?`)) return;
    try {
      await axios.delete(`${apiBase}/firewall/rules/${encodeURIComponent(id)}`);
      await load();
    } catch (err) {
      setError(err.response?.data?.error || 'Fehler beim Löschen');
    }
  };

  const toggleFirewall = async () => {
    if (!detectedTool || detectedTool.tool === 'none') return;
    const enable = !detectedTool.active;
    if (!confirm(`Firewall (${toolInfo?.label}) wirklich ${enable ? 'aktivieren' : 'deaktivieren'}?`)) return;
    setToggling(true);
    try {
      await axios.post(`${apiBase}/firewall/toggle`, { enable, tool: detectedTool.tool });
      await load();
    } catch (err) {
      setError(err.response?.data?.error || 'Fehler beim Umschalten');
    }
    setToggling(false);
  };

  const set = (key, val) => setForm(f => ({ ...f, [key]: val }));
  const toolInfo = TOOL_LABELS[detectedTool?.tool] || null;

  return (
    <div className="space-y-3">
      {/* ── Kopfzeile ─────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <ServerSelector selected={selectedServer} onChange={setSelectedServer} />

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

          <button onClick={detect} disabled={detecting}
            className="flex items-center gap-1.5 px-2 py-1 text-xs text-panel-muted hover:text-panel-text border border-panel-border hover:border-panel-accent rounded transition-colors disabled:opacity-50">
            <ScanSearch size={12} className={detecting ? 'animate-spin' : ''} />
            {detecting ? 'Erkenne…' : 'Erkennen'}
          </button>

          {canWrite && detectedTool && detectedTool.tool !== 'none' && (
            <button onClick={toggleFirewall} disabled={toggling}
              className={`flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded border transition-colors disabled:opacity-50
                ${detectedTool.active
                  ? 'bg-panel-red/10 border-panel-red/40 text-panel-red hover:bg-panel-red/20'
                  : 'bg-panel-green/10 border-panel-green/40 text-panel-green hover:bg-panel-green/20'}`}
            >
              <Power size={12} />
              {toggling ? '…' : detectedTool.active ? 'Deaktivieren' : 'Aktivieren'}
            </button>
          )}
        </div>

        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={load}><RefreshCw size={14} className="mr-1" />Aktualisieren</Button>
          {canWrite && (
            <Button size="sm" onClick={openNew}><Plus size={14} className="mr-1" />Regel hinzufügen</Button>
          )}
        </div>
      </div>

      {/* ── Kein Tool gefunden ───────────────────────────────────────────── */}
      {detectedTool?.tool === 'none' && !loading && (
        <div className="bg-panel-orange/10 border border-panel-orange/30 text-panel-orange text-sm rounded-md px-3 py-3">
          ⚠️ Keine aktive Firewall gefunden. Entweder ist kein Tool installiert oder alle installierten Tools sind deaktiviert (UFW, iptables, nftables, firewalld).
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

      {/* ── KI-Analyse ───────────────────────────────────────────────────── */}
      <AiCard apiBase={apiBase} />

      {/* ── Regeln ───────────────────────────────────────────────────────── */}
      <Card title={`Firewall-Regeln (${rules.length})`}>
        {rules.length === 0 ? (
          <div className="text-panel-muted text-sm py-4 text-center">
            {loading ? 'Lade…' : 'Keine Regeln gefunden'}
          </div>
        ) : (
          <div className="-mx-4 -mb-4">
            {/* Tabellenkopf */}
            <div className={`grid gap-2 px-4 py-2 border-b border-panel-border text-[10px] font-semibold text-panel-muted uppercase tracking-wide ${
              canWrite ? 'grid-cols-[2.5rem_1fr_6rem_1fr_auto]' : 'grid-cols-[2.5rem_1fr_6rem_1fr]'
            }`}>
              <span>#</span>
              <span>Port / Ziel</span>
              <span>Aktion</span>
              <span>Von (Quelle)</span>
              {canWrite && <span className="w-14" />}
            </div>

            {rules.map((r, i) => {
              const isAllow = r.action === 'allow' || r.action?.toUpperCase().includes('ALLOW');
              const displayId   = r.id   ?? r.num ?? i + 1;
              const displayPort = r.port ?? r.to  ?? '—';
              return (
                <div
                  key={i}
                  className={`grid gap-2 items-center px-4 py-2.5 border-b border-panel-border/30 last:border-0 hover:bg-panel-surface/50 transition-colors ${
                    canWrite ? 'grid-cols-[2.5rem_1fr_6rem_1fr_auto]' : 'grid-cols-[2.5rem_1fr_6rem_1fr]'
                  }`}
                >
                  <span className="text-[11px] text-panel-muted tabular-nums font-mono">{displayId}</span>
                  <span className="text-xs text-panel-text truncate font-mono">
                    {displayPort}{r.proto && r.proto !== 'any' ? `/${r.proto}` : ''}
                  </span>
                  <span className={`text-xs font-semibold ${isAllow ? 'text-panel-green' : 'text-panel-red'}`}>
                    {isAllow ? '✓ Erlaubt' : '✗ Gesperrt'}
                  </span>
                  <span className="text-xs text-panel-muted truncate">{r.from || 'Alle'}</span>
                  {canWrite && (
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => openEdit(r, displayId)}
                        title="Bearbeiten"
                        className="text-panel-muted hover:text-panel-accent transition-colors p-1 rounded hover:bg-panel-accent/10"
                      >
                        <Pencil size={11} />
                      </button>
                      <button
                        onClick={() => deleteRule(displayId)}
                        title="Löschen"
                        className="text-panel-muted hover:text-panel-red transition-colors p-1 rounded hover:bg-panel-red/10"
                      >
                        <Trash2 size={11} />
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* ── Regel hinzufügen / bearbeiten Modal ─────────────────────────── */}
      <Modal
        open={showRuleModal}
        onClose={() => setShowRuleModal(false)}
        title={editingRule ? `Regel ${editingRule.id} bearbeiten` : 'Neue Firewall-Regel'}
        footer={<>
          <Button variant="ghost" size="sm" onClick={() => setShowRuleModal(false)}>Abbrechen</Button>
          <Button size="sm" onClick={saveRule} disabled={!form.port}>
            {editingRule ? 'Speichern' : 'Hinzufügen'}
          </Button>
        </>}
      >
        <div className="space-y-3">
          <div>
            <label className="block text-xs text-panel-muted mb-1">Was soll passieren?</label>
            <select value={form.action} onChange={e => set('action', e.target.value)} className={inputCls}>
              <option value="allow">✓ Erlauben — Verbindungen auf diesem Port zulassen</option>
              <option value="deny">✗ Sperren — Verbindungen auf diesem Port blockieren</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-panel-muted mb-1">Port</label>
            <input
              value={form.port}
              onChange={e => set('port', e.target.value)}
              placeholder="z.B. 80 (HTTP), 443 (HTTPS), 22 (SSH)"
              className={inputCls}
            />
          </div>
          <div>
            <label className="block text-xs text-panel-muted mb-1">Protokoll</label>
            <select value={form.proto} onChange={e => set('proto', e.target.value)} className={inputCls}>
              <option value="tcp">TCP — für die meisten Dienste (Web, SSH, …)</option>
              <option value="udp">UDP — für DNS, Spiele, VoIP, …</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-panel-muted mb-1">Nur von dieser IP erlauben (optional)</label>
            <input
              value={form.from}
              onChange={e => set('from', e.target.value)}
              placeholder="leer = alle IPs; z.B. 192.168.1.0/24 für Heimnetz"
              className={inputCls}
            />
          </div>
          {detectedTool?.tool && detectedTool.tool !== 'none' && (
            <p className="text-xs text-panel-muted bg-panel-surface rounded px-3 py-2">
              🛡 Wird auf <strong className="text-panel-text">{TOOL_LABELS[detectedTool.tool]?.label}</strong> angewendet
            </p>
          )}
        </div>
      </Modal>
    </div>
  );
}
