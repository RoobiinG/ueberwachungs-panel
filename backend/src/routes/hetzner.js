const router      = require('express').Router();
const axios       = require('axios');
const db          = require('../db');
const { requirePermission, getPermissions } = require('../middleware/requirePermission');

const actionPermMap = {
  poweron:  'hetzner.start',
  poweroff: 'hetzner.stop',
  shutdown: 'hetzner.stop',
  reset:    'hetzner.stop',
  reboot:   'hetzner.restart',
};

const getToken = () =>
  db.prepare("SELECT value FROM settings WHERE key = 'hetzner_api_token'").get()?.value ||
  process.env.HETZNER_API_TOKEN || '';

const api = () => {
  const token = getToken();
  if (!token) throw new Error('Hetzner API Token nicht konfiguriert');
  return axios.create({
    baseURL: 'https://api.hetzner.cloud/v1',
    headers: { Authorization: `Bearer ${token}` },
  });
};

const handle = async (res, fn) => {
  try { res.json((await fn()).data); }
  catch (err) {
    const msg = err.response?.data?.error?.message || err.message;
    res.status(err.response?.status || 500).json({ error: msg });
  }
};

const validId = (id) => /^\d+$/.test(id);

// ─── Storage Boxes ────────────────────────────────────────────────────────────
// Gleicher Cloud-Token. Endpunkt-Host: erst api.hetzner.cloud, bei 404 api.hetzner.com.
const SBOX_CACHE = new Map();
const SBOX_TTL   = 45_000;

const pickNum = (o, ...keys) => { for (const k of keys) { const v = o?.[k]; if (v != null && !isNaN(+v)) return +v; } return 0; };
const pickStr = (o, ...keys) => { for (const k of keys) { const v = o?.[k]; if (v != null && v !== '') return String(v); } return null; };

async function fetchStorageBoxesRaw() {
  const token = getToken();
  if (!token) throw new Error('Hetzner API Token nicht konfiguriert');
  const hosts = ['https://api.hetzner.cloud/v1', 'https://api.hetzner.com/v1'];
  let lastErr;
  for (const baseURL of hosts) {
    try {
      const client = axios.create({ baseURL, headers: { Authorization: `Bearer ${token}` }, timeout: 10_000 });
      const [boxesRes, typesRes] = await Promise.all([
        client.get('/storage_boxes'),
        client.get('/storage_box_types').catch(() => ({ data: {} })),
      ]);
      return { boxesRes, typesRes };
    } catch (err) {
      lastErr = err;
      // Nur bei 404/Netzfehler den anderen Host probieren; 401/403 sofort durchreichen
      if (err.response && err.response.status !== 404) throw err;
    }
  }
  throw lastErr;
}

function mapStorageBox(b, typeSize) {
  const t        = (b.storage_box_type && typeof b.storage_box_type === 'object') ? b.storage_box_type : null;
  const typeName = pickStr(t, 'name') || pickStr(b, 'storage_box_type');
  const typeId   = t?.id ?? null;
  const quota    = pickNum(t, 'size')
    || (typeId != null && typeSize.byId[typeId]) || (typeName && typeSize.byName[typeName]) || 0;
  const stats    = (b.stats && typeof b.stats === 'object') ? b.stats : b;
  const used     = pickNum(stats, 'size');
  const acc      = b.access_settings || {};
  return {
    id:        b.id ?? b.uuid,
    name:      pickStr(b, 'name') || `Box ${b.id}`,
    server:    pickStr(b, 'server', 'server_name'),   // FQDN
    username:  pickStr(b, 'username'),
    type:      typeName,
    location:  pickStr(b.location, 'name') || pickStr(b, 'location'),
    status:    pickStr(b, 'status') || 'unbekannt',
    usedBytes: used,
    quotaBytes: quota,
    usagePct:  quota > 0 ? Math.round((used / quota) * 1000) / 10 : null,
    dataBytes: pickNum(stats, 'size_data'),
    snapshotBytes: pickNum(stats, 'size_snapshots'),
    ssh:    !!(acc.ssh_enabled ?? acc.ssh),
    samba:  !!(acc.samba_enabled ?? acc.samba),
    webdav: !!(acc.webdav_enabled ?? acc.webdav),
    deleteProtection: !!(b.delete_protection ?? b.protection?.delete),
  };
}

// Gemappte Storage-Box-Liste (mit Cache) — auch vom Alert-Evaluator genutzt.
async function getStorageBoxes() {
  const cached = SBOX_CACHE.get('boxes');
  if (cached && Date.now() - cached.ts < SBOX_TTL) return cached.data;

  const { boxesRes, typesRes } = await fetchStorageBoxesRaw();
  const types = typesRes.data?.storage_box_types || [];
  const typeSize = { byId: {}, byName: {} };
  for (const t of types) {
    const s = pickNum(t, 'size');
    if (t.id != null) typeSize.byId[t.id] = s;
    if (t.name)       typeSize.byName[t.name] = s;
  }
  const raw   = boxesRes.data?.storage_boxes || [];
  const boxes = raw.map(b => mapStorageBox(b, typeSize));
  SBOX_CACHE.set('boxes', { data: boxes, ts: Date.now() });
  return boxes;
}

router.get('/servers', requirePermission('hetzner.view'), (req, res) => handle(res, () => api().get('/servers')));

router.get('/storage_boxes', requirePermission('hetzner.view'), (req, res) =>
  handle(res, async () => ({ data: { boxes: await getStorageBoxes() } })));

router.post('/servers/:id/:action', (req, res) => {
  if (!validId(req.params.id)) return res.status(400).json({ error: 'Ungültige Server-ID' });
  const perm = actionPermMap[req.params.action];
  if (!perm) return res.status(400).json({ error: 'Ungültige Aktion' });
  if (!getPermissions(req.user.role).includes(perm)) return res.status(403).json({ error: 'Keine Berechtigung' });
  handle(res, () => api().post(`/servers/${req.params.id}/actions/${req.params.action}`));
});

router.post('/servers/:id/backup/:toggle', requirePermission('hetzner.backup'), (req, res) => {
  if (!validId(req.params.id)) return res.status(400).json({ error: 'Ungültige Server-ID' });
  if (!['enable', 'disable'].includes(req.params.toggle)) return res.status(400).json({ error: 'Ungültiger Wert' });
  handle(res, () => api().post(`/servers/${req.params.id}/actions/${req.params.toggle}_backup`));
});

router.get('/servers/:id/backups', requirePermission('hetzner.view'), (req, res) => {
  if (!validId(req.params.id)) return res.status(400).json({ error: 'Ungültige Server-ID' });
  handle(res, () => api().get(`/images?type=backup&bound_to=${req.params.id}`));
});

module.exports = router;
// Für den Alert-Evaluator (Storage-Box-Metrik) wiederverwendbar.
module.exports.getStorageBoxes = getStorageBoxes;
