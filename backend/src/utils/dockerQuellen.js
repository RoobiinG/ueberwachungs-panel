// ─── Container über alle erlaubten Server hinweg ──────────────────────────────
//
// Grundlage der serverübergreifenden Suche. Der entscheidende Punkt: **Welche Server
// überhaupt abgefragt werden, entscheidet allein diese Datei anhand der Rolle** — nicht
// das Frontend. Wer eine Rolle mit `restrict_agents` hat, bekommt fremde Server hier gar
// nicht erst zu sehen, und `hide_local` blendet den Panel-Server selbst aus. Eine Suche,
// die im Frontend filtert, hätte die Namen vorher schon übertragen.
//
// Ein nicht erreichbarer Server lässt die ganze Suche nicht scheitern: Jede Quelle wird
// einzeln bewertet und mit ihrem Fehler zurückgemeldet, damit in der Oberfläche steht,
// welcher Server gerade nicht antwortet.

const db = require('../db');
const dockhand = require('./dockhandClient');
const dockerSocket = require('./dockerSocket');
const { agentClient } = require('./agentTls');
const { erlaubteAgenten, darfLokal } = require('./agentAccess');

const ABFRAGE_TIMEOUT = 6000;

// Die Abfrage bewusst erst beim Aufruf vorbereiten: Beim Laden des Moduls kann die
// Migration der Tabelle noch nicht durch sein (siehe metricsRecorder, v5.6.x).
const getSetting = (k) => db.prepare('SELECT value FROM settings WHERE key = ?').get(k)?.value ?? null;
const localEnvId = () => getSetting('dockhandLocalEnvId');
const engineMode = () => getSetting('dockerEngine') || 'agents';

// ── Container einer einzelnen Quelle ─────────────────────────────────────────

// Panel-Server: bevorzugt Dockhand (dort stehen auch Auslastungswerte), sonst der
// lokale Docker-Socket. Ohne den Rückfall bliebe der eigene Server in der Suche leer,
// solange kein Dockhand eingerichtet ist.
async function lokaleContainer() {
  const envId = localEnvId();
  if (envId) {
    try {
      const { data } = await dockhand.getContainers(envId);
      return (Array.isArray(data) ? data : []).map(dockhand.normalizeContainer);
    } catch (err) {
      if (!(await dockerSocket.verfuegbar())) throw err;
    }
  }
  if (!(await dockerSocket.verfuegbar())) {
    throw new Error('Weder Dockhand noch der lokale Docker-Socket sind verfügbar');
  }
  return dockerSocket.containerListe(true);
}

// Remote-Server: je nach Betriebsart über den Agenten oder über Dockhand.
async function agentContainer(agent) {
  const modus = engineMode();

  if (modus !== 'dockhand') {
    try {
      const { data } = await agentClient(agent, ABFRAGE_TIMEOUT).get('/docker/containers');
      return Array.isArray(data) ? data : [];
    } catch (err) {
      // Nur im gemischten Betrieb ausweichen — sonst verdeckt der Rückfall dauerhaft
      // einen ausgefallenen Agenten (dieselbe Überlegung wie in routes/agents.js).
      if (modus !== 'mixed' || !agent.dockhand_env_id) throw err;
    }
  }

  if (!agent.dockhand_env_id) throw new Error('Kein Dockhand-Environment zugewiesen');
  const { data } = await dockhand.getContainers(agent.dockhand_env_id);
  return (Array.isArray(data) ? data : []).map(dockhand.normalizeContainer);
}

// ── Alle Quellen zusammen ────────────────────────────────────────────────────

/**
 * Fragt alle für diese Rolle erlaubten Server parallel ab.
 * Gibt `{ quellen, container }` zurück; `container` trägt je Eintrag `serverId`
 * ('local' oder Agent-ID) und `serverName`.
 */
async function containerAllerQuellen(roleName) {
  const quellen = [];
  if (darfLokal(roleName)) quellen.push({ id: 'local', name: 'Lokal', lokal: true });
  for (const a of erlaubteAgenten(roleName)) quellen.push({ id: a.id, name: a.name, agent: a });

  const ergebnisse = await Promise.allSettled(
    quellen.map(q => (q.lokal ? lokaleContainer() : agentContainer(q.agent)))
  );

  const container = [];
  const bericht = quellen.map((q, i) => {
    const r = ergebnisse[i];
    if (r.status !== 'fulfilled') {
      return { id: q.id, name: q.name, ok: false, fehler: r.reason?.response?.data?.error || r.reason?.message || 'nicht erreichbar', anzahl: 0 };
    }
    for (const c of r.value) container.push({ ...c, serverId: q.id, serverName: q.name });
    return { id: q.id, name: q.name, ok: true, fehler: null, anzahl: r.value.length };
  });

  return { quellen: bericht, container };
}

module.exports = { containerAllerQuellen };
