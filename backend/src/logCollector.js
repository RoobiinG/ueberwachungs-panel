const db = require('./db');
const { agentClient } = require('./utils/agentTls');

const insert = db.prepare(`
  INSERT INTO syslogs (agent_id, timestamp, source, level, message)
  VALUES (?, ?, ?, ?, ?)
`);

// 7 Tage Vorhaltezeit
const cleanup = db.prepare(`DELETE FROM syslogs WHERE timestamp < datetime('now', '-7 days')`);

const state = {}; // { agentId: last_timestamp_sec }

async function collectAgentLogs(agent) {
  try {
    // Hole logs seit dem letzten Durchlauf (oder der letzten Stunde bei erstem Start)
    const since = state[agent.id] || Math.floor(Date.now() / 1000) - 3600;
    
    // API Call (wir geben dem Agent 10s Zeit, da Journalctl etwas dauern kann)
    const api = agentClient(agent, 10000);
    const res = await api.get(`/logs?since=${since}`);
    const logs = Array.isArray(res.data) ? res.data : [];

    if (logs.length > 0) {
      let maxTs = 0;
      
      const tx = db.transaction((logEntries) => {
        for (const l of logEntries) {
          const logTs = parseInt(l.timestamp);
          if (logTs > maxTs) maxTs = logTs;

          insert.run(
            agent.id,
            new Date(logTs * 1000).toISOString().replace('T', ' ').replace('Z', ''),
            l.source || 'syslog',
            l.level || 'info',
            l.message || ''
          );
        }
      });
      tx(logs);

      if (maxTs > since) {
        state[agent.id] = maxTs;
      }
    } else {
      state[agent.id] = Math.floor(Date.now() / 1000);
    }
  } catch (err) {
    // Timeout oder Verbindungsfehler, beim nächsten Mal wieder versuchen
  }
}

async function collectAll() {
  const agents = db.prepare('SELECT * FROM remote_agents').all();
  await Promise.allSettled(agents.map(collectAgentLogs));
}

function start() {
  cleanup.run();
  setInterval(collectAll, 60_000);
  setInterval(() => cleanup.run(), 24 * 60 * 60 * 1000);
  setTimeout(collectAll, 5000);
  console.log('Log-Collector gestartet (alle 60 Sek, 7 Tage Aufbewahrung)');
}

module.exports = { start };
