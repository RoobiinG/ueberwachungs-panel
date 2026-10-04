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
const { execFile } = require('child_process');
const { promisify } = require('util');
const db     = require('../db');
const { agentClient }   = require('./agentTls');
const { auditLog }      = require('./audit');
const { compareSemver } = require('./updateCheck');
const { warteAufAgent } = require('./agentHealth');
const { makeStatusTracker } = require('./workerStatus');
const _status = makeStatusTracker();
const execFileAsync = promisify(execFile);

const SCRIPT_PATH = path.resolve(__dirname, '../../../agent/panel-agent.js');

// Dem Panel und den Servern Zeit zum Hochkommen geben. Ein Agent, der nach einem
// Server-Neustart noch nicht lauscht, soll nicht als „nicht erreichbar" gelten.
const START_DELAY_MS = 45_000;

// So lange wartet das Panel nach dem Ausrollen, bis der Agent mit der neuen Version
// wieder antwortet. Der Neustart selbst dauert wenige Sekunden; der Rest ist Reserve für
// den Selbst-Rollback des Agenten (drei Startversuche im Abstand von RestartSec=5).
const HEALTH_FENSTER_MS = 90_000;

// Bleiben so viele Agents *nacheinander* nach dem Update stumm (oder auf der alten Version),
// liegt es wahrscheinlich am Script und nicht am einzelnen Server — dann stoppt der Rollout,
// statt dasselbe Script auf alle übrigen Server zu legen.
const ABBRUCH_NACH = 2;

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

// Das Script, das ausgerollt werden soll, muss sich überhaupt laden lassen. Ein Syntaxfehler
// im Image würde sonst den Agenten auf jedem Server beim Neustart lahmlegen.
async function scriptPruefen() {
  try {
    await execFileAsync(process.execPath, ['--check', SCRIPT_PATH], { timeout: 20_000 });
    return null;
  } catch (err) {
    return String(err.stderr || err.message).trim().split('\n').slice(0, 3).join(' | ').slice(0, 300);
  }
}

