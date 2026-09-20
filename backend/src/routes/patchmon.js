const router      = require('express').Router();
const axios       = require('axios');
const db          = require('../db');
const { requirePermission } = require('../middleware/requirePermission');
const { validatePublicUrl } = require('../utils/validateUrl');
const { canAccessAgent } = require('../utils/agentAccess');

// ─── Helpers ────────────────────────────────────────────────────────────────

const getSetting = (key) =>
  db.prepare('SELECT value FROM settings WHERE key = ?').get(key)?.value ?? null;

const setSetting = (key, val) =>
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, val);

// ─── Cache (30 s) ────────────────────────────────────────────────────────────

const CACHE = new Map();
const TTL   = 30_000;

// HTTP-Basic-Auth-Header für die PatchMon-Scoped-API (token_key:token_secret).
const authHeaders = (tokenKey, tokenSecret) => ({
  Authorization: `Basic ${Buffer.from(`${tokenKey}:${tokenSecret}`).toString('base64')}`,
  Accept: 'application/json',
});

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

// Konkrete Fehlermeldung aus einer PatchMon-Antwort ziehen (JSON-Feld oder Text-Snippet).
function extractServerMsg(body) {
  if (!body) return null;
  if (typeof body === 'string') {
    const s = body.replace(/\s+/g, ' ').trim();
    if (!s || /^<(?:!doctype|html)/i.test(s)) return null;   // HTML → keine sinnvolle Meldung
    return s.slice(0, 200);
  }
  if (typeof body === 'object') {
    const m = body.error || body.message || body.detail || body.msg || body.error_description;
    if (m) return String(m).slice(0, 200);
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

  const totalPackages = pickNum(stats, 'total_packages', 'totalPackages', 'packages_total', 'installed_packages');

  const os = pickStr(h, 'os', 'os_type', 'osType', 'operating_system', 'distro', 'platform');
  const osVersion = pickStr(h, 'os_version', 'osVersion', 'os_release', 'version');

  // Host-Gruppen: PatchMon v2 liefert host_groups als Array (von Objekten oder Strings).
  let hostGroup = pickStr(h, 'host_group', 'hostGroup', 'group', 'group_name', 'hostgroup');
  const groups = h.host_groups ?? h.hostGroups ?? h.groups;
  if (!hostGroup && Array.isArray(groups) && groups.length) {
    hostGroup = groups
      .map(g => (typeof g === 'string' ? g : g?.name ?? g?.friendly_name ?? g?.label))
      .filter(Boolean)
      .join(', ') || null;
  }

  const hostname     = pickStr(h, 'hostname', 'host', 'machine_name') || null;
  const friendlyName = pickStr(h, 'friendly_name', 'friendlyName', 'name') || null;

  return {
    id:        h.id ?? h.uuid ?? h.host_id ?? h.machine_id ?? hostname ?? friendlyName,
    // Anzeigename: sprechender friendly_name bevorzugt, sonst der technische Hostname.
    name:      friendlyName || hostname || 'unbekannt',
    hostname,
    ip:        pickStr(h, 'ip', 'ip_address', 'ipAddress', 'address'),
    os:        [os, osVersion].filter(Boolean).join(' ') || null,
    updatesCount,
    securityCount,
    totalPackages,
    updatesAvailable: updatesCount > 0,
    needsReboot: h.needs_reboot ?? h.needsReboot ?? false,
    lastCheckIn: pickStr(h, 'last_check_in', 'lastCheckIn', 'last_report', 'lastReport',
                            'last_seen', 'lastSeen', 'last_update', 'updated_at'),
    hostGroup,
    agentStatus: pickStr(h, 'agent_status', 'agentStatus', 'status', 'connection_status'),
  };
}

async function fetchHosts(url, tokenKey, tokenSecret) {
  const cacheKey = `${url}|${tokenKey}`;
  const cached   = CACHE.get(cacheKey);
  if (cached && Date.now() - cached.ts < TTL) return cached.data;

  const base  = url.replace(/\/+$/, '');

  const { data } = await axios.get(`${base}/api/v1/api/hosts?include=stats`, {
    headers: authHeaders(tokenKey, tokenSecret),
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

  // Sortierung: Hosts mit Updates zuerst, dann alphabetisch nach Anzeigename.
  hosts.sort((a, b) =>
    (b.updatesCount > 0 ? 1 : 0) - (a.updatesCount > 0 ? 1 : 0) ||
    b.updatesCount - a.updatesCount ||
    (a.name || '').localeCompare(b.name || '', 'de')
  );

  const result = { hosts };
  CACHE.set(cacheKey, { data: result, ts: Date.now() });
  return result;
}

// ─── Host-System (nur nicht-duplizierende Kernel-Infos) ──────────────────────
// Panel-Agent liefert CPU/RAM/Disk/Uptime bereits → hier NUR Kernel + Reboot-Grund.

function mapSystem(s) {
  const sys = (s && typeof s === 'object' && s.system && typeof s.system === 'object') ? s.system : s;
  if (!sys || typeof sys !== 'object') return null;
  return {
    kernelRunning:   pickStr(sys, 'kernel_version', 'kernelVersion', 'kernel', 'running_kernel'),
    kernelInstalled: pickStr(sys, 'installed_kernel_version', 'installedKernelVersion', 'latest_kernel', 'kernel_installed'),
    rebootReason:    pickStr(sys, 'reboot_reason', 'rebootReason', 'reboot_required_reason'),
    needsReboot:     sys.needs_reboot ?? sys.needsReboot ?? false,
  };
}

async function fetchHostSystem(url, tokenKey, tokenSecret, id) {
  const cacheKey = `sys|${url}|${tokenKey}|${id}`;
  const cached   = CACHE.get(cacheKey);
  if (cached && Date.now() - cached.ts < TTL) return cached.data;

  const base = url.replace(/\/+$/, '');
  const { data } = await axios.get(`${base}/api/v1/api/hosts/${encodeURIComponent(id)}/system`, {
    headers: authHeaders(tokenKey, tokenSecret),
    timeout: 10000,
  });

  const system = mapSystem(data);
  CACHE.set(cacheKey, { data: system, ts: Date.now() });
  return system;
}

// ─── Verknüpfte Panel-Agenten ────────────────────────────────────────────────
// Ein PatchMon-Host kann über `remote_agents.patchmon_host_id` einem Panel-Agenten
// zugeordnet sein. Nur dann lässt sich das Update von hier aus auch ausführen
// (POST /api/agents/:id/packages/update). Die Rollen-Beschränkung auf einzelne
// Server gilt dabei genauso wie auf der Server-Seite: Wer den Agenten nicht sehen
// darf, bekommt hier auch keine Agent-ID und damit keinen Update-Button.
function mitAgenten(hosts, roleName) {
  const rows = db.prepare(
    "SELECT id, name, patchmon_host_id FROM remote_agents WHERE patchmon_host_id IS NOT NULL AND TRIM(patchmon_host_id) != ''"
  ).all();
  const nachHostId = new Map(rows.map(r => [String(r.patchmon_host_id), r]));

  // Der Host, auf dem das Panel selbst läuft. Ein Update dort kann Docker oder den
  // Server neu starten und damit die eigene Verbindung kappen — das Update läuft
  // trotzdem zu Ende, die Oberfläche muss es nur richtig erklären.
  const lokalerHost = getSetting('patchmonLocalHostId');

  return hosts.map(h => {
    const a = nachHostId.get(String(h.id));
    const erlaubt = a && canAccessAgent(a.id, roleName);
    return {
      ...h,
      agentId:      erlaubt ? a.id : null,
      agentName:    erlaubt ? a.name : null,
      istPanelHost: !!lokalerHost && String(h.id) === String(lokalerHost),
    };
  });
}

// ─── Routes ──────────────────────────────────────────────────────────────────

// GET /api/patchmon/config
router.get('/config', requirePermission('patchmon.view'), (req, res) => {
  res.json({
    url:      getSetting('patchmonUrl') || '',
    hasToken: !!(getSetting('patchmonTokenKey') && getSetting('patchmonTokenSecret')),
  });
});

// POST /api/patchmon/config  (Verbindung ändern erfordert Verwaltungsrecht)
router.post('/config', requirePermission('patchmon.manage'), (req, res) => {
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
router.get('/hosts', requirePermission('patchmon.view'), async (req, res) => {
  const url         = getSetting('patchmonUrl');
  const tokenKey    = getSetting('patchmonTokenKey');
  const tokenSecret = getSetting('patchmonTokenSecret');

  if (!url)                       return res.status(400).json({ error: 'PatchMon-URL nicht konfiguriert.' });
  if (!tokenKey || !tokenSecret)  return res.status(400).json({ error: 'PatchMon-API-Token nicht konfiguriert.' });

  try {
    const { hosts } = await fetchHosts(url, tokenKey, tokenSecret);
    return res.json({ hosts: mitAgenten(hosts, req.user?.role) });
  } catch (err) {
    const status = err?.response?.status;
    const serverMsg = extractServerMsg(err?.response?.data);   // konkrete PatchMon-Meldung, falls vorhanden
    const suffix    = serverMsg ? ` — PatchMon meldet: „${serverMsg}"` : '';
    const msg =
      err.isDataError
        ? err.message
        : status === 401 || status === 403
        ? `API-Token abgelehnt (${status}) — Token-Key/Secret und Scope \`host:get\` in PatchMon prüfen${suffix}`
        : status === 404
        ? `Endpunkt nicht gefunden (404) — URL und PatchMon-Version (v2 erforderlich) prüfen${suffix}`
        : status
        ? `PatchMon HTTP ${status}${suffix || ': ' + err.message}`
        : `Verbindung fehlgeschlagen: ${err.message}`;
    return res.status(502).json({ error: msg });
  }
});

// GET /api/patchmon/hosts/:id/system — nur Kernel/Reboot-Grund (fail-soft)
router.get('/hosts/:id/system', requirePermission('patchmon.view'), async (req, res) => {
  const url         = getSetting('patchmonUrl');
  const tokenKey    = getSetting('patchmonTokenKey');
  const tokenSecret = getSetting('patchmonTokenSecret');

  if (!url || !tokenKey || !tokenSecret)
    return res.status(400).json({ error: 'PatchMon nicht konfiguriert.' });
  if (!req.params.id)
    return res.status(400).json({ error: 'Host-ID fehlt.' });

  try {
    return res.json({ system: await fetchHostSystem(url, tokenKey, tokenSecret, req.params.id) });
  } catch (err) {
    const status = err?.response?.status;
    const serverMsg = extractServerMsg(err?.response?.data);
    const msg = status
      ? `PatchMon HTTP ${status}${serverMsg ? ` — ${serverMsg}` : ''}`
      : `Verbindung fehlgeschlagen: ${err.message}`;
    return res.status(502).json({ error: msg });
  }
});

// ─── Verknüpfung des lokalen Panel-Servers mit einem PatchMon-Host ───────────
// (Agenten-Verknüpfung läuft über PUT /api/agents/:id; hier nur der lokale Server.)

// GET /api/patchmon/local-binding
router.get('/local-binding', requirePermission('patchmon.view'), (req, res) => {
  res.json({ hostId: getSetting('patchmonLocalHostId') || '' });
});

// POST /api/patchmon/local-binding
router.post('/local-binding', requirePermission('patchmon.manage'), (req, res) => {
  const { hostId } = req.body;
  setSetting('patchmonLocalHostId', hostId ? String(hostId) : '');
  res.json({ ok: true });
});

module.exports = router;
// fetchHosts für den Alert-Evaluator (PatchMon-Metriken) wiederverwendbar machen.
module.exports.fetchHosts = fetchHosts;
