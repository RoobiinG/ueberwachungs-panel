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
      if (reason?.isAxiosError) return; // wird vom axios-Interceptor erfasst
      const msg   = reason?.message || String(reason) || 'Unhandled Promise Rejection';
      const stack = reason?.stack ?? '';
      report('Promise', msg, stack, window.location.pathname);
    };

    // ── Axios-Interceptor für unerwartete API-Fehler ─────────────────────────
    const interceptorId = axios.interceptors.response.use(
      response => response,
      error => {
        const status = error.response?.status;
        const method  = (error.config?.method || 'GET').toUpperCase();
        const url     = error.config?.url || '';
        const errMsg  = error.response?.data?.error
                     ?? error.response?.data?.message
                     ?? error.message;

        // Upstream-Agent-Verbindungsfehler (502/504) sind normale Monitoring-Zustände (z. B. Server offline/Neustart),
        // keine Software-Fehler des Panels.
        const isUpstreamAgentError = (status === 502 || status === 504) && url.includes('/api/agents/');
        const isCanceled = error.code === 'ERR_CANCELED';

        // Auth-Flows (401/403) und fehlende Ressourcen (404) sind erwartet → ignorieren
        if (status !== 401 && status !== 403 && status !== 404 && !isUpstreamAgentError && !isCanceled) {
          // Absichtlich fehlende Konfiguration (z. B. ungenutzte Module) nicht global als "Panel-Fehler" loggen
          const isConfigError = /nicht konfiguriert/i.test(errMsg);
          
          if (!isConfigError) {
            report(
              'API',
              `${method} ${url} → ${status ? `HTTP ${status}` : 'Netzwerkfehler'}: ${errMsg}`,
              null,
              url,
            );
          }
        }
        return Promise.reject(error);
      },
    );

    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onUnhandledRejection);

    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onUnhandledRejection);
      axios.interceptors.response.eject(interceptorId);
    };
  }, [user]);
}
