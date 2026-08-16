const axios = require('axios');
const https = require('https');

// Agent-Zertifikate sind in aller Regel selbstsigniert. Statt die Prüfung ganz
// abzuschalten, pinnen wir den beim Anlegen des Agenten gespeicherten Fingerprint.
// Liegt keiner vor, gilt Trust-on-first-use — dasselbe Verhalten wie bisher.
//
// Zentral hier, damit alle Pfade dieselbe Prüfung verwenden: die HTTP-Aufrufe in
// routes/agents.js, der Alert-Evaluator und der Terminal-WebSocket-Proxy.
function checkServerIdentityFor(agent) {
  if (!agent?.fingerprint) return () => undefined;

  const expected = agent.fingerprint.replace(/:/g, '').toLowerCase();
  return (hostname, cert) => {
    const got = (cert?.fingerprint256 || '').replace(/:/g, '').toLowerCase();
    if (got !== expected) {
      return new Error(
        `TLS-Fingerprint stimmt nicht überein!\nErwartet: ${expected}\nErhalten:  ${got}`
      );
    }
  };
}

// Axios-Instanz für einen Agenten, inklusive Token-Header und Fingerprint-Pinning.
function agentClient(agent, timeout = 8000) {
  const cfg = {
    baseURL: agent.url.replace(/\/$/, ''),
    timeout,
    headers: agent.token ? { 'x-agent-token': agent.token } : {},
  };

  if (agent.url.startsWith('https://')) {
    cfg.httpsAgent = new https.Agent({
      rejectUnauthorized: false,   // selbstsigniert — wir pinnen manuell
      checkServerIdentity: checkServerIdentityFor(agent),
    });
  }

  return axios.create(cfg);
}

module.exports = { checkServerIdentityFor, agentClient };
