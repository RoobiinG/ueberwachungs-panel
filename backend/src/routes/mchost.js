const router      = require('express').Router();
const axios       = require('axios');
const db          = require('../db');
const { requirePermission, getPermissions } = require('../middleware/requirePermission');

const actionPermMap = {
  start:    'mchost.start',
  stop:     'mchost.stop',
  shutdown: 'mchost.stop',
  restart:  'mchost.restart',
};

const getSetting = (key) =>
  db.prepare('SELECT value FROM settings WHERE key = ?').get(key)?.value || '';
const setSetting = (key, val) =>
  db.prepare('INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)').run(key, val);

// ─── Token-Verwaltung ────────────────────────────────────────────────────────

const getToken = async () => {
  const cached = getSetting('mchost_api_token');
  if (cached) return cached;

  const username = getSetting('mchost_username');
  const password = getSetting('mchost_password');
  if (!username || !password) throw new Error('MC-Host24 Zugangsdaten nicht konfiguriert');

  let data;
  try {
    ({ data } = await axios.post(
      'https://mc-host24.de/api/v1/token',
      { username, password },
      { headers: { 'Content-Type': 'application/json', Accept: 'application/json' } }
    ));
  } catch (err) {
    const msg = err.response?.data?.messages
      ? Object.values(err.response.data.messages).flat().join(', ')
      : err.response?.data?.message || err.message;
    throw new Error(`Login fehlgeschlagen: ${msg}`);
  }

  // API antwortet mit: { status: "SUCCESS", data: { api_token: "..." } }
  const token = data?.data?.api_token ?? data?.api_token ?? data?.token ?? data?.access_token;

  if (!token) {
    throw new Error(`Kein Token in der API-Antwort gefunden. Response: ${JSON.stringify(data)}`);
  }

  setSetting('mchost_api_token', token);
  return token;
};

// ─── Axios-Instanz mit Auth-Header ──────────────────────────────────────────

const api = async () => {
  const token = await getToken();
  return axios.create({
    baseURL: 'https://mc-host24.de/api/v1',
    headers: {
      // Laut offizieller Swagger-Doku: Authorization: {token} — KEIN "Bearer"!
      'Authorization': token,
      'Content-Type':  'application/json',
      'Accept':        'application/json',
    },
  });
};

// ─── Error-Handler ───────────────────────────────────────────────────────────

const handle = async (res, fn, _retried = false) => {
  try {
    // MC-Host24 wraps responses: { status: "SUCCESS", data: ... } → unwrappen
    const body = (await fn()).data;
    res.json(body?.data ?? body);
  } catch (err) {
    if ((err.response?.status === 401 || err.response?.status === 403) && !_retried) {
      // Token abgelaufen → löschen und einmalig automatisch neu einloggen + wiederholen
      db.prepare("DELETE FROM settings WHERE key = 'mchost_api_token'").run();
      try {
        await getToken(); // wirft, falls keine Credentials hinterlegt
        return handle(res, fn, true);
      } catch { /* fällt durch zum Fehler unten */ }
    }
    const msg = err.response?.data?.messages
      ? Object.values(err.response.data.messages).flat().join(', ')
      : err.response?.data?.message || err.message;
    res.status(err.response?.status || 500).json({ error: msg });
  }
};

// ─── Zugriffskontrolle ───────────────────────────────────────────────────────

// Gibt null zurück wenn kein Zugriff, sonst das gefilterte Array
const filterByAccess = (list, userRole) => {
  const role = db.prepare('SELECT id, is_admin, restrict_mchost FROM roles WHERE name = ?').get(userRole);
  if (!role || role.is_admin || !role.restrict_mchost) return list;
  const allowed = new Set(
    db.prepare('SELECT vserver_id FROM mchost_vserver_access WHERE role_id = ?')
      .all(role.id).map(r => String(r.vserver_id))
  );
  return list.filter(s => allowed.has(String(s.id)));
};

// Tags für eine Liste von VServer-IDs laden und anhängen
const attachTags = (list) => {
  if (!list.length) return list;
  const ids = list.map(s => String(s.id));
  const placeholders = ids.map(() => '?').join(',');
  const tags = db.prepare(
    `SELECT vserver_id, tag, color FROM mchost_vserver_tags WHERE vserver_id IN (${placeholders})`
  ).all(...ids);
  const tagMap = {};
  for (const t of tags) {
    (tagMap[t.vserver_id] ??= []).push({ tag: t.tag, color: t.color });
  }
  return list.map(s => ({ ...s, tags: tagMap[String(s.id)] ?? [] }));
};

// ─── Routes ──────────────────────────────────────────────────────────────────

const validId = (id) => /^\d+$/.test(id);

router.get('/vserver', requirePermission('mchost.view'), async (req, res) => {
  try {
    const body = (await (await api()).get('/vserver')).data;
    let list = Array.isArray(body?.data) ? body.data : Array.isArray(body) ? body : [];
    list = filterByAccess(list, req.user.role);
    list = attachTags(list);
    res.json(list);
  } catch (err) {
    if ((err.response?.status === 401 || err.response?.status === 403)) {
      db.prepare("DELETE FROM settings WHERE key = 'mchost_api_token'").run();
    }
    const msg = err.response?.data?.messages
      ? Object.values(err.response.data.messages).flat().join(', ')
      : err.response?.data?.message || err.message;
    res.status(err.response?.status || 500).json({ error: msg });
  }
});

