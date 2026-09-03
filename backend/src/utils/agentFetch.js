/**
 * Hilfsfunktion: Stats von einem Remote-Agent abrufen (für Alert-Evaluator)
 * Gibt { cpu, memory, disk } in Prozent zurück, oder null bei Fehler.
 */
const db = require('../db');
const { agentClient } = require('./agentTls');

async function fetchAgentStats(agentId) {
  const agent = db.prepare('SELECT * FROM remote_agents WHERE id = ?').get(agentId);
  if (!agent) return null;

  try {
    const { data } = await agentClient(agent, 6000).get('/stats');
    // Netzwerk: Summe aller Interfaces in Bytes/s → MB/s
    const netArr = Array.isArray(data.network) ? data.network : [];
    const netRx  = netArr.reduce((s, n) => s + (n.rxSec ?? 0), 0) / (1024 * 1024);
    const netTx  = netArr.reduce((s, n) => s + (n.txSec ?? 0), 0) / (1024 * 1024);
    return {
      cpu:    data.cpu?.usage             ?? null,
      memory: data.memory?.usedPercent    ?? null,
      disk:   data.disk?.[0]?.usedPercent ?? null,
      net_rx: netRx,
      net_tx: netTx,
    };
  } catch {
    return null;
  }
}

async function fetchAgentPorts(agentId) {
  const agent = db.prepare('SELECT * FROM remote_agents WHERE id = ?').get(agentId);
  if (!agent) return null;
  try {
    const { data } = await agentClient(agent, 6000).get('/network/ports');
    return Array.isArray(data) ? data : null;
  } catch {
    return null;
  }
}

module.exports = { fetchAgentStats, fetchAgentPorts };
