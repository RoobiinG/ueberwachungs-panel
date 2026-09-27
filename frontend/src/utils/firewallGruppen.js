// ─── Firewall-Regeln zu logischen Einheiten zusammenfassen ────────────────────
//
// Beispiel: „11434/tcp für alle gesperrt" + „11434/tcp von 1.2.3.4 erlaubt" ist in Wahrheit
// *eine* Aussage — „Ollama nur für 1.2.3.4". Gruppiert wird nach dem Schlüssel `gruppe`
// (Richtung|Proto|Port), den das Backend mitliefert (backend/src/utils/firewallGruppen.js).
//
// Zusätzlich die Reihenfolge prüfen: ufw, iptables und nftables werten innerhalb einer
// Kette die erste passende Regel. Steht eine Einzelregel hinter einer Pauschalregel mit
// gegenteiliger Aktion, greift sie nie. firewalld kennt keine Reihenfolge, wertet aber
// Sperren vor Freigaben aus.

const istErlaubt = (r) => r.action === 'allow' || String(r.action || '').toUpperCase().includes('ALLOW');
const istPauschal = (r) => !r.from || r.from === 'any';
const quelleText = (r) => r.from;

// Kette, innerhalb derer die Reihenfolge zählt. nft liefert die Kette im Roh-JSON; bei den
// übrigen Werkzeugen reicht die Richtung (INPUT bzw. Weiterleitung).
function kette(r, tool) {
  if (tool === 'nftables' && r.raw && r.raw.startsWith('{')) {
    try { const j = JSON.parse(r.raw); return `${j.family}/${j.table}/${j.chain}`; } catch { /* Richtung */ }
  }
  return r.direction || 'in';
}

function zusammenfassen(g, tool, standardAbgelehnt) {
  const pE = g.regeln.filter(r => istErlaubt(r) && istPauschal(r));
  const pG = g.regeln.filter(r => !istErlaubt(r) && istPauschal(r));
  const eE = g.regeln.filter(r => istErlaubt(r) && !istPauschal(r));
  const eG = g.regeln.filter(r => !istErlaubt(r) && !istPauschal(r));
  const n = (k) => (k === 1 ? '1 Adresse' : `${k} Adressen`);

  if (pE.length && pG.length) return { art: 'widerspruch', farbe: 'red', text: 'Widerspruch: für alle erlaubt und gesperrt' };
  if (pG.length && eE.length) return { art: 'eingeschraenkt', farbe: 'blue', text: `Nur für ${n(eE.length)} erlaubt` };
  if (pG.length) return { art: 'gesperrt', farbe: 'red', text: 'Für alle gesperrt' };
  if (pE.length && eG.length) return { art: 'offen_ausser', farbe: 'orange', text: `Offen, ${n(eG.length)} gesperrt` };
  if (pE.length) return { art: 'offen', farbe: 'green', text: 'Für alle erreichbar' };
  if (eE.length) {
    return standardAbgelehnt
      ? { art: 'eingeschraenkt', farbe: 'blue', text: `Nur für ${n(eE.length)} erlaubt (Standard: abgelehnt)` }
      : { art: 'nur_freigaben', farbe: 'orange', text: `Freigabe für ${n(eE.length)} — für alle anderen gilt die Standard-Richtlinie` };
  }
  return { art: 'einzelsperren', farbe: 'orange', text: `${n(eG.length)} gesperrt` };
}

function warnungen(g, tool) {
  const w = [];
  if (tool === 'firewalld') {
    const pG = g.regeln.some(r => !istErlaubt(r) && istPauschal(r));
    for (const r of g.regeln.filter(x => istErlaubt(x) && !istPauschal(x))) {
      if (pG) w.push({ regel: r.fingerprint, text: `Freigabe für ${quelleText(r)} greift nicht — firewalld wertet Sperren vor Freigaben aus.` });
    }
    return w;
  }
  if (!['ufw', 'iptables', 'nftables'].includes(tool)) return w;
  g.regeln.forEach((r, i) => {
    if (istPauschal(r)) return;
    const davor = g.regeln.slice(0, i).find(c => istPauschal(c) && istErlaubt(c) !== istErlaubt(r) && kette(c, tool) === kette(r, tool));
    if (!davor) return;
    w.push({
      regel: r.fingerprint,
      text: istErlaubt(r)
        ? `Freigabe für ${quelleText(r)} greift nie — die Sperre für alle steht davor.`
        : `Sperre für ${quelleText(r)} greift nie — die Freigabe für alle steht davor.`,
    });
  });
  return w;
}

const portSortierung = (p) => {
  if (!p || p === 'any') return -1;
  const n = parseInt(String(p), 10);
  return Number.isNaN(n) ? 1e6 : n;
};

/**
 * @param {Array} regeln  bereits per mergeFamilies zusammengefasste Regeln, in Tool-Reihenfolge
 * @param {string} tool   ufw | iptables | nftables | firewalld
 * @param {boolean} standardAbgelehnt  eingehende Standard-Richtlinie ist „abgelehnt"
 */
export function gruppiereRegeln(regeln, tool, standardAbgelehnt = false) {
  const map = new Map();
  regeln.forEach((r) => {
    const key = r.gruppe || `${r.direction || 'in'}|${r.proto || 'any'}|${r.port || 'any'}`;
    if (!map.has(key)) {
      const [richtung, proto, port] = key.split('|');
      map.set(key, { key, richtung, proto, port, portLabel: null, regeln: [] });
    }
    const g = map.get(key);
    g.regeln.push(r);
    if (!g.portLabel && r.portLabel) g.portLabel = r.portLabel;
  });
  return [...map.values()]
    .map(g => {
      const z = zusammenfassen(g, tool, standardAbgelehnt);
      const pauschalSperre = g.regeln.some(r => !istErlaubt(r) && istPauschal(r));
      return { ...g, ...z, warnungen: warnungen(g, tool), freigabeVorSperre: pauschalSperre && tool !== 'firewalld' };
    })
    .sort((a, b) => portSortierung(a.port) - portSortierung(b.port) || a.key.localeCompare(b.key));
}

export { istErlaubt };
