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

// ─── REST API (Uptime Kuma v2+) ──────────────────────────────────────────────
// Uptime Kuma v2 stellt eine REST-API bereit.
// Authentifizierung über Authorization: ApiKey <key>

async function fetchViaRest(url, apiKey) {
  const key    = `${url}|${apiKey.slice(0, 8)}`;
  const cached = CACHE.get(key);
  if (cached && Date.now() - cached.ts < TTL) return cached.data;

  const base = url.replace(/\/+$/, '');
  const { data } = await axios.get(`${base}/api/v1/monitor`, {
    headers: { Authorization: `ApiKey ${apiKey}` },
    timeout: 10000,
  });

  // Nur bei explizitem ok=false ablehnen (nicht bei fehlendem ok-Feld!).
  // Uptime Kuma v2.x sendet teils keinen ok-Wrapper → !undefined wäre false-positive.
  if (data.ok === false) {
    const errMsg = data.msg || data.message || data.error || 'API-Key ungültig oder keine Berechtigung';
    throw new Error(`Uptime-Kuma: ${errMsg}`);
  }

  // monitors kann Array (v1) oder Objekt { id: {...} } (v2) sein
  if (data.monitors == null) {
    throw new Error('Unerwartetes Antwortformat — monitors fehlt in der API-Antwort');
  }
  const monitorArr = Array.isArray(data.monitors)
    ? data.monitors
    : Object.values(data.monitors);

  // Uptime kann als Bruch (0–1) oder als Prozentwert (0–100) kommen
  const toPercent = (v) => {
    if (v == null) return null;
    const n = parseFloat(v);
    if (isNaN(n)) return null;
    return Math.round((n <= 1 ? n * 100 : n) * 10) / 10;
  };

  const monitors = monitorArr
    .filter(m => m.active)
    .map(m => {
      const hb = m.lastHeartBeat ?? m.heartbeat ?? {};
      return {
        id:        m.id,
        name:      m.name,
        type:      m.type,
        group:     m.tags?.length ? m.tags[0]?.name : null,
        status:    m.currentStatus ?? hb.status    ?? 3,
        ping:      hb.ping         ?? hb.duration  ?? null,
        msg:       hb.msg          ?? '',
        lastCheck: hb.time         ? new Date(hb.time.replace(' ', 'T')).toISOString() : null,
        uptime24h: toPercent(m.uptime   ?? m.uptimeDay   ?? null),
        uptime30d: toPercent(m.uptimeMonth              ?? null),
      };
    });

  monitors.sort((a, b) =>
    (a.status === 0 ? -1 : b.status === 0 ? 1 : 0) || a.name.localeCompare(b.name)
  );

  const result = { monitors, incident: null };
  CACHE.set(key, { data: result, ts: Date.now() });
  return result;
}

// ─── Socket.IO (Uptime Kuma v1.x Fallback) ───────────────────────────────────
// Uptime Kuma v1.23+ unterstützt API-Keys über socket.handshake.auth.apiKey

function fetchViaSocket(url, apiKey) {
  const key    = `${url}|${apiKey.slice(0, 8)}`;
  const cached = CACHE.get(key);
  if (cached && Date.now() - cached.ts < TTL) return Promise.resolve(cached.data);

  return new Promise((resolve, reject) => {
    const base = url.replace(/\/+$/, '');

    const socket = io(base, {
      transports:   ['polling', 'websocket'],
      reconnection: false,
      timeout:      12000,
      // Uptime Kuma v1.23+ und v2.x: API-Key im auth-Objekt
      auth: { apiKey },
    });

    const monitors   = {};
    const heartbeats = {};
    const uptime     = {};
    let done = false;
    let timeoutId;

    const finish = (err) => {
      if (done) return;
      done = true;
      clearTimeout(timeoutId);
      socket.disconnect();
      if (err) return reject(err);
      const result = buildResult(monitors, heartbeats, uptime);
      if (result.monitors.length === 0) {
        return reject(new Error(
          'Socket.IO: 0 Monitore empfangen — API-Key ungültig oder Uptime Kuma v1.23+ erforderlich'
        ));
      }
      CACHE.set(key, { data: result, ts: Date.now() });
      resolve(result);
    };

    // Uptime Kuma v1.x / v2.x Events
    socket.on('monitorList',   (list)            => { Object.assign(monitors, list); });
    socket.on('heartbeatList', (id, list)        => { heartbeats[id] = list; });
    socket.on('uptime',        (id, period, val) => {
      if (!uptime[id]) uptime[id] = {};
      uptime[id][period] = val;
    });

    socket.on('connect', () => {
      // Explizit Monitore anfordern (Callback + Event-Variante)
      socket.emit('getMonitorList', (res) => {
        if (res?.ok && res.monitors) Object.assign(monitors, res.monitors);
      });
    });

    // Authentifizierungsfehler abfangen (manche Uptime-Kuma-Versionen)
    socket.on('disconnect', (reason) => {
      if (!done && reason !== 'io client disconnect') {
        finish(new Error(`Socket getrennt: ${reason}`));
      }
    });

    socket.on('connect_error', (err) =>
      finish(new Error(`Verbindung fehlgeschlagen: ${err.message}`))
    );
    socket.on('error', (err) =>
      finish(new Error(err?.message || 'Socket-Fehler'))
    );

    // 12 s warten, dann mit gesammelten Daten auswerten
    timeoutId = setTimeout(() => finish(null), 12000);
  });
}

// ─── Hilfsfunktionen ─────────────────────────────────────────────────────────

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

  if (apiKey) {
    // ── REST API (Uptime Kuma v2+) ──────────────────────────────────────────
    let restDiag = '';
    try {
      return res.json(await fetchViaRest(url, apiKey));
    } catch (restErr) {
      // Diagnosemeldung für den Fallback-Fehler sammeln (HTTP-Status + Meldung)
      const status = restErr?.response?.status;
      const msg    = restErr?.response?.data?.message ?? restErr?.message ?? 'unbekannt';
      if (status === 401) {
        restDiag = 'REST HTTP 401 (API-Key abgelehnt)';
      } else if (status === 404) {
        restDiag = 'REST HTTP 404 (Endpunkt nicht gefunden)';
      } else if (status) {
        restDiag = `REST HTTP ${status}: ${msg}`;
      } else {
        restDiag = `REST-Fehler: ${msg}`;
      }
    }

    // ── Socket.IO Fallback (Uptime Kuma v1.x / v2.x) ───────────────────────
    try {
      return res.json(await fetchViaSocket(url, apiKey));
    } catch (sockErr) {
      return res.status(502).json({
        error: `${sockErr.message} · ${restDiag}`,
      });
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
