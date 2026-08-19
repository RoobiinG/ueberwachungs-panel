// ─── Abschaltbare Funktionen des Panels ───────────────────────────────────────
//
// Liegt bewusst hier und nicht in routes/settings.js: Die Prüfung brauchen auch andere
// Routen. Ein Modul nur in der Oberfläche auszublenden reicht nicht — wer die Adresse
// kennt, käme sonst weiterhin an die Funktion. Deshalb weist der jeweilige Router die
// Anfrage zusätzlich selbst ab.

const db = require('../db');

const defaultModules = {
  docker: true,
  patchmon: true,
  uptimekuma: true,
  hetzner: true,
  mchost: true,
  passkeys: true,
};

// Erst beim Aufruf abfragen, nicht beim Laden des Moduls: Zu diesem Zeitpunkt kann die
// Migration der Tabelle noch nicht durch sein.
const alleModule = () => {
  try {
    const roh = db.prepare("SELECT value FROM settings WHERE key = 'enabled_modules'").get()?.value;
    return { ...defaultModules, ...(roh ? JSON.parse(roh) : {}) };
  } catch {
    return { ...defaultModules };
  }
};

const modulAktiv = (name) => alleModule()[name] !== false;

/** Express-Middleware: weist die Anfrage ab, solange das Modul abgeschaltet ist. */
const erfordertModul = (name, meldung) => (req, res, next) => {
  if (modulAktiv(name)) return next();
  res.status(403).json({ error: meldung || 'Diese Funktion ist in den Einstellungen abgeschaltet.' });
};

module.exports = { defaultModules, alleModule, modulAktiv, erfordertModul };
