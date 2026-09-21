// ─── Automatisches Agent-Update beim Panel-Start ─────────────────────────────
//
// Jedes Panel-Image bringt das passende Agent-Script mit (`agent/panel-agent.js`).
// Nach dem Start des Containers wird deshalb einmal geprüft, ob auf den Servern eine
// ältere Fassung läuft — und diese dann ausgerollt. Es ist derselbe Weg, den der Knopf
// „Agent aktualisieren" auf der Agenten-Seite geht: das Script wird mit dem Token des
// jeweiligen Agenten HMAC-signiert übertragen, die Verbindung ist per Fingerprint
// gepinnt. Neue Wege nach außen entstehen dadurch nicht.
//
// Abschaltbar über die Einstellung `agentAutoUpdate` = 'off'.

const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');
const db     = require('../db');
const { agentClient }   = require('./agentTls');
const { auditLog }      = require('./audit');
const { compareSemver } = require('./updateCheck');
const { makeStatusTracker } = require('./workerStatus');
const _status = makeStatusTracker();

const SCRIPT_PATH = path.resolve(__dirname, '../../../agent/panel-agent.js');

// Dem Panel und den Servern Zeit zum Hochkommen geben. Ein Agent, der nach einem
// Server-Neustart noch nicht lauscht, soll nicht als „nicht erreichbar" gelten.
const START_DELAY_MS = 45_000;

// Nach dem Ausrollen braucht der Agent ~1,5 s bis zum Neustart (systemctl restart).
const RESTART_GRACE_MS = 6_000;

const getSetting = (k) => db.prepare('SELECT value FROM settings WHERE key = ?').get(k)?.value ?? null;

// Der Vorgang hat keinen Benutzer — auditLog braucht trotzdem ein Request-artiges Objekt.
const sysReq = { headers: {}, socket: {}, user: { id: null, username: 'System' } };

function panelLog(level, message) {
  try {
    db.prepare('INSERT INTO panel_logs (level, source, message, stack, url) VALUES (?, ?, ?, ?, ?)')
      .run(level, 'Agent-AutoUpdate', String(message).slice(0, 2000), null, null);
  } catch { /* Logging darf den Vorgang nie stoppen */ }
}

function readLocalScript() {
  try {
    const content = fs.readFileSync(SCRIPT_PATH, 'utf8');
    const version = content.match(/^const VERSION\s*=\s*['"]([^'"]+)['"]/m)?.[1] || null;
    return { content, version };
  } catch {
    return { content: null, version: null };
  }
}

// Rollt das Script auf einen Agenten aus und prüft danach, ob er wieder antwortet.
async function updateAgent(agent, script, targetVersion) {
  const api = agentClient(agent, 8000);

  const { data } = await api.get('/version');
  const current = data?.version || null;
  if (current && compareSemver(targetVersion, current) <= 0) {
    return { skipped: true, current };
  }

  const hmac = crypto.createHmac('sha256', agent.token).update(script).digest('hex');
  await api.post('/update', { script, hmac }, { timeout: 30000 });

  // Der Agent schreibt sich selbst neu und startet neu — kurz warten, dann nachsehen,
  // ob er überhaupt wieder antwortet.
  await new Promise(r => setTimeout(r, RESTART_GRACE_MS));
  let alive = false;
  try {
    const ping = await agentClient(agent, 8000).get('/version');
    alive = !!ping.data?.version;
  } catch { alive = false; }

  try {
    db.prepare('UPDATE remote_agents SET version = ? WHERE id = ?').run(targetVersion, agent.id);
  } catch { /* Spalte ist nur Anzeige */ }

  auditLog(sysReq, 'agent.update.auto', 'agent', agent.name, { from: current, to: targetVersion, alive });
  return { updated: true, from: current, to: targetVersion, alive };
}

