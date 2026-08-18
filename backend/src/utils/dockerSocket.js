// ─── Docker-Engine über den lokalen Socket ────────────────────────────────────
//
// Für Container auf dem Panel-Server selbst. Der Socket ist bereits eingebunden
// (siehe docker-compose.yml), gesprochen wird die Engine-API direkt über HTTP —
// Node kann das über `socketPath`, ein zusätzliches Paket wie `dockerode` braucht
// es dafür nicht.
//
// Genutzt wird das ausschließlich für die Container-Konsole und deren Vorlauf-Log.
// Die Container-Listen kommen weiterhin von Dockhand bzw. den Agenten.

const http = require('http');

const SOCKET = process.env.DOCKER_SOCKET || '/var/run/docker.sock';

// ── JSON-Aufruf gegen die Engine ─────────────────────────────────────────────
function api(method, pfad, body = null) {
  return new Promise((resolve, reject) => {
    const daten = body ? JSON.stringify(body) : null;
    const req = http.request({
      socketPath: SOCKET,
      path: pfad,
      method,
      timeout: 10_000,
      headers: {
        'Content-Type': 'application/json',
        ...(daten ? { 'Content-Length': Buffer.byteLength(daten) } : {}),
      },
    }, (res) => {
      const teile = [];
      res.on('data', c => teile.push(c));
      res.on('end', () => {
        const text = Buffer.concat(teile).toString('utf8');
        if (res.statusCode >= 400) {
          let grund = text.slice(0, 200);
          try { grund = JSON.parse(text).message || grund; } catch {}
          const err = new Error(grund);
          err.status = res.statusCode;
          return reject(err);
        }
        try { resolve(text ? JSON.parse(text) : {}); } catch { resolve({}); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('Zeitüberschreitung beim Docker-Socket')));
    req.on('error', reject);
    if (daten) req.write(daten);
    req.end();
  });
}

// ── Erreichbarkeit ───────────────────────────────────────────────────────────
async function verfuegbar() {
  try { await api('GET', '/_ping'); return true; } catch { return false; }
}

async function containerExistiert(id) {
  try { await api('GET', `/containers/${encodeURIComponent(id)}/json`); return true; }
  catch { return false; }
}

// ── Logs ─────────────────────────────────────────────────────────────────────
// Container ohne eigenes TTY liefern einen gemultiplexten Strom: je Abschnitt acht
// Kopf-Bytes (Strom-Art + Länge) vor den Nutzdaten. Container *mit* TTY liefern
// rohen Text — beide Formen werden hier auseinandergehalten.
function entmultiplexen(buf) {
  let out = '';
  let i = 0;
  while (i + 8 <= buf.length) {
    const art = buf[i];
    const laenge = buf.readUInt32BE(i + 4);
    // Gültiger Kopf? Strom-Art ist 0, 1 oder 2 und die Länge muss in den Puffer passen.
    if (art > 2 || buf[i + 1] !== 0 || buf[i + 2] !== 0 || buf[i + 3] !== 0 || i + 8 + laenge > buf.length) {
      return buf.toString('utf8');   // sieht nicht nach Kopf aus → roher TTY-Strom
    }
    out += buf.slice(i + 8, i + 8 + laenge).toString('utf8');
    i += 8 + laenge;
  }
  return out || buf.toString('utf8');
}

function logs(id, tail = 200) {
  return new Promise((resolve, reject) => {
    const n = Math.max(1, Math.min(5000, parseInt(tail, 10) || 200));
    const req = http.request({
      socketPath: SOCKET,
      path: `/containers/${encodeURIComponent(id)}/logs?stdout=1&stderr=1&timestamps=0&tail=${n}`,
      method: 'GET',
      timeout: 15_000,
    }, (res) => {
      const teile = [];
      res.on('data', c => teile.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(teile);
        if (res.statusCode >= 400) return reject(new Error(`Docker ${res.statusCode}: ${buf.toString('utf8').slice(0, 200)}`));
        resolve(entmultiplexen(buf));
      });
    });
    req.on('timeout', () => req.destroy(new Error('Zeitüberschreitung beim Abruf der Logs')));
    req.on('error', reject);
    req.end();
  });
}

// ── Konsole ──────────────────────────────────────────────────────────────────
// Zuerst wird eine Exec-Sitzung angelegt, dann der Strom übernommen. Mit `Tty:true`
// ist der Strom *nicht* gemultiplext und lässt sich unverändert an den WebSocket
// weiterreichen.
// Nacheinander mehrere Shells zu versuchen funktioniert hier *nicht*: Die Engine nimmt
// den exec-Aufruf an, ohne zu prüfen, ob die Datei existiert — der Fehler ("OCI runtime
// exec failed") erscheint erst im Datenstrom und damit lange nach jedem try/catch.
// Deshalb entscheidet der erste Versuch selbst, welche Shell er startet.
// Wichtig: erst prüfen, dann ersetzen. `exec bash || exec sh` funktioniert *nicht* —
// schlägt ein `exec` fehl, beendet sich die Shell sofort, und der zweite Teil kommt nie
// zum Zug. Der Datenstrom schließt sich dann wortlos.
const SHELL_VERSUCHE = [
  ['/bin/sh', '-c', 'if [ -x /bin/bash ]; then exec /bin/bash; else exec /bin/sh; fi'],
  ['/bin/ash'],
  ['/bin/busybox', 'sh'],
];

async function execAnlegen(containerId, cmd) {
  const { Id } = await api('POST', `/containers/${encodeURIComponent(containerId)}/exec`, {
    AttachStdin: true, AttachStdout: true, AttachStderr: true,
    Tty: true,
    Cmd: cmd,
    Env: ['TERM=xterm-256color'],
  });
  return Id;
}

function stromUebernehmen(execId) {
  return new Promise((resolve, reject) => {
    const daten = JSON.stringify({ Detach: false, Tty: true });
    const req = http.request({
      socketPath: SOCKET,
      path: `/exec/${execId}/start`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(daten),
        Connection: 'Upgrade',
        Upgrade: 'tcp',
      },
    });
    // Die Engine antwortet je nach Version mit 101 (Upgrade) oder 200 (Hijack).
    req.on('upgrade', (_res, socket) => resolve(socket));
    req.on('response', (res) => {
      if (res.statusCode === 200) return resolve(res.socket);
      reject(new Error(`Konsole konnte nicht gestartet werden (HTTP ${res.statusCode})`));
    });
    req.on('error', reject);
    req.write(daten);
    req.end();
  });
}

// Öffnet eine Shell im Container. Gibt den rohen Strom und die Exec-Kennung zurück,
// letztere wird für die Größenänderung gebraucht.
async function konsoleOeffnen(containerId) {
  let letzterFehler;
  for (const cmd of SHELL_VERSUCHE) {
    try {
      const execId = await execAnlegen(containerId, cmd);
      const strom  = await stromUebernehmen(execId);
      return { strom, execId, shell: cmd[0] };
    } catch (err) { letzterFehler = err; }
  }
  throw letzterFehler || new Error('Keine Shell im Container gefunden');
}

async function groesseAendern(execId, spalten, zeilen) {
  const w = Math.max(20, Math.min(500, parseInt(spalten, 10) || 80));
  const h = Math.max(5,  Math.min(200, parseInt(zeilen,  10) || 24));
  try { await api('POST', `/exec/${execId}/resize?h=${h}&w=${w}`); } catch { /* nicht kritisch */ }
}

module.exports = { verfuegbar, containerExistiert, logs, konsoleOeffnen, groesseAendern };
