import { Component } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

/**
 * React ErrorBoundary — fängt Render-Fehler in Kind-Komponenten ab.
 * Verhindert, dass die ganze App schwarz/leer wird wenn eine Seite crasht.
 */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null, errorInfo: null, prevResetKey: props.resetKey };
  }

  // Wenn sich der resetKey ändert (z.B. Route-Wechsel) → Fehler-State zurücksetzen
  static getDerivedStateFromProps(props, state) {
    if (props.resetKey !== state.prevResetKey) {
      return { error: null, errorInfo: null, prevResetKey: props.resetKey };
    }
    return null;
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, errorInfo) {
    this.setState({ errorInfo });
    console.error('[ErrorBoundary]', error, errorInfo?.componentStack);

    // ── Chunk-Mismatch nach Deploy → automatisch hard-reload ───────────────
    // Passiert wenn Browser alte HTML-Datei gecacht hat, neue Chunk-Dateinamen aber
    // nicht mehr auf dem Server vorhanden sind (Vite content-hash ändert sich beim Build).
    const msg = error?.message || String(error);
    const isChunkError = /dynamically imported module|Loading chunk|Failed to fetch/i.test(msg);
    if (isChunkError) {
      const KEY = 'panel_chunk_reload_ts';
      const last = parseInt(sessionStorage.getItem(KEY) || '0', 10);
      if (Date.now() - last > 15_000) {          // max. 1 automatischer Reload alle 15s
        sessionStorage.setItem(KEY, String(Date.now()));
        window.location.reload();
        return;                                   // render() wird nicht mehr aufgerufen
      }
      // Falls Reload nicht half → normaler Error-State mit Hinweis
      this.setState({ isChunkError: true });
    }

    // Ans Backend loggen
    try {
      fetch('/api/panel-logs', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          level:   'error',
          source:  'React-ErrorBoundary',
          message: msg.slice(0, 2000),
          stack:   errorInfo?.componentStack?.slice(0, 5000),
          url:     window.location.pathname,
        }),
      }).catch(() => {});
    } catch { /* nie crashen */ }
  }

  handleReset = () => {
    this.setState({ error: null, errorInfo: null, isChunkError: false });
    // Chunk-Fehler: hard reload erzwingen (Cache umgehen)
    if (this.state.isChunkError) {
      window.location.href = '/?_=' + Date.now();
    } else {
      window.location.href = '/';
    }
  };

  render() {
    const { error, errorInfo, isChunkError } = this.state;

    if (!error) return this.props.children;

    const isDev = import.meta.env.DEV;

    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] px-6 text-center">
        <div className="max-w-lg w-full space-y-4">
          {/* Icon */}
          <div className="flex justify-center">
            <div className="p-3 bg-red-500/10 rounded-full">
              <AlertTriangle size={28} className="text-red-400" />
            </div>
          </div>

          {/* Titel */}
          <div>
            <h2 className="text-lg font-semibold text-white">
              {isChunkError ? 'Neue Version verfügbar' : 'Diese Seite konnte nicht geladen werden'}
            </h2>
            <p className="text-sm text-gray-400 mt-1">
              {isChunkError
                ? 'Das Panel wurde aktualisiert. Bitte einmal neu laden.'
                : 'Ein unerwarteter Fehler ist aufgetreten.'}
            </p>
          </div>

          {/* Fehlermeldung — bei Chunk-Fehler vereinfacht */}
          {!isChunkError && (
            <div className="bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-3 text-left">
              <p className="text-sm font-mono text-red-300 break-words">
                {error.message || String(error)}
              </p>
            </div>
          )}

          {/* Stack Trace (nur im Dev-Modus) */}
          {isDev && errorInfo?.componentStack && (
            <details className="text-left">
              <summary className="text-xs text-gray-500 cursor-pointer hover:text-gray-300 transition-colors">
                Component Stack anzeigen
              </summary>
              <pre className="mt-2 text-[10px] font-mono bg-gray-900 border border-gray-800 rounded p-3 overflow-x-auto whitespace-pre-wrap break-all text-gray-400">
                {errorInfo.componentStack}
              </pre>
            </details>
          )}

          {/* Button */}
          <button
            onClick={this.handleReset}
            className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors"
          >
            <RefreshCw size={14} />
            {isChunkError ? 'Jetzt neu laden' : 'Zur Startseite'}
          </button>
        </div>
      </div>
    );
  }
}