// Fehlen dem Agenten `ws`/`node-pty`, gibt es dort keine Container-Konsole. Das Ausrollen
// des Scripts allein ändert daran nichts — die Module müssen auf dem Server selbst
// installiert werden. Der Agent erledigt das auf Zuruf; hier wird es angestoßen und das
// Ergebnis abgewartet, damit es nachvollziehbar im Panel-Log steht.
async function terminalNachruestenFalls(agent) {
  let ping;
  try { ping = (await agentClient(agent, 8000).get('/ping')).data; }
  catch { return null; }

  if (ping?.terminal !== false) return null;          // bereits vorhanden oder Agent zu alt
  if (ping.terminalSetup === 'laeuft') return null;   // läuft schon

  try {
    await agentClient(agent, 15000).post('/terminal/setup', {});
  } catch (err) {
    return { agent: agent.name, ok: false, grund: err.response?.data?.error || err.message };
  }
  panelLog('info', `Terminal-Module werden auf "${agent.name}" nachgerüstet (ws, node-pty) — das kann einige Minuten dauern.`);

  // Höchstens 8 Minuten begleiten. Der Agent startet nach Erfolg selbst neu, deshalb sind
  // zwischenzeitliche Verbindungsfehler normal und kein Abbruchgrund.
  const ende = Date.now() + 8 * 60_000;
  while (Date.now() < ende) {
    await new Promise(r => setTimeout(r, 20_000));
    try {
      const p = (await agentClient(agent, 8000).get('/ping')).data;
      if (p?.terminal === true) return { agent: agent.name, ok: true };
      if (p?.terminalSetup === 'fehlgeschlagen') return { agent: agent.name, ok: false, grund: p.terminalMeldung };
    } catch { /* Neustart des Agenten — weiter warten */ }
  }
  return { agent: agent.name, ok: false, grund: 'Zeitüberschreitung nach 8 Minuten' };
}

async function runOnce() {
  if (getSetting('agentAutoUpdate') === 'off') return;

  const { content, version } = readLocalScript();
  if (!content || !version) {
    panelLog('warn', 'Agent-Script im Image nicht lesbar — automatisches Update übersprungen.');
    return;
  }

  const agents = db.prepare('SELECT * FROM remote_agents ORDER BY name').all() || [];
  if (!agents.length) return;

  const updated = [];
  const failed  = [];
  const terminal = [];

  for (const agent of agents) {
    try {
      const r = await updateAgent(agent, content, version);

      // Auch bei bereits aktuellen Agenten prüfen: Die Konsole kann unabhängig von der
      // Version fehlen, weil sie an Modulen auf dem Server hängt.
      const t = await terminalNachruestenFalls(agent);
      if (t) terminal.push(t);

      if (r.skipped) continue;

      updated.push(`${agent.name} (${r.from || 'unbekannt'} → ${version})`);

      // Antwortet ein Server nach dem Ausrollen nicht mehr, wird abgebrochen. Sonst
      // liefe dasselbe fehlerhafte Script der Reihe nach auf alle übrigen Server.
      if (!r.alive) {
        panelLog('error',
          `Agent "${agent.name}" antwortet nach dem Update auf v${version} nicht mehr. ` +
          `Das automatische Ausrollen wurde gestoppt, die übrigen Server bleiben auf ihrem Stand.`);
        console.error(`[Agent-AutoUpdate] "${agent.name}" nach Update stumm — Rollout gestoppt.`);
        return;
      }
    } catch (err) {
      // Nicht erreichbare Server sind der Normalfall (aus, im Neustart, Netz weg) und
      // kein Grund für einen Fehlereintrag.
      failed.push(`${agent.name}: ${err.response?.data?.error || err.message}`);
    }
  }

  if (updated.length) {
    panelLog('info', `Agenten automatisch auf v${version} aktualisiert: ${updated.join(', ')}`);
    console.log(`[Agent-AutoUpdate] ${updated.length} Agent(en) auf v${version} aktualisiert.`);
  }
  if (failed.length) {
    panelLog('warn', `Nicht erreichbar beim automatischen Agent-Update: ${failed.join(' · ')}`);
  }

  const fertig     = terminal.filter(t => t.ok).map(t => t.agent);
  const gescheitert = terminal.filter(t => !t.ok);
  if (fertig.length) {
    panelLog('info', `Container-Konsole nachgerüstet auf: ${fertig.join(', ')}`);
    console.log(`[Agent-AutoUpdate] Terminal-Module auf ${fertig.length} Server(n) nachgerüstet.`);
    for (const name of fertig) auditLog(sysReq, 'agent.terminal.setup', 'agent', name, { ok: true });
  }
  for (const g of gescheitert) {
    panelLog('warn',
      `Container-Konsole konnte auf "${g.agent}" nicht eingerichtet werden: ${g.grund}. ` +
      `Von Hand: cd /opt/panel-agent && npm install --save ws node-pty && systemctl restart panel-agent`);
    auditLog(sysReq, 'agent.terminal.setup', 'agent', g.agent, { ok: false, grund: g.grund });
  }
}

function start() {
  setTimeout(() => {
    _status.wrap(runOnce).then(() => {
      const { lastError } = _status.get();
      if (lastError) {
        console.error('[Agent-AutoUpdate] Durchlauf fehlgeschlagen:', lastError);
        panelLog('error', `Automatisches Agent-Update fehlgeschlagen: ${lastError}`);
      }
    });
  }, START_DELAY_MS);
}

module.exports = { start, runOnce, getStatus: _status.get };
