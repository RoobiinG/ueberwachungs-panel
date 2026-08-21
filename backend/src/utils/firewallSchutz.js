// ─── Schutz davor, sich selbst auszusperren ───────────────────────────────────
//
// Eine Firewall einzuschalten ist der einzige Knopf im Panel, der einen Server in einem
// Zug unerreichbar machen kann — und zwar endgültig, weil danach weder SSH noch das Panel
// selbst noch antworten. Genau das droht in der häufigsten Konstellation:
//
//   • `ufw --force enable` überspringt bewusst die Rückfrage, mit der UFW sonst warnt,
//     dass die bestehende SSH-Verbindung gleich abreißt.
//   • Der iptables-Adapter fällt, wenn es keinen systemd-Dienst gibt (auf Debian mit
//     Docker der Normalfall), auf `-P INPUT DROP` zurück. Ohne vorherige Freigabe von
//     Port 22 ist der Server damit sofort weg.
//
// Deshalb wird vor dem Einschalten geprüft, ob die nötigen Zugänge überhaupt freigegeben
// sind. Fehlt einer, wird abgebrochen statt geschaltet. Wer es trotzdem will — etwa weil
// die Freigabe über eine Regelform erfolgt, die das Panel nicht ausliest — kann mit einer
// ausdrücklichen Bestätigung darüber hinweg.

const SSH_PORT = 22;

/** Deckt eine Regel den gesuchten Port ab? Berücksichtigt Bereiche wie „8000:8100". */
const decktAb = (regel, port) => {
  const roh = String(regel.port ?? '').trim();
  if (!roh || roh === 'any') return true;          // „alles erlaubt" deckt auch diesen Port
  if (roh.includes(':') || roh.includes('-')) {
    const [von, bis] = roh.split(/[:-]/).map(n => parseInt(n, 10));
    if (!isNaN(von) && !isNaN(bis)) return port >= von && port <= bis;
  }
  return parseInt(roh, 10) === port;
};

const istErlaubend = (regel) => {
  const a = String(regel.action ?? '').toLowerCase();
  return a === 'allow' || a === 'accept' || a === '';
};

/**
 * Prüft, ob nach dem Einschalten noch ein Weg auf den Server führt.
 *
 * @param {Array}  regeln  Regeln in der Form, die die Firewall-Routen liefern
 * @param {Array}  ports   Zusätzlich benötigte Ports, z. B. der des Agenten
 * @returns {{ sicher: boolean, fehlend: number[] }}
 */
function zugangGesichert(regeln, ports = []) {
  const liste = Array.isArray(regeln) ? regeln : [];
  const gebraucht = [SSH_PORT, ...ports.map(p => parseInt(p, 10)).filter(p => !isNaN(p))];
  const eindeutig = [...new Set(gebraucht)];

  const fehlend = eindeutig.filter(port =>
    !liste.some(r => istErlaubend(r) && decktAb(r, port))
  );
  return { sicher: fehlend.length === 0, fehlend };
}

/** Einheitliche Meldung, damit lokal und über den Agenten dasselbe steht. */
function warnung(fehlend) {
  const liste = fehlend.join(', ');
  return `Die Firewall wurde nicht eingeschaltet: Für ${fehlend.length === 1 ? 'Port' : 'die Ports'} `
    + `${liste} gibt es keine Freigabe. Beim Einschalten wäre dieser Server damit sofort nicht mehr `
    + `erreichbar — weder über SSH noch über das Panel. Lege zuerst eine Freigabe an. `
    + `Wenn der Zugang auf anderem Weg gesichert ist, lässt sich das Einschalten ausdrücklich erzwingen.`;
}

module.exports = { zugangGesichert, warnung, SSH_PORT };
