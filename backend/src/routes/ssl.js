const express = require('express');
const router = express.Router();
const db = require('../db');
const { requirePermission } = require('../permissions');
const { checkDomain } = require('../utils/sslMonitor');

// Nur Admins oder Nutzer mit alerts.manage dürfen Zertifikate überwachen
router.use(requirePermission('alerts.manage'));

// GET /api/ssl - Alle Monitore abrufen
router.get('/', (req, res) => {
  try {
    const monitors = db.prepare("SELECT * FROM ssl_monitors ORDER BY domain ASC").all();
    res.json(monitors);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/ssl - Neuen Monitor hinzufügen
router.post('/', async (req, res) => {
  const { domain, port, name } = req.body;
  if (!domain) return res.status(400).json({ error: 'Domain ist erforderlich' });

  try {
    const stmt = db.prepare(`
      INSERT INTO ssl_monitors (domain, port, name) 
      VALUES (?, ?, ?)
    `);
    const info = stmt.run(domain, port || 443, name || '');
    
    // Asynchron direkt den ersten Check anstoßen, aber nicht darauf warten
    const monitorId = info.lastInsertRowid;
    checkAndStoreDomain(monitorId, domain, port || 443);

    res.json({ id: monitorId, message: 'Monitor hinzugefügt' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/ssl/:id - Monitor aktualisieren (aktiv/inaktiv)
router.put('/:id', (req, res) => {
  const { domain, port, name, active } = req.body;
  
  try {
    const stmt = db.prepare(`
      UPDATE ssl_monitors 
      SET domain = ?, port = ?, name = ?, active = ?
      WHERE id = ?
    `);
    stmt.run(domain, port || 443, name || '', active === 1 || active === true ? 1 : 0, req.params.id);
    res.json({ message: 'Monitor aktualisiert' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/ssl/:id - Monitor löschen
router.delete('/:id', (req, res) => {
  try {
    db.prepare("DELETE FROM ssl_monitors WHERE id = ?").run(req.params.id);
    res.json({ message: 'Monitor gelöscht' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/ssl/:id/check - Manuellen Check anstoßen
router.post('/:id/check', async (req, res) => {
  try {
    const monitor = db.prepare("SELECT * FROM ssl_monitors WHERE id = ?").get(req.params.id);
    if (!monitor) return res.status(404).json({ error: 'Monitor nicht gefunden' });

    await checkAndStoreDomain(monitor.id, monitor.domain, monitor.port);
    const updated = db.prepare("SELECT * FROM ssl_monitors WHERE id = ?").get(req.params.id);
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Hilfsfunktion für manuellen / initialen Check
async function checkAndStoreDomain(id, domain, port) {
  try {
    const result = await checkDomain(domain, port);
    const now = new Date();
    const diffMs = result.validTo.getTime() - now.getTime();
    const daysRemaining = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    
    let status = 'ok';
    if (daysRemaining <= 0) status = 'expired';
    else if (daysRemaining <= 7) status = 'critical';
    else if (daysRemaining <= 30) status = 'warning';

    db.prepare(`
      UPDATE ssl_monitors 
      SET last_check = CURRENT_TIMESTAMP, 
          valid_to = ?, 
          issuer = ?, 
          days_remaining = ?, 
          status = ?, 
          error_msg = NULL 
      WHERE id = ?
    `).run(result.validTo.toISOString(), result.issuer, daysRemaining, status, id);
  } catch (err) {
    db.prepare(`
      UPDATE ssl_monitors 
      SET last_check = CURRENT_TIMESTAMP, 
          status = 'error', 
          error_msg = ? 
      WHERE id = ?
    `).run(err.message, id);
  }
}

module.exports = router;
