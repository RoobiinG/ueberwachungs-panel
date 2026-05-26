/**
 * Hilfsfunktion: Stats von einem Remote-Agent abrufen (für Alert-Evaluator)
 * Gibt { cpu, memory, disk } in Prozent zurück, oder null bei Fehler.
 */
const axios = require('axios');
const https = require('https');
const db    = require('../db');

async function fetchAgentStats(agentId) {
  const agent = db.prepare('SELECT * FROM remote_agents WHERE id = ?').get(agentId);
  if (!agent) return null;

  const cfg = {
    baseURL: agent.url.replace(/\/$/, ''),
    timeout: 6000,
    headers: agent.token ? { 'x-agent-token': agent.token } : {},
  };

  if (agent.url.startsWith('https://')) {
    cfg.httpsAgent = new https.Agent({
      rejectUnauthorized: false,
      checkServerIdentity: agent.fingerprint
        ? (hostname, cert) => {
            const got      = (cert.fingerprint256 || '').replace(/:/g, '').toLowerCase();
            const expected = agent.fingerprint.replace(/:/g, '').toLowerCase();
            if (got !== expected) return new Error('TLS-Fingerprint Mismatch');
          }
        : () => undefined,
    });
  }

  try {
    const { data } = await axios.create(cfg).get('/stats');
    return {
      cpu:    data.cpu?.usage            ?? null,
      memory: data.memory?.usedPercent   ?? null,
      disk:   data.disk?.[0]?.usedPercent ?? null,
    };
  } catch {
    return null;
  }
}

module.exports = { fetchAgentStats };
