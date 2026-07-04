const router      = require('express').Router();
const axios       = require('axios');
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

// ─── PatchMon Scoped-Integration-API ─────────────────────────────────────────
// Base-Path: <url>/api/v1/api  ·  Auth: HTTP Basic (token_key:token_secret)
// Hosts:     GET /api/v1/api/hosts?include=stats

// Erste vorhandene Zahl aus einer Liste möglicher Feldnamen ziehen.
// PatchMon-Feldnamen variieren je Version → defensiv mehrere Kandidaten prüfen.
function pickNum(obj, ...keys) {
  if (!obj || typeof obj !== 'object') return 0;
  for (const k of keys) {
    const v = obj[k];
    if (v == null) continue;
    const n = typeof v === 'number' ? v : parseInt(v, 10);
    if (!isNaN(n)) return n;
  }
  return 0;
}

function pickStr(obj, ...keys) {
  if (!obj || typeof obj !== 'object') return null;
  for (const k of keys) {
    const v = obj[k];
    if (v != null && v !== '') return String(v);
  }
  return null;
}

function mapHost(h) {
  // Stats können verschachtelt (h.stats) oder flach am Host hängen.
  const stats = (h.stats && typeof h.stats === 'object') ? h.stats : h;

  const updatesCount = pickNum(
    stats,
    'updates_count', 'updatesCount', 'outdated_packages', 'outdatedPackages',
    'packages_count', 'packagesCount', 'total_updates', 'updates_available_count',
  );
  const securityCount = pickNum(
    stats,
    'security_count', 'securityCount', 'security_updates', 'securityUpdates',
    'security_updates_count',
  );

  const os = pickStr(h, 'os', 'os_type', 'osType', 'operating_system', 'distro', 'platform');
  const osVersion = pickStr(h, 'os_version', 'osVersion', 'os_release', 'version');

  return {
    id:        h.id ?? h.uuid ?? h.host_id ?? h.machine_id ?? h.hostname,
    hostname:  pickStr(h, 'hostname', 'friendly_name', 'friendlyName', 'name', 'host') || 'unbekannt',
    os:        [os, osVersion].filter(Boolean).join(' ') || null,
    updatesCount,
    securityCount,
    updatesAvailable: updatesCount > 0,
    lastCheckIn: pickStr(h, 'last_check_in', 'lastCheckIn', 'last_report', 'lastReport',
                            'last_seen', 'lastSeen', 'updated_at', 'last_update'),
    hostGroup: pickStr(h, 'host_group', 'hostGroup', 'group', 'group_name', 'hostgroup'),
    agentStatus: pickStr(h, 'agent_status', 'agentStatus', 'status', 'connection_status'),
  };
}

