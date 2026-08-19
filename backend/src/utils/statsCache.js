// ─── Kurzlebiger Zwischenspeicher für Container-Auslastung ────────────────────
//
// Die Docker-Seite fragte die Auslastung bisher pro Container einzeln ab und wiederholte
// das alle acht Sekunden. Bei zehn Containern auf einem Remote-Server waren das zehn
// Anfragen je Runde, von denen jede mehrere Sekunden brauchte: Die Docker-Engine muss für
// die CPU-Prozente zwei Messpunkte abwarten, das dauert je Aufruf rund zwei Sekunden.
// Zusammen mit dem Verbindungslimit des Browsers ergab das die langen Ladezeiten.
//
// Hier landen die gebündelten Ergebnisse für ein paar Sekunden. Zwei Dinge sind dabei
// wichtig: Ein zweiter Aufruf während eines laufenden Abrufs bekommt dasselbe Versprechen
// zurück, statt einen zweiten Durchlauf anzustoßen (sonst verdoppeln zwei offene Tabs die
// Last), und die Frist liegt knapp unter dem Abstand der Abfragen.

const FRIST_MS = 6000;

const gespeichert = new Map(); // Schlüssel → { zeit, daten }
const laufend     = new Map(); // Schlüssel → Promise

function holen(schluessel, laden) {
  const eintrag = gespeichert.get(schluessel);
  if (eintrag && Date.now() - eintrag.zeit < FRIST_MS) return Promise.resolve(eintrag.daten);

  const offen = laufend.get(schluessel);
  if (offen) return offen;

  const versprechen = Promise.resolve()
    .then(laden)
    .then((daten) => {
      gespeichert.set(schluessel, { zeit: Date.now(), daten });
      laufend.delete(schluessel);
      return daten;
    })
    .catch((err) => {
      laufend.delete(schluessel);
      throw err;
    });

  laufend.set(schluessel, versprechen);
  return versprechen;
}

/** Nach einer Aktion (Start/Stopp) sind die gespeicherten Werte überholt. */
function verwerfen(schluessel) {
  gespeichert.delete(schluessel);
}

// Damit die Ablage nicht unbegrenzt wächst, wenn Server verschwinden.
const kehren = setInterval(() => {
  const jetzt = Date.now();
  for (const [k, v] of gespeichert) if (jetzt - v.zeit > 60_000) gespeichert.delete(k);
}, 60_000);
kehren.unref();

module.exports = { holen, verwerfen };
