import { useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import { ServerSelector } from '../components/ui/ServerSelector';
import { useAuth } from '../context/AuthContext';
import {
  Plus, Trash2, RefreshCw, Shield, Power, ScanSearch,
  Pencil, ChevronLeft, ChevronRight, Search, X, Filter, AlertTriangle,
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

// ─── Hilfsfunktionen ──────────────────────────────────────────────────────────

// UFW listet jede Regel zweimal — einmal für IPv4, einmal als „(v6)". Für den
// Vergleich müssen die v6-Zusätze weg.
const normFrom = (f) =>
  String(f ?? '').replace(/\s*\(v6\)\s*$/i, '').replace(/^anywhere$/i, 'any').trim() || 'any';

// Gleiche Regel für beide Adressfamilien zu einem Eintrag zusammenfassen. Die IDs
// beider Originale bleiben erhalten, damit Löschen weiterhin beide trifft.
const mergeFamilies = (rules) => {
  const out = [];
  const byKey = new Map();
  for (const r of rules) {
    const isV6 = /\(v6\)/i.test(r.raw || '') || /\(v6\)/i.test(String(r.from || ''));
    const key  = `${r.port}|${r.proto}|${r.action}|${normFrom(r.from)}`;
    const seen = byKey.get(key);
    if (seen) {
      seen.ids.push(r.id);
      seen.families.add(isV6 ? 'IPv6' : 'IPv4');
      continue;
    }
    const entry = { ...r, from: normFrom(r.from), ids: [r.id], families: new Set([isV6 ? 'IPv6' : 'IPv4']) };
    byKey.set(key, entry);
    out.push(entry);
  }
  return out;
};

// Standard-Richtlinie aus der Rohausgabe des jeweiligen Tools lesen — der wichtigste
// Wert einer Firewall, der bisher nur in der aufklappbaren Ausgabe versteckt war.
const parsePolicy = (raw, tool) => {
  if (!raw) return null;
  if (tool === 'ufw') {
    const line = raw.match(/Default:\s*(.+)/i)?.[1];
    if (!line) return null;
    return {
      incoming: /(\w+)\s*\(incoming\)/i.exec(line)?.[1],
      outgoing: /(\w+)\s*\(outgoing\)/i.exec(line)?.[1],
    };
  }
  if (tool === 'iptables')  return { incoming: raw.match(/Chain INPUT \(policy (\w+)\)/i)?.[1] };
  if (tool === 'nftables')  return { incoming: raw.match(/hook input[^}]*policy (\w+)/i)?.[1] };
  if (tool === 'firewalld') return { incoming: raw.match(/target:\s*(\S+)/i)?.[1] };
  return null;
};

const policyWord = (v) => {
  if (!v) return null;
  const s = String(v).toLowerCase();
  if (['deny', 'drop', 'reject', '%%reject%%'].includes(s)) return 'abgelehnt';
  if (['allow', 'accept'].includes(s)) return 'erlaubt';
  return s;
};

// Rohe Tool- und Systemmeldungen in verständliche Sätze übersetzen.
const humanError = (msg, isLocal) => {
  const m = String(msg || '');
  if (/nsenter|operation not permitted|permission denied/i.test(m) && isLocal) {
    return 'Der Panel-Container darf die Firewall des Hosts nicht steuern. In der docker-compose.yml fehlen dafür `privileged: true` und `pid: "host"`.';
  }
  if (/kein unterstütztes firewall-tool/i.test(m)) {
    return 'Auf diesem Server ist keine der unterstützten Firewalls aktiv (UFW, firewalld, nftables, iptables).';
  }
  if (/agent nicht erreichbar|ECONNREFUSED|ETIMEDOUT|socket hang up/i.test(m)) {
    return 'Der Panel-Agent auf diesem Server antwortet nicht. Läuft der Dienst noch (`systemctl status panel-agent`)?';
  }
  if (/regel nicht gefunden|liste hat sich/i.test(m)) {
    return 'Diese Regel gibt es nicht mehr — die Liste hat sich zwischenzeitlich geändert. Bitte aktualisieren.';
  }
  return m;
};

export default function Firewall() {
  const { canWrite } = useAuth();

  const [selectedServer, setSelectedServer] = useState(null);
  const [agents,         setAgents]         = useState([]);
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
      setError(humanError(err.response?.data?.error || 'Firewall nicht erreichbar', !selectedServer));
    }
    setLoading(false);
  };

  useEffect(() => {
    setStatus(''); setRules([]); setDetectedTool(null); setSearch(''); setFilterAct('all');
    load();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedServer]);

  // Agentenliste nur für den Aussperr-Schutz: Der Agent-Port steckt in seiner URL und
  // ist über PANEL_AGENT_PORT frei wählbar — eine feste 7331 wäre geraten.
  useEffect(() => {
    axios.get('/api/agents').then(r => setAgents(r.data || [])).catch(() => {});
  }, []);

  // ── Zugangs-Ports, deren Sperrung den Server unerreichbar macht ────────────
  // Der Agent-Port ist über PANEL_AGENT_PORT frei wählbar und steckt in seiner URL —
  // eine fest verdrahtete 7331 wäre geraten.
  const accessPort = selectedServer
    ? (agents.find(a => a.id === selectedServer)?.url?.match(/:(\d{2,5})(?:\/|$)/)?.[1] || null)
    : String(window.location.port || '3001');

  const guardedPorts = [
    { port: '22', label: 'dein SSH-Zugang' },
    ...(accessPort ? [{
      port:  accessPort,
      label: selectedServer
        ? 'der Port des Panel-Agenten auf diesem Server'
        : 'der Port, über den du dieses Panel gerade bedienst',
    }] : []),
  ];

  // Vorlagen für den Regel-Dialog — spart das Nachschlagen von Portnummern.
  const quickPorts = [
    { label: 'SSH',   port: '22'  },
    { label: 'HTTP',  port: '80'  },
    { label: 'HTTPS', port: '443' },
    ...(accessPort ? [{ label: selectedServer ? 'Agent' : 'Panel', port: accessPort }] : []),
  ];

  const guardFor = (port) => guardedPorts.find(g => g.port === String(port ?? '').trim());

  // Warnt, bevor ein Zugang zugemacht wird — abbrechen ist die Voreinstellung des
  // Dialogs, bestätigen bleibt möglich.
  const confirmLockout = (port, what) => {
    const g = guardFor(port);
    if (!g) return true;
    return confirm(
      `Achtung — Zugang betroffen\n\n` +
      `Port ${g.port} ist ${g.label}.\n` +
      `${what}\n\n` +
      `Danach kommst du über diesen Weg möglicherweise nicht mehr auf den Server. Trotzdem fortfahren?`
    );
  };

  // ── Modal öffnen ───────────────────────────────────────────────────────────
  const openNew = () => {
    setEditingRule(null);
    setForm({ port: '', proto: 'tcp', from: '', action: 'allow' });
    setShowRuleModal(true);
  };

  const openEdit = (r) => {
    setEditingRule({ id: r.ids?.[0] ?? r.id, ids: r.ids ?? [r.id] });
    setForm({
      port:   r.port !== 'any' ? (r.port ?? r.to ?? '') : '',
      proto:  r.proto && r.proto !== 'any' ? r.proto : 'tcp',
      from:   r.from !== 'any' ? (r.from || '') : '',
      action: (r.action === 'allow' || r.action?.toUpperCase?.().includes('ALLOW')) ? 'allow' : 'deny',
    });
    setShowRuleModal(true);
  };

  // Regel-Nummern absteigend abarbeiten: UFW & iptables nummerieren fortlaufend, beim
  // Löschen rutscht alles darunter eine Position hoch.
  const byNumberDesc = (a, b) => Number(b) - Number(a);

  // ── Regel speichern ────────────────────────────────────────────────────────
  const saveRule = async () => {
    if (form.action === 'deny' && !confirmLockout(form.port, 'Diese Regel würde ihn sperren.')) return;
    const body = { port: form.port, proto: form.proto, from: form.from || undefined, action: form.action };
    try {
      if (editingRule) {
        const ids = [...editingRule.ids].sort(byNumberDesc);
        // Zusammengefasste IPv4+IPv6-Regel: die Zusatzeinträge zuerst entfernen,
        // der letzte wird über PUT ersetzt.
        for (const extra of ids.slice(0, -1)) {
          await axios.delete(`${apiBase}/firewall/rules/${encodeURIComponent(extra)}`);
        }
        await axios.put(`${apiBase}/firewall/rules/${encodeURIComponent(ids[ids.length - 1])}`, body);
      } else {
        await axios.post(`${apiBase}/firewall/${form.action}`, body);
      }
      setShowRuleModal(false);
      await load();
    } catch (err) {
      setError(humanError(err.response?.data?.error || 'Fehler beim Speichern', !selectedServer));
    }
  };

  const deleteRule = async (rule) => {
    const ids = (rule.ids ?? [rule.id]).filter(v => v != null);
    const isAllow = rule.action === 'allow' || rule.action?.toUpperCase?.().includes('ALLOW');
    // Eine Erlaubnis auf einem Zugangs-Port zu löschen sperrt genauso aus wie eine
    // Sperr-Regel anzulegen.
    if (isAllow && !confirmLockout(rule.port, 'Diese Regel erlaubt ihn gerade — beim Löschen fällt die Erlaubnis weg.')) return;
    if (!confirm(`Regel ${ids.join(' + ')} wirklich löschen?`)) return;
    try {
      for (const id of [...ids].sort(byNumberDesc)) {
        await axios.delete(`${apiBase}/firewall/rules/${encodeURIComponent(id)}`);
      }
      await load();
    } catch (err) {
      setError(humanError(err.response?.data?.error || 'Fehler beim Löschen', !selectedServer));
    }
  };

  const toggleFirewall = async () => {
    if (!detectedTool || detectedTool.tool === 'none') return;
    const enable = !detectedTool.active;
    const frage = enable
      ? `Firewall (${toolInfo?.label}) wirklich aktivieren?\n\nAb dann gilt: Was keine Freigabe hat, kommt nicht mehr durch.`
      : `Firewall (${toolInfo?.label}) wirklich deaktivieren?\n\nDanach ist dieser Server ungefiltert erreichbar.`;
    if (!confirm(frage)) return;
    setToggling(true);
    try {
      await axios.post(`${apiBase}/firewall/toggle`, { enable, tool: detectedTool.tool });
      await load();
    } catch (err) {
      const daten = err.response?.data;
      // 409 = das Panel hat das Einschalten angehalten, weil danach niemand mehr
      // hereinkäme. Das ist keine Fehlermeldung zum Wegklicken, sondern eine Frage:
      // Wer den Zugang anders abgesichert hat, darf darüber hinweg — bewusst.
      if (err.response?.status === 409 && daten?.bestaetigungNoetig) {
        const trotzdem = confirm(
          `${daten.error}\n\n` +
          `Trotzdem einschalten?\n\n` +
          `Nur bestätigen, wenn du sicher bist, dass du danach noch auf diesen Server kommst — ` +
          `andernfalls ist er weder über das Panel noch über SSH zurückzuholen.`
        );
        if (trotzdem) {
          try {
            await axios.post(`${apiBase}/firewall/toggle`, { enable, tool: detectedTool.tool, trotzdem: true });
            await load();
          } catch (e2) {
            setError(humanError(e2.response?.data?.error || 'Fehler beim Umschalten', !selectedServer));
          }
        }
      } else {
        setError(humanError(daten?.error || 'Fehler beim Umschalten', !selectedServer));
      }
    }
    setToggling(false);
  };

  const setF = (key, val) => setForm(f => ({ ...f, [key]: val }));
  const toolInfo = TOOL_LABELS[detectedTool?.tool] || null;
  const policy   = parsePolicy(status, detectedTool?.tool);

  // ── Gefilterte + paginierte Regeln ─────────────────────────────────────────
  // Zuerst IPv4/IPv6-Doppel zusammenfassen, damit die Liste nicht alles doppelt zeigt.
  const merged = mergeFamilies(rules);

  const filtered = merged.filter(r => {
    const q = search.toLowerCase();
    const matchSearch = !q || [r.port, r.proto, r.from, String(r.id)].some(v => String(v ?? '').toLowerCase().includes(q));
    const matchAction = filterAct === 'all' || r.action === filterAct
      || (filterAct === 'allow' && r.action?.toUpperCase?.().includes('ALLOW'))
      || (filterAct === 'deny'  && !r.action?.toUpperCase?.().includes('ALLOW'));
    return matchSearch && matchAction;
  });

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paginated  = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const allowCount = merged.filter(r => r.action === 'allow' || r.action?.toUpperCase?.().includes('ALLOW')).length;
  const denyCount  = merged.length - allowCount;

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

      {/* Fehler — die Übersetzung in Klartext passiert bereits in humanError() */}
      {error && (
        <div className="bg-panel-orange/10 border border-panel-orange/30 text-panel-orange text-sm rounded-md px-3 py-2 flex items-start gap-2">
          <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {/* Status */}
      {status && (
        <div className="bg-panel-card border border-panel-border rounded-lg p-3">
          <div className="flex items-center gap-2 mb-2 flex-wrap">
            <span className={`w-2 h-2 rounded-full ${detectedTool?.active ? 'bg-panel-green' : 'bg-panel-red'}`} />
            <span className="text-xs font-semibold text-panel-text">
              {toolInfo?.label || 'Firewall'} {detectedTool?.active ? 'aktiv' : 'inaktiv'}
            </span>
            {/* Die Standard-Richtlinie entscheidet, was mit allem passiert, wofür es keine
                Regel gibt — bisher stand sie nur klein in der Rohausgabe. */}
            {policyWord(policy?.incoming) && (
              <span className="text-[11px] text-panel-muted">
                · Standard: eingehend{' '}
                <span className={policyWord(policy.incoming) === 'abgelehnt' ? 'text-panel-green font-medium' : 'text-panel-orange font-medium'}>
                  {policyWord(policy.incoming)}
                </span>
                {policyWord(policy?.outgoing) && <>, ausgehend <span className="text-panel-text">{policyWord(policy.outgoing)}</span></>}
              </span>
            )}
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
          <div className="text-panel-muted text-sm py-10 text-center px-6">
            {rules.length > 0
              ? 'Keine Treffer für die aktuelle Suche'
              : detectedTool?.tool === 'nftables'
                // Auf einem Docker-Host ist das der Normalfall: Docker bringt eigene Ketten
                // für Weiterleitung mit, filtert eingehenden Verkehr aber nicht.
                ? <>Keine Regeln für eingehende Verbindungen — dieser Server filtert eingehenden
                    Verkehr derzeit nicht.<br />
                    <span className="text-[11px] text-panel-muted/70">
                      Regeln, die Docker selbst für Weiterleitung und NAT anlegt, werden hier bewusst
                      nicht aufgeführt.
                    </span></>
                : 'Keine Regeln gefunden'}
          </div>
        ) : (
          <>
            {/* Spalten-Header */}
            <div className={`hidden sm:grid gap-3 px-4 py-2 border-b border-panel-border text-[10px] font-semibold text-panel-muted uppercase tracking-wide
              ${canWrite ? 'sm:grid-cols-[3rem_1fr_5rem_5rem_1fr_5rem]' : 'sm:grid-cols-[3rem_1fr_5rem_5rem_1fr]'}`}>
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
                  className={`flex flex-col sm:grid gap-2 sm:gap-3 sm:items-center px-4 py-3 sm:py-2.5 border-b border-panel-border/30 last:border-0
                    hover:bg-panel-surface/50 transition-colors
                    ${canWrite ? 'sm:grid-cols-[3rem_1fr_5rem_5rem_1fr_5rem]' : 'sm:grid-cols-[3rem_1fr_5rem_5rem_1fr]'}`}
                >
                  {/* Obere Reihe Mobil / ID */}
                  <div className="flex items-center justify-between sm:contents">
                    <span className="text-[11px] text-panel-muted tabular-nums font-mono">
                      <span className="sm:hidden mr-1 font-sans text-[10px] uppercase">ID:</span>{displayId}
                    </span>
                    {/* Aktionen auf Mobil oben rechts, auf Desktop am Ende */}
                    {canWrite && (
                      <div className="flex sm:hidden items-center gap-1">
                        <Button size="sm" variant="ghost" onClick={() => openEdit(r)}>
                          <Pencil size={11} />Bearbeiten
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => deleteRule(r)}
                          className="text-panel-red hover:border-panel-red/40">
                          <Trash2 size={11} />Löschen
                        </Button>
                      </div>
                    )}
                  </div>

                  {/* Port — bei zusammengefassten Regeln steht dahinter, für welche
                      Adressfamilien sie gilt (UFW führt beide getrennt). */}
                  <span className="text-xs font-mono truncate flex items-center justify-between sm:contents">
                    <span className="sm:hidden text-[10px] text-panel-muted uppercase font-sans">Port:</span>
                    <span className="flex items-center gap-1.5 min-w-0">
                      {displayPort
                        ? <span className="text-panel-text truncate">{displayPort}</span>
                        : <span className="text-panel-muted italic text-[11px]">alle Ports</span>}
                      {r.families?.size > 1 && (
                        <span className="text-[9px] px-1 py-0.5 rounded bg-panel-surface border border-panel-border text-panel-muted font-sans flex-shrink-0"
                          title={`Gilt für IPv4 und IPv6 (Regeln ${r.ids.join(' und ')})`}>
                          IPv4+IPv6
                        </span>
                      )}
                    </span>
                  </span>

                  {/* Protokoll */}
                  <span className="flex items-center justify-between sm:contents">
                    <span className="sm:hidden text-[10px] text-panel-muted uppercase">Proto:</span>
                    {displayProto
                      ? <span className="text-[11px] px-1.5 py-0.5 rounded bg-panel-surface border border-panel-border text-panel-muted font-mono">{displayProto}</span>
                      : <span className="text-[11px] text-panel-muted/50">—</span>}
                  </span>

                  {/* Aktion */}
                  <span className={`flex items-center justify-between sm:contents`}>
                    <span className="sm:hidden text-[10px] text-panel-muted uppercase">Aktion:</span>
                    <span className={`inline-flex items-center gap-1 text-xs font-semibold ${isAllow ? 'text-panel-green' : 'text-panel-red'}`}>
                      {isAllow ? '✓ Erlaubt' : '✗ Gesperrt'}
                    </span>
                  </span>

                  {/* Quelle */}
                  <span className="text-xs font-mono truncate flex items-center justify-between sm:contents">
                    <span className="sm:hidden text-[10px] text-panel-muted uppercase font-sans">Quelle:</span>
                    {displayFrom
                      ? <span className="text-panel-text">{displayFrom}</span>
                      : <span className="text-panel-muted/50 text-[11px]">alle</span>}
                  </span>

                  {/* Aktionen Desktop */}
                  {canWrite && (
                    <div className="hidden sm:flex items-center gap-1 justify-end">
                      <Button size="sm" variant="ghost" onClick={() => openEdit(r)}>
                        <Pencil size={11} />Bearbeiten
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => deleteRule(r)}
                        className="text-panel-red hover:border-panel-red/40">
                        <Trash2 size={11} />Löschen
                      </Button>
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
            <div className="flex flex-wrap gap-1 mb-2">
              {quickPorts.map(q => (
                <button
                  key={`${q.label}-${q.port}`}
                  type="button"
                  onClick={() => setForm(f => ({ ...f, port: q.port, proto: 'tcp' }))}
                  title={`Port ${q.port}/tcp übernehmen`}
                  className={`px-2 py-1 text-[11px] rounded border transition-colors ${
                    form.port === q.port
                      ? 'bg-panel-accent/15 border-panel-accent/50 text-panel-accent'
                      : 'bg-panel-surface border-panel-border text-panel-muted hover:text-panel-text hover:border-panel-accent/40'
                  }`}
                >
                  {q.label} {q.port}
                </button>
              ))}
            </div>
            <input value={form.port} onChange={e => setF('port', e.target.value)}
              placeholder="z.B. 80, 443 oder 8080:8090" className={inputCls} />
            {/* Der Hinweis erscheint schon beim Tippen, nicht erst beim Speichern. */}
            {form.action === 'deny' && guardFor(form.port) && (
              <p className="mt-1.5 text-[11px] text-panel-orange flex items-start gap-1.5">
                <AlertTriangle size={11} className="flex-shrink-0 mt-0.5" />
                Port {form.port} ist {guardFor(form.port).label}. Diese Regel würde ihn sperren.
              </p>
            )}
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
