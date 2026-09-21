// Kleiner Helfer, mit dem ein Hintergrund-Worker (setInterval-Job) seinen letzten
// Lauf beobachtbar macht, ohne dass jedes Modul dasselbe Objekt von Hand pflegt.
// Wird vom Diagnostik-Report genutzt, um zu sehen, ob ein Worker noch läuft und
// ob sein letzter Durchlauf fehlgeschlagen ist.
function makeStatusTracker() {
  const status = { lastRunAt: null, lastError: null, lastDurationMs: null, runCount: 0, running: false };

  // Läuft `fn` aus, merkt sich Zeitpunkt/Dauer/Fehler und schluckt die Exception
  // (wie die bisherigen `.catch(() => {})`-Aufrufe), damit ein einzelner
  // fehlschlagender Durchlauf den setInterval-Job nicht zum Absturz bringt.
  //
  // Überspringt einen Tick, wenn der vorherige Durchlauf noch läuft — sonst starten
  // bei einem langsamen Agent/Remote-Call mehrere überlappende Durchläufe derselben
  // Funktion gegen denselben In-Memory-Zustand (z.B. mehrfach ausgelöste Alarme).
  async function wrap(fn) {
    if (status.running) return;
    status.running = true;
    const t0 = Date.now();
    try {
      await fn();
      status.lastError = null;
    } catch (err) {
      status.lastError = err?.message || String(err);
    } finally {
      status.running         = false;
      status.lastRunAt       = new Date().toISOString();
      status.lastDurationMs  = Date.now() - t0;
      status.runCount++;
    }
  }

  return { wrap, get: () => ({ ...status }) };
}

module.exports = { makeStatusTracker };
