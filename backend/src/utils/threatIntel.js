// ─── Lokale Bedrohungsdaten: Geo-, ASN- und Blocklisten-Datenbanken ──────────
//
// Mittlere Stufe der IP-Prüfung (Cache → lokale Datenbanken → ipapi.is, siehe ipIntel.js).
// Das Panel besorgt sich die Dateien selbst — niemand muss etwas auf dem Server ablegen:
//   geo    DB-IP „IP to City Lite"  (mmdb, monatlich, CC BY 4.0)  → Land, Stadt
//   asn    DB-IP „IP to ASN Lite"   (mmdb, monatlich, CC BY 4.0)  → Provider, ASN
//   ipsum  IPsum (stamparm)          (Text, täglich, Unlicense)    → auf wie vielen Blocklisten
//
// Ablauf:
//   - Beim Start werden vorhandene Dateien im Hintergrund geladen, fehlende kurz danach
//     heruntergeladen. Der Server lauscht sofort; bis die Geo-Datenbank bereit ist, gilt die
//     eingebaute geoip-lite-Datenbank (audit.js), danach wird deren Speicher freigegeben.
//   - Ein stündlicher Takt prüft, was fällig ist: DB-IP, sobald ein neuer Monat begonnen hat
//     (höchstens alle 6 h, die Datei erscheint erst im Lauf des Monatsersten), IPsum alle 12 h
//     als bedingte Anfrage — ohne Änderung wird nichts heruntergeladen.
//   - Eine neue Datei wird erst geprüft (Typ, Probe-Abfrage, Mindestumfang) und dann per
//     rename ausgetauscht. Scheitert etwas, bleibt die bisherige aktiv.
//
// Nach außen geht dabei keine einzige Adresse — es werden nur die Listen abgerufen, von fest
// eingetragenen URLs. Mit THREAT_INTEL_DOWNLOADS=off unterbleiben alle Downloads (Offline-Betrieb).

const fs    = require('fs');
const fsp   = fs.promises;
const path  = require('path');
const zlib  = require('zlib');
const { Transform } = require('stream');
const { pipeline }  = require('stream/promises');
const axios = require('axios');
const { Reader } = require('mmdb-lib');
const db = require('../db');
const { makeStatusTracker } = require('./workerStatus');

const VERZEICHNIS   = process.env.THREAT_INTEL_DIR || path.join(path.dirname(path.resolve(db.name)), 'bedrohungsdaten');
const DOWNLOADS_AUS = /^(off|aus|false|0|no|nein)$/i.test(String(process.env.THREAT_INTEL_DOWNLOADS || '').trim());

const STUNDE            = 3600 * 1000;
const TAKT_MS           = STUNDE;
const START_MS          = 5000;
const MMDB_PRUEF_MS     = 6 * STUNDE;
const IPSUM_PRUEF_MS    = 12 * STUNDE;
const FEHLER_PAUSE_MS   = 30 * 60 * 1000;
const MAX_LAUFZEIT_MS   = 15 * 60 * 1000;
const LEERLAUF_MS       = 30 * 1000;      // Abbruch, wenn so lange keine Daten kommen
const MANUELL_SPERRE_MS = 60 * 1000;
const IPSUM_MISSBRAUCH  = 3;              // ab so vielen Listen gilt eine Adresse als bekannte Missbrauchsquelle
const USER_AGENT        = 'Ueberwachungs-Panel (Bedrohungsdaten)';

const QUELLEN = {
  geo: {
    name: 'DB-IP City Lite', zweck: 'Land & Stadt', art: 'mmdb',
    datei: 'dbip-city-lite.mmdb', typ: /city/i, probe: '1.1.1.1',
    url: (m) => `https://download.db-ip.com/free/dbip-city-lite-${m}.mmdb.gz`,
    maxDownload: 200e6, maxEntpackt: 500e6,
    lizenz: 'CC BY 4.0', link: 'https://db-ip.com',
  },
  asn: {
    name: 'DB-IP ASN Lite', zweck: 'Provider & ASN', art: 'mmdb',
    datei: 'dbip-asn-lite.mmdb', typ: /asn/i, probe: '8.8.8.8',
    url: (m) => `https://download.db-ip.com/free/dbip-asn-lite-${m}.mmdb.gz`,
    maxDownload: 50e6, maxEntpackt: 150e6,
    lizenz: 'CC BY 4.0', link: 'https://db-ip.com',
  },
  ipsum: {
    name: 'IPsum', zweck: 'Blocklisten-Treffer', art: 'ipsum',
    datei: 'ipsum.txt',
    url: () => 'https://raw.githubusercontent.com/stamparm/ipsum/master/ipsum.txt',
    maxDownload: 50e6, maxEntpackt: 50e6,
    lizenz: 'Unlicense', link: 'https://github.com/stamparm/ipsum',
  },
};
const IDS = Object.keys(QUELLEN);

