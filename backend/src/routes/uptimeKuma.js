const router = require('express').Router();
const axios  = require('axios');
const { io } = require('socket.io-client');
const db     = require('../db');

// ─── Helpers ────────────────────────────────────────────────────────────────

const getSetting = (key) =>
  db.prepare('SELECT value FROM settings WHERE key = ?').get(key)?.value ?? null;

const setSetting = (key, val) =>
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, val);

// ─── Cache (30 s) ────────────────────────────────────────────────────────────

const CACHE = new Map();
const TTL   = 30_000;

// ─── Socket.IO-Verbindung zu Uptime Kuma ────────────────────────────────────
// Verbindet sich, holt alle Monitore + Heartbeats, trennt dann die Verbindung.
// Ergebnis wird 30 Sekunden gecacht.

function fetchViaSocket(url, username, password) {
  const key    = `${url}|${username}`;
  const cached = CACHE.get(key);
  if (cached && Date.now() - cached.ts < TTL) return Promise.resolve(cached.data);

  return new Promise((resolve, reject) => {
    const socket = io(url.replace(/\/+$/, ''), {
      transports:  ['websocket'],
      reconnection: false,
      timeout:      8000,
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
      const data = buildResult(monitors, heartbeats, uptime);
      CACHE.set(key, { data, ts: Date.now() });
      resolve(data);
    };

    socket.on('connect', () => {
      socket.emit('login', { username, password, token: '' }, (res) => {
        if (!res?.ok) finish(new Error(res?.msg || 'Login fehlgeschlagen — Zugangsdaten prüfen.'));
      });
    });

    // Uptime Kuma sendet diese Events nach erfolgreichem Login:
    socket.on('monitorList',    (list)             => { Object.assign(monitors, list); });
    socket.on('heartbeatList',  (id, list)         => { heartbeats[id] = list; });
    socket.on('uptime',         (id, period, val)  => {
      if (!uptime[id]) uptime[id] = {};
      uptime[id][period] = val; // Wert kommt als Dezimalzahl 0–1
    });

    socket.on('connect_error', (err) => finish(new Error(`Verbindung fehlgeschlagen: ${err.message}`)));
    socket.on('error',         (err) => finish(new Error(err.message || 'Socket-Fehler')));

    // Nach 7 Sekunden mit dem abschicken was wir haben (Uptime-Events kommen etwas verzögert)
    setTimeout(() => finish(null), 7000);
  });
}

// Uptime aus Heartbeat-Liste berechnen (Fallback wenn kein uptime-Event kam)
function calcUptime(hbList, hours) {
  if (!hbList?.length) return null;
  const since    = Date.now() - hours * 3_600_000;
  const relevant = hbList.filter(h => new Date(h.time?.replace(' ', 'T')).getTime() >= since);
  if (!relevant.length) return null;
  const up = relevant.filter(h => h.status === 1).length;
  return Math.round((up / relevant.length) * 1000) / 10;
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
  // Sortierung: DOWN zuerst, dann nach Name
  result.sort((a, b) => (a.status === 0 ? -1 : b.status === 0 ? 1 : 0) || a.name.localeCompare(b.name));
  return { monitors: result, incident: null };
}

// ─── Routes ──────────────────────────────────────────────────────────────────

// GET /api/uptime-kuma/config
router.get('/config', (req, res) => {
  res.json({
    url:      getSetting('uptimeKumaUrl')      || '',
    username: getSetting('uptimeKumaUsername') || '',
    // Passwort wird nicht zurückgegeben, nur ob eins gesetzt ist
    hasPassword: !!getSetting('uptimeKumaPassword'),
    slug:     getSetting('uptimeKumaSlug')     || 'default',
  });
});

// POST /api/uptime-kuma/config
router.post('/config', (req, res) => {
  const { url, username, password, slug } = req.body;
  if (url      !== undefined) setSetting('uptimeKumaUrl',      url.trim());
  if (username !== undefined) setSetting('uptimeKumaUsername', username.trim());
  if (password !== undefined) setSetting('uptimeKumaPassword', password);
  if (slug     !== undefined) setSetting('uptimeKumaSlug',     slug?.trim() || 'default');
  // Cache bei neuer Konfiguration leeren
  CACHE.clear();
  res.json({ ok: true });
});

// GET /api/uptime-kuma/monitors
router.get('/monitors', async (req, res) => {
  const url      = getSetting('uptimeKumaUrl');
  const username = getSetting('uptimeKumaUsername');
  const password = getSetting('uptimeKumaPassword');
  const slug     = getSetting('uptimeKumaSlug') || 'default';

  if (!url) return res.status(400).json({ error: 'Uptime Kuma URL nicht konfiguriert.' });

  // Mit Zugangsdaten: vollständige API über Socket.IO
  if (username && password) {
    try {
      const data = await fetchViaSocket(url, username, password);
      return res.json(data);
    } catch (err) {
      return res.status(502).json({ error: err.message });
    }
  }

  // Ohne Zugangsdaten: öffentliche Status-Seite (nur Monitore die dort gelistet sind)
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
          status:    hb?.status  ?? 3,
          ping:      hb?.ping    ?? null,
          msg:       hb?.msg     ?? '',
          lastCheck: hb?.time    ? new Date(hb.time.replace(' ', 'T')).toISOString() : null,
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
