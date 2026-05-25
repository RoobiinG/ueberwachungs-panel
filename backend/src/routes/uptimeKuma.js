const router      = require('express').Router();
const axios       = require('axios');
const { io }      = require('socket.io-client');
const db          = require('../db');
const requireRole = require('../middleware/roles');
const { validatePublicUrl } = require('../utils/validateUrl');

// ─── Helpers ────────────────────────────────────────────────────────────────

const getSetting = (key) =>
  db.prepare('SELECT value FROM settings WHERE key = ?').get(key)?.value ?? null;

const setSetting = (key, val) =>
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, val);

// ─── Cache (30 s) ────────────────────────────────────────────────────────────

const CACHE = new Map();
const TTL   = 30_000;

// ─── Socket.IO via API-Key ────────────────────────────────────────────────────
// Uptime Kuma v1.23+ unterstützt API-Keys über den Socket-Auth-Header.
// Der Key wird als "x-api-key" im auth-Objekt beim Verbindungsaufbau übergeben.

function fetchViaSocket(url, apiKey) {
  const key    = `${url}|${apiKey.slice(0, 8)}`;
  const cached = CACHE.get(key);
  if (cached && Date.now() - cached.ts < TTL) return Promise.resolve(cached.data);

  return new Promise((resolve, reject) => {
    const socket = io(url.replace(/\/+$/, ''), {
      transports:   ['polling', 'websocket'], // polling zuerst (Nginx-kompatibel), dann WebSocket
      reconnection: false,
      timeout:      8000,
      auth: { 'x-api-key': apiKey },
    });

    const monitors  = {};
    const heartbeats = {};
    const uptime    = {};
    let done = false;

    const finish = (err) => {
      if (done) return;
      done = true;
      socket.disconnect();
      if (err) return reject(err);
      const result = buildResult(monitors, heartbeats, uptime);
      if (result.monitors.length === 0) {
        // Wenn nach dem Timeout keine Monitore kamen → wahrscheinlich Auth-Fehler
        return reject(new Error('Keine Monitore empfangen — API-Key gültig? (Uptime Kuma ≥ v1.23 erforderlich)'));
      }
      CACHE.set(key, { data: result, ts: Date.now() });
      resolve(result);
    };

    socket.on('monitorList',   (list)            => { Object.assign(monitors, list); });
    socket.on('heartbeatList', (id, list)        => { heartbeats[id] = list; });
    socket.on('uptime',        (id, period, val) => {
      if (!uptime[id]) uptime[id] = {};
      uptime[id][period] = val;
    });

    socket.on('connect_error', (err) =>
      finish(new Error(`Verbindung fehlgeschlagen: ${err.message}`))
    );
    socket.on('error', (err) =>
      finish(new Error(err.message || 'Socket-Fehler'))
    );

    // Nach 7 Sekunden auflösen (Uptime-Events kommen verzögert)
    setTimeout(() => finish(null), 7000);
  });
}

// Uptime aus Heartbeat-Liste berechnen (Fallback wenn kein uptime-Event kam)
function calcUptime(hbList, hours) {
  if (!hbList?.length) return null;
  const since    = Date.now() - hours * 3_600_000;
  const relevant = hbList.filter(h => new Date(h.time?.replace(' ', 'T')).getTime() >= since);
  if (!relevant.length) return null;
  return Math.round((relevant.filter(h => h.status === 1).length / relevant.length) * 1000) / 10;
}

function buildResult(monitors, heartbeats, uptime) {
  const result = [];
  for (const [id, m] of Object.entries(monitors)) {
    if (!m.active) continue;
    const hbList = heartbeats[id] || [];
    const latest = hbList.at(-1);
    const u      = uptime[id];
    result.push({
      id:        m.id,
      name:      m.name,
      type:      m.type,
      group:     m.tags?.length ? m.tags[0]?.name : null,
      status:    latest?.status ?? 3,
      ping:      latest?.ping   ?? null,
      msg:       latest?.msg    ?? '',
      lastCheck: latest?.time   ? new Date(latest.time.replace(' ', 'T')).toISOString() : null,
      uptime24h: u?.['24']  != null ? Math.round(u['24']  * 1000) / 10 : calcUptime(hbList, 24),
      uptime30d: u?.['720'] != null ? Math.round(u['720'] * 1000) / 10 : calcUptime(hbList, 720),
    });
  }
  result.sort((a, b) =>
    (a.status === 0 ? -1 : b.status === 0 ? 1 : 0) || a.name.localeCompare(b.name)
  );
  return { monitors: result, incident: null };
}

// ─── Routes ──────────────────────────────────────────────────────────────────

// GET /api/uptime-kuma/config
router.get('/config', (req, res) => {
  res.json({
    url:       getSetting('uptimeKumaUrl')    || '',
    hasApiKey: !!getSetting('uptimeKumaApiKey'),
    slug:      getSetting('uptimeKumaSlug')   || 'default',
  });
});

// POST /api/uptime-kuma/config  (nur Admins dürfen die Verbindung ändern)
router.post('/config', requireRole('admin'), (req, res) => {
  const { url, apiKey, slug } = req.body;
  if (url !== undefined) {
    try { validatePublicUrl(url); } catch (e) { return res.status(400).json({ error: e.message }); }
    setSetting('uptimeKumaUrl', url.trim());
  }
  if (apiKey !== undefined) setSetting('uptimeKumaApiKey', apiKey.trim());
  if (slug   !== undefined) setSetting('uptimeKumaSlug',   slug?.trim() || 'default');
  CACHE.clear();
  res.json({ ok: true });
});

// GET /api/uptime-kuma/monitors
router.get('/monitors', async (req, res) => {
  const url    = getSetting('uptimeKumaUrl');
  const apiKey = getSetting('uptimeKumaApiKey');
  const slug   = getSetting('uptimeKumaSlug') || 'default';

  if (!url) return res.status(400).json({ error: 'Uptime Kuma URL nicht konfiguriert.' });

  // Mit API-Key: vollständige API via Socket.IO
  if (apiKey) {
    try {
      return res.json(await fetchViaSocket(url, apiKey));
    } catch (err) {
      return res.status(502).json({ error: err.message });
    }
  }

  // Ohne API-Key: öffentliche Status-Seite (Fallback)
  try {
    const { data } = await axios.get(
      `${url.replace(/\/+$/, '')}/api/status-page/${encodeURIComponent(slug)}`,
      { timeout: 10000 }
    );
    const monitors = [];
    for (const group of data.publicGroupList || []) {
      for (const m of group.monitorList || []) {
        const hb = m.heartbeatList?.at(-1);
        monitors.push({
          id:        m.id,
          name:      m.name,
          type:      m.type,
          group:     group.name,
          status:    hb?.status ?? 3,
          ping:      hb?.ping   ?? null,
          msg:       hb?.msg    ?? '',
          lastCheck: hb?.time   ? new Date(hb.time.replace(' ', 'T')).toISOString() : null,
          uptime24h: m.uptimeList?.['24']  ?? null,
          uptime30d: m.uptimeList?.['720'] ?? null,
        });
      }
    }
    res.json({ monitors, incident: data.incident ?? null });
  } catch (err) {
    if (err.response?.status === 404)
      return res.status(404).json({
        error: `Status-Seite "${slug}" nicht gefunden — Slug in Uptime Kuma unter Einstellungen → Status-Seiten prüfen.`,
      });
    res.status(502).json({ error: `Verbindung fehlgeschlagen: ${err.message}` });
  }
});

module.exports = router;
