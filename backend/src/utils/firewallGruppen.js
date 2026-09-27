// ─── Fingerabdruck und Gruppe einer Firewall-Regel ────────────────────────────
//
// Regel-IDs taugen nicht als Schlüssel für Beschriftungen: UFW-Nummern und iptables-Zeilen
// rücken nach, sobald davor eine Regel gelöscht wird. Ein Label hängt deshalb am Inhalt der
// Regel, eine Portgruppe (alle Regeln zu Richtung + Protokoll + Port) an dessen Teil davon.
// Diese Datei ist die einzige Stelle, an der normalisiert wird — das Frontend bekommt die
// fertigen Schlüssel mit der Regelliste geliefert.

const norm = (v, leer = 'any') => {
  const s = String(v ?? '').replace(/\s*\(v6\)\s*/gi, ' ').trim().toLowerCase();
  if (!s || s === 'anywhere' || s === '0.0.0.0/0' || s === '::/0') return leer;
  // Port-Listen aus nft („80, 443") und Zusätze wie „Anywhere on eth0" ohne Leerzeichen.
  return s.replace(/\/32$/, '').replace(/\/128$/, '').replace(/\s*,\s*/g, ',').replace(/\s+/g, '_');
};

const richtung = (r) => (['in', 'out', 'fwd'].includes(r.direction) ? r.direction : 'in');

/** Richtung|Proto|Port — alle Regeln, die denselben Dienst betreffen. */
const gruppe = (r) => `${richtung(r)}|${norm(r.proto)}|${norm(r.port)}`;

/** Richtung|Proto|Port|Quelle|Ziel|Aktion — eine bestimmte Regel. */
const fingerprint = (r) =>
  `${gruppe(r)}|${norm(r.from)}|${norm(r.to, '')}|${r.action === 'allow' ? 'allow' : 'deny'}`;

// Was ein Fingerabdruck in der URL/im Body enthalten darf: Adressen, Ports, Bereiche,
// Dienstnamen (firewalld) — keine Leerzeichen, keine Steuerzeichen.
const FINGERPRINT_RE = /^(in|out|fwd)\|[\w.-]{1,20}\|[\w.:,-]{1,64}(\|[\w.:/,-]{0,64}\|[\w.:/,-]{0,64}\|(allow|deny))?$/;

module.exports = { fingerprint, gruppe, FINGERPRINT_RE };