// Geladene Datenbanken. null = (noch) nicht vorhanden.
const daten = { geo: null, asn: null, ipsum: null };
const lauf  = { quelle: null, fortschritt: null };
let letzterLauf = null;
let letzterManuell = 0;
let bereit = Promise.resolve();
let gestartet = false;
const tracker = makeStatusTracker();

const datei = (id) => path.join(VERZEICHNIS, QUELLEN[id].datei);

// ── Meta-Daten (Stand, ETag, letzte Prüfung, Fehler) in der settings-Tabelle ──
function metaLesen() {
  try {
    const v = db.prepare('SELECT value FROM settings WHERE key = ?').get('threat_intel_meta')?.value;
    const m = v ? JSON.parse(v) : {};
    return m && typeof m === 'object' ? m : {};
  } catch { return {}; }
}
function metaSchreiben(id, eintrag) {
  const alle = metaLesen();
  alle[id] = eintrag;
  db.prepare('INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)')
    .run('threat_intel_meta', JSON.stringify(alle));
}

// 'YYYY-MM' des aktuellen und des Vormonats (UTC — so benennt DB-IP seine Dateien).
function monate(jetzt = new Date()) {
  const vor = new Date(Date.UTC(jetzt.getUTCFullYear(), jetzt.getUTCMonth() - 1, 1));
  return [jetzt.toISOString().slice(0, 7), vor.toISOString().slice(0, 7)];
}

const kurz = (v, max = 120) => {
  if (v === null || v === undefined || typeof v === 'object') return null;
  const s = String(v).trim().slice(0, max);
  return s || null;
};

const fehlerText = (err) => {
  const status = err?.response?.status;
  if (status) return `HTTP ${status}`;
  if (err?.name === 'AbortError' || err?.code === 'ABORT_ERR') return 'Zeitüberschreitung';
  return kurz(err?.message, 200) || 'Unbekannter Fehler';
};

// ── Laden & Prüfen ────────────────────────────────────────────────────────────
// Eine mmdb-Datei wird nur übernommen, wenn sie den erwarteten Typ hat und die Probe-Adresse
// darin zu finden ist — sonst wäre eine abgeschnittene oder falsche Datei „aktiv".
async function ladeMmdb(id, pfad) {
  const q = QUELLEN[id];
  const puffer = await fsp.readFile(pfad);
  const reader = new Reader(puffer);
  const typ = String(reader.metadata?.databaseType || '');
  if (!q.typ.test(typ)) throw new Error(`Unerwarteter Datenbank-Typ „${kurz(typ, 60) || '?'}"`);
  const probe = reader.get(q.probe);
  const ok = id === 'geo' ? !!probe?.country?.iso_code : Number.isInteger(probe?.autonomous_system_number);
  if (!ok) throw new Error('Probe-Abfrage lieferte keine Daten — Datei unvollständig?');
  const epoch = reader.metadata?.buildEpoch;
  return {
    reader,
    groesse: puffer.length,
    gebaut: epoch instanceof Date && !isNaN(epoch) ? epoch.toISOString() : null,
  };
}

function ipv4Zahl(ip) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (!m) return null;
  const o = m.slice(1).map(Number);
  if (o.some(n => n > 255)) return null;
  return ((o[0] * 256 + o[1]) * 256 + o[2]) * 256 + o[3];
}

