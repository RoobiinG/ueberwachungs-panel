/**
 * Docker Container-Labels (Spitznamen / Tags).
 * Diese Daten sind panel-seitig in SQLite gespeichert und brauchen
 * keinen lokalen Docker-Zugriff → kein requireLocalAccess.
 *
 * Lesen:    docker.view   (wer Container sieht, sieht auch ihre Spitznamen)
 * Schreiben: docker.label  (separates Recht zum Anlegen/Ändern von Labels)
 */

const router = require('express').Router();
const db     = require('../db');
const { requirePermission } = require('../middleware/requirePermission');

// GET /api/docker/labels?server=local
router.get('/', requirePermission('docker.view'), (req, res) => {
  const server = req.query.server || 'local';
  const rows = db.prepare(
    'SELECT container_id, nickname, tag FROM container_labels WHERE server = ?'
  ).all(server);
  const map = {};
  for (const r of rows) map[r.container_id] = { nickname: r.nickname, tag: r.tag };
  res.json(map);
});

// PUT /api/docker/labels  body: { server, containerId, nickname, tag }
router.put('/', requirePermission('docker.label'), (req, res) => {
  const { server = 'local', containerId, nickname = '', tag = '' } = req.body;
  if (!containerId) return res.status(400).json({ error: 'containerId erforderlich' });
  db.prepare(`
    INSERT INTO container_labels (server, container_id, nickname, tag)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(server, container_id)
    DO UPDATE SET nickname = excluded.nickname, tag = excluded.tag
  `).run(server, containerId, nickname.trim(), tag.trim());
  res.json({ ok: true });
});

// DELETE /api/docker/labels/:server/:containerId
router.delete('/:server/:containerId', requirePermission('docker.label'), (req, res) => {
  db.prepare('DELETE FROM container_labels WHERE server = ? AND container_id = ?')
    .run(req.params.server, req.params.containerId);
  res.json({ ok: true });
});

module.exports = router;
