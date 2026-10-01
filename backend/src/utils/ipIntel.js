// ─── GeoIP & Bedrohungsdaten zu fremden IP-Adressen ───────────────────────────
//
// Drei Stufen (Wasserfall), damit die Sperrlisten nie auf ein Drittsystem warten:
//   1. Cache: Was ipapi.is schon geliefert hat, liegt 14 Tage in `ip_intel`.
//   2. Lokale Datenbanken (utils/threatIntel.js, lädt das Panel selbst herunter):
//      Land und Stadt (DB-IP City), Provider und ASN (DB-IP ASN), Blocklisten-Treffer (IPsum).
//      Land/Stadt kommen immer von hier, Provider nur, solange Stufe 1 nichts hat.
//   3. Extern: Die Einstufung VPN/Proxy/Tor/Rechenzentrum holt ein Hintergrund-Worker
//      gebündelt bei ipapi.is (bis 100 IPs je Anfrage, HTTPS) und legt sie in Stufe 1 ab.
//      Bis dahin steht in der Antwort `status: 'ausstehend'`; die nächste Abfrage der Liste
//      (30-s-Takt im Frontend) bringt die Daten mit.
//
// Nach außen gehen nur öffentliche Adressen, und nur wenn ein API-Key hinterlegt ist.
// SSH-Sitzungen fragen bewusst nicht extern nach (`extern: false`) — das sind in aller
// Regel die eigenen Leute, deren Adressen gehören nicht zu einem Drittanbieter.
// Alles, was von dort zurückkommt, gilt als unvertrauenswürdig: nur erwartete Felder,
// auf feste Typen gebracht und gekürzt.

const axios = require('axios');
const db = require('../db');
const { geoLookup } = require('./audit');
const { parseCidr, geschuetztGrund } = require('./ipPruefung');
const { makeStatusTracker } = require('./workerStatus');
const lokal = require('./threatIntel');

const ENDPUNKT        = 'https://api.ipapi.is';
const GUELTIG_MS      = 14 * 24 * 3600 * 1000;
const FEHLER_GUELTIG  = 24 * 3600 * 1000;
const BUDGET_PRO_TAG  = 900;          // Freikontingent 1.000/Tag, Luft für Tests lassen
const BUENDEL         = 100;
const TAKT_MS         = 5000;
const PAUSE_FEHLER_MS = 10 * 60 * 1000;
const MAX_WARTESCHLANGE = 1000;

const warteschlange = new Set();
let pauseBis = 0;
let letztesAufraeumen = 0;
const tracker = makeStatusTracker();

const setting = (key) => db.prepare('SELECT value FROM settings WHERE key = ?').get(key)?.value || '';
const apiKey  = () => setting('ipapi_is_key');

const heute = () => new Date().toISOString().slice(0, 10);
function budgetVerbraucht() {
  const [tag, n] = setting('ip_intel_budget').split(':');
  return tag === heute() ? (parseInt(n, 10) || 0) : 0;
}
function budgetBuchen(anzahl) {
  db.prepare('INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)')
    .run('ip_intel_budget', `${heute()}:${budgetVerbraucht() + anzahl}`);
}

/** Nur einzelne, öffentliche Adressen gehen nach außen. */
function oeffentlich(ip) {
  try {
    const p = parseCidr(ip);
    return p.praefix === (p.family === 4 ? 32 : 128) && !geschuetztGrund(p);
  } catch { return false; }
}

const kurz = (v) => {
  if (v === null || v === undefined || typeof v === 'object') return null;
  const s = String(v).trim().slice(0, 120);
  return s || null;
};

function einstufen(d) {
  if (d.is_tor) return 'tor';
  if (d.is_vpn) return 'vpn';
  if (d.is_proxy) return 'proxy';
  if (d.is_datacenter || d.company?.type === 'hosting') return 'rechenzentrum';
  if (d.is_mobile) return 'mobil';
  return 'provider';
}

// Antwort von ipapi.is auf das Format des Panels bringen.
function ausAntwort(d) {
  const land = kurz(d.location?.country_code);
  return {
    typ:       einstufen(d),
    isp:       kurz(d.company?.name) || kurz(d.asn?.org),
    firmaTyp:  kurz(d.company?.type),
    asn:       Number.isInteger(d.asn?.asn) ? d.asn.asn : null,
    asnOrg:    kurz(d.asn?.org),
    missbrauch: !!d.is_abuser,
    land:      land && /^[A-Za-z]{2}$/.test(land) ? land.toUpperCase() : null,
    stadt:     kurz(d.location?.city),
  };
}

function speichern(ip, quelle, daten) {
  db.prepare('INSERT OR REPLACE INTO ip_intel (ip, daten, quelle, abgerufen_at) VALUES (?, ?, ?, ?)')
    .run(ip, JSON.stringify(daten), quelle, Date.now());
}

/**
 * Standort und — soweit vorhanden — Provider-Daten zu mehreren IPs, ohne zu warten.
 * Fehlende oder veraltete Einträge werden (bei `extern`) für den Worker vorgemerkt.
 * @returns {Object<string, object>}  IP → { land, stadt, isp, asn, asnOrg, typ, missbrauch, blocklisten, status }
 */
