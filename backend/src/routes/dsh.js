const router = require('express').Router();
const axios  = require('axios');
const crypto = require('crypto');
const db     = require('../db');
const { requirePermission, getPermissions } = require('../middleware/requirePermission');
const { erfordertModul } = require('../utils/module');
const { auditLog }       = require('../utils/audit');
const { notifyAction }   = require('../utils/actionNotify');

// Modul-Prüfung: Ist DSH in den Einstellungen deaktiviert, 403 zurückgeben
router.use(erfordertModul('dsh', 'DeinServerHost ist in den Einstellungen deaktiviert.'));

const actionPermMap = {
  start:  'dsh.start',
  stop:   'dsh.stop',
  reset:  'dsh.reset',
  rescue: 'dsh.rescue',
};

const getToken = () =>
  db.prepare("SELECT value FROM settings WHERE key = 'dsh_api_token'").get()?.value ||
  process.env.DSH_API_TOKEN || '';

const api = () => {
  const token = getToken();
  if (!token) throw new Error('DSH API Token nicht konfiguriert');
  return axios.create({
    baseURL: 'https://api.dsh.gg/api/v2',
    headers: {
      'X-TOKEN': token,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    timeout: 10000,
  });
};

const handle = async (res, fn) => {
  try {
    const resp = await fn();
    res.json(resp.data);
  } catch (err) {
    const msg = err.response?.data?.message || err.response?.data?.error || err.message;
    const status = err.response?.status || (/nicht konfiguriert/i.test(msg) ? 400 : 500);
    res.status(status).json({ error: msg });
  }
};

const validId = (id) => /^\d+$/.test(id);

// ─── 1. Alle Services abrufen (inkl. Live-Powerstatus) ─────────────────────────
router.get('/services', requirePermission('dsh.view'), async (req, res) => {
  try {
    const client = api();
    const { data } = await client.get('/service');
    const items = Array.isArray(data?.items) ? data.items : (Array.isArray(data) ? data : []);

    // Live-Power-Status parallel für jeden Service abrufen (fail-soft)
    // Bei gekündigten oder beendeten Services keinen unnötigen Status-Call machen
    const statusPromises = items.map(srv => {
      const rawStatus = (srv.status || '').toLowerCase();
      if (!srv.serviceid || rawStatus === 'cancelled' || rawStatus === 'terminated') return Promise.resolve(null);
      return client.get(`/service/${srv.serviceid}/status`, { timeout: 5000 })
        .then(r => r.data)
        .catch(() => null);
    });

    const statuses = await Promise.allSettled(statusPromises);
    const enriched = items.map((srv, idx) => ({
      ...srv,
      powerStatus: statuses[idx]?.status === 'fulfilled' ? statuses[idx].value : null,
    }));

    res.json({
      status: 'OK',
      totalResults: enriched.length,
      items: enriched,
    });
  } catch (err) {
    const msg = err.response?.data?.message || err.response?.data?.error || err.message;
    const status = err.response?.status || (/nicht konfiguriert/i.test(msg) ? 400 : 500);
    res.status(status).json({ error: msg });
  }
});

// ─── 2. Einzelnen Service & Details abrufen ───────────────────────────────────
router.get('/services/:id', requirePermission('dsh.view'), async (req, res) => {
  if (!validId(req.params.id)) return res.status(400).json({ error: 'Ungültige Service-ID' });
  try {
    const client = api();
    const [srvRes, statusRes] = await Promise.allSettled([
      client.get(`/service/${req.params.id}`),
      client.get(`/service/${req.params.id}/status`, { timeout: 5000 }),
    ]);

    if (srvRes.status === 'rejected') {
      const msg = srvRes.reason?.response?.data?.message || srvRes.reason?.message || 'Fehler beim Laden des Services';
      return res.status(srvRes.reason?.response?.status || 500).json({ error: msg });
    }

    const srvData = srvRes.value.data?.items?.[0] || srvRes.value.data;
    const powerStatus = statusRes.status === 'fulfilled' ? statusRes.value.data : null;

    res.json({
      status: 'OK',
      service: {
        ...srvData,
        powerStatus,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── 3. Server-Aktionen (Start, Stop, Reset, Rescue) ──────────────────────────
router.post('/services/:id/:action', async (req, res) => {
  const { id, action } = req.params;
  if (!validId(id)) return res.status(400).json({ error: 'Ungültige Service-ID' });

  const requiredPerm = actionPermMap[action];
  if (!requiredPerm) {
    return res.status(400).json({ error: `Ungültige Aktion "${action}". Erlaubt: start, stop, reset, rescue` });
  }

  const userPerms = getPermissions(req.user.role);
  if (!userPerms.includes(requiredPerm)) {
    return res.status(403).json({ error: `Keine Berechtigung (${requiredPerm}) für diese Aktion.` });
  }

  try {
    const client = api();
    let resultData;

    if (action === 'rescue') {
      // Wenn kein Passwort übergeben wird, ein sicheres Einmalpasswort generieren
      // Anforderung DSH: min 12 Zeichen, min 1 Großbuchstabe, min 1 Zahl, min 1 Sonderzeichen
      const rootpass = req.body?.rootpass?.trim() ||
        `Dsh!${crypto.randomBytes(6).toString('hex')}9#`;

      const { data } = await client.post(`/service/${id}/rescue`, { rootpass });
      resultData = { ...data, rootpass };
    } else {
      const { data } = await client.post(`/service/${id}/${action}`);
      resultData = data;
    }

    // Server-Name für Audit & Benachrichtigung
    const serverName = req.body?.serverName || `DSH-${id}`;

    auditLog(req, `dsh.${action}`, 'dsh', id, { serverName, action });
    notifyAction(req, action, serverName, 'dsh');

    res.json(resultData);
  } catch (err) {
    const msg = err.response?.data?.message || err.response?.data?.error || err.message;
    res.status(err.response?.status || 500).json({ error: msg });
  }
});

// ─── 4. NoVNC-Notfallkonsole URL anfordern ─────────────────────────────────────
router.get('/services/:id/console', requirePermission('dsh.console'), async (req, res) => {
  if (!validId(req.params.id)) return res.status(400).json({ error: 'Ungültige Service-ID' });
  try {
    const { data } = await api().get(`/service/${req.params.id}/console`);
    auditLog(req, 'dsh.console', 'dsh', req.params.id);
    res.json({
      status: 'OK',
      url: data?.URL || data?.url,
    });
  } catch (err) {
    const msg = err.response?.data?.message || err.response?.data?.error || err.message;
    res.status(err.response?.status || 500).json({ error: msg });
  }
});

// ─── 5. DDoS-Schutz: Incidents / Vorfälle ─────────────────────────────────────
router.get('/protection/incidents/:ip', requirePermission('dsh.view'), (req, res) => {
  const ip = req.params.ip;
  if (!ip) return res.status(400).json({ error: 'IP-Adresse erforderlich' });
  handle(res, () => api().get(`/protection/incidents/${encodeURIComponent(ip)}`));
});

// ─── 6. DDoS-Schutz: Routing-Status ──────────────────────────────────────────
router.get('/protection/routing/:ip/:cidr', requirePermission('dsh.view'), (req, res) => {
  const { ip, cidr } = req.params;
  if (!ip || !cidr) return res.status(400).json({ error: 'IP und CIDR erforderlich' });
  handle(res, () => api().get(`/protection/routing/${encodeURIComponent(ip)}/${encodeURIComponent(cidr)}`));
});

router.put('/protection/routing/:ip/:cidr', requirePermission('dsh.view'), async (req, res) => {
  const { ip, cidr } = req.params;
  const { l4_permanent, l7_permanent, l7_only } = req.body;
  try {
    const { data } = await api().put(`/protection/routing/${encodeURIComponent(ip)}/${encodeURIComponent(cidr)}`, {
      l4_permanent: !!l4_permanent,
      l7_permanent: !!l7_permanent,
      l7_only: !!l7_only,
    });
    auditLog(req, 'dsh.routing_update', 'dsh', `${ip}/${cidr}`, { l4_permanent, l7_permanent, l7_only });
    res.json(data);
  } catch (err) {
    const msg = err.response?.data?.message || err.response?.data?.error || err.message;
    res.status(err.response?.status || 500).json({ error: msg });
  }
});

// ─── 7. Reverse DNS (PTR Record) ──────────────────────────────────────────────
router.put('/dns/reverse/:ip', requirePermission('dsh.rdns'), async (req, res) => {
  const ip = req.params.ip;
  const { record } = req.body;
  if (!record || !record.trim()) return res.status(400).json({ error: 'PTR-Record erforderlich' });

  try {
    const { data } = await api().put(`/dns/reverse/${encodeURIComponent(ip)}/record`, {
      record: record.trim(),
    });
    auditLog(req, 'dsh.rdns_set', 'dsh', ip, { record: record.trim() });
    res.json(data);
  } catch (err) {
    const msg = err.response?.data?.message || err.response?.data?.error || err.message;
    res.status(err.response?.status || 500).json({ error: msg });
  }
});

router.delete('/dns/reverse/:ip', requirePermission('dsh.rdns'), async (req, res) => {
  const ip = req.params.ip;
  try {
    const { data } = await api().delete(`/dns/reverse/${encodeURIComponent(ip)}/record`);
    auditLog(req, 'dsh.rdns_delete', 'dsh', ip);
    res.json(data);
  } catch (err) {
    const msg = err.response?.data?.message || err.response?.data?.error || err.message;
    res.status(err.response?.status || 500).json({ error: msg });
  }
});

module.exports = router;
