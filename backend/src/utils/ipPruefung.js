// ─── Strenge Prüfung von IP-Adressen und Netzen (CIDR) ─────────────────────────
//
// Grundlage für dauerhafte Sperren: Was hier nicht durchkommt, erreicht nie den Agenten
// und damit nie nftables. Der Agent prüft dasselbe noch einmal selbst — diese Datei ist
// die Spiegelung von _parseCidr/_geschuetztGrund in agent/panel-agent.js. Wer hier etwas
// ändert, ändert es dort auch.
//
// Gerechnet wird mit BigInt-Intervallen [start, ende], damit sich auch Netze gegen
// Netze prüfen lassen (net.BlockList kann nur einzelne Adressen nachschlagen).

const net = require('net');

// Kleinste erlaubte Netze: ein /8 über das Panel zu sperren, wäre eher ein Tippfehler als Absicht.
const MIN_PRAEFIX = { 4: 16, 6: 32 };
const MAX_PRAEFIX = { 4: 32, 6: 128 };

class IpFehler extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const v4ZuZahl = (s) => s.split('.').reduce((n, o) => (n << 8n) + BigInt(Number(o)), 0n);

function v6ZuZahl(s) {
  let a = s.toLowerCase();
  // Eingebettete IPv4 am Ende (z. B. ::ffff:1.2.3.4) in zwei Hex-Gruppen umrechnen.
  const m = a.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/);
  if (m) {
    const v4 = v4ZuZahl(m[2]);
    a = `${m[1]}${(v4 >> 16n).toString(16)}:${(v4 & 0xffffn).toString(16)}`;
  }
  const [kopf, rumpf] = a.split('::');
  const k = kopf ? kopf.split(':') : [];
  const r = rumpf === undefined ? null : (rumpf ? rumpf.split(':') : []);
  const gruppen = r === null ? k : [...k, ...Array(8 - k.length - r.length).fill('0'), ...r];
  if (gruppen.length !== 8) throw new IpFehler(400, 'Ungültige IPv6-Adresse');
  return gruppen.reduce((n, g) => (n << 16n) + BigInt(parseInt(g || '0', 16)), 0n);
}

const zahlZuV4 = (n) => [24n, 16n, 8n, 0n].map(s => String((n >> s) & 0xffn)).join('.');

// Kanonische Kurzform nach RFC 5952: längste Folge (≥ 2) von Null-Gruppen wird zu „::".
function zahlZuV6(n) {
  const g = [];
  for (let i = 7; i >= 0; i--) g.push(Number((n >> BigInt(i * 16)) & 0xffffn));
  let best = -1, bestLen = 0;
  for (let i = 0; i < 8;) {
    if (g[i] !== 0) { i++; continue; }
    let j = i; while (j < 8 && g[j] === 0) j++;
    if (j - i > bestLen && j - i >= 2) { best = i; bestLen = j - i; }
    i = j;
  }
  const hex = g.map(x => x.toString(16));
  if (best < 0) return hex.join(':');
  return `${hex.slice(0, best).join(':')}::${hex.slice(best + bestLen).join(':')}`;
}

const maske = (fam, praefix) => {
  const bits = BigInt(MAX_PRAEFIX[fam]);
  return ((1n << bits) - 1n) ^ ((1n << (bits - BigInt(praefix))) - 1n);
};

/**
 * Adresse oder Netz streng einlesen. Wirft IpFehler(400) bei allem, was nicht eindeutig
 * eine einzelne Adresse oder ein sauber ausgerichtetes Netz ist.
 * @returns {{ family: 4|6, praefix: number, cidr: string, start: bigint, ende: bigint }}
 */
