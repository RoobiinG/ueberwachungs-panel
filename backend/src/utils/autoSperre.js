// ─── Automatische Sperre und Whitelist-Verteilung ────────────────────────────
//
// Drei Aufgaben, alle über die bestehenden Agent-Verbindungen (Token, gepinnter Fingerprint):
//   1. Threat-Feed: Adressen ab N IPsum-Listen gehen als vollständige Liste an jeden Agenten
//      (POST /threatfeed, ab Agent v2.20.0). Der Agent sperrt sie per nftables vorab und lässt
//      eigene, geschützte, gelistete und gerade per SSH angemeldete Adressen selbst weg.
//   2. Whitelist: die globale Liste (Tabelle fail2ban_whitelist) geht an jeden Agenten
//      (PUT /whitelist). Er trägt sie in fail2ban (ignoreip) und vor die eigenen Sperren ein.
//   3. fail2ban-Eskalation: Sperrt fail2ban eine Adresse, die auf mindestens N Blocklisten
//      steht, wird daraus eine Dauersperre (Quelle `auto:<jail>`, Urheber „System").
//
// Abgeglichen wird alle 10 Minuten, nach jeder Änderung der Einstellungen oder der Whitelist
// sofort und nach jedem neuen IPsum-Stand. So holen auch Server auf, die gerade nicht
// erreichbar waren oder deren Agent neu installiert wurde. Nach dem Update ist alles aus.

const db = require('../db');
const ti = require('./threatIntel');
const { makeStatusTracker } = require('./workerStatus');
const { auditLog } = require('./audit');
const { parseCidr, geschuetztGrund } = require('./ipPruefung');
const {
  agentApi, agentZuAlt, agentFehler, banMetaSpeichern, sperreSetzen, whitelistEintraege, whitelistTreffer,
} = require('./sperren');

const SYNC_MS        = 10 * 60 * 1000;
const ESKALATION_MS  = 2 * 60 * 1000;
const START_MS       = 60 * 1000;
const MAX_JE_LAUF    = 50;
const AGENT_AB       = '2.20.0';
const JAIL_RE        = /^[\w.@:-]{1,64}$/;
const STANDARD       = { feed: false, feedSchwelle: 3, eskalation: false, eskalationSchwelle: 1 };

const syncTracker = makeStatusTracker();
const eskTracker  = makeStatusTracker();
const zustand = new Map();            // agentId → { agentId, name, feed, whitelist, eskalation }
const letzteEskalationen = [];        // die jüngsten 20, neueste zuerst
// Der Vorgang hat keinen Benutzer — auditLog braucht trotzdem ein Request-artiges Objekt.
const sysReq = { headers: {}, socket: {}, user: { id: null, username: 'System' } };

// ── Einstellungen ────────────────────────────────────────────────────────────
const schwelle = (v, std) => (Number.isInteger(v) && v >= 1 && v <= 10 ? v : std);

function einstellungen() {
  let roh = {};
  try { roh = JSON.parse(db.prepare('SELECT value FROM settings WHERE key = ?').get('auto_sperre')?.value || '{}') || {}; }
  catch { roh = {}; }
  return {
    feed:               roh.feed === true,
    feedSchwelle:       schwelle(roh.feedSchwelle, STANDARD.feedSchwelle),
    eskalation:         roh.eskalation === true,
    eskalationSchwelle: schwelle(roh.eskalationSchwelle, STANDARD.eskalationSchwelle),
  };
}

function einstellungenSpeichern(neu) {
  db.prepare('INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)')
    .run('auto_sperre', JSON.stringify(neu));
}

const agenten = () => db.prepare('SELECT * FROM remote_agents ORDER BY name').all();

function eintrag(agent) {
  let z = zustand.get(agent.id);
  if (!z) { z = { agentId: agent.id, name: agent.name, feed: null, whitelist: null, eskalation: null }; zustand.set(agent.id, z); }
  z.name = agent.name;
  return z;
}

const fehlerVon = (err) => ({ fehler: agentZuAlt(err, AGENT_AB) || agentFehler(err), zuAlt: err.response?.status === 404 });

