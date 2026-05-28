/**
 * Globaler Frontend-Error-Reporter
 *
 * Fängt window.onerror + unhandledrejection ab und speichert sie
 * persistent via POST /api/logs im Backend.
 *
 * Aktiviert sich nur wenn ein User eingeloggt ist.
 * Doppelte Fehler innerhalb von 10 Sekunden werden lokal unterdrückt.
 */

import { useEffect } from 'react';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';

// Lokales Deduplizierungs-Set (pro Browser-Session)
const recentKeys = new Map();

function canSend(key) {
  const last = recentKeys.get(key) ?? 0;
  if (Date.now() - last < 10_000) return false;
  recentKeys.set(key, Date.now());
  // Map nicht unbegrenzt wachsen lassen
  if (recentKeys.size > 200) {
    const first = recentKeys.keys().next().value;
    recentKeys.delete(first);
  }
  return true;
}

function report(source, message, stack, url) {
  const key = `${source}::${message.slice(0, 120)}`;
  if (!canSend(key)) return;
  axios.post('/api/logs', {
    level:   'error',
    source,
    message: message.slice(0, 2000),
    stack:   stack ? stack.slice(0, 5000) : undefined,
    url:     url || window.location.pathname,
  }).catch(() => {}); // Fehler beim Melden selbst niemals anzeigen
}

export function useErrorReporter() {
  const { user } = useAuth();

  useEffect(() => {
    if (!user) return;

    // ── JS-Runtime-Fehler ────────────────────────────────────────────────────
    const onError = (event) => {
      // Chrome/Firefox/Edge geben das Error-Objekt mit
      const msg   = event.message || 'Unbekannter JavaScript-Fehler';
      const stack = event.error?.stack ?? '';
      const src   = event.filename ? event.filename.replace(window.location.origin, '') : window.location.pathname;

      // React-interne und Browser-Extension-Fehler ignorieren
      if (/ResizeObserver loop/i.test(msg)) return;
      if (/extensions?:\/\//i.test(event.filename || '')) return;

      report('JavaScript', msg, stack, src);
    };

    // ── Unbehandelte Promise-Rejections ──────────────────────────────────────
    const onUnhandledRejection = (event) => {
      const reason = event.reason;
      // Axios-Fehler haben eigene Behandlung via Interceptor → überspringen
      if (reason?.isAxiosError) return;
      const msg   = reason?.message || String(reason) || 'Unhandled Promise Rejection';
      const stack = reason?.stack ?? '';
      report('Promise', msg, stack, window.location.pathname);
    };

    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onUnhandledRejection);

    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onUnhandledRejection);
    };
  }, [user]);
}
