// Panel-Logs: Frontend-Fehler, API-Fehler, JS-Exceptions — persistent in SQLite
// Alle eingeloggten User schreiben; nur Admins lesen.

import { useEffect, useState, useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import axios from 'axios';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import {
  RefreshCw, Trash2, ChevronDown, ChevronUp,
  AlertCircle, Info, TriangleAlert,
  Copy, Check, Link2, Square, CheckSquare,
} from 'lucide-react';

// ─── Hilfsfunktionen ──────────────────────────────────────────────────────────

const LEVEL_STYLE = {
  error: { cls: 'bg-panel-red/15 text-panel-red border-panel-red/30',         icon: AlertCircle,    label: 'Error' },
  warn:  { cls: 'bg-panel-orange/15 text-panel-orange border-panel-orange/30', icon: TriangleAlert,  label: 'Warn'  },
  info:  { cls: 'bg-panel-accent/15 text-panel-accent border-panel-accent/30', icon: Info,           label: 'Info'  },
};

const SOURCE_CHIP = {
  JavaScript:   'bg-yellow-500/15 text-yellow-400',
  Promise:      'bg-orange-500/15 text-orange-400',
  'API-Fehler': 'bg-red-500/15 text-red-400',
  React:        'bg-blue-500/15 text-blue-400',
};

function fmtDate(s) {
  const d = new Date(s);
  return d.toLocaleDateString('de-DE') + ' ' + d.toLocaleTimeString('de-DE');
}

// ─── Icon-Button mit kurzem Feedback ─────────────────────────────────────────

function IconAction({ icon: Icon, doneIcon: DoneIcon, title, onClick, doneColor = 'text-panel-green' }) {
  const [done, setDone] = useState(false);
  const handle = () => {
    onClick();
    setDone(true);
    setTimeout(() => setDone(false), 2000);
  };
  return (
    <button
      onClick={handle}
      title={title}
      className="p-1 rounded text-panel-muted/50 hover:text-panel-muted transition-colors"
    >
      {done
        ? <DoneIcon size={12} className={doneColor} />
        : <Icon     size={12} />
      }
    </button>
  );
}

// ─── Log-Eintrag-Karte ────────────────────────────────────────────────────────

function LogEntry({ log, highlighted, selected, onToggle }) {
  const [expanded, setExpanded] = useState(false);
  const ref     = useRef(null);
  const style   = LEVEL_STYLE[log.level] ?? LEVEL_STYLE.error;
  const Icon    = style.icon;
  const chipCls = SOURCE_CHIP[log.source] ?? 'bg-panel-muted/15 text-panel-muted';

  useEffect(() => {
    if (highlighted && ref.current) {
      ref.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [highlighted]);

  const copyText = () => {
    const lines = [
      `[${log.level.toUpperCase()}] ${fmtDate(log.created_at)}`,
      `Quelle: ${log.source}${log.url ? `  —  ${log.url}` : ''}`,
      '',
      log.message,
    ];
    if (log.stack) lines.push('', log.stack);
    navigator.clipboard.writeText(lines.join('\n'));
  };

  const copyLink = () => {
    navigator.clipboard.writeText(`${window.location.origin}/panel-logs?id=${log.id}`);
  };

  return (
    <div
      ref={ref}
      id={`log-${log.id}`}
      className={`border rounded-md px-3 py-2 text-xs transition-all duration-500 ${style.cls} ${
        selected    ? 'ring-2 ring-panel-accent/60'    : ''
      } ${
        highlighted ? 'ring-2 ring-panel-accent ring-offset-1 ring-offset-panel-card' : ''
      }`}
    >
      <div className="flex items-start gap-2">

        {/* Checkbox */}
        <button
          onClick={onToggle}
          className="flex-shrink-0 mt-0.5 text-panel-muted/40 hover:text-panel-accent transition-colors"
          title={selected ? 'Auswahl aufheben' : 'Auswählen'}
        >
          {selected
            ? <CheckSquare size={13} className="text-panel-accent" />
            : <Square      size={13} />
          }
        </button>

        <Icon size={12} className="flex-shrink-0 mt-0.5" />

        <div className="flex-1 min-w-0">
          {/* Zeile 1: Source + Zeit + Aktions-Buttons */}
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-medium ${chipCls}`}>
              {log.source}
            </span>
            <span className="text-[10px] text-panel-muted/60 tabular-nums">{fmtDate(log.created_at)}</span>
            {log.url && (
              <span className="text-[10px] text-panel-muted/50 truncate max-w-[180px]" title={log.url}>
                {log.url}
              </span>
            )}

            {/* Aktions-Icons rechts */}
            <div className="ml-auto flex items-center gap-0.5">
              <IconAction
                icon={Copy}  doneIcon={Check}
                title="Fehlertext kopieren"
                onClick={copyText}
              />
              <IconAction
                icon={Link2} doneIcon={Check}
                title="Direktlink kopieren"
                onClick={copyLink}
              />
            </div>
          </div>

          {/* Nachricht */}
          <p className="break-words leading-snug font-mono text-[11px]">{log.message}</p>

          {/* Stack Trace */}
          {log.stack && (
            <button
              onClick={() => setExpanded(e => !e)}
              className="flex items-center gap-1 mt-1.5 text-[10px] text-panel-muted/70 hover:text-panel-muted transition-colors"
            >
              {expanded ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
              Stack Trace {expanded ? 'ausblenden' : 'anzeigen'}
            </button>
          )}
          {log.stack && expanded && (
            <pre className="mt-1.5 text-[10px] font-mono bg-black/20 rounded p-2 overflow-x-auto whitespace-pre-wrap break-all leading-relaxed text-panel-muted">
              {log.stack}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Haupt-Seite ──────────────────────────────────────────────────────────────

export default function PanelLogs() {
  const [searchParams] = useSearchParams();
  const highlightId    = searchParams.get('id') ? Number(searchParams.get('id')) : null;

  const [logs,    setLogs]    = useState([]);
  const [total,   setTotal]   = useState(0);
  const [loading, setLoading] = useState(false);
  const [sources, setSources] = useState([]);

  // Auswahl
  const [selected, setSelected] = useState(new Set());

  // Filter
  const [filterLevel,  setFilterLevel]  = useState('');
  const [filterSource, setFilterSource] = useState('');
  const [page,         setPage]         = useState(0);
  const PAGE_SIZE = 50;

  const load = useCallback(async () => {
    setLoading(true);
    setSelected(new Set());
    try {
      const params = { limit: PAGE_SIZE, offset: page * PAGE_SIZE };
      if (filterLevel)  params.level  = filterLevel;
      if (filterSource) params.source = filterSource;
      const { data } = await axios.get('/api/logs', { params });
      setLogs(data.logs);
      setTotal(data.total);
    } catch {}
    setLoading(false);
  }, [page, filterLevel, filterSource]);

  const loadSources = async () => {
    try {
      const { data } = await axios.get('/api/logs/sources');
      setSources(data);
    } catch {}
  };

  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadSources(); }, []);

  // Filter-Änderung → zurück zu Seite 0
  const changeFilter = (setter) => (e) => { setter(e.target.value); setPage(0); };

  // ── Auswahl-Aktionen ────────────────────────────────────────────────────────

  const toggleOne = (id) => setSelected(s => {
    const next = new Set(s);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  const allIds      = logs.map(l => l.id);
  const allSelected = allIds.length > 0 && allIds.every(id => selected.has(id));

  const toggleAll = () => {
    if (allSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(allIds));
    }
  };

  const deleteSelected = async () => {
    if (!selected.size) return;
    if (!confirm(`${selected.size} Eintrag(e) wirklich löschen?`)) return;
    await axios.delete('/api/logs/bulk', { data: { ids: [...selected] } }).catch(() => {});
    await load();
    loadSources();
  };

  // Ausgewählte Logs als Text kopieren
  const [bulkCopied, setBulkCopied] = useState(null); // 'text' | 'link' | null

  const copySelectedText = () => {
    const selectedLogs = logs.filter(l => selected.has(l.id));
    const text = selectedLogs.map(log => [
      `[${log.level.toUpperCase()}] ${fmtDate(log.created_at)}`,
      `Quelle: ${log.source}${log.url ? `  —  ${log.url}` : ''}`,
      '',
      log.message,
      ...(log.stack ? ['', log.stack] : []),
    ].join('\n')).join('\n\n─────────────────────────\n\n');
    navigator.clipboard.writeText(text).then(() => {
      setBulkCopied('text');
      setTimeout(() => setBulkCopied(null), 2000);
    });
  };

  // Direktlinks für alle ausgewählten Logs kopieren
  const copySelectedLinks = () => {
    const selectedLogs = logs.filter(l => selected.has(l.id));
    const links = selectedLogs.map(l => `${window.location.origin}/panel-logs?id=${l.id}`).join('\n');
    navigator.clipboard.writeText(links).then(() => {
      setBulkCopied('link');
      setTimeout(() => setBulkCopied(null), 2000);
    });
  };

  // ── Alle löschen ────────────────────────────────────────────────────────────

  const clearAll = async () => {
    if (!confirm('Alle Panel-Logs wirklich löschen?')) return;
    await axios.delete('/api/logs').catch(() => {});
    setLogs([]);
    setTotal(0);
    setSources([]);
    setSelected(new Set());
  };

  const selectCls   = 'bg-panel-surface border border-panel-border rounded px-2 py-1 text-xs text-panel-text focus:outline-none focus:border-panel-accent';
  const totalPages  = Math.ceil(total / PAGE_SIZE);

  return (
    <div className="space-y-3">

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <h1 className="text-sm font-semibold text-panel-text">Panel-Logs</h1>
          {total > 0 && (
            <span className="px-1.5 py-0.5 bg-panel-red/20 text-panel-red text-[10px] rounded-full tabular-nums">
              {total}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <select value={filterLevel}  onChange={changeFilter(setFilterLevel)}  className={selectCls}>
            <option value="">Alle Level</option>
            <option value="error">Error</option>
            <option value="warn">Warn</option>
            <option value="info">Info</option>
          </select>
          <select value={filterSource} onChange={changeFilter(setFilterSource)} className={selectCls}>
            <option value="">Alle Quellen</option>
            {sources.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <Button variant="ghost" size="sm" onClick={load} disabled={loading}>
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          </Button>
          {total > 0 && (
            <Button variant="danger" size="sm" onClick={clearAll}>
              <Trash2 size={13} className="mr-1" />Alle löschen
            </Button>
          )}
        </div>
      </div>

      {/* ── Auswahl-Toolbar (erscheint wenn mind. 1 gewählt) ────────────────── */}
      {selected.size > 0 && (
        <div className="flex items-center gap-3 px-3 py-2 bg-panel-accent/10 border border-panel-accent/30 rounded-md text-xs text-panel-accent">
          <button
            onClick={toggleAll}
            className="flex items-center gap-1.5 hover:text-panel-text transition-colors"
          >
            {allSelected
              ? <CheckSquare size={13} />
              : <Square      size={13} />
            }
            <span>{allSelected ? 'Alle abwählen' : 'Alle auswählen'}</span>
          </button>
          <span className="text-panel-muted/60">|</span>
          <span className="font-medium tabular-nums">{selected.size} ausgewählt</span>
          <div className="ml-auto flex items-center gap-2">
            {/* Text kopieren */}
            <button
              onClick={copySelectedText}
              title="Ausgewählte Fehler als Text kopieren"
              className="flex items-center gap-1 text-[11px] px-2 py-1 rounded border border-panel-accent/30 hover:bg-panel-accent/20 transition-colors"
            >
              {bulkCopied === 'text'
                ? <><Check size={11} className="text-panel-green" /><span className="text-panel-green">Kopiert!</span></>
                : <><Copy  size={11} /><span>Kopieren</span></>
              }
            </button>
            {/* Links kopieren */}
            <button
              onClick={copySelectedLinks}
              title="Direktlinks für ausgewählte Einträge kopieren"
              className="flex items-center gap-1 text-[11px] px-2 py-1 rounded border border-panel-accent/30 hover:bg-panel-accent/20 transition-colors"
            >
              {bulkCopied === 'link'
                ? <><Check size={11} className="text-panel-green" /><span className="text-panel-green">Kopiert!</span></>
                : <><Link2 size={11} /><span>Links erstellen</span></>
              }
            </button>
            <Button variant="danger" size="sm" onClick={deleteSelected}>
              <Trash2 size={12} className="mr-1" />Auswahl löschen
            </Button>
          </div>
        </div>
      )}

      {/* ── Alle auswählen (wenn noch nichts selektiert, aber Logs da) ───────── */}
      {selected.size === 0 && logs.length > 0 && (
        <button
          onClick={toggleAll}
          className="flex items-center gap-1.5 text-[11px] text-panel-muted/50 hover:text-panel-muted transition-colors"
        >
          <Square size={12} />
          Alle auswählen
        </button>
      )}

      {/* ── Log-Liste ───────────────────────────────────────────────────────── */}
      <Card>
        {loading && logs.length === 0 ? (
          <div className="text-panel-muted text-sm text-center py-8">Lade…</div>
        ) : logs.length === 0 ? (
          <div className="text-panel-muted text-sm text-center py-8">
            {filterLevel || filterSource ? 'Keine Logs mit diesem Filter.' : 'Keine Logs vorhanden — alles grün!'}
          </div>
        ) : (
          <div className="space-y-2">
            {logs.map(log => (
              <LogEntry
                key={log.id}
                log={log}
                highlighted={log.id === highlightId}
                selected={selected.has(log.id)}
                onToggle={() => toggleOne(log.id)}
              />
            ))}
          </div>
        )}
      </Card>

      {/* ── Paginierung ─────────────────────────────────────────────────────── */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 text-xs text-panel-muted">
          <Button variant="ghost" size="sm" disabled={page === 0} onClick={() => setPage(p => p - 1)}>
            ← Zurück
          </Button>
          <span>Seite {page + 1} / {totalPages}</span>
          <Button variant="ghost" size="sm" disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}>
            Weiter →
          </Button>
        </div>
      )}

      {/* ── Hinweis ─────────────────────────────────────────────────────────── */}
      <p className="text-[10px] text-panel-muted/50 text-center">
        JavaScript-Fehler, unhandled Promises und API-Fehler werden automatisch erfasst. Max. 500 Einträge.
      </p>
    </div>
  );
}