// IPsum: „IP<Tab>Anzahl Listen" je Zeile. Sortiert in typisierten Arrays abgelegt —
// rund 120 000 Adressen brauchen so gut ein halbes MB statt einer großen Map.
async function ladeIpsum(pfad) {
  const text = await fsp.readFile(pfad, 'utf8');
  const kombi = [];
  let stand = null;
  for (const zeile of text.split('\n')) {
    if (zeile.startsWith('#')) {
      const m = /Last update:\s*(.+)$/i.exec(zeile);
      if (m && !stand) { const t = Date.parse(m[1].trim()); if (!isNaN(t)) stand = new Date(t).toISOString(); }
      continue;
    }
    const [ip, anzahl] = zeile.trim().split(/\s+/);
    const zahl = ipv4Zahl(ip || '');
    const n = parseInt(anzahl, 10);
    if (zahl === null || !(n >= 1)) continue;
    kombi.push(zahl * 256 + Math.min(n, 255));   // < 2^40, in einem Double exakt darstellbar
  }
  if (kombi.length < 1000) throw new Error(`Liste unvollständig (${kombi.length} Einträge)`);
  const sortiert = Float64Array.from(kombi).sort();
  const ips = new Uint32Array(sortiert.length);
  const treffer = new Uint8Array(sortiert.length);
  let missbrauch = 0;
  for (let i = 0; i < sortiert.length; i++) {
    ips[i] = Math.floor(sortiert[i] / 256);
    treffer[i] = sortiert[i] % 256;
    if (treffer[i] >= IPSUM_MISSBRAUCH) missbrauch++;
  }
  return { ips, treffer, eintraege: ips.length, missbrauch, stand, groesse: Buffer.byteLength(text) };
}

// ── Download ──────────────────────────────────────────────────────────────────
// Stream → Zähler (Fortschritt, Obergrenze) → ggf. gunzip → Obergrenze entpackt → Datei.
// Die Obergrenzen schützen vor einer manipulierten oder entgleisten Quelle (Gzip-Bombe).
function begrenzer(max, meldung, beiDaten) {
  let n = 0;
  return new Transform({
    transform(chunk, _enc, cb) {
      n += chunk.length;
      beiDaten?.(n);
      if (n > max) return cb(new Error(meldung));
      cb(null, chunk);
    },
  });
}

async function herunterladen(id, url, ziel, { etag } = {}) {
  const q = QUELLEN[id];
  const signal = AbortSignal.timeout(MAX_LAUFZEIT_MS);
  const res = await axios.get(url, {
    responseType: 'stream',
    timeout: LEERLAUF_MS,
    maxRedirects: 3,
    signal,
    headers: { 'User-Agent': USER_AGENT, ...(etag ? { 'If-None-Match': etag } : {}) },
    validateStatus: (s) => s === 200 || s === 304 || s === 404,
  });
  if (res.status !== 200) {
    res.data?.destroy?.();
    return res.status === 304 ? { unveraendert: true } : { nichtGefunden: true };
  }
  const gesamt = parseInt(res.headers['content-length'], 10) || null;
  if (gesamt && gesamt > q.maxDownload) { res.data.destroy(); throw new Error('Download größer als erwartet'); }
  lauf.fortschritt = { geladen: 0, gesamt };

  const stufen = [
    res.data,
    begrenzer(q.maxDownload, 'Download größer als erwartet', (n) => { lauf.fortschritt = { geladen: n, gesamt }; }),
    ...(q.art === 'mmdb' ? [zlib.createGunzip()] : []),
    begrenzer(q.maxEntpackt, 'Entpackte Datei größer als erwartet'),
    fs.createWriteStream(ziel, { mode: 0o640 }),
  ];
  await pipeline(...stufen, { signal });
  return { etag: kurz(res.headers.etag, 200) };
}

// ── Aktualisieren ─────────────────────────────────────────────────────────────
function faellig(id, meta, jetzt = Date.now()) {
  if (DOWNLOADS_AUS) return false;
  if (meta.fehlerAt && jetzt - meta.fehlerAt < FEHLER_PAUSE_MS) return false;
  if (!daten[id]) return true;
  const zuletzt = meta.geprueftAt || 0;
  if (QUELLEN[id].art === 'mmdb') return meta.version !== monate()[0] && jetzt - zuletzt >= MMDB_PRUEF_MS;
  return jetzt - zuletzt >= IPSUM_PRUEF_MS;
}