// ── 1. Threat-Feed ───────────────────────────────────────────────────────────
// Sollstand: Version = „<IPsum-Stand>:<Schwelle>" bzw. „aus". Die Liste wird nur berechnet,
// wenn ein Agent tatsächlich einen anderen Stand hat.
function feedSoll(e) {
  if (!e.feed) return { version: 'aus', ips: () => [] };
  const stand = ti.ipsumStand();
  if (!stand) return null;   // IPsum noch nicht geladen — nichts verteilen, auch nichts leeren
  let ips = null;
  return { version: `${stand.slice(0, 19)}:${e.feedSchwelle}`, ips: () => (ips ??= ti.ipsumListe(e.feedSchwelle)) };
}

async function feedAbgleichen(agent, soll) {
  const z = eintrag(agent);
  try {
    const { data } = await agentApi(agent, 15000).get('/threatfeed');
    let feed = { version: data.version || null, anzahl: data.anzahl || 0, uebersprungen: data.uebersprungen || 0,
                 drops: data.drops || null, at: data.at || null };
    // Aus und auf dem Server nie benutzt: nichts anlegen.
    if (data.version !== soll.version && !(soll.version === 'aus' && !data.anzahl)) {
      const { data: r } = await agentApi(agent, 90000).post('/threatfeed', { version: soll.version, ips: soll.ips() });
      feed = { ...feed, version: r.version, anzahl: r.anzahl, uebersprungen: r.uebersprungen, at: new Date().toISOString() };
    }
    z.feed = { ...feed, fehler: null, zuAlt: false };
  } catch (err) {
    z.feed = { ...(z.feed || {}), ...fehlerVon(err) };
  }
}

// ── 2. Whitelist ─────────────────────────────────────────────────────────────
function f2bZusammenfassung(f) {
  if (!f) return null;
  return {
    state: f.state || null,
    datei: !!f.datei,
    dateiFehler: f.dateiFehler || null,
    // GET liefert je Jail `fehlend`, PUT liefert `ok`.
    jails: (f.jails || []).map(j => ({ name: j.name, ok: j.ok ?? (Array.isArray(j.fehlend) ? j.fehlend.length === 0 : null) })),
  };
}

async function whitelistAbgleichen(agent, soll) {
  const z = eintrag(agent);
  try {
    const { data } = await agentApi(agent, 15000).get('/whitelist');
    const ist = [...(data.eintraege || [])].sort();
    let ergebnis = { fail2ban: data.fail2ban, nft: data.nft };
    const gleich = ist.length === soll.length && ist.every((c, i) => c === soll[i]);
    // Jail ohne einen der Einträge (z. B. nach einem fail2ban-Neustart) → erneut anwenden.
    const luecke = (data.fail2ban?.jails || []).some(j => Array.isArray(j.fehlend) && j.fehlend.length);
    if (!gleich || (luecke && soll.length)) {
      const { data: r } = await agentApi(agent, 90000).put('/whitelist', { eintraege: soll });
      ergebnis = { fail2ban: r.fail2ban, nft: r.nft };
    }
    z.whitelist = {
      synchron: true, anzahl: soll.length,
      fail2ban: f2bZusammenfassung(ergebnis.fail2ban),
      firewall: ergebnis.nft ? { ok: ergebnis.nft.ok !== false, fehler: ergebnis.nft.fehler || null } : null,
      fehler: null, zuAlt: false, at: new Date().toISOString(),
    };
  } catch (err) {
    // Leere Whitelist auf einem alten Agenten ist kein Problem — es gibt nichts zu verteilen.
    const f = fehlerVon(err);
    z.whitelist = { synchron: f.zuAlt && !soll.length, anzahl: soll.length, fail2ban: null, firewall: null, ...f };
  }
}

async function abgleichen() {
  const e = einstellungen();
  const feed = feedSoll(e);
  const wl = whitelistEintraege().map(w => w.cidr).sort();
  const fehler = [];
  for (const agent of agenten()) {
    await whitelistAbgleichen(agent, wl);
    if (feed) await feedAbgleichen(agent, feed);
    const z = zustand.get(agent.id);
    for (const t of [z?.whitelist, z?.feed]) if (t?.fehler && !t.zuAlt) fehler.push(`${agent.name}: ${t.fehler}`);
  }
  // Gelöschte Server aus dem Status nehmen.
  const ids = new Set(agenten().map(a => a.id));
  for (const id of zustand.keys()) if (!ids.has(id)) zustand.delete(id);
  if (fehler.length) throw new Error(fehler.slice(0, 5).join(' · '));
}

