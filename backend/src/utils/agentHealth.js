// ─── Health-Check nach einem Agent-Update ─────────────────────────────────────
//
// Nach dem Ausrollen schreibt sich der Agent selbst neu und startet ~1,5 s später neu.
// Eine einzige Prüfung nach fester Zeit kann dabei zwei Fehler machen: sie trifft noch den
// alten Prozess (antwortet mit der alten Version) oder sie kommt in die Lücke des Neustarts.
// Deshalb wird über ein Zeitfenster gepollt, und zählen tut nur eine Antwort mit der
// *Zielversion*.
//
// Ohne Abhängigkeiten (kein axios, keine DB): `holeVersion` wird übergeben.

const schlafen = (ms) => new Promise(r => setTimeout(r, ms));

/**
 * @param {object}   o
 * @param {Function} o.holeVersion  async () => Versionsstring | null — wirft oder liefert null, wenn der Agent nicht antwortet
 * @param {string}   o.ziel         erwartete Version nach dem Update
 * @param {number}   [o.fensterMs]  so lange wird insgesamt gewartet
 * @param {number}   [o.intervallMs] Abstand der Prüfungen
 * @param {number}   [o.erstMs]     Pause vor der ersten Prüfung (der Neustart braucht ~1,5 s)
 * @returns {Promise<{ zustand: 'ok'|'zurueckgerollt'|'stumm', version: string|null, wartezeitMs: number }>}
 *   ok             — Agent antwortet mit der Zielversion
 *   zurueckgerollt — Agent antwortet, aber nicht mit der Zielversion (hat sich selbst zurückgesetzt
 *                    oder ist gar nicht neu gestartet); `version` ist die zuletzt gemeldete
 *   stumm          — im ganzen Fenster keine Antwort
 */
async function warteAufAgent({
  holeVersion, ziel,
  fensterMs = 90_000, intervallMs = 3_000, erstMs = 2_000,
  warten = schlafen, jetzt = Date.now,
}) {
  const start = jetzt();
  let letzte = null;

  await warten(erstMs);
  for (;;) {
    try {
      const v = await holeVersion();
      if (v) {
        letzte = v;
        if (v === ziel) return { zustand: 'ok', version: v, wartezeitMs: jetzt() - start };
      }
    } catch { /* Neustart oder Ausfall — weiter warten */ }

    if (jetzt() - start + intervallMs >= fensterMs) break;
    await warten(intervallMs);
  }
  return { zustand: letzte ? 'zurueckgerollt' : 'stumm', version: letzte, wartezeitMs: jetzt() - start };
}

module.exports = { warteAufAgent };
