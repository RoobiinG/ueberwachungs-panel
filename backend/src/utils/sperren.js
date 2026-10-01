// ─── Dauersperren und Whitelist — gemeinsam für Routen und Hintergrund-Jobs ───
//
// Genutzt von routes/agents.js (Sperren von Hand), routes/whitelist.js und
// utils/autoSperre.js (fail2ban-Eskalation, Verteilung von Feed und Whitelist).

const db = require('../db');
const { agentClient } = require('./agentTls');
const { parseCidr, ueberlappt, normIp } = require('./ipPruefung');

const agentApi = (agent, timeout = 8000) => agentClient(agent, timeout);

// Adresse, von der die anfragende Person kommt (hinter dem Reverse Proxy der erste
// X-Forwarded-For-Eintrag). Nur für Warnungen vor Selbst-Aussperrung — eine gefälschte
// Angabe kann damit nichts freischalten.
const anfrageIp = (req) =>
  normIp((req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket?.remoteAddress || '');

const agentZuAlt = (err, ab) => err.response?.status === 404
  ? `Der Agent kennt diese Funktion noch nicht — bitte auf v${ab} oder neuer aktualisieren.` : null;
const agentFehler = (err) => err.response?.data?.error || err.message;

function banMetaSpeichern(agentId, cidr, grund, quelle, von) {
  db.prepare(`
    INSERT INTO permanent_bans (agent_id, cidr, grund, quelle, erstellt_von) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(agent_id, cidr) DO UPDATE SET grund = COALESCE(excluded.grund, grund)
  `).run(agentId, cidr, grund || null, quelle, von || null);
}

// Eine Sperre auf einem Agenten setzen. Liefert { ok, bereits, status, error, bestaetigungNoetig, whitelist }.
async function sperreSetzen(agent, cidr, trotzdem) {
  try {
    await agentApi(agent).post('/blocklist/add', { cidr, trotzdem: trotzdem === true });
    return { ok: true };
  } catch (err) {
    const d = err.response?.data || {};
    if (d.bereits) return { ok: true, bereits: true };
    return {
      ok: false, status: err.response?.status || 502,
      error: agentZuAlt(err, '2.19.1') || agentFehler(err),
      bestaetigungNoetig: !!d.bestaetigungNoetig, whitelist: !!d.whitelist,
    };
  }
}

// ── Whitelist ────────────────────────────────────────────────────────────────
const whitelistEintraege = () =>
  db.prepare('SELECT id, cidr, notiz, erstellt_von, erstellt_at FROM fail2ban_whitelist ORDER BY id').all();

/** Der Whitelist-Eintrag, der sich mit `eintrag` (CIDR-String oder parseCidr-Objekt) überschneidet. */
function whitelistTreffer(eintrag) {
  let p;
  try { p = typeof eintrag === 'string' ? parseCidr(eintrag, { minPraefix: { 4: 0, 6: 0 } }) : eintrag; }
  catch { return null; }
  for (const w of whitelistEintraege()) {
    try { if (ueberlappt(p, parseCidr(w.cidr))) return w; } catch {}
  }
  return null;
}

module.exports = {
  agentApi, anfrageIp, agentZuAlt, agentFehler, banMetaSpeichern, sperreSetzen,
  whitelistEintraege, whitelistTreffer,
};