function anreichern(ips, { extern = true } = {}) {
  const ergebnis = {};
  const eingerichtet = !!apiKey();
  const lesen = db.prepare('SELECT daten, quelle, abgerufen_at FROM ip_intel WHERE ip = ?');

  for (const roh of new Set((ips || []).filter(Boolean).map(String))) {
    const ip = roh.split('/')[0];
    const geo = geoLookup(ip) || {};
    let daten = null, status;

    if (!oeffentlich(ip)) {
      status = 'intern';
    } else {
      const zeile = lesen.get(ip);
      const alter = zeile ? Date.now() - zeile.abgerufen_at : Infinity;
      if (zeile) { try { daten = JSON.parse(zeile.daten); } catch { daten = null; } }
      const frisch = zeile && alter < (zeile.quelle === 'fehler' ? FEHLER_GUELTIG : GUELTIG_MS);

      if (frisch) status = zeile.quelle === 'fehler' ? 'fehler' : 'ok';
      else if (!extern) status = daten ? 'ok' : 'nur_standort';
      else if (!eingerichtet) status = 'nicht_eingerichtet';
      else {
        if (warteschlange.size < MAX_WARTESCHLANGE) warteschlange.add(ip);
        status = 'ausstehend';
      }
    }

    // Stufe 2: Provider aus der lokalen ASN-Datenbank, solange der Cache nichts Besseres hat.
    const asnLokal = status === 'intern' || daten?.isp ? null : lokal.asn(ip);
    const blocklisten = lokal.blocklisten(ip);

    ergebnis[roh] = {
      land:       daten?.land  || geo.country || null,
      stadt:      daten?.stadt || geo.city    || null,
      isp:        daten?.isp    ?? asnLokal?.org ?? null,
      asn:        daten?.asn    ?? asnLokal?.asn ?? null,
      asnOrg:     daten?.asnOrg ?? asnLokal?.org ?? null,
      typ:        daten?.typ    ?? null,
      missbrauch: !!daten?.missbrauch || blocklisten >= lokal.IPSUM_MISSBRAUCH,
      blocklisten,
      status,
    };
  }
  return ergebnis;
}

async function abfragen(ips, key) {
  const { data } = await axios.post(ENDPUNKT, { ips, key }, { timeout: 8000, headers: { 'Content-Type': 'application/json' } });
  if (!data || typeof data !== 'object') throw new Error('Unerwartete Antwort von ipapi.is');
  if (data.error) throw new Error(`ipapi.is: ${kurz(data.error)}`);
  return data;
}

async function takt() {
  // Einmal pro Stunde alte Einträge wegräumen.
  if (Date.now() - letztesAufraeumen > 3600 * 1000) {
    letztesAufraeumen = Date.now();
    db.prepare('DELETE FROM ip_intel WHERE abgerufen_at < ?').run(Date.now() - 4 * GUELTIG_MS);
  }
  if (!warteschlange.size || Date.now() < pauseBis) return;
  const key = apiKey();
  if (!key) { warteschlange.clear(); return; }

  const rest = BUDGET_PRO_TAG - budgetVerbraucht();
  if (rest <= 0) return;   // Kontingent für heute aufgebraucht — morgen geht es weiter
  const buendel = [...warteschlange].slice(0, Math.min(BUENDEL, rest));
  buendel.forEach(ip => warteschlange.delete(ip));

  let antwort;
  try {
    antwort = await abfragen(buendel, key);
  } catch (err) {
    pauseBis = Date.now() + PAUSE_FEHLER_MS;
    buendel.forEach(ip => warteschlange.add(ip));
    const status = err.response?.status;
    throw new Error(status ? `ipapi.is antwortete mit HTTP ${status}` : err.message);
  }
  budgetBuchen(buendel.length);
  for (const ip of buendel) {
    const d = antwort[ip];
    if (d && typeof d === 'object' && !d.error) speichern(ip, 'ipapi.is', ausAntwort(d));
    else speichern(ip, 'fehler', {});
  }
}

/** Key prüfen, ohne ihn zu speichern. Verbraucht eine Abfrage des Kontingents. */
async function testen(key) {
  const antwort = await abfragen(['1.1.1.1'], key);
  const d = antwort['1.1.1.1'];
  if (!d || typeof d !== 'object' || d.error) throw new Error('ipapi.is lieferte keine Daten zur Test-Adresse');
  budgetBuchen(1);
  return ausAntwort(d);
}

let gestartet = false;
function start() {
  if (gestartet) return;
  gestartet = true;
  const t = setInterval(() => tracker.wrap(takt), TAKT_MS);
  t.unref?.();
}

const getStatus = () => ({
  ...tracker.get(),
  eingerichtet: !!apiKey(),
  warteschlange: warteschlange.size,
  heuteAbgefragt: budgetVerbraucht(),
  tagesBudget: BUDGET_PRO_TAG,
  pausiertBis: pauseBis > Date.now() ? new Date(pauseBis).toISOString() : null,
});

module.exports = { anreichern, testen, start, getStatus };
