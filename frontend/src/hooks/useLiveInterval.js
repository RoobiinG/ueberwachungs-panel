/**
 * Liefert das konfigurierbare Live-Refresh-Intervall (in ms).
 *
 * Der Wert wird einmalig vom Backend geladen und für die Browser-Session
 * gecacht — kein erneuter Fetch bei jedem Seiten-Wechsel.
 *
 * Standard: 15 000 ms (15 Sekunden)
 */

import { useState, useEffect } from 'react';
import axios from 'axios';

const DEFAULT_MS = 15_000;

// Modul-Level-Cache: einmal geladen → kein zweiter Request
let _cached = null;
let _pending = null; // laufendes Promise

async function fetchInterval() {
  if (_cached !== null) return _cached;
  if (_pending) return _pending;
  _pending = axios.get('/api/settings/general')
    .then(({ data }) => {
      const v = typeof data.liveRefreshInterval === 'number' ? data.liveRefreshInterval : DEFAULT_MS;
      _cached = Math.max(5_000, Math.min(300_000, v));
      _pending = null;
      return _cached;
    })
    .catch(() => {
      _pending = null;
      return DEFAULT_MS;
    });
  return _pending;
}

export function useLiveInterval() {
  const [intervalMs, setIntervalMs] = useState(_cached ?? DEFAULT_MS);

  useEffect(() => {
    if (_cached !== null) return; // bereits gecacht
    fetchInterval().then(v => setIntervalMs(v));
  }, []);

  return intervalMs;
}

// Ermöglicht es, den Cache nach einer Settings-Änderung zurückzusetzen
export function invalidateLiveIntervalCache() {
  _cached = null;
}
