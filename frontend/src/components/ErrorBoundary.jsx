import { Component } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

/**
 * React ErrorBoundary — fängt Render-Fehler in Kind-Komponenten ab.
 * Verhindert, dass die ganze App schwarz/leer wird wenn eine Seite crasht.
 */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, errorInfo) {
    this.setState({ errorInfo });
    console.error('[ErrorBoundary]', error, errorInfo?.componentStack);
    // Direkt ans Backend melden (fetch statt axios, um Zirkelabhängigkeiten zu vermeiden)
    try {
      fetch('/api/logs', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          level:   'error',
          source:  'React-ErrorBoundary',
          message: (error?.message || String(error)).slice(0, 2000),
          stack:   errorInfo?.componentStack?.slice(0, 5000),
          url:     window.location.pathname,
        }),
      }).catch(() => {});
    } catch { /* nie crashen */ }
  }

  handleReset = () => {
    this.setState({ error: null, errorInfo: null });
    // Zurück zur Startseite navigieren
    window.location.href = '/';
  };

  render() {
    const { error, errorInfo } = this.state;

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
              Diese Seite konnte nicht geladen werden
            </h2>
            <p className="text-sm text-gray-400 mt-1">
              Ein unerwarteter Fehler ist aufgetreten.
            </p>
          </div>

          {/* Fehlermeldung */}
          <div className="bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-3 text-left">
            <p className="text-sm font-mono text-red-300 break-words">
              {error.message || String(error)}
            </p>
          </div>

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

          {/* Zurück-Button */}
          <button
            onClick={this.handleReset}
            className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors"
          >
            <RefreshCw size={14} />
            Zur Startseite
          </button>
        </div>
      </div>
    );
  }
}
