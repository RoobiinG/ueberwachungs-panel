// ─── Update-Check Service (Panel & Agent) ────────────────────────────────────
// Prüft über die GitHub API ob neue Versionen im (privaten) Repository vorliegen.
// Nutzt den in den Einstellungen hinterlegten 'github_token'.

const axios = require('axios');
const fs = require('fs');
const path = require('path');
const db = require('../db');

const REPO_OWNER = 'RoobiinG';
const REPO_NAME  = 'ueberwachungs-panel';

let cache = {
  lastChecked: null,
  panel: { available: false, currentVersion: null, currentBuild: null, remoteVersion: null, remoteBuild: null, date: null, error: null },
  agent: { available: false, remoteVersion: null, outdatedAgents: [], error: null },
};

let checkInProgress = false;

const getSetting = (key) =>
  db.prepare('SELECT value FROM settings WHERE key = ?').get(key)?.value || '';

function getGitHubHeaders() {
  const token = getSetting('github_token');
  const headers = {
    Accept: 'application/vnd.github.v3.raw',
    'User-Agent': 'Ueberwachungs-Panel-UpdateChecker',
  };
  if (token) {
    headers.Authorization = `token ${token}`;
  }
  return headers;
}

// Lokale version.json lesen
function getLocalVersion() {
  const versionPath = path.join(__dirname, '../../../version.json');
  try {
    const content = fs.readFileSync(versionPath, 'utf8');
    return JSON.parse(content);
  } catch {
    return { version: '0.0.0', build: 0 };
  }
}

// Semver leichtgewichtig vergleichen (a > b -> 1, a == b -> 0, a < b -> -1)
function compareSemver(a, b) {
  if (!a || !b) return 0;
  const pa = String(a).split('.').map(n => parseInt(n, 10) || 0);
  const pb = String(b).split('.').map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const va = pa[i] || 0;
    const vb = pb[i] || 0;
    if (va > vb) return 1;
    if (va < vb) return -1;
  }
  return 0;
}

async function checkUpdates(force = false) {
  // Wenn vor weniger als 5 Minuten geprüft, Cache zurückgeben (außer bei force)
  if (!force && cache.lastChecked && Date.now() - cache.lastChecked < 5 * 60 * 1000) {
    return cache;
  }
  if (checkInProgress) return cache;
  checkInProgress = true;

  try {
    const headers = getGitHubHeaders();
    const local = getLocalVersion();

    // 1. Panel-Version (version.json) prüfen
    let panelResult = {
      available: false,
      currentVersion: local.version,
      currentBuild: local.build,
      remoteVersion: null,
      remoteBuild: null,
      date: null,
      error: null,
    };
    try {
      const url = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/version.json`;
      const res = await axios.get(url, { headers, timeout: 10000 });
      const remote = typeof res.data === 'string' ? JSON.parse(res.data) : res.data;

      panelResult.remoteVersion = remote.version;
      panelResult.remoteBuild = Number(remote.build || 0);
      panelResult.date = remote.date || null;

      const buildHigher = Number(remote.build || 0) > Number(local.build || 0);
      const semverHigher = compareSemver(remote.version, local.version) > 0;
      panelResult.available = buildHigher || semverHigher;
    } catch (err) {
      panelResult.error = err.response?.status === 404 || err.response?.status === 401
        ? 'Kein Zugriff auf privates Repo – bitte GitHub Token hinterlegen'
        : err.message;
    }

    // 2. Agent-Version (agent/panel-agent.js) prüfen
    let agentResult = {
      available: false,
      remoteVersion: null,
      outdatedAgents: [],
      error: null,
    };
    try {
      const url = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/agent/panel-agent.js`;
      const res = await axios.get(url, { headers, timeout: 10000 });
      const content = typeof res.data === 'string' ? res.data : String(res.data);
      const match = content.match(/const\s+VERSION\s*=\s*['"]([^'"]+)['"]/);
      const remoteAgentVersion = match ? match[1] : null;

      agentResult.remoteVersion = remoteAgentVersion;

      if (remoteAgentVersion) {
        const agents = db.prepare('SELECT id, name, version FROM remote_agents').all() || [];
        const outdated = [];
        for (const a of agents) {
          if (a.version && compareSemver(remoteAgentVersion, a.version) > 0) {
            outdated.push({ id: a.id, name: a.name, currentVersion: a.version });
          }
        }
        agentResult.outdatedAgents = outdated;
        agentResult.available = outdated.length > 0;
      }
    } catch (err) {
      agentResult.error = err.response?.status === 404 || err.response?.status === 401
        ? 'Kein Zugriff auf privates Repo – bitte GitHub Token hinterlegen'
        : err.message;
    }

    cache = {
      lastChecked: Date.now(),
      panel: panelResult,
      agent: agentResult,
    };
  } catch (err) {
    console.error('[UpdateCheck] Fehler beim Prüfen auf Updates:', err.message);
  } finally {
    checkInProgress = false;
  }

  return cache;
}

// Periodischer Check alle 30 Minuten
let intervalId = null;
function startPeriodicCheck() {
  if (intervalId) clearInterval(intervalId);
  // Initial nach 10s prüfen
  setTimeout(() => checkUpdates(true), 10000);
  intervalId = setInterval(() => checkUpdates(true), 30 * 60 * 1000);
}

module.exports = {
  checkUpdates,
  startPeriodicCheck,
  getCache: () => cache,
  compareSemver,   // auch vom automatischen Agent-Update genutzt
};
