const axios = require('axios');
const https = require('https');
const db    = require('./db');

const insert  = db.prepare(`
  INSERT OR REPLACE INTO metrics (ts, server_id, cpu, mem_used, mem_total, disk_used, disk_total, net_rx_sec, net_tx_sec)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
const cleanup = db.prepare('DELETE FROM metrics WHERE ts < ? AND server_id = ?');

const agentApi = (agent) => {
  const cfg = {
    baseURL: agent.url.replace(/\/$/, ''),
    timeout: 5000,
    headers: agent.token ? { 'x-agent-token': agent.token } : {},
  };
  if (agent.url.startsWith('https://')) {
    cfg.httpsAgent = new https.Agent({
      rejectUnauthorized: false,
      checkServerIdentity: agent.fingerprint
        ? (hostname, cert) => {
            const got      = (cert.fingerprint256 || '').replace(/:/g, '').toLowerCase();
            const expected = agent.fingerprint.replace(/:/g, '').toLowerCase();
            if (got !== expected) return new Error('TLS-Fingerprint stimmt nicht überein');
          }
        : () => undefined,
    });
  }
  return axios.create(cfg);
};

async function recordAgent(agent) {
  try {
    const api = agentApi(agent);
    const [statsRes, netRes] = await Promise.allSettled([
      api.get('/stats'),
      api.get('/network/stats'),
    ]);

    const data    = statsRes.status === 'fulfilled' ? statsRes.value.data : null;
    if (!data) return;

    const ts       = Math.floor(Date.now() / 1000);
    const serverId = `agent:${agent.id}`;

    const disk = Array.isArray(data.disk)
      ? (data.disk.find(d => d.mount === '/') || data.disk[0])
      : null;

    // Netzwerk-Durchsatz aus /network/stats summieren
    let rxSec = 0, txSec = 0;
    if (netRes.status === 'fulfilled' && Array.isArray(netRes.value.data)) {
      for (const n of netRes.value.data) {
        rxSec += n.rx_sec || 0;
        txSec += n.tx_sec || 0;
      }
    }

    insert.run(
      ts, serverId,
      data.cpu?.usage ?? 0,
      data.memory?.used ?? 0,
      data.memory?.total ?? 1,
      disk?.used ?? 0,
      disk?.size ?? 1,
      Math.round(rxSec),
      Math.round(txSec),
    );
  } catch {}
}

async function recordAll() {
  const agents = db.prepare('SELECT * FROM remote_agents').all();
  await Promise.allSettled(agents.map(recordAgent));
}

function start() {
  recordAll();
  setInterval(recordAll, 1_000);
  // Raw-Daten nur 6 Stunden — Langzeit via metricsAggregator
  const runCleanup = () => {
    const cutoff = Math.floor(Date.now() / 1000) - 6 * 3600;
    const agents  = db.prepare('SELECT id FROM remote_agents').all();
    for (const a of agents) cleanup.run(cutoff, `agent:${a.id}`);
  };
  runCleanup();
  setInterval(runCleanup, 3_600_000);
  console.log('Remote-Metrics-Recorder gestartet (alle 1 Sek, 6 Std. Aufbewahrung)');
}

module.exports = { start };