router.get('/vserver/:id/status', requirePermission('mchost.view'), async (req, res) => {
  if (!validId(req.params.id)) return res.status(400).json({ error: 'Ungültige VServer-ID' });
  handle(res, async () => (await api()).get(`/vserver/${req.params.id}/status`));
});

router.post('/vserver/:id/:action', requirePermission('mchost.view'), async (req, res) => {
  if (!validId(req.params.id)) return res.status(400).json({ error: 'Ungültige VServer-ID' });
  const perm = actionPermMap[req.params.action];
  if (!perm) return res.status(400).json({ error: 'Ungültige Aktion' });
  if (!getPermissions(req.user.role).includes(perm)) return res.status(403).json({ error: 'Keine Berechtigung' });
  handle(res, async () => (await api()).post(`/vserver/${req.params.id}/${req.params.action}`));
});

router.get('/vserver/:id/backups', requirePermission('mchost.view'), async (req, res) => {
  if (!validId(req.params.id)) return res.status(400).json({ error: 'Ungültige VServer-ID' });
  handle(res, async () => (await api()).get(`/vserver/${req.params.id}/backups`));
});

router.post('/vserver/:id/backups', requirePermission('mchost.backup'), async (req, res) => {
  if (!validId(req.params.id)) return res.status(400).json({ error: 'Ungültige VServer-ID' });
  handle(res, async () => (await api()).post(`/vserver/${req.params.id}/backups`));
});

// ─── Tag-Routen ──────────────────────────────────────────────────────────────

const VALID_COLORS = ['blue', 'green', 'red', 'orange', 'purple', 'gray'];

router.get('/vserver/:id/tags', requirePermission('mchost.view'), (req, res) => {
  const tags = db.prepare('SELECT tag, color FROM mchost_vserver_tags WHERE vserver_id = ?')
    .all(req.params.id);
  res.json(tags);
});

router.post('/vserver/:id/tags', requirePermission('mchost.view'), (req, res) => {
  const role = db.prepare('SELECT is_admin FROM roles WHERE name = ?').get(req.user.role);
  if (!role?.is_admin) return res.status(403).json({ error: 'Nur Admins können Tags verwalten' });

  const { tag, color = 'blue' } = req.body || {};
  if (!tag || typeof tag !== 'string' || tag.trim().length === 0 || tag.length > 32) {
    return res.status(400).json({ error: 'Ungültiger Tag (1–32 Zeichen)' });
  }
  if (!VALID_COLORS.includes(color)) {
    return res.status(400).json({ error: 'Ungültige Farbe' });
  }
  db.prepare(
    'INSERT OR REPLACE INTO mchost_vserver_tags (vserver_id, tag, color) VALUES (?, ?, ?)'
  ).run(req.params.id, tag.trim(), color);
  res.json({ ok: true });
});

router.delete('/vserver/:id/tags/:tag', requirePermission('mchost.view'), (req, res) => {
  const role = db.prepare('SELECT is_admin FROM roles WHERE name = ?').get(req.user.role);
  if (!role?.is_admin) return res.status(403).json({ error: 'Nur Admins können Tags verwalten' });

  db.prepare('DELETE FROM mchost_vserver_tags WHERE vserver_id = ? AND tag = ?')
    .run(req.params.id, req.params.tag);
  res.json({ ok: true });
});

// ─── VServer-Zugriffskontrolle für Rollen-Editor ─────────────────────────────

// Gibt alle zugewiesenen VServer-IDs für eine Rolle zurück
router.get('/access/:roleId', requirePermission('mchost.view'), (req, res) => {
  const role = db.prepare('SELECT is_admin FROM roles WHERE name = ?').get(req.user.role);
  if (!role?.is_admin) return res.status(403).json({ error: 'Keine Berechtigung' });
  const ids = db.prepare('SELECT vserver_id FROM mchost_vserver_access WHERE role_id = ?')
    .all(req.params.roleId).map(r => r.vserver_id);
  res.json(ids);
});

// Speichert die VServer-Zuweisung für eine Rolle
router.put('/access/:roleId', requirePermission('mchost.view'), (req, res) => {
  const adminRole = db.prepare('SELECT is_admin FROM roles WHERE name = ?').get(req.user.role);
  if (!adminRole?.is_admin) return res.status(403).json({ error: 'Keine Berechtigung' });

  const { vserverIds = [] } = req.body || {};
  if (!Array.isArray(vserverIds)) return res.status(400).json({ error: 'vserverIds muss ein Array sein' });

  const del = db.prepare('DELETE FROM mchost_vserver_access WHERE role_id = ?');
  const ins = db.prepare('INSERT OR IGNORE INTO mchost_vserver_access (role_id, vserver_id) VALUES (?, ?)');
  db.transaction(() => {
    del.run(req.params.roleId);
    for (const id of vserverIds) ins.run(req.params.roleId, String(id));
  })();
  res.json({ ok: true });
});

module.exports = router;