function naechstePruefung(id, meta) {
  if (DOWNLOADS_AUS) return null;
  if (meta.fehlerAt) return new Date(meta.fehlerAt + FEHLER_PAUSE_MS).toISOString();
  if (!daten[id]) return null;
  if (QUELLEN[id].art === 'mmdb') {
    if (meta.version === monate()[0]) {
      const j = new Date();
      return new Date(Date.UTC(j.getUTCFullYear(), j.getUTCMonth() + 1, 1)).toISOString();
    }
    return new Date((meta.geprueftAt || Date.now()) + MMDB_PRUEF_MS).toISOString();
  }
  return new Date((meta.geprueftAt || Date.now()) + IPSUM_PRUEF_MS).toISOString();
}

async function ersetzen(tmp, id) {
  await fsp.rename(tmp, datei(id));
}

// DB-IP: erst der aktuelle Monat, sonst der Vormonat (die neue Datei erscheint erst im Lauf
// des Monatsersten). Ist der vorhandene Stand schon so neu, wird nichts heruntergeladen.
async function aktualisiereMmdb(id, meta) {
  const q = QUELLEN[id];
  for (const m of monate()) {
    if (daten[id] && meta.version && meta.version >= m) return 'aktuell';
    const tmp = `${datei(id)}.tmp`;
    try {
      const r = await herunterladen(id, q.url(m), tmp);
      if (r.nichtGefunden) continue;
      const neu = await ladeMmdb(id, tmp);
      await ersetzen(tmp, id);
      daten[id] = neu;
      Object.assign(meta, { version: m, aktualisiertAt: Date.now(), groesse: neu.groesse, gebaut: neu.gebaut });
      if (id === 'geo') require('./audit').geoipFreigeben();
      return 'aktualisiert';
    } finally {
      await fsp.rm(tmp, { force: true }).catch(() => {});
    }
  }
  if (daten[id]) return 'aktuell';
  throw new Error(`Keine Datei für ${monate().join(' oder ')} verfügbar`);
}

async function aktualisiereIpsum(meta) {
  const tmp = `${datei('ipsum')}.tmp`;
  try {
    const r = await herunterladen('ipsum', QUELLEN.ipsum.url(), tmp, { etag: daten.ipsum ? meta.etag : null });
    if (r.unveraendert) return 'aktuell';
    if (r.nichtGefunden) throw new Error('Liste nicht gefunden (HTTP 404)');
    const neu = await ladeIpsum(tmp);
    await ersetzen(tmp, 'ipsum');
    daten.ipsum = neu;
    ipsumGeaendert();
    Object.assign(meta, {
      version: neu.stand ? neu.stand.slice(0, 10) : null, etag: r.etag,
      aktualisiertAt: Date.now(), groesse: neu.groesse,
    });
    return 'aktualisiert';
  } finally {
    await fsp.rm(tmp, { force: true }).catch(() => {});
  }
}

async function durchlauf({ manuell = false, von = null } = {}) {
  await bereit;
  if (DOWNLOADS_AUS) return;
  await fsp.mkdir(VERZEICHNIS, { recursive: true });

  const ergebnisse = {};
  const fehler = [];
  for (const id of IDS) {
    const meta = metaLesen()[id] || {};
    if (!manuell && !faellig(id, meta)) continue;
    lauf.quelle = id;
    lauf.fortschritt = null;
    try {
      ergebnisse[id] = QUELLEN[id].art === 'mmdb' ? await aktualisiereMmdb(id, meta) : await aktualisiereIpsum(meta);
      if (ergebnisse[id] === 'aktualisiert') console.log(`[Bedrohungsdaten] ${QUELLEN[id].name} aktualisiert (${meta.version || '—'})`);
      meta.fehler = null;
      meta.fehlerAt = null;
    } catch (err) {
      ergebnisse[id] = 'fehler';
      meta.fehler = fehlerText(err);
      meta.fehlerAt = Date.now();
      fehler.push(`${QUELLEN[id].name}: ${meta.fehler}`);
      console.warn(`[Bedrohungsdaten] ${QUELLEN[id].name} fehlgeschlagen: ${meta.fehler}`);
    } finally {
      meta.geprueftAt = Date.now();
      metaSchreiben(id, meta);
      lauf.quelle = null;
      lauf.fortschritt = null;
    }
  }
  if (Object.keys(ergebnisse).length) letzterLauf = { at: new Date().toISOString(), manuell, von, ergebnisse };
  if (fehler.length) throw new Error(fehler.join(' · '));
}

