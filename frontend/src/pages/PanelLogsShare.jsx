// Öffentliche Share-Seite — kein Login nötig
// Erreichbar über /s/<token>

import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import axios from 'axios';
import { AlertCircle, Info, TriangleAlert, ChevronDown, ChevronUp, Shield } from 'lucide-react';

const LEVEL_STYLE = {
  error: { cls: 'bg-red-500/10 text-red-400 border-red-500/20',       icon: AlertCircle   },
  warn:  { cls: 'bg-orange-500/10 text-orange-400 border-orange-500/20', icon: TriangleAlert },
  info:  { cls: 'bg-blue-500/10 text-blue-400 border-blue-500/20',     icon: Info          },
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

function SharedLogEntry({ log }) {
  const [expanded, setExpanded] = useState(false);
  const style   = LEVEL_STYLE[log.level] ?? LEVEL_STYLE.error;
  const Icon    = style.icon;
  const chipCls = SOURCE_CHIP[log.source] ?? 'bg-gray-500/15 text-gray-400';

  return (
    <div className={`border rounded-lg px-4 py-3 text-xs ${style.cls}`}>
      <div className="flex items-start gap-2">
        <Icon size={13} className="flex-shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-medium ${chipCls}`}>
              {log.source}
            </span>
            <span className="text-[10px] text-gray-500 tabular-nums">{fmtDate(log.created_at)}</span>
            {log.url && (
              <span className="text-[10px] text-gray-600 truncate max-w-[250px]" title={log.url}>
                {log.url}
              </span>
            )}
          </div>
          <p className="break-words leading-snug font-mono text-[11px]">{log.message}</p>
          {log.stack && (
            <button
              onClick={() => setExpanded(e => !e)}
              className="flex items-center gap-1 mt-1.5 text-[10px] text-gray-500 hover:text-gray-300 transition-colors"
            >
              {expanded ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
              Stack Trace {expanded ? 'ausblenden' : 'anzeigen'}
            </button>
          )}
          {log.stack && expanded && (
            <pre className="mt-1.5 text-[10px] font-mono bg-black/30 rounded p-2 overflow-x-auto whitespace-pre-wrap break-all leading-relaxed text-gray-400">
              {log.stack}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}

export default function PanelLogsShare() {
  const { token } = useParams();
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');

  useEffect(() => {
    axios.get(`/api/panel-logs/share/${token}`)
      .then(r => { setData(r.data); setLoading(false); })
      .catch(e => {
        setError(e.response?.data?.error || 'Link nicht gefunden oder widerrufen');
        setLoading(false);
      });
  }, [token]);

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <div className="max-w-3xl mx-auto px-4 py-10 space-y-6">

        {/* Header */}
        <div className="flex items-center gap-3">
          <Shield size={20} className="text-blue-400 flex-shrink-0" />
          <div>
            <h1 className="text-lg font-bold text-white">
              {data?.label || 'Geteilte Panel-Logs'}
            </h1>
            {data?.createdAt && (
              <p className="text-xs text-gray-500 mt-0.5">
                Erstellt am {fmtDate(data.createdAt)} · {data.logs.length} Eintrag{data.logs.length !== 1 ? 'e' : ''}
              </p>
            )}
          </div>
        </div>

        {/* Inhalt */}
        {loading && (
          <p className="text-gray-500 text-sm text-center py-12">Lade…</p>
        )}

        {error && (
          <div className="flex items-center gap-3 bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-3 text-red-400 text-sm">
            <AlertCircle size={16} />
            {error}
          </div>
        )}

        {data && (
          <div className="space-y-3">
            {data.logs.length === 0 ? (
              <p className="text-gray-500 text-sm text-center py-8">
                Die referenzierten Log-Einträge wurden bereits gelöscht.
              </p>
            ) : (
              data.logs.map(log => <SharedLogEntry key={log.id} log={log} />)
            )}
          </div>
        )}

        {/* Footer */}
        <p className="text-[10px] text-gray-700 text-center pt-4 border-t border-gray-800">
          Überwachungs-Panel · Geteilter Log-Report
        </p>
      </div>
    </div>
  );
}
