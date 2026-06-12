import { useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import { ServerSelector } from '../components/ui/ServerSelector';
import { useAuth } from '../context/AuthContext';
import {
  Plus, Trash2, RefreshCw, Shield, ScanSearch, Power,
  Pencil, ChevronLeft, ChevronRight, Search, X, Filter,
} from 'lucide-react';

const inputCls = 'w-full bg-panel-surface border border-panel-border rounded-md px-3 py-2 text-sm text-panel-text focus:outline-none focus:border-panel-accent';

const TOOL_LABELS = {
  ufw:       { label: 'UFW',       color: 'text-blue-400',   bg: 'bg-blue-400/10 border-blue-400/30' },
  iptables:  { label: 'iptables',  color: 'text-orange-400', bg: 'bg-orange-400/10 border-orange-400/30' },
  nftables:  { label: 'nftables',  color: 'text-purple-400', bg: 'bg-purple-400/10 border-purple-400/30' },
  firewalld: { label: 'firewalld', color: 'text-red-400',    bg: 'bg-red-400/10 border-red-400/30' },
  none:      { label: 'Kein Tool', color: 'text-gray-500',   bg: 'bg-gray-500/10 border-gray-500/30' },
};

const PAGE_SIZE = 25;

export default function Firewall() {
  const { canWrite } = useAuth();

  const [selectedServer, setSelectedServer] = useState(null);
  const [detectedTool,   setDetectedTool]   = useState(null);
  const [detecting,  setDetecting]  = useState(false);
  const [toggling,   setToggling]   = useState(false);
  const [status,     setStatus]     = useState('');
  const [rules,      setRules]      = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState('');

  // Filter + Paginierung
  const [search,     setSearch]     = useState('');
  const [filterAct,  setFilterAct]  = useState('all'); // 'all' | 'allow' | 'deny'
  const [page,       setPage]       = useState(1);

  // Regel-Modal
  const [showRuleModal, setShowRuleModal] = useState(false);
  const [editingRule,   setEditingRule]   = useState(null);
  const [form, setForm] = useState({ port: '', proto: 'tcp', from: '', action: 'allow' });

  const apiBase = selectedServer ? `/api/agents/${selectedServer}` : '/api';

  // ── Erkennung ──────────────────────────────────────────────────────────────
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

  // ── Laden ──────────────────────────────────────────────────────────────────
  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const detected = await detect();
      if (detected.tool === 'none') {
        setStatus(''); setRules([]);
        setLoading(false);
        return;
      }
      const [s, r] = await Promise.all([
        axios.get(`${apiBase}/firewall/status`),
        axios.get(`${apiBase}/firewall/rules`),
      ]);
      setStatus(s.data.rawOutput || s.data.status || '');
      setRules(Array.isArray(r.data) ? r.data : (r.data.rules || []));
      setPage(1);
    } catch (err) {
      setError(err.response?.data?.error || 'Firewall nicht erreichbar');
    }
    setLoading(false);
  };

  useEffect(() => {
    setStatus(''); setRules([]); setDetectedTool(null); setSearch(''); setFilterAct('all');
    load();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedServer]);

  // ── Modal öffnen ───────────────────────────────────────────────────────────
  const openNew = () => {
    setEditingRule(null);
    setForm({ port: '', proto: 'tcp', from: '', action: 'allow' });
    setShowRuleModal(true);
  };

  const openEdit = (r, displayId) => {
    setEditingRule({ id: displayId });
    setForm({
      port:   r.port !== 'any' ? (r.port ?? r.to ?? '') : '',
      proto:  r.proto && r.proto !== 'any' ? r.proto : 'tcp',
      from:   r.from !== 'any' ? (r.from || '') : '',
      action: (r.action === 'allow' || r.action?.toUpperCase?.().includes('ALLOW')) ? 'allow' : 'deny',
    });
    setShowRuleModal(true);
  };

  // ── Regel speichern ────────────────────────────────────────────────────────
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

  const setF = (key, val) => setForm(f => ({ ...f, [key]: val }));
  const toolInfo = TOOL_LABELS[detectedTool?.tool] || null;

  // ── Gefilterte + paginierte Regeln ─────────────────────────────────────────
  const filtered = rules.filter(r => {
    const q = search.toLowerCase();
    const matchSearch = !q || [r.port, r.proto, r.from, String(r.id)].some(v => String(v ?? '').toLowerCase().includes(q));
    const matchAction = filterAct === 'all' || r.action === filterAct
      || (filterAct === 'allow' && r.action?.toUpperCase?.().includes('ALLOW'))
      || (filterAct === 'deny'  && !r.action?.toUpperCase?.().includes('ALLOW'));
    return matchSearch && matchAction;
  });

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paginated  = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const allowCount = rules.filter(r => r.action === 'allow' || r.action?.toUpperCase?.().includes('ALLOW')).length;
  const denyCount  = rules.length - allowCount;

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-3">

      {/* Kopfzeile */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <ServerSelector selected={selectedServer} onChange={setSelectedServer} />

          {toolInfo && (
            <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded border text-xs font-semibold ${toolInfo.bg} ${toolInfo.color}`}>
              <Shield size={11} />
              {toolInfo.label}
              <span className={`w-1.5 h-1.5 rounded-full ${detectedTool?.active ? 'bg-green-400' : 'bg-red-400'}`} />
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
          {canWrite && <Button size="sm" onClick={openNew}><Plus size={14} className="mr-1" />Regel hinzufügen</Button>}
        </div>
      </div>

      {/* Kein Tool */}
      {detectedTool?.tool === 'none' && !loading && (
        <div className="bg-panel-orange/10 border border-panel-orange/30 text-panel-orange text-sm rounded-md px-3 py-3">
          ⚠️ Keine aktive Firewall gefunden (UFW, iptables, nftables oder firewalld).
        </div>
      )}

      {/* Fehler */}
      {error && (
        <div className="bg-panel-orange/10 border border-panel-orange/30 text-panel-orange text-sm rounded-md px-3 py-2">
          {!selectedServer && (error.includes('nsenter') || error.includes('Operation not permitted'))
            ? <>nsenter fehlgeschlagen — <code className="bg-panel-surface px-1 rounded font-mono text-xs">privileged: true</code> und <code className="bg-panel-surface px-1 rounded font-mono text-xs">pid: "host"</code> ergänzen.</>
            : error}
        </div>
      )}

      {/* Status */}
      {status && (
        <div className="bg-panel-card border border-panel-border rounded-lg p-3">
          <div className="flex items-center gap-2 mb-2">
            <span className={`w-2 h-2 rounded-full ${detectedTool?.active ? 'bg-panel-green' : 'bg-panel-red'}`} />
            <span className="text-xs font-semibold text-panel-text">
              {toolInfo?.label || 'Firewall'} {detectedTool?.active ? 'aktiv' : 'inaktiv'}
            </span>
          </div>
          <details>
            <summary className="text-xs text-panel-muted cursor-pointer hover:text-panel-text transition-colors select-none">Vollständige Ausgabe anzeigen</summary>
            <pre className="text-xs font-mono text-panel-muted whitespace-pre-wrap bg-panel-surface rounded-md p-3 mt-2 max-h-40 overflow-y-auto">{status}</pre>
          </details>
        </div>
      )}

      {/* Regeln */}
      <div className="bg-panel-card border border-panel-border rounded-lg overflow-hidden">

        {/* Tabellen-Header mit Suche + Filter */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-panel-border flex-wrap">
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <span className="text-sm font-semibold text-panel-text whitespace-nowrap">
              Firewall-Regeln
            </span>
            {rules.length > 0 && (
              <div className="flex items-center gap-1.5">
                <span className="text-[11px] px-2 py-0.5 rounded-full bg-panel-green/10 text-panel-green border border-panel-green/20 font-medium">
                  ✓ {allowCount} erlaubt
                </span>
                <span className="text-[11px] px-2 py-0.5 rounded-full bg-panel-red/10 text-panel-red border border-panel-red/20 font-medium">
                  ✗ {denyCount} gesperrt
                </span>
              </div>
            )}
          </div>

          {rules.length > 0 && (
            <div className="flex items-center gap-2">
              {/* Suche */}
              <div className="relative">
                <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-panel-muted" />
                <input
                  value={search}
                  onChange={e => { setSearch(e.target.value); setPage(1); }}
                  placeholder="Port, IP, …"
                  className="pl-7 pr-7 py-1.5 text-xs bg-panel-surface border border-panel-border rounded-md text-panel-text focus:outline-none focus:border-panel-accent w-36"
                />
                {search && (
                  <button onClick={() => { setSearch(''); setPage(1); }} className="absolute right-2 top-1/2 -translate-y-1/2 text-panel-muted hover:text-panel-text">
                    <X size={11} />
                  </button>
                )}
              </div>

              {/* Filter */}
              <div className="flex items-center rounded-md overflow-hidden border border-panel-border text-xs">
                {[['all','Alle'], ['allow','Erlaubt'], ['deny','Gesperrt']].map(([val, label]) => (
                  <button key={val} onClick={() => { setFilterAct(val); setPage(1); }}
                    className={`px-2.5 py-1.5 transition-colors border-r border-panel-border last:border-0 ${
                      filterAct === val ? 'bg-panel-accent text-white' : 'text-panel-muted hover:text-panel-text hover:bg-panel-surface'
                    }`}>
                    {label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Tabelle */}
        {loading ? (
          <div className="flex items-center justify-center py-12 text-panel-muted text-sm">
            <RefreshCw size={14} className="animate-spin mr-2" />Lade…
          </div>
        ) : paginated.length === 0 ? (
          <div className="text-panel-muted text-sm py-10 text-center">
            {rules.length === 0 ? 'Keine Regeln gefunden' : 'Keine Treffer für die aktuelle Suche'}
          </div>
        ) : (
          <>
            {/* Spalten-Header */}
            <div className={`grid gap-3 px-4 py-2 border-b border-panel-border text-[10px] font-semibold text-panel-muted uppercase tracking-wide
              ${canWrite ? 'grid-cols-[3rem_1fr_5rem_5rem_1fr_5rem]' : 'grid-cols-[3rem_1fr_5rem_5rem_1fr]'}`}>
              <span>#</span>
              <span>Port / Ziel</span>
              <span>Protokoll</span>
              <span>Aktion</span>
              <span>Quelle</span>
              {canWrite && <span />}
            </div>

            {paginated.map((r, i) => {
              const isAllow     = r.action === 'allow' || r.action?.toUpperCase?.().includes('ALLOW');
              const displayId   = r.id   ?? r.num ?? ((page - 1) * PAGE_SIZE + i + 1);
              const displayPort = (r.port && r.port !== 'any') ? r.port : (r.to || null);
              const displayFrom = (r.from && r.from !== 'any') ? r.from : null;
              const displayProto = (r.proto && r.proto !== 'any') ? r.proto.toUpperCase() : null;

              return (
                <div
                  key={i}
                  className={`grid gap-3 items-center px-4 py-2.5 border-b border-panel-border/30 last:border-0
                    hover:bg-panel-surface/50 transition-colors
                    ${canWrite ? 'grid-cols-[3rem_1fr_5rem_5rem_1fr_5rem]' : 'grid-cols-[3rem_1fr_5rem_5rem_1fr]'}`}
                >
                  {/* ID */}
                  <span className="text-[11px] text-panel-muted tabular-nums font-mono">{displayId}</span>

                  {/* Port */}
                  <span className="text-xs font-mono truncate">
                    {displayPort
                      ? <span className="text-panel-text">{displayPort}</span>
                      : <span className="text-panel-muted italic text-[11px]">alle Ports</span>}
                  </span>

                  {/* Protokoll */}
                  <span>
                    {displayProto
                      ? <span className="text-[11px] px-1.5 py-0.5 rounded bg-panel-surface border border-panel-border text-panel-muted font-mono">{displayProto}</span>
                      : <span className="text-[11px] text-panel-muted/50">—</span>}
                  </span>

                  {/* Aktion */}
                  <span className={`inline-flex items-center gap-1 text-xs font-semibold ${isAllow ? 'text-panel-green' : 'text-panel-red'}`}>
                    {isAllow ? '✓ Erlaubt' : '✗ Gesperrt'}
                  </span>

                  {/* Quelle */}
                  <span className="text-xs font-mono truncate">
                    {displayFrom
                      ? <span className="text-panel-text">{displayFrom}</span>
                      : <span className="text-panel-muted/50 text-[11px]">alle</span>}
                  </span>

                  {/* Aktionen */}
                  {canWrite && (
                    <div className="flex items-center gap-1 justify-end">
                      <button onClick={() => openEdit(r, displayId)} title="Bearbeiten"
                        className="text-panel-muted hover:text-panel-accent p-1 rounded hover:bg-panel-accent/10 transition-colors">
                        <Pencil size={11} />
                      </button>
                      <button onClick={() => deleteRule(displayId)} title="Löschen"
                        className="text-panel-muted hover:text-panel-red p-1 rounded hover:bg-panel-red/10 transition-colors">
                        <Trash2 size={11} />
                      </button>
                    </div>
                  )}
                </div>
              );
            })}

            {/* Paginierung */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between px-4 py-2.5 border-t border-panel-border bg-panel-surface/30">
                <span className="text-[11px] text-panel-muted">
                  {filtered.length} Regeln · Seite {page} / {totalPages}
                </span>
                <div className="flex items-center gap-1">
                  <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
                    className="p-1 rounded hover:bg-panel-surface disabled:opacity-40 text-panel-muted hover:text-panel-text transition-colors">
                    <ChevronLeft size={14} />
                  </button>
                  {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                    const start = Math.max(1, Math.min(page - 2, totalPages - 4));
                    const p = start + i;
                    return p <= totalPages ? (
                      <button key={p} onClick={() => setPage(p)}
                        className={`min-w-[1.75rem] h-7 rounded text-xs transition-colors ${
                          p === page ? 'bg-panel-accent text-white' : 'text-panel-muted hover:text-panel-text hover:bg-panel-surface'
                        }`}>
                        {p}
                      </button>
                    ) : null;
                  })}
                  <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
                    className="p-1 rounded hover:bg-panel-surface disabled:opacity-40 text-panel-muted hover:text-panel-text transition-colors">
                    <ChevronRight size={14} />
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Regel-Modal */}
      <Modal
        open={showRuleModal}
        onClose={() => setShowRuleModal(false)}
        title={editingRule ? `Regel ${editingRule.id} bearbeiten` : 'Neue Firewall-Regel'}
        footer={<>
          <Button variant="ghost" size="sm" onClick={() => setShowRuleModal(false)}>Abbrechen</Button>
          <Button size="sm" onClick={saveRule} disabled={!form.port}>{editingRule ? 'Speichern' : 'Hinzufügen'}</Button>
        </>}
      >
        <div className="space-y-3">
          <div>
            <label className="block text-xs text-panel-muted mb-1">Aktion</label>
            <select value={form.action} onChange={e => setF('action', e.target.value)} className={inputCls}>
              <option value="allow">✓ Erlauben</option>
              <option value="deny">✗ Sperren</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-panel-muted mb-1">Port</label>
            <input value={form.port} onChange={e => setF('port', e.target.value)}
              placeholder="z.B. 80, 443 oder 8080:8090" className={inputCls} />
          </div>
          <div>
            <label className="block text-xs text-panel-muted mb-1">Protokoll</label>
            <select value={form.proto} onChange={e => setF('proto', e.target.value)} className={inputCls}>
              <option value="tcp">TCP — Web, SSH, …</option>
              <option value="udp">UDP — DNS, VoIP, …</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-panel-muted mb-1">Nur von dieser IP (optional)</label>
            <input value={form.from} onChange={e => setF('from', e.target.value)}
              placeholder="leer = alle · z.B. 192.168.1.0/24" className={inputCls} />
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