// Vorhandene Dateien beim Start laden. Eine unlesbare Datei gilt als fehlend und wird
// beim nächsten Durchlauf neu geholt.
async function vorhandeneLaden() {
  const meta = metaLesen();
  for (const id of IDS) {
    try {
      daten[id] = QUELLEN[id].art === 'mmdb' ? await ladeMmdb(id, datei(id)) : await ladeIpsum(datei(id));
      if (id === 'geo') require('./audit').geoipFreigeben();
      if (id === 'ipsum') ipsumGeaendert();
    } catch (err) {
      daten[id] = null;
      if (err.code !== 'ENOENT') console.warn(`[Bedrohungsdaten] ${QUELLEN[id].name} nicht lesbar, wird neu geladen: ${fehlerText(err)}`);
      else if (meta[id]) metaSchreiben(id, { ...meta[id], version: null, etag: null });
    }
  }
}

// ── Abfragen ──────────────────────────────────────────────────────────────────
const normal = (ip) => String(ip ?? '').trim().replace(/^::ffff:(?=\d+\.\d+\.\d+\.\d+$)/i, '');

function nachschlagen(id, ip) {
  try { return daten[id]?.reader.get(normal(ip)) || null; }
  catch { return null; }   // keine gültige Adresse
}

/** Land und Stadt aus DB-IP. `undefined`, solange die Datenbank nicht geladen ist (→ Rückfall). */
function geo(ip) {
  if (!daten.geo) return undefined;
  const r = nachschlagen('geo', ip);
  if (!r) return null;
  const land = kurz(r.country?.iso_code, 2);
  return {
    country: land && /^[A-Z]{2}$/.test(land) ? land : null,
    city:    kurz(r.city?.names?.en) || kurz(r.city?.names?.de),
  };
}

/** Provider (ASN-Organisation) und AS-Nummer aus DB-IP, sonst null. */
function asn(ip) {
  const r = nachschlagen('asn', ip);
  if (!r || !Number.isInteger(r.autonomous_system_number)) return null;
  return { asn: r.autonomous_system_number, org: kurz(r.autonomous_system_organization) };
}

/** Auf wie vielen Blocklisten die Adresse laut IPsum steht (nur IPv4, sonst 0). */
function blocklisten(ip) {
  const l = daten.ipsum;
  const zahl = l && ipv4Zahl(normal(ip));
  if (zahl === null || zahl === undefined || !l) return 0;
  let lo = 0, hi = l.ips.length - 1;
  while (lo <= hi) {
    const mitte = (lo + hi) >>> 1;
    const v = l.ips[mitte];
    if (v === zahl) return l.treffer[mitte];
    if (v < zahl) lo = mitte + 1; else hi = mitte - 1;
  }
  return 0;
}

// ── IPsum für die automatische Sperre (utils/autoSperre.js) ───────────────────
const zahlZuIp = (n) => `${n >>> 24}.${(n >>> 16) & 255}.${(n >>> 8) & 255}.${n & 255}`;

/** Alle IPv4-Adressen, die auf mindestens `schwelle` Listen stehen. */
function ipsumListe(schwelle) {
  const l = daten.ipsum;
  if (!l) return [];
  const aus = [];
  for (let i = 0; i < l.ips.length; i++) if (l.treffer[i] >= schwelle) aus.push(zahlZuIp(l.ips[i]));
  return aus;
}

/** Anzahl Adressen ab 1, 2, … 10 Listen — für die Auswahl der Schwelle in der Oberfläche. */
function ipsumVerteilung() {
  const l = daten.ipsum;
  const n = Array(11).fill(0);
  if (!l) return null;
  for (let i = 0; i < l.treffer.length; i++) n[Math.min(l.treffer[i], 10)]++;
  const ab = {};
  let summe = 0;
  for (let s = 10; s >= 1; s--) { summe += n[s]; ab[s] = summe; }
  return ab;
}

