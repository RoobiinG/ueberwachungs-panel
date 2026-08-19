// ─── Serverübergreifende Container-Suche ──────────────────────────────────────
//
// Bewusst ein eigener Router und **nicht** Teil von routes/docker.js: Dort hängt
// `requireLocalAccess` davor, das jede Anfrage abweist, sobald die Rolle den lokalen
// Server nicht sehen darf (`hide_local`). Für eine Suche über *alle* Server wäre das
// falsch — der Panel-Server soll dann nur ausgelassen, nicht die ganze Suche verweigert
// werden. Deshalb wird dieser Router in index.js vor `/api/docker` gemountet, genau wie
// es `/api/docker/labels` schon macht.
//
// Zum Rechtesystem: Welche Server abgefragt werden, entscheidet `containerAllerQuellen`
// anhand der Rolle — `restrict_agents` (nur freigegebene Agenten) und `hide_local` (kein
// Panel-Server) wirken bereits beim Abruf, nicht erst beim Anzeigen. Über diese Route
// werden also weder Container noch Namen von Servern übertragen, die der Benutzer nicht
// sehen darf. Zusätzlich ist wie überall sonst `docker.view` nötig.

const router = require('express').Router();
const { requirePermission } = require('../middleware/requirePermission');
const db = require('../db');
const dockerQuellen = require('../utils/dockerQuellen');
const pelicanClient = require('../utils/pelicanClient');

router.get('/', requirePermission('docker.view'), async (req, res) => {
  const suchbegriff = String(req.query.q || '').trim().toLowerCase();
  if (suchbegriff.length < 2) {
    return res.status(400).json({ error: 'Bitte mindestens zwei Zeichen eingeben.' });
  }

  try {
    const { quellen, container } = await dockerQuellen.containerAllerQuellen(req.user?.role);

    // Spitznamen und Pelican-Klarnamen sind Anzeigenamen des Panels. Wer nach ihnen
    // sucht, erwartet Treffer — auch wenn der Container selbst anders heißt.
    const labels = db.prepare('SELECT server, container_id, nickname, tag FROM container_labels').all();
    const labelKarte = new Map(labels.map(l => [`${l.server}:${l.container_id}`, l]));

    // Nicht eingerichtetes Pelican ist kein Grund, die Suche scheitern zu lassen.
    let pelican = {};
    try { pelican = await pelicanClient.namensKarte(false); } catch {}

    const passt = (wert) => String(wert || '').toLowerCase().includes(suchbegriff);

    const treffer = container.map(c => {
      const label = labelKarte.get(`${c.serverId}:${c.id}`) || {};
      const pelicanName = pelican[String(c.name || '').toLowerCase()] || null;
      const felder = {
        name: c.name, image: c.image, stack: c.stack,
        spitzname: label.nickname || null, markierung: label.tag || null,
        pelicanName,
        kennung: String(c.id || '').slice(0, 12),
      };
      const gefundenIn = Object.entries(felder).filter(([, v]) => passt(v)).map(([k]) => k);
      return gefundenIn.length ? { ...c, ...felder, gefundenIn } : null;
    }).filter(Boolean);

    // Laufende zuerst, dann nach Server und Name — die Reihenfolge der Serverabfrage
    // ist durch das parallele Laden sonst zufällig.
    treffer.sort((a, b) =>
      (a.state === 'running' ? 0 : 1) - (b.state === 'running' ? 0 : 1) ||
      String(a.serverName).localeCompare(String(b.serverName)) ||
      String(a.name).localeCompare(String(b.name))
    );

    res.json({ suchbegriff, treffer, quellen, durchsucht: container.length });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Suche fehlgeschlagen' });
  }
});

module.exports = router;