// Rollt das Script auf einen Agenten aus und wartet, bis er mit der neuen Version wieder
// antwortet. Ergebnis `zustand`: ok | zurueckgerollt | stumm (siehe agentHealth.js).
async function updateAgent(agent, script, targetVersion) {
  const api = agentClient(agent, 8000);

  const { data } = await api.get('/version');
  const current = data?.version || null;
  if (current && compareSemver(targetVersion, current) <= 0) {
    return { skipped: true, current };
  }

  const hmac = crypto.createHmac('sha256', agent.token).update(script).digest('hex');
  await api.post('/update', { script, hmac }, { timeout: 30000 });

  // Der Agent schreibt sich selbst neu und startet neu — über ein Zeitfenster pollen. Nur
  // eine Antwort mit der Zielversion zählt; der alte Prozess kann in der Sekunde vor dem
  // Neustart noch antworten.
  const ergebnis = await warteAufAgent({
    holeVersion: async () => (await agentClient(agent, 4000).get('/version')).data?.version || null,
    ziel: targetVersion,
    fensterMs: HEALTH_FENSTER_MS,
  });

  // Die angezeigte Version nur dann nachziehen, wenn sie stimmt — früher stand sie auch bei
  // einem Agenten, der nie zurückkam, auf der Zielversion.
  try {
    const gemeldet = ergebnis.zustand === 'ok' ? targetVersion : ergebnis.version;
    if (gemeldet) db.prepare('UPDATE remote_agents SET version = ? WHERE id = ?').run(gemeldet, agent.id);
  } catch { /* Spalte ist nur Anzeige */ }

  auditLog(sysReq, 'agent.update.auto', 'agent', agent.name, {
    from: current, to: targetVersion, ergebnis: ergebnis.zustand, gemeldet: ergebnis.version,
    wartezeitS: Math.round(ergebnis.wartezeitMs / 1000),
  });
  return { updated: true, from: current, to: targetVersion, ...ergebnis };
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

  const fehler = await scriptPruefen();
  if (fehler) {
    panelLog('error', `Agent-Script im Image ist nicht ladbar (${fehler}) — automatisches Update übersprungen, kein Server wurde angefasst.`);
    console.error('[Agent-AutoUpdate] Script nicht ladbar — übersprungen:', fehler);
    return;
  }

  const agents = db.prepare('SELECT * FROM remote_agents ORDER BY name').all() || [];
  if (!agents.length) return;

  const updated  = [];
  const failed   = [];
  const isoliert = [];   // nach dem Update stumm oder nicht auf der Zielversion
  const erreicht = [];   // aktuell und antwortend — nur für diese ist die Konsole-Nachrüstung sinnvoll

  // Jeder Agent läuft isoliert: ein Fehler beim einen berührt die übrigen nicht. Nur eine
  // Serie (siehe ABBRUCH_NACH) stoppt die Schleife.
  let stummInFolge = 0;
  for (const [i, agent] of agents.entries()) {
    try {
      const r = await updateAgent(agent, content, version);

      if (r.skipped) { erreicht.push(agent); continue; }

      if (r.zustand === 'ok') {
        stummInFolge = 0;
        updated.push(`${agent.name} (${r.from || 'unbekannt'} → ${version})`);
        erreicht.push(agent);
        continue;
      }

      stummInFolge++;
      const sek = Math.round(r.wartezeitMs / 1000);
      const grund = r.zustand === 'zurueckgerollt'
        ? `läuft nach dem Update weiter mit v${r.version} statt v${version} — das Update wurde zurückgenommen oder der Neustart blieb aus`
        : `antwortet ${sek} s nach dem Update auf v${version} nicht mehr`;
      isoliert.push(`${agent.name}: ${grund}`);
      panelLog('error',
        `Agent "${agent.name}" ${grund}. Er wurde isoliert, das Ausrollen läuft für die übrigen Server weiter. ` +
        `Ab Agent v2.20.1 setzt er sich nach drei fehlgeschlagenen Starts selbst zurück; sonst von Hand: systemctl status panel-agent`);
      console.error(`[Agent-AutoUpdate] "${agent.name}" nach Update ${r.zustand} — isoliert.`);

      if (stummInFolge >= ABBRUCH_NACH) {
        const offen = agents.length - i - 1;
        panelLog('error',
          `${stummInFolge} Agents hintereinander blieben nach dem Update auf v${version} stumm — vermutlich liegt es am Script. ` +
          `Das automatische Ausrollen wurde gestoppt${offen ? `, ${offen} weitere Server bleiben auf ihrem Stand` : ''}.`);
        console.error(`[Agent-AutoUpdate] ${stummInFolge} stumme Agents in Folge — Rollout gestoppt.`);
        break;
      }
    } catch (err) {
      // Nicht erreichbare Server sind der Normalfall (aus, im Neustart, Netz weg) und
      // kein Grund für einen Fehlereintrag — und kein Hinweis auf ein kaputtes Script.
      failed.push(`${agent.name}: ${err.response?.data?.error || err.message}`);
    }
  }

  // Zweite Phase: Auch bei bereits aktuellen Agenten prüfen, denn die Konsole kann
  // unabhängig von der Version fehlen (sie hängt an Modulen auf dem Server). Das Nachrüsten
  // kann Minuten dauern; früher hielt es die Schleife je Agent hintereinander auf. Die Server
  // sind voneinander unabhängig, deshalb läuft es jetzt parallel.
  const terminal = (await Promise.allSettled(erreicht.map(terminalNachruestenFalls)))
    .map(r => (r.status === 'fulfilled' ? r.value : null))
    .filter(Boolean);

  if (updated.length) {
    panelLog('info', `Agenten automatisch auf v${version} aktualisiert: ${updated.join(', ')}`);
    console.log(`[Agent-AutoUpdate] ${updated.length} Agent(en) auf v${version} aktualisiert.`);
  }
  if (failed.length) {
    panelLog('warn', `Nicht erreichbar beim automatischen Agent-Update: ${failed.join(' · ')}`);
  }
  if (isoliert.length) {
    console.error(`[Agent-AutoUpdate] Isoliert: ${isoliert.join(' · ')}`);
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