const ipsumStand = () => daten.ipsum?.stand || null;

// Wer wissen will, wann eine neue IPsum-Liste geladen ist (Threat-Feed neu verteilen).
const ipsumBeobachter = [];
function beiIpsum(fn) { ipsumBeobachter.push(fn); }
function ipsumGeaendert() {
  for (const fn of ipsumBeobachter) { try { fn(); } catch (e) { console.warn('[Bedrohungsdaten]', e.message); } }
}

// ── Steuerung ─────────────────────────────────────────────────────────────────
function start() {
  if (gestartet) return;
  gestartet = true;
  bereit = vorhandeneLaden().catch(err => console.warn('[Bedrohungsdaten] Laden fehlgeschlagen:', err.message));
  if (DOWNLOADS_AUS) { console.log('[Bedrohungsdaten] Downloads abgeschaltet (THREAT_INTEL_DOWNLOADS=off)'); return; }
  const erster = setTimeout(() => tracker.wrap(() => durchlauf()), START_MS);
  erster.unref?.();
  const t = setInterval(() => tracker.wrap(() => durchlauf()), TAKT_MS);
  t.unref?.();
}

/** Manuell angestoßene Prüfung aller Quellen. Läuft im Hintergrund, die Antwort kommt sofort. */
function manuellStarten(von) {
  if (DOWNLOADS_AUS) return { deaktiviert: true };
  if (tracker.get().running) return { laeuft: true };
  const warten = letzterManuell + MANUELL_SPERRE_MS - Date.now();
  if (warten > 0) return { wartenSek: Math.ceil(warten / 1000) };
  letzterManuell = Date.now();
  tracker.wrap(() => durchlauf({ manuell: true, von: kurz(von, 64) }));
  return { gestartet: true };
}

function getStatus() {
  const meta = metaLesen();
  const t = tracker.get();
  const [aktuell, vormonat] = monate();
  const quellen = IDS.map((id) => {
    const q = QUELLEN[id];
    const m = meta[id] || {};
    const d = daten[id];
    const laedt = lauf.quelle === id;
    let veraltet = false;
    if (d && q.art === 'mmdb') veraltet = !!m.version && m.version < vormonat;
    if (d && q.art === 'ipsum') veraltet = !!d.stand && Date.now() - Date.parse(d.stand) > 3 * 24 * STUNDE;
    return {
      id, name: q.name, zweck: q.zweck, lizenz: q.lizenz, link: q.link,
      status: d ? 'aktiv' : DOWNLOADS_AUS ? 'aus' : m.fehler ? 'fehler' : 'fehlt',
      laedt,
      fortschritt: laedt ? lauf.fortschritt : null,
      version: m.version || (q.art === 'ipsum' ? d?.stand?.slice(0, 10) : d?.gebaut?.slice(0, 7)) || null,
      aktuellerMonat: q.art === 'mmdb' ? m.version === aktuell : undefined,
      aktualisiertAt: m.aktualisiertAt ? new Date(m.aktualisiertAt).toISOString() : null,
      geprueftAt:     m.geprueftAt ? new Date(m.geprueftAt).toISOString() : null,
      naechstePruefung: naechstePruefung(id, m),
      veraltet,
      groesse: d?.groesse ?? m.groesse ?? null,
      eintraege: q.art === 'ipsum' ? d?.eintraege ?? null : null,
      missbrauch: q.art === 'ipsum' ? d?.missbrauch ?? null : null,
      fehler: m.fehler || null,
    };
  });
  return {
    ...t,
    downloads: !DOWNLOADS_AUS,
    laeuft: t.running,
    geoRueckfall: !daten.geo,
    missbrauchAb: IPSUM_MISSBRAUCH,
    quellen,
    letzterLauf,
  };
}

module.exports = {
  start, manuellStarten, getStatus, geo, asn, blocklisten, IPSUM_MISSBRAUCH,
  ipsumListe, ipsumVerteilung, ipsumStand, beiIpsum,
};