// ── 3. fail2ban-Eskalation ───────────────────────────────────────────────────
async function eskalieren() {
  const e = einstellungen();
  if (!e.eskalation) return;
  const fehler = [];
  for (const agent of agenten()) {
    const z = eintrag(agent);
    let bans;
    try {
      const { data } = await agentApi(agent).get('/fail2ban/bans');
      if (!data?.available) { z.eskalation = { geprueftAt: new Date().toISOString(), hinweis: data?.message || null }; continue; }
      bans = data.bans || [];
    } catch (err) {
      z.eskalation = { ...(z.eskalation || {}), fehler: agentFehler(err) };
      fehler.push(`${agent.name}: ${agentFehler(err)}`);
      continue;
    }
    const dauerhaft = new Set(db.prepare('SELECT cidr FROM permanent_bans WHERE agent_id = ?').all(agent.id).map(r => r.cidr));
    const neu = [];
    let versuche = 0;
    for (const b of bans) {
      if (versuche >= MAX_JE_LAUF) break;
      if (b.permanent || dauerhaft.has(b.ip) || !JAIL_RE.test(String(b.jail || ''))) continue;
      const listen = ti.blocklisten(b.ip);
      if (listen < e.eskalationSchwelle) continue;
      let p;
      try { p = parseCidr(b.ip); } catch { continue; }
      if (geschuetztGrund(p) || whitelistTreffer(p)) continue;
      versuche++;
      // Ohne „trotzdem": Besteht von dort eine SSH-Sitzung, fragt der Agent nach — dann nicht automatisch.
      const r = await sperreSetzen(agent, p.cidr, false);
      if (!r.ok) continue;
      banMetaSpeichern(agent.id, p.cidr, `Automatisch: fail2ban-Jail ${b.jail}, auf ${listen} ${listen === 1 ? 'Blockliste' : 'Blocklisten'}`, `auto:${b.jail}`, 'System');
      dauerhaft.add(p.cidr);
      if (!r.bereits) neu.push({ cidr: p.cidr, jail: b.jail, listen });
    }
    z.eskalation = { geprueftAt: new Date().toISOString(), fehler: null, zuletzt: neu.length };
    if (neu.length) {
      auditLog(sysReq, 'security.auto_sperre.eskalation', 'agent', agent.name, { gesperrt: neu });
      const at = new Date().toISOString();
      for (const x of neu) letzteEskalationen.unshift({ ...x, agentId: agent.id, server: agent.name, at });
      letzteEskalationen.splice(20);
    }
  }
  if (fehler.length) throw new Error(fehler.slice(0, 5).join(' · '));
}

// ── Steuerung ────────────────────────────────────────────────────────────────
let nochmal = false;
let anstossTimer = null;
async function abgleichLauf() {
  do { nochmal = false; await abgleichen(); } while (nochmal);
}

/** Abgleich bald ausführen (nach Änderungen). Läuft gerade einer, folgt direkt ein zweiter. */
function anstossen() {
  if (syncTracker.get().running) { nochmal = true; return; }
  clearTimeout(anstossTimer);
  anstossTimer = setTimeout(() => syncTracker.wrap(abgleichLauf), 1500);
  anstossTimer.unref?.();
}

let gestartet = false;
function start() {
  if (gestartet) return;
  gestartet = true;
  const t0 = setTimeout(() => syncTracker.wrap(abgleichLauf), START_MS);
  t0.unref?.();
  setInterval(() => syncTracker.wrap(abgleichLauf), SYNC_MS).unref?.();
  setInterval(() => eskTracker.wrap(eskalieren), ESKALATION_MS).unref?.();
  // Neuer IPsum-Stand → Feed neu verteilen (nur wenn eingeschaltet, sonst ist nichts zu tun).
  ti.beiIpsum(() => { if (gestartet && einstellungen().feed) anstossen(); });
}

function getStatus() {
  return {
    ...syncTracker.get(),
    eskalationsLauf: eskTracker.get(),
    einstellungen: einstellungen(),
    server: [...zustand.values()],
    letzteEskalationen: [...letzteEskalationen],
  };
}

/** Eskalation sofort prüfen (etwa direkt nach dem Einschalten), statt auf den 2-min-Takt zu warten. */
const eskalierenJetzt = () => eskTracker.wrap(eskalieren);

module.exports = { start, anstossen, eskalierenJetzt, getStatus, einstellungen, einstellungenSpeichern, AGENT_AB };