function parseCidr(eingabe, { minPraefix = MIN_PRAEFIX } = {}) {
  const s = String(eingabe ?? '').trim();
  if (!s || s.length > 49 || !/^[0-9a-fA-F.:]+(\/\d{1,3})?$/.test(s)) throw new IpFehler(400, 'Ungültige IP-Adresse oder ungültiges Netz');
  const [addr, pfx] = s.split('/');
  const fam = net.isIP(addr);
  if (!fam) throw new IpFehler(400, 'Ungültige IP-Adresse');
  if (fam === 4 && addr.split('.').some(o => o.length > 1 && o[0] === '0')) {
    throw new IpFehler(400, 'IPv4-Adressen bitte ohne führende Nullen angeben');
  }
  if (fam === 6 && /^::ffff:/i.test(addr)) throw new IpFehler(400, 'IPv4-gemappte Adresse bitte als IPv4 angeben');

  const max = MAX_PRAEFIX[fam], min = minPraefix[fam];
  const praefix = pfx === undefined ? max : Number(pfx);
  if (!Number.isInteger(praefix) || praefix < min || praefix > max) {
    throw new IpFehler(400, `Netzgröße /${pfx} ist nicht erlaubt (IPv${fam}: /${min} bis /${max})`);
  }
  const wert = fam === 4 ? v4ZuZahl(addr) : v6ZuZahl(addr);
  const m = maske(fam, praefix);
  const netz = wert & m;
  const text = (n) => (fam === 4 ? zahlZuV4(n) : zahlZuV6(n));
  if (netz !== wert) {
    throw new IpFehler(400, `${s} ist keine Netzadresse — gemeint ist vermutlich ${text(netz)}/${praefix}`);
  }
  const ende = netz | (((1n << BigInt(max)) - 1n) ^ m);
  return { family: fam, praefix, cidr: praefix === max ? text(netz) : `${text(netz)}/${praefix}`, start: netz, ende };
}

const ueberlappt = (a, b) => a.family === b.family && a.start <= b.ende && b.start <= a.ende;

// Adressbereiche, die nie gesperrt werden dürfen: Sperren dort treffen interne Netze,
// den Server selbst oder sind schlicht sinnlos (Dokumentations- und Reserve-Netze).
const GESCHUETZT = [
  ['0.0.0.0/8', 'reservierter Bereich'],
  ['10.0.0.0/8', 'privates Netz (RFC 1918)'],
  ['100.64.0.0/10', 'Carrier-NAT (RFC 6598)'],
  ['127.0.0.0/8', 'Loopback'],
  ['169.254.0.0/16', 'Link-Local'],
  ['172.16.0.0/12', 'privates Netz (RFC 1918)'],
  ['192.0.0.0/24', 'reservierter Bereich'],
  ['192.0.2.0/24', 'Dokumentations-Netz'],
  ['192.168.0.0/16', 'privates Netz (RFC 1918)'],
  ['198.18.0.0/15', 'Benchmark-Netz'],
  ['198.51.100.0/24', 'Dokumentations-Netz'],
  ['203.0.113.0/24', 'Dokumentations-Netz'],
  ['224.0.0.0/4', 'Multicast'],
  ['240.0.0.0/4', 'reservierter Bereich'],
  ['::/128', 'unspezifizierte Adresse'],
  ['::1/128', 'Loopback'],
  ['64:ff9b::/96', 'NAT64'],
  ['100::/64', 'Discard-Bereich'],
  ['2001:db8::/32', 'Dokumentations-Netz'],
  ['fc00::/7', 'privates Netz (ULA)'],
  ['fe80::/10', 'Link-Local'],
  ['ff00::/8', 'Multicast'],
].map(([cidr, grund]) => ({ ...parseCidr(cidr, { minPraefix: { 4: 0, 6: 0 } }), grund }));

/** Normalisiert eine Socket-/Header-Adresse (::ffff:1.2.3.4 → 1.2.3.4). */
const normIp = (ip) => String(ip ?? '').trim().replace(/^::ffff:(?=\d+\.\d+\.\d+\.\d+$)/i, '');

/**
 * Grund, warum dieser Eintrag nicht gesperrt werden darf — oder null.
 * @param {object} eintrag  Ergebnis von parseCidr
 * @param {Array<{ip: string, grund: string}>} zusatz  weitere geschützte Adressen
 */
function geschuetztGrund(eintrag, zusatz = []) {
  const fest = GESCHUETZT.find(g => ueberlappt(eintrag, g));
  if (fest) return `${eintrag.cidr} liegt in einem geschützten Bereich (${fest.grund})`;
  for (const z of zusatz) {
    const ip = normIp(z.ip);
    if (!net.isIP(ip)) continue;
    let p;
    try { p = parseCidr(ip); } catch { continue; }
    if (ueberlappt(eintrag, p)) return `${eintrag.cidr} enthält ${ip} (${z.grund})`;
  }
  return null;
}

module.exports = { parseCidr, ueberlappt, geschuetztGrund, normIp, IpFehler };
