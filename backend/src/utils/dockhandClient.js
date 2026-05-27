// ─── Dockhand.pro API-Client ─────────────────────────────────────────────────
// Authentifizierung via Bearer-Token (Settings: dockhandUrl, dockhandApiToken)
// Normalisierung: Dockhand-Container-Objekt → einheitliches Panel-Format

const axios = require('axios');
const db    = require('../db');

const getSetting = k =>
  db.prepare('SELECT value FROM settings WHERE key = ?').get(k)?.value ?? null;

// ─── Axios-Instance on-demand ─────────────────────────────────────────────────

function client() {
  const token = getSetting('dockhandApiToken');
  const base  = (getSetting('dockhandUrl') || '').replace(/\/$/, '');
  if (!base)  throw new Error('Dockhand URL nicht konfiguriert (Einstellungen → Dockhand)');
  if (!token) throw new Error('Dockhand API-Token nicht konfiguriert (Einstellungen → Dockhand)');
  return axios.create({
    baseURL: base,
    headers: { Authorization: `Bearer ${token}` },
    timeout: 12000,
  });
}

// ─── Zentraler Aufruf mit sprechenden Fehlermeldungen ────────────────────────

async function call(method, path, opts = {}) {
  let inst;
  try { inst = client(); } catch (e) { throw e; }
  try {
    return await inst({ method, url: path, ...opts });
  } catch (err) {
    const status = err.response?.status;
    const msg    = err.response?.data?.message
                ?? err.response?.data?.error
                ?? err.message;
    if (status === 401) throw new Error('Dockhand: API-Token ungültig oder abgelaufen');
    if (status === 403) throw new Error('Dockhand: API-Token hat keine Berechtigung für diese Aktion');
    if (status === 404) throw new Error(`Dockhand: Ressource nicht gefunden (${path})`);
    throw new Error(status ? `Dockhand HTTP ${status}: ${msg}` : `Dockhand: ${msg}`);
  }
}

// ─── Normalisierung: Dockhand → einheitliches Panel-Format ───────────────────
// Alle Server (lokal + remote via Hawser) liefern jetzt dieses Format:
// { id, name, image, state, status, cpu, memUsed, memLimit, memPercent, netRx, netTx, stack, ports, created }

function normalizeContainer(c) {
  // Ports: Dockhand liefert entweder Array von Strings oder Objekten
  let ports = [];
  if (Array.isArray(c.ports)) {
    ports = c.ports.map(p =>
      typeof p === 'string' ? p : `${p.hostPort ?? p.privatePort}:${p.privatePort ?? ''}/${p.type ?? 'tcp'}`
    );
  }

  return {
    id:         c.id,
    name:       (c.name || '').replace(/^\//, ''),
    image:      c.image,
    state:      (c.state  || '').toLowerCase(),
    status:     c.status  || (c.state || '').toLowerCase(),
    cpu:        c.cpuPercent  ?? c.cpu        ?? null,
    memUsed:    c.memUsage    ?? c.memUsed    ?? null,
    memLimit:   c.memLimit                    ?? null,
    memPercent: c.memPercent                  ?? null,
    netRx:      c.netRx                       ?? null,
    netTx:      c.netTx                       ?? null,
    stack:      c.stack ?? c.labels?.['com.docker.compose.project'] ?? null,
    ports,
    created:    c.created ?? null,
  };
}

// ─── API-Methoden ─────────────────────────────────────────────────────────────

module.exports = {
  call,
  normalizeContainer,

  getEnvironments:   ()             => call('GET', '/api/environments'),
  getContainers:     (envId)        => call('GET', `/api/containers?env=${envId}`),
  getContainer:      (envId, id)    => call('GET', `/api/containers/${id}?env=${envId}`),
  getContainerStats: (envId, id)    => call('GET', `/api/containers/${id}/stats?env=${envId}`),
  getContainerLogs:  (envId, id, n) => call('GET', `/api/containers/${id}/logs?env=${envId}&tail=${n || 100}`),
  containerAction:   (envId, id, a) => call('POST', `/api/containers/${id}/${a}?env=${envId}`),
  getImages:         (envId)        => call('GET', `/api/images?env=${envId}`),
  getDashboardStats: ()             => call('GET', '/api/dashboard/stats'),
  getActivity:       (envId)        => call('GET', `/api/activity${envId ? `?environmentId=${envId}` : ''}`),
};
