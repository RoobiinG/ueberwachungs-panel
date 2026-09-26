import { useCallback, useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

/**
 * Aktiver Tab einer Hub-Seite, gespeichert in `?tab=` (teil- und verlinkbar, Zurück-Taste geht).
 *
 * - Sichtbar sind nur Tabs, deren `permission` (String oder Array, eines genügt) der Nutzer hat.
 * - Ein fehlender, unbekannter oder nicht erlaubter `?tab=` wird ohne neuen Verlaufseintrag
 *   auf den ersten erlaubten Tab korrigiert — ein von Hand eingetippter Link auf einen
 *   gesperrten Tab zeigt also nie dessen Inhalt.
 * - Beim Tab-Wechsel bleiben nur die in `persist` genannten Parameter erhalten (z. B. `server`);
 *   tab-eigene wie `?id=` der System-Logs fallen weg. Beim Korrigieren bleibt alles stehen.
 *
 * Das ist Bedienführung. Die Daten selbst schützt das Backend mit requirePermission.
 */
export function useTabParam(tabs, { persist = [] } = {}) {
  const { hasPermission } = useAuth();
  const [params, setParams] = useSearchParams();

  const allowed = useMemo(
    () => tabs.filter(t => !t.permission || hasPermission(t.permission)),
    [tabs, hasPermission],
  );

  const requested = params.get('tab');
  const active = allowed.some(t => t.key === requested) ? requested : (allowed[0]?.key ?? null);

  useEffect(() => {
    if (active && requested !== active) {
      setParams(prev => { const n = new URLSearchParams(prev); n.set('tab', active); return n; }, { replace: true });
    }
  }, [active, requested, setParams]);

  const setTab = useCallback((key) => {
    setParams(prev => {
      const n = new URLSearchParams();
      for (const k of persist) if (prev.has(k)) n.set(k, prev.get(k));
      n.set('tab', key);
      return n;
    });
  // persist ist an den Aufrufstellen eine Konstante
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setParams]);

  return { tabs: allowed, active, setTab };
}