async function fetchHosts(url, tokenKey, tokenSecret) {
  const cacheKey = `${url}|${tokenKey}`;
  const cached   = CACHE.get(cacheKey);
  if (cached && Date.now() - cached.ts < TTL) return cached.data;

  const base  = url.replace(/\/+$/, '');
  const creds = Buffer.from(`${tokenKey}:${tokenSecret}`).toString('base64');

  const { data } = await axios.get(`${base}/api/v1/api/hosts?include=stats`, {
    headers: { Authorization: `Basic ${creds}`, Accept: 'application/json' },
    timeout: 10000,
  });

  // PatchMon könnte gültiges JSON mit falschem Content-Type (text/plain) senden →
  // axios lässt es dann als String. Erst parsen versuchen, bevor wir aufgeben.
  let payload = data;
  if (typeof payload === 'string') {
    const trimmed = payload.trim();
    if (trimmed && (trimmed[0] === '{' || trimmed[0] === '[')) {
      try { payload = JSON.parse(trimmed); } catch { /* unten als Fehler behandelt */ }
    }
  }

  // Immer noch String → Text/HTML statt JSON: aussagekräftige Diagnose mit Antwort-Anfang.
  if (typeof payload === 'string') {
    const snippet   = payload.replace(/\s+/g, ' ').trim().slice(0, 200);
    const looksHtml = /^\s*<(?:!doctype|html)/i.test(payload);
    const e = new Error(
      looksHtml
        ? `PatchMon lieferte HTML statt JSON (HTTP 200) — vermutlich zeigt die URL aufs Web-UI statt auf die API, oder der Pfad /api/v1/api/hosts stimmt für diese Version nicht. Antwort-Anfang: ${snippet}`
        : `PatchMon-Antwort ist Text statt JSON (HTTP 200): ${snippet || '(leer)'}`
    );
    e.isDataError = true;
    throw e;
  }

  const data2 = payload;

  // Antwort kann sein: Array direkt · { hosts: [...] } · { data: [...] } · { results: [...] }
  let arr;
  if (Array.isArray(data2))                    arr = data2;
  else if (Array.isArray(data2?.hosts))        arr = data2.hosts;
  else if (Array.isArray(data2?.data))         arr = data2.data;
  else if (Array.isArray(data2?.results))      arr = data2.results;
  else if (Array.isArray(data2?.items))        arr = data2.items;
  else {
    const keys = data2 && typeof data2 === 'object' ? Object.keys(data2).slice(0, 8).join(', ') : typeof data2;
    const e = new Error(`Unerwartetes JSON-Antwortformat — vorhandene Felder: ${keys || '(leer)'}`);
    e.isDataError = true;
    throw e;
  }

  const hosts = arr.map(mapHost);

  // Sortierung: Hosts mit Updates zuerst, dann alphabetisch nach Hostname.
  hosts.sort((a, b) =>
    (b.updatesCount > 0 ? 1 : 0) - (a.updatesCount > 0 ? 1 : 0) ||
    b.updatesCount - a.updatesCount ||
    a.hostname.localeCompare(b.hostname, 'de')
  );

  const result = { hosts };
  CACHE.set(cacheKey, { data: result, ts: Date.now() });
  return result;
}

// ─── Routes ──────────────────────────────────────────────────────────────────

// GET /api/patchmon/config
router.get('/config', (req, res) => {
  res.json({
    url:      getSetting('patchmonUrl') || '',
    hasToken: !!(getSetting('patchmonTokenKey') && getSetting('patchmonTokenSecret')),
  });
});

// POST /api/patchmon/config  (nur Admins dürfen die Verbindung ändern)
router.post('/config', requireRole('admin'), (req, res) => {
  const { url, tokenKey, tokenSecret } = req.body;
  if (url !== undefined) {
    try { validatePublicUrl(url); } catch (e) { return res.status(400).json({ error: e.message }); }
    setSetting('patchmonUrl', url.trim());
  }
  if (tokenKey    !== undefined && tokenKey    !== '') setSetting('patchmonTokenKey',    tokenKey.trim());
  if (tokenSecret !== undefined && tokenSecret !== '') setSetting('patchmonTokenSecret', tokenSecret.trim());
  CACHE.clear();
  res.json({ ok: true });
});

// GET /api/patchmon/hosts
router.get('/hosts', async (req, res) => {
  const url         = getSetting('patchmonUrl');
  const tokenKey    = getSetting('patchmonTokenKey');
  const tokenSecret = getSetting('patchmonTokenSecret');

  if (!url)                       return res.status(400).json({ error: 'PatchMon-URL nicht konfiguriert.' });
  if (!tokenKey || !tokenSecret)  return res.status(400).json({ error: 'PatchMon-API-Token nicht konfiguriert.' });

  try {
    return res.json(await fetchHosts(url, tokenKey, tokenSecret));
  } catch (err) {
    const status = err?.response?.status;
    const msg =
      err.isDataError
        ? err.message
        : status === 401 || status === 403
        ? 'API-Token abgelehnt (401/403) — Token-Key/Secret und Scope `host:get` in PatchMon prüfen.'
        : status === 404
        ? 'Endpunkt nicht gefunden (404) — URL und PatchMon-Version (v2 erforderlich) prüfen.'
        : status
        ? `PatchMon HTTP ${status}: ${err.response?.data?.error || err.message}`
        : `Verbindung fehlgeschlagen: ${err.message}`;
    return res.status(502).json({ error: msg });
  }
});

module.exports = router;
