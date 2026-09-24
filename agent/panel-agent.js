#!/usr/bin/env node
/**
 * Überwachungs-Panel Agent
 * Installieren: curl -sL https://raw.githubusercontent.com/RoobiinG/ueberwachungs-panel/master/agent/install.sh | bash
 */
const http   = require('http');
const https  = require('https');
const os     = require('os');
const path   = require('path');
const crypto = require('crypto');
const { exec, execFile } = require('child_process');
const { promisify } = require('util');
const fs = require('fs');

const execAsync = promisify(exec);
// Für alles, wo Namen oder IDs aus der Anfrage in den Befehl wandern: keine Shell,
// sondern ein Argument-Array. Sonderzeichen in Volume-/Netzwerk-/Image-Namen können
// so nicht als Shell-Syntax gedeutet werden.
const execFileAsync = promisify(execFile);
const VERSION = '2.15.1';

// Ob die Container-Konsole angeboten werden kann. Steht erst nach dem Laden von
// ws/node-pty am Ende dieser Datei fest und wird über /ping und /version gemeldet,
// damit das Panel den Grund nennen kann, statt nur einen Verbindungsfehler zu zeigen.
let TERMINAL_BEREIT = false;

// Zustand des Nachrüstens: null (nichts läuft) | 'laeuft' | 'fertig' | 'fehlgeschlagen'
let TERMINAL_SETUP = { zustand: null, meldung: null, seit: null };
// Verhindert, dass ein zweiter /packages/update-Aufruf einen weiteren apt-get/dnf
// startet, während schon einer läuft und um dieselbe Paket-Sperre konkurriert.
let PAKET_UPDATE_LAEUFT = false;
const REPO_RAW = 'https://raw.githubusercontent.com/RoobiinG/ueberwachungs-panel/master/agent/panel-agent.js';
const PORT  = parseInt(process.env.PANEL_AGENT_PORT || '7331');

async function getSyslogs(since) {
  try {
    // Falls kein since angegeben, Default = letzte 1 Stunde (als Sekunden)
    const sinceTimestamp = since ? parseInt(since) : Math.floor(Date.now() / 1000) - 3600;
    const { stdout } = await execAsync(`journalctl --since "@${sinceTimestamp}" -o json --no-pager -n 1000`);
    const logs = [];
    stdout.split('\n').forEach(line => {
      if (!line.trim()) return;
      try {
        const obj = JSON.parse(line);
        let level = 'info';
        const prio = parseInt(obj.PRIORITY || 6);
        if (prio <= 3) level = 'error';
        else if (prio === 4) level = 'warn';

        logs.push({
          timestamp: parseInt(obj.__REALTIME_TIMESTAMP) / 1000, // ms
          source: obj.SYSLOG_IDENTIFIER || obj._COMM || 'syslog',
          level,
          message: obj.MESSAGE || ''
        });
      } catch (e) {}
    });
    return logs;
  } catch (err) {
    // Fallback: /var/log/syslog (sehr primitiv, ohne echtes 'since' - nur tail)
    try {
      const { stdout } = await execAsync('tail -n 200 /var/log/syslog');
      return stdout.split('\n').filter(l => l.trim()).map(line => {
        let level = 'info';
        if (line.match(/error|fail|crit|fatal/i)) level = 'error';
        else if (line.match(/warn/i)) level = 'warn';
        return { timestamp: Date.now(), source: 'syslog', level, message: line };
      });
    } catch (e) {
      return [];
    }
  }
}

const TOKEN = process.env.PANEL_AGENT_TOKEN || '';
const DIR   = __dirname;

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ─── Terminal-Module nachrüsten ───────────────────────────────────────────────
// Ohne `ws` und `node-pty` gibt es keine Container-Konsole. `node-pty` ist eine native
// Erweiterung und braucht zum Übersetzen einen Compiler. Beides wird hier bei Bedarf
// nachgeholt. Sämtliche Paket- und Programmnamen stehen fest im Code — es gelangt
// nichts aus einer Anfrage in einen dieser Befehle.
const TERMINAL_MODULE = ['ws', 'node-pty'];

const programmVorhanden = async (name) => {
  // execFile statt einer per String zusammengesetzten sh -c-Zeile — bislang war `name`
  // an jeder Aufrufstelle ein fest im Code stehender Programmname, aber diese Funktion
  // sollte für sich selbst schon sicher sein, falls sie später mit einem Wert aus einer
  // Anfrage aufgerufen wird. `command` ist ein Shell-Builtin (kein eigenes Programm),
  // deshalb `which`, das auf so gut wie jeder Distribution als echtes Programm existiert.
  try { await execFileAsync('which', [name]); return true; }
  catch { return false; }
};

async function terminalNachruesten() {
  if (TERMINAL_SETUP.zustand === 'laeuft') return TERMINAL_SETUP;
  TERMINAL_SETUP = { zustand: 'laeuft', meldung: 'Installation gestartet', seit: Date.now() };
  console.log('Rüste Terminal-Module nach (ws, node-pty) …');

  const schritte = [];
  try {
    // 1. Compiler-Werkzeuge — node-pty wird beim Installieren übersetzt.
    const compilerDa = await programmVorhanden('cc')
                    && await programmVorhanden('make')
                    && await programmVorhanden('python3');
    if (!compilerDa) {
      schritte.push('Build-Werkzeuge fehlten');
      if (await programmVorhanden('apt-get')) {
        await execFileAsync('apt-get', ['update'], { timeout: 300_000 });
        await execFileAsync('apt-get', ['install', '-y', 'build-essential', 'python3', 'make', 'g++'], { timeout: 900_000 });
      } else if (await programmVorhanden('dnf')) {
        await execFileAsync('dnf', ['install', '-y', 'gcc-c++', 'make', 'python3'], { timeout: 900_000 });
      } else if (await programmVorhanden('yum')) {
        await execFileAsync('yum', ['install', '-y', 'gcc-c++', 'make', 'python3'], { timeout: 900_000 });
      } else {
        throw new Error('Kein bekannter Paketmanager gefunden (apt-get, dnf oder yum)');
      }
      schritte.push('Build-Werkzeuge installiert');
    }

    // 2. npm braucht eine package.json im Agent-Verzeichnis.
    if (!fs.existsSync(path.join(DIR, 'package.json'))) {
      await execFileAsync('npm', ['init', '-y'], { cwd: DIR, timeout: 60_000 });
    }

    // 3. Die Module selbst.
    await execFileAsync('npm', ['install', '--no-fund', '--no-audit', '--save', ...TERMINAL_MODULE],
      { cwd: DIR, timeout: 900_000 });

    const alleDa = TERMINAL_MODULE.every(m => fs.existsSync(path.join(DIR, 'node_modules', m)));
    if (!alleDa) throw new Error('Module waren nach der Installation nicht auffindbar');
    schritte.push('ws und node-pty installiert');

    TERMINAL_SETUP = { zustand: 'fertig', meldung: schritte.join(', '), seit: Date.now() };
    console.log('Terminal-Module nachgerüstet — Neustart, damit die Konsole bereitsteht.');
    // Erst nach dem Neustart lädt der Agent die Module und bietet den WebSocket an.
    setTimeout(() => exec('systemctl restart panel-agent', () => {}), 1500);

  } catch (err) {
    const grund = (err.message || String(err)).slice(0, 300);
    TERMINAL_SETUP = { zustand: 'fehlgeschlagen', meldung: grund, seit: Date.now() };
    console.error('Nachrüsten der Terminal-Module fehlgeschlagen: ' + grund);
  }
  return TERMINAL_SETUP;
}

// ─── Datei-Download (HTTPS, folgt Weiterleitungen) ───────────────────────────

const ALLOWED_DOWNLOAD_HOSTS = ['raw.githubusercontent.com', 'github.com'];

function isSafeRedirectUrl(location) {
  try {
    const u = new URL(location);
    if (u.protocol !== 'https:') return false;
    return ALLOWED_DOWNLOAD_HOSTS.some(h => u.hostname === h || u.hostname.endsWith('.' + h));
  } catch { return false; }
}

function downloadFile(url, dest, redirects = 5) {
  return new Promise((resolve, reject) => {
    if (redirects <= 0) return reject(new Error('Zu viele Weiterleitungen'));
    const file = fs.createWriteStream(dest);
    const req = https.get(url, { headers: { 'User-Agent': 'panel-agent-updater' } }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        file.destroy(); fs.unlink(dest, () => {});
        const location = res.headers.location || '';
        if (!isSafeRedirectUrl(location))
          return reject(new Error(`Unsichere Redirect-URL blockiert: ${location}`));
        return downloadFile(location, dest, redirects - 1).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        file.destroy(); fs.unlink(dest, () => {});
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      res.pipe(file);
      file.on('finish', () => file.close(resolve));
      file.on('error', e => { fs.unlink(dest, () => {}); reject(e); });
    });
    req.on('error', e => { try { file.destroy(); fs.unlink(dest, () => {}); } catch {} reject(e); });
    req.setTimeout(20000, () => { req.destroy(); reject(new Error('Download-Timeout')); });
  });
}

// ─── System Stats ────────────────────────────────────────────────────────────

async function cpuUsage() {
  const read = () => fs.readFileSync('/proc/stat', 'utf8')
    .split('\n')[0].replace(/^cpu\s+/, '').split(/\s+/).map(Number);
  const s1 = read();
  await sleep(250);
  const s2 = read();
  const idle = v => (v[3] || 0) + (v[4] || 0);
  const total = v => v.reduce((a, b) => a + b, 0);
  const dt = total(s2) - total(s1);
  return dt ? Math.round(100 * (1 - (idle(s2) - idle(s1)) / dt)) : 0;
}

async function getDisk() {
  try {
    const { stdout } = await execAsync(
      "df -B1 --output=source,size,used,pcent,target 2>/dev/null | tail -n +2",
      { timeout: 5000 }
    );
    return stdout.trim().split('\n').map(line => {
      const [fs, size, used, pcent, mount] = line.trim().split(/\s+/);
      return { fs, size: +size, used: +used, usedPercent: parseFloat(pcent), mount };
    }).filter(d => {
      if (!d.mount || !d.fs) return false;
      // Virtuelle Mount-Points ausschließen (exakt oder als Präfix mit Slash)
      const skipMounts = ['/sys', '/proc', '/dev', '/run'];
      if (skipMounts.some(p => d.mount === p || d.mount.startsWith(p + '/'))) return false;
      // Nur echte Block-Geräte — kein tmpfs, overlay, squashfs, devtmpfs, udev etc.
      if (!d.fs.startsWith('/dev/')) return false;
      return true;
    }).sort((a, b) => {
      // Wurzel-Partition immer an erster Stelle
      if (a.mount === '/') return -1;
      if (b.mount === '/') return 1;
      return a.mount.localeCompare(b.mount);
    });
  } catch { return []; }
}

function getOsInfo() {
  const info = { distro: os.type(), release: os.release(), arch: os.arch(), hostname: os.hostname(), uptime: os.uptime() };
  try {
    const content = fs.readFileSync('/etc/os-release', 'utf8');
    const pretty = (content.match(/^PRETTY_NAME="(.+)"$/m) || [])[1];
    if (pretty) { info.distro = pretty.split(' ')[0]; info.release = pretty; }
  } catch {}
  return info;
}

// ─── Netzwerk-Cache (Hintergrund-Messung alle 5 s) ───────────────────────────

let _netCache = [];

function readProcNet() {
  const lines = fs.readFileSync('/proc/net/dev', 'utf8').split('\n').slice(2);
  const out = {};
  for (const line of lines) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 10) continue;
    const iface = parts[0].replace(':', '');
    out[iface] = { rx: parseInt(parts[1]) || 0, tx: parseInt(parts[9]) || 0 };
  }
  return out;
}

async function updateNetCache() {
  try {
    const s1 = readProcNet();
    await sleep(1000);
    const s2 = readProcNet();
    _netCache = Object.entries(s2)
      .filter(([iface]) => iface !== 'lo')
      .map(([iface, v]) => ({
        iface,
        rxSec:    Math.max(0, v.rx - (s1[iface]?.rx || 0)),
        txSec:    Math.max(0, v.tx - (s1[iface]?.tx || 0)),
        rxBytes:  v.rx,
        txBytes:  v.tx,
      }));
  } catch { _netCache = []; }
}

// Sofort starten, dann alle 5 Sekunden wiederholen
updateNetCache();
setInterval(updateNetCache, 5000);

// ─────────────────────────────────────────────────────────────────────────────

async function getStats() {
  const [cpu, disk] = await Promise.all([cpuUsage(), getDisk()]);
  const total = os.totalmem(), free = os.freemem(), used = total - free;
  return {
    cpu: { usage: cpu, cores: os.cpus().length },
    memory: { total, used, free, usedPercent: Math.round(used / total * 100) },
    disk,
    os: getOsInfo(),
    network: _netCache,
  };
}

async function getServices() {
  try {
    const { stdout } = await execAsync(
      'systemctl list-units --type=service --no-pager --plain --no-legend',
      { timeout: 10000 }
    );
    return stdout.trim().split('\n').map(line => {
      const p = line.trim().split(/\s+/);
      return { name: p[0], load: p[1], active: p[2], sub: p[3], description: p.slice(4).join(' ') };
    }).filter(s => s.name);
  } catch { return []; }
}

async function serviceAction(name, action) {
  const valid = ['start', 'stop', 'restart', 'reload', 'enable', 'disable'];
  if (!valid.includes(action)) throw new Error('Ungültige Aktion');
  if (!/^[a-zA-Z0-9@._:-]+$/.test(name)) throw new Error('Ungültiger Service-Name');
  const { stdout } = await execAsync(`systemctl ${action} ${name}`, { timeout: 10000 });
  return stdout;
}

// ─── Prozess-Manager ──────────────────────────────────────────────────────────
async function getProcesses() {
  try {
    const { stdout } = await execAsync(
      'ps -eo pid,user,%cpu,%mem,command --sort=-%cpu --no-headers | head -n 25',
      { timeout: 8000 }
    );
    return stdout
      .trim()
      .split('\n')
      .map(line => {
        const parts = line.trim().split(/\s+/);
        if (parts.length < 5) return null;
        const pid = parseInt(parts[0], 10);
        const user = parts[1];
        const cpu = parseFloat(parts[2]) || 0;
        const memory = parseFloat(parts[3]) || 0;
        const command = parts.slice(4).join(' ');
        return { pid, user, cpu, memory, command };
      })
      .filter(p => p && !isNaN(p.pid));
  } catch {
    return [];
  }
}

async function killProcess(pid, signal = 'SIGTERM') {
  const targetPid = parseInt(pid, 10);
  if (isNaN(targetPid) || targetPid <= 0) {
    throw new Error('Ungültige PID');
  }
  // Schutz vor Beenden kritischer Prozesse
  if (targetPid === 1 || targetPid === process.pid || targetPid === process.ppid) {
    throw new Error('Kritische System- oder Agenten-PID kann nicht beendet werden (Sicherheits-Schutz)');
  }
  const validSignals = ['SIGTERM', 'SIGKILL', '15', '9'];
  const sig = validSignals.includes(String(signal).toUpperCase())
    ? (String(signal).toUpperCase() === 'SIGKILL' || String(signal) === '9' ? '-9' : '-15')
    : '-15';
  await execAsync(`kill ${sig} ${targetPid}`, { timeout: 5000 });
  return `Prozess ${targetPid} beendet (${sig === '-9' ? 'SIGKILL' : 'SIGTERM'})`;
}


// ─── Firewall (Multi-Tool: UFW, iptables, nftables, firewalld) ───────────────
//
// ACHTUNG — diese Sektion ist die Spiegelung von backend/src/utils/firewallAdapters.js.
// Der Agent ist bewusst eine einzelne Datei (install.sh lädt sie per curl, das Panel
// pusht sie HMAC-signiert), deshalb liegt die Logik hier ein zweites Mal statt in einem
// gemeinsamen Modul. Wer dort etwas ändert, ändert es auch hier — genau aus dem
// Auseinanderlaufen der beiden Fassungen stammten die Fehler bis v5.4.2.0.

const _IPV4_RE   = /^(\d{1,3}\.){3}\d{1,3}(\/\d{1,2})?$/;
// Doppelpunkt ist Pflicht — sonst gilt jede reine Hex-Folge („abc") als IPv6-Adresse.
const _IPV6_RE   = /^(?=.*:)[0-9a-fA-F:]+(%[a-z0-9]+)?(\/\d{1,3})?$/;

// Einzelport oder Bereich „von:bis"; „99999" galt früher als gültig und lief erst im
// Firewall-Tool auf einen Fehler.
const _validPort = (p) => {
  const s = String(p ?? '').trim();
  const m = s.match(/^(\d{1,5})(?::(\d{1,5}))?$/);
  const lo = m ? +m[1] : 0;
  const hi = m && m[2] != null ? +m[2] : lo;
  if (!m || lo < 1 || hi > 65535 || lo > hi) throw new Error('Ungültiger Port');
  return s;
};

const _validProto = (p) => ['tcp','udp'].includes(p) ? p : null;

// Eine angegebene Quelle muss gültig sein. Vorher wurde eine unbrauchbare Eingabe still
// zu `null` — die Regel galt dann für *alle* Quellen statt für die eine gewünschte.
const _validFrom = (f) => {
  const s = String(f ?? '').trim();
  if (!s) return null;
  if (!_IPV4_RE.test(s) && !_IPV6_RE.test(s)) throw new Error(`Ungültige Quell-Adresse: ${s}`);
  return s;
};

const _isIPv6 = (addr) => addr.includes(':');

// Erkennt aktive Firewall-Software. Wir geben das am höchsten abstrahierte Tool
// zurück, das installiert ist, auch wenn es gerade deaktiviert ist.
async function detectAgentFirewall() {
  try { const { stdout } = await execAsync('which ufw 2>/dev/null', { timeout: 3000 });
    if (stdout.trim()) { try { const { stdout: s } = await execAsync('ufw status 2>/dev/null', { timeout: 3000 }); return { tool: 'ufw', active: /Status:\s*active/i.test(s), rawOutput: s }; } catch { return { tool: 'ufw', active: false, rawOutput: '' }; } }
  } catch {}
  try { const { stdout } = await execAsync('which firewall-cmd 2>/dev/null', { timeout: 3000 });
    if (stdout.trim()) { try { const { stdout: s } = await execAsync('firewall-cmd --state 2>/dev/null', { timeout: 3000 }); return { tool: 'firewalld', active: s.trim() === 'running', rawOutput: s }; } catch { return { tool: 'firewalld', active: false, rawOutput: '' }; } }
  } catch {}
  try { const { stdout } = await execAsync('which nft 2>/dev/null', { timeout: 3000 });
    if (stdout.trim()) { try { const { stdout: s } = await execAsync('nft -j list ruleset 2>/dev/null', { timeout: 3000 }); return { tool: 'nftables', active: true, rawOutput: s }; } catch { return { tool: 'nftables', active: true, rawOutput: '' }; } }
  } catch {}
  try { const { stdout } = await execAsync('which iptables 2>/dev/null', { timeout: 3000 });
    if (stdout.trim()) { try { const { stdout: s } = await execAsync('iptables -S INPUT 2>/dev/null', { timeout: 3000 }); return { tool: 'iptables', active: true, rawOutput: s }; } catch { return { tool: 'iptables', active: true, rawOutput: '' }; } }
  } catch {}
  return { tool: 'none', active: false, rawOutput: '' };
}

// Filtert die Firewall wirklich? — Spiegelung von filterZustand() in
// backend/src/utils/firewallAdapters.js.
async function agentFilterZustand(tool, rawOutput = null) {
  const offen  = (grund) => ({ filtert: false, grund });
  const dicht  = (grund) => ({ filtert: true,  grund });
  const lauf   = (cmd) => execAsync(cmd, { timeout: 5000 });

  try {
    if (tool === 'ufw') {
      const stdout = rawOutput !== null ? rawOutput : (await lauf('ufw status 2>/dev/null')).stdout;
      return /Status:\s*active/i.test(stdout)
        ? dicht('UFW ist eingeschaltet und filtert eingehende Verbindungen.')
        : offen('UFW ist installiert, aber ausgeschaltet — es wird nichts gefiltert.');
    }
    if (tool === 'firewalld') {
      const stdout = rawOutput !== null ? rawOutput : (await lauf('firewall-cmd --state 2>/dev/null')).stdout;
      return stdout.trim() === 'running'
        ? dicht('firewalld läuft und filtert eingehende Verbindungen.')
        : offen('firewalld ist installiert, läuft aber nicht — es wird nichts gefiltert.');
    }
    if (tool === 'iptables') {
      const stdout = rawOutput !== null ? rawOutput : (await lauf('iptables -S INPUT 2>/dev/null')).stdout;
      if (/^-P INPUT (DROP|REJECT)/m.test(stdout)) {
        return dicht('Alles ist gesperrt, was keine ausdrückliche Freigabe hat (Standard-Regel DROP).');
      }
      const sperrend = stdout.split('\n').filter(z => /^-A INPUT/.test(z)).some(z => /-j\s+(DROP|REJECT)/.test(z));
      return sperrend
        ? dicht('Die Standard-Regel lässt zwar alles durch, einzelne Regeln sperren aber gezielt.')
        : offen('Die INPUT-Kette lässt alles durch: Standard-Regel ACCEPT und keine sperrende Regel.');
    }
    if (tool === 'nftables') {
      const stdout = rawOutput !== null ? rawOutput : (await lauf('nft -j list ruleset 2>/dev/null')).stdout;
      let daten = {};
      try { daten = JSON.parse(stdout || '{}'); } catch { return offen('Der nftables-Regelsatz war nicht lesbar.'); }
      const eintraege = Array.isArray(daten.nftables) ? daten.nftables : [];
      const eingang = eintraege.map(e => e.chain).filter(c => c && c.hook === 'input');
      if (!eingang.length) {
        return offen('Es gibt keine Kette für eingehende Verbindungen — alle Verbindungen werden zugelassen.');
      }
      const gesperrt = eingang.filter(c => ['drop', 'reject'].includes(String(c.policy || '').toLowerCase()));
      if (gesperrt.length) {
        return dicht('Alles ist gesperrt, was keine ausdrückliche Freigabe hat (Kette "' + gesperrt[0].name + '" mit Standard-Regel ' + gesperrt[0].policy + ').');
      }
      const namen = new Set(eingang.map(c => c.name));
      const sperrend = eintraege.map(e => e.rule).filter(r => r && namen.has(r.chain))
        .some(r => (r.expr || []).some(a => a.drop !== undefined || a.reject !== undefined));
      return sperrend
        ? dicht('Die Standard-Regel lässt zwar alles durch, einzelne Regeln sperren aber gezielt.')
        : offen('Die Kette für eingehende Verbindungen lässt alles durch: Standard-Regel accept und keine sperrende Regel.');
    }
  } catch (err) {
    return offen('Der Zustand ließ sich nicht ermitteln: ' + String(err.message || err).slice(0, 120));
  }
  return offen('Kein unterstütztes Firewall-Werkzeug gefunden.');
}

// Firewall-Status (einheitlich)
async function getFirewallStatus() {
  const { tool, active } = await detectAgentFirewall();
  let rawOutput = '';
  try {
    if (tool === 'ufw')      { const { stdout } = await execAsync('ufw status verbose', { timeout: 5000 }); rawOutput = stdout; }
    else if (tool === 'firewalld') { const { stdout } = await execAsync('firewall-cmd --list-all 2>/dev/null', { timeout: 5000 }); rawOutput = stdout; }
    else if (tool === 'nftables') { const { stdout } = await execAsync('nft list ruleset 2>/dev/null', { timeout: 5000 }); rawOutput = stdout; }
    else if (tool === 'iptables') { const { stdout } = await execAsync('iptables -L INPUT -n --line-numbers 2>/dev/null', { timeout: 5000 }); rawOutput = stdout; }
  } catch (e) { rawOutput = e.message; }
  return { tool, active, rawOutput, status: rawOutput };
}

// Eine Zeile aus `ufw status numbered` zerlegen. Versteht auch Weiterleitungsregeln
// (ALLOW FWD), wie ufw-docker sie für veröffentlichte Container-Ports anlegt: dort steht
// im Ziel-Feld zusätzlich die Container-IP ("172.20.0.2 10080/tcp"), und die Richtung ist
// FWD statt IN. Die alte Fassung las daraus "172" als Port und hängte den Kommentartext
// an die Quelle. Rückgabe zusätzlich mit `to` (Ziel) und `direction` (in|out|fwd) —
// bestehende Felder bleiben unverändert.
function _parseUfwRuleLine(line) {
  const m = line.match(/^\[\s*(\d+)\]\s+(.*)$/);
  if (!m) return null;
  const id = m[1];
  let rest = m[2];
  // Kommentar (" # …") abtrennen, sonst landet er in der Quelle.
  const hash = rest.indexOf('#');
  if (hash >= 0) rest = rest.slice(0, hash);
  const cols = rest.trim().split(/\s{2,}/);
  if (cols.length < 2) return { id, port: '?', proto: 'any', action: '?', from: 'any', to: null, direction: 'in', raw: line.trim() };
  // "(v6)"-Zusätze entfernen; die Adressfamilie fasst das Panel ohnehin zusammen.
  const stripV6 = (s) => s.replace(/\s*\(v6\)\s*/i, ' ').trim();
  const toCol   = stripV6(cols[0]);
  const actCol  = (cols[1] || '').toUpperCase();
  const fromCol = stripV6(cols[2] || '');
  const action    = actCol.includes('ALLOW') ? 'allow' : 'deny';
  const direction = actCol.includes('FWD') ? 'fwd' : actCol.includes('OUT') ? 'out' : 'in';
  // Ziel-Feld: bei Weiterleitung "<Ziel-IP> <port>/<proto>", sonst nur "<port>/<proto>".
  const toks    = toCol.split(/\s+/).filter(Boolean);
  const portTok = toks[toks.length - 1] || '';
  const dest    = toks.length > 1 ? toks.slice(0, -1).join(' ') : null;
  let port = portTok, proto = 'any';
  const pm = portTok.match(/^(\d[\d:]*)(?:\/(tcp|udp))?$/i);
  if (pm) { port = pm[1]; proto = pm[2] ? pm[2].toLowerCase() : 'any'; }
  else if (/^anywhere$/i.test(portTok)) { port = 'any'; }
  const from = (/^anywhere$/i.test(fromCol) || fromCol === '') ? 'any' : fromCol;
  return { id, port, proto, action, from, to: dest, direction, raw: line.trim() };
}

// Regeln abrufen (einheitliches Format)
async function getFirewallRules() {
  const { tool } = await detectAgentFirewall();
  const rules = [];
  try {
    if (tool === 'ufw') {
      const { stdout } = await execAsync('ufw status numbered', { timeout: 5000 });
      return stdout.split('\n').filter(l => /^\[\s*\d+\]/.test(l)).map(_parseUfwRuleLine).filter(Boolean);
    } else if (tool === 'firewalld') {
      const { stdout: p } = await execAsync('firewall-cmd --list-ports 2>/dev/null', { timeout: 5000 });
      const { stdout: s } = await execAsync('firewall-cmd --list-services 2>/dev/null', { timeout: 5000 });
      p.trim().split(/\s+/).filter(Boolean).forEach(pp => { const [port,proto] = pp.split('/'); rules.push({ id: pp, port, proto: proto||'tcp', action: 'allow', from: 'any', raw: pp }); });
      s.trim().split(/\s+/).filter(Boolean).forEach(svc => rules.push({ id: `svc:${svc}`, port: svc, proto: 'service', action: 'allow', from: 'any', raw: svc }));
      // Rich Rules — hier liegt alles mit Quell-Einschränkung und jede echte Sperre.
      // Fehlten in der Liste bislang komplett.
      (await _richRules()).forEach((line, i) => rules.push({
        id:     `rich:${i}`,
        port:   line.match(/port port="([^"]+)"/)?.[1]?.replace('-', ':') || 'any',
        proto:  line.match(/protocol="([^"]+)"/)?.[1] || 'any',
        action: /\baccept\b/.test(line) ? 'allow' : 'deny',
        from:   line.match(/source address="([^"]+)"/)?.[1] || 'any',
        raw:    line,
      }));
      return rules;
    } else if (tool === 'nftables') {
      try {
        const { stdout } = await execAsync('nft -j list ruleset 2>/dev/null', { timeout: 5000 });
        const items = JSON.parse(stdout)?.nftables || [];

        // Nur Ketten, die eingehenden Verkehr filtern. Auf einem Docker-Host kamen sonst
        // rund 50 Einträge zurück: NAT-Weiterleitungen, FORWARD, raw und alle
        // DOCKER-*-Ketten — auf einem echten Server nachgemessen.
        const inputChains = new Set();
        for (const item of items) {
          const c = item.chain;
          if (c?.hook === 'input') inputChains.add(`${c.family}/${c.table}/${c.name}`);
        }

        for (const item of items) {
          if (!item.rule) continue;
          const r = item.rule; const expr = r.expr || [];
          if (!inputChains.has(`${r.family}/${r.table}/${r.chain}`)) continue;

          const verdict = expr.find(e => e.accept !== undefined || e.drop !== undefined || e.reject !== undefined);
          const action = verdict ? (verdict.accept !== undefined ? 'allow' : 'deny') : 'unknown';
          if (action === 'unknown') continue;   // Jump-/Counter-Regeln überspringen

          let port = 'any', proto = 'any', from = 'any';
          for (const e of expr) {
            const left = e.match?.left, right = e.match?.right;
            if (left?.payload?.field === 'dport') {
              port = right?.set ? right.set.map(String).join(', ')
                   : right?.range ? `${right.range[0]}:${right.range[1]}`
                   : String(right ?? 'any');
              // Bei „tcp dport 80" steht das Protokoll im selben payload-Objekt.
              if (left.payload.protocol) proto = String(left.payload.protocol);
            }
            if (left?.meta?.key === 'l4proto') {
              const v = right;
              proto = v === 6 ? 'tcp' : v === 17 ? 'udp' : typeof v === 'string' ? v : proto;
            }
            if (left?.payload?.field === 'saddr') {
              from = right?.prefix ? `${right.prefix.addr}/${right.prefix.len}` : String(right ?? 'any');
            }
          }
          rules.push({ id: String(r.handle ?? ''), port, proto, action, from, raw: JSON.stringify(r) });
        }
      } catch {
        const { stdout } = await execAsync('nft list ruleset 2>/dev/null', { timeout: 5000 });
        for (const line of stdout.split('\n')) { const m = line.match(/(\w+)\s+dport\s+(\S+)\s+(accept|drop).*#\s*handle\s+(\d+)/i); if (m) rules.push({ id: m[4], port: m[2], proto: m[1].toLowerCase(), action: m[3] === 'accept' ? 'allow' : 'deny', from: 'any', raw: line.trim() }); }
      }
      return rules;
    } else if (tool === 'iptables') {
      const { stdout } = await execAsync('iptables -L INPUT -n --line-numbers 2>/dev/null', { timeout: 5000 });
      for (const line of stdout.split('\n').slice(2)) {
        const m = line.match(/^(\d+)\s+(ACCEPT|DROP|REJECT)\s+(\w+)\s+--\s+(\S+)\s+\S+(?:.*dpt:(\d+)(?::(\d+))?)?/i);
        if (m) rules.push({ id: m[1], port: m[6] ? `${m[5]}:${m[6]}` : (m[5]||'any'), proto: m[3].toLowerCase()==='all'?'any':m[3].toLowerCase(), action: m[2].toLowerCase()==='accept'?'allow':'deny', from: m[4]==='0.0.0.0/0'?'any':m[4], raw: line.trim() });
      }
      return rules;
    }
  } catch {}
  return rules;
}

// ─── Docker ───────────────────────────────────────────────────────────────────

async function getDockerContainers() {
  try {
    const { stdout } = await execAsync("docker ps -a --format '{{json .}}'", { timeout: 10000 });
    return stdout.trim().split('\n').filter(Boolean).map(line => {
      const c = JSON.parse(line);
      return {
        id: c.ID,
        name: c.Names,
        image: c.Image,
        state: c.State,
        status: c.Status,
        ports: c.Ports ? c.Ports.split(',').map(p => p.trim()) : []
      };
    });
  } catch { throw new Error('Docker nicht erreichbar oder nicht installiert'); }
}

async function getDockerImages() {
  try {
    const { stdout } = await execAsync("docker images --format '{{json .}}'", { timeout: 10000 });
    return stdout.trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
  } catch { return []; }
}

async function getDockerStats(id) {
  try {
    const { stdout } = await execFileAsync('docker', ['stats', id, '--no-stream', '--format', '{{json .}}'], { timeout: 10000 });
    if (!stdout.trim()) throw new Error('404');
    const s = JSON.parse(stdout.trim().split('\n')[0]);
    const parseMem = (str) => {
      if (!str) return 0;
      const v = parseFloat(str);
      if (str.includes('GiB') || str.includes('GB')) return v * 1024 * 1024 * 1024;
      if (str.includes('MiB') || str.includes('MB')) return v * 1024 * 1024;
      if (str.includes('KiB') || str.includes('kB') || str.includes('KB')) return v * 1024;
      return v;
    };
    const memParts = (s.MemUsage || '0/0').split('/');
    const netParts = (s.NetIO || '0/0').split('/');
    return {
      cpuPercent: parseFloat(s.CPUPerc) || 0,
      memUsage: parseMem(memParts[0]),
      memLimit: parseMem(memParts[1]),
      netRx: parseMem(netParts[0]),
      netTx: parseMem(netParts[1])
    };
  } catch { throw new Error('Ressource nicht gefunden'); }
}

async function getDockerLogs(id, tail) {
  try {
    // Both stdout and stderr
    const { stdout, stderr } = await execFileAsync('docker', ['logs', '--tail', String(tail), id], { timeout: 10000 });
    return stdout + stderr;
  } catch { throw new Error('Ressource nicht gefunden'); }
}

async function dockerAction(id, action) {
  try {
    const valid = ['start', 'stop', 'restart', 'pause', 'unpause', 'kill'];
    if (!valid.includes(action)) throw new Error('Ungültige Aktion');
    await execFileAsync('docker', [action, id], { timeout: 30000 });
    return { success: true };
  } catch (e) { throw new Error(e.message); }
}

async function getDockerStacks() {
  try {
    const { stdout } = await execAsync("docker compose ls -a --format json", { timeout: 10000 });
    return JSON.parse(stdout.trim() || '[]');
  } catch { return []; }
}

async function dockerStackAction(id, action) {
  try {
    const stacks = await getDockerStacks();
    const stack = stacks.find(s => s.Name === id);
    if (!stack || !stack.ConfigFiles) throw new Error('Stack nicht gefunden');
    const path = stack.ConfigFiles;
    const valid = ['up', 'down', 'pull', 'restart'];
    if (!valid.includes(action)) throw new Error('Ungültige Aktion');
    
    const args = { up: ['up', '-d'], down: ['down'], pull: ['pull'], restart: ['restart'] }[action];
    await execFileAsync('docker', ['compose', '-f', path, ...args], { timeout: 60000 });
    return { success: true };
  } catch (e) { throw new Error(e.message); }
}

async function deployDockerStack(id, res) {
  try {
    const stacks = await getDockerStacks();
    const stack = stacks.find(s => s.Name === id);
    if (!stack || !stack.ConfigFiles) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Stack nicht gefunden\n');
      return;
    }
    const path = stack.ConfigFiles;
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Transfer-Encoding': 'chunked' });
    res.write(`[Live-Deploy] Starte Deployment für Stack "${id}"...\n`);
    
    const { spawn } = require('child_process');
    const child = spawn('docker', ['compose', '-f', path, 'up', '-d', '--build', '--remove-orphans']);
    
    child.stdout.on('data', d => res.write(d));
    child.stderr.on('data', d => res.write(d));
    
    child.on('close', code => {
      if (code === 0) res.write(`\n[Live-Deploy] Deployment erfolgreich abgeschlossen.\n`);
      else res.write(`\n[Live-Deploy] Deployment mit Fehlercode ${code} beendet.\n`);
      res.end();
    });
    child.on('error', err => {
      res.write(`\n[Live-Deploy] Prozess-Fehler: ${err.message}\n`);
      res.end();
    });
  } catch (err) {
    if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(`[Live-Deploy] Interner Fehler: ${err.message}\n`);
  }
}

async function getDockerStackFile(id) {
  try {
    const stacks = await getDockerStacks();
    const stack = stacks.find(s => s.Name === id);
    if (!stack || !stack.ConfigFiles) throw new Error('Stack nicht gefunden');
    const content = fs.readFileSync(stack.ConfigFiles, 'utf8');
    return { content, path: stack.ConfigFiles };
  } catch (e) { throw new Error(e.message); }
}

async function writeDockerStackFile(id, content) {
  try {
    const stacks = await getDockerStacks();
    const stack = stacks.find(s => s.Name === id);
    if (!stack || !stack.ConfigFiles) throw new Error('Stack nicht gefunden');
    fs.writeFileSync(stack.ConfigFiles, content, 'utf8');
    return { success: true };
  } catch (e) { throw new Error(e.message); }
}

async function getDockerVolumes() {
  try {
    const { stdout } = await execAsync("docker volume ls --format '{{json .}}'", { timeout: 10000 });
    return stdout.trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
  } catch { return []; }
}

async function getDockerNetworks() {
  try {
    const { stdout } = await execAsync("docker network ls --format '{{json .}}'", { timeout: 10000 });
    return stdout.trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
  } catch { return []; }
}

// Rich Rule für firewalld — nur damit lassen sich Quell-Einschränkungen und echte
// Sperren abbilden. Ohne Shell braucht die Regel keine Anführungszeichen.
function _richRule(from, port, proto, verdict) {
  const portSpec = port.replace(':', '-');   // firewalld schreibt Bereiche mit Bindestrich
  const family   = from ? ` family="${_isIPv6(from) ? 'ipv6' : 'ipv4'}"` : '';
  const source   = from ? ` source address="${from}"` : '';
  return `rule${family}${source} port port="${portSpec}" protocol="${proto}" ${verdict}`;
}

async function _richRules() {
  try {
    const { stdout } = await execAsync('firewall-cmd --permanent --list-rich-rules 2>/dev/null', { timeout: 5000 });
    return stdout.split('\n').map(l => l.trim()).filter(Boolean);
  } catch { return []; }
}

async function _ensureNftChain() {
  try { await execAsync('nft add table inet filter 2>/dev/null'); } catch {}
  try { await execAsync("nft add chain inet filter input '{ type filter hook input priority 0; }' 2>/dev/null"); } catch {}
}

// Firewall-Regel hinzufügen (action: 'allow' | 'deny')
// Die Quelle wurde früher nur bei UFW-allow und iptables-allow beachtet und sonst
// stillschweigend verworfen — die Regel galt dann für alle Absender. Sämtliche Befehle
// laufen jetzt über execFile mit Argument-Array statt über die Shell.
async function firewallAllow(port, proto, from, action, route = false) {
  const { tool } = await detectAgentFirewall();
  const p   = _validPort(port);
  const pr  = _validProto(proto);
  const fr  = _validFrom(from);
  const opt = { timeout: 10000 };

  if (tool === 'ufw') {
    let args;
    if (route) {
      // Weiterleitungsregel (FWD) — für veröffentlichte Docker-Container-Ports, analog zu
      // `ufw route allow`. Ohne diesen Zweig würde das Bearbeiten einer Container-Regel sie
      // in eine wirkungslose INPUT-Regel verwandeln (Docker umgeht die INPUT-Kette).
      args = ['route', action, ...(pr ? ['proto', pr] : []), ...(fr ? ['from', fr] : []), 'to', 'any', 'port', p];
    } else {
      args = fr
        ? [action, 'from', fr, 'to', 'any', 'port', p, ...(pr ? ['proto', pr] : [])]
        : [action, pr ? `${p}/${pr}` : p];
    }
    await execFileAsync('ufw', args, opt);

  } else if (tool === 'firewalld') {
    if (action === 'allow' && !fr) {
      await execFileAsync('firewall-cmd', ['--permanent', `--add-port=${p}/${pr || 'tcp'}`], opt);
    } else {
      const verdict = action === 'allow' ? 'accept' : 'reject';
      await execFileAsync('firewall-cmd', ['--permanent', `--add-rich-rule=${_richRule(fr, p, pr || 'tcp', verdict)}`], opt);
    }
    await execFileAsync('firewall-cmd', ['--reload'], opt);

  } else if (tool === 'nftables') {
    await _ensureNftChain();
    const saddr   = fr ? [_isIPv6(fr) ? 'ip6' : 'ip', 'saddr', fr] : [];
    const dport   = p.includes(':') ? `{ ${p.replace(':', '-')} }` : p;
    const verdict = action === 'allow' ? 'accept' : 'drop';
    await execFileAsync('nft', ['add', 'rule', 'inet', 'filter', 'input', ...saddr, pr || 'tcp', 'dport', dport, verdict], opt);

  } else if (tool === 'iptables') {
    // Nur die IPv4-Tabelle wird verwaltet; eine IPv6-Quelle bräuchte ip6tables und
    // landete in einer Tabelle, die das Panel nicht anzeigt.
    if (fr && _isIPv6(fr)) throw new Error('IPv6-Quellen werden mit iptables nicht unterstützt — dafür wäre ip6tables nötig.');
    const src = fr ? ['-s', fr] : [];
    await execFileAsync('iptables', ['-I', 'INPUT', '-p', pr || 'tcp', ...src, '--dport', p, '-j', action === 'allow' ? 'ACCEPT' : 'DROP'], opt);
    try { await execAsync('sh -c "iptables-save > /etc/iptables/rules.v4 2>/dev/null || true"'); } catch {}

  } else {
    throw new Error('Kein unterstütztes Firewall-Tool gefunden');
  }
}

// ID ist je nach Tool eine Nummer, ein nft-Handle, "PORT/PROTO", "svc:NAME" oder
// "rich:INDEX". Die firewalld-Varianten wanderten früher ungeprüft in einen
// Shell-Befehl.
async function firewallDeleteRule(id) {
  const { tool } = await detectAgentFirewall();
  const s   = String(id);
  const opt = { timeout: 10000 };

  if (tool === 'ufw') {
    if (!/^\d+$/.test(s)) throw new Error('Ungültige Regel-Nummer');
    await execFileAsync('ufw', ['--force', 'delete', s], opt);

  } else if (tool === 'firewalld') {
    if (/^rich:\d{1,4}$/.test(s)) {
      const target = (await _richRules())[+s.slice(5)];
      if (!target) throw new Error('Regel nicht gefunden — die Liste hat sich zwischenzeitlich geändert. Bitte neu laden.');
      await execFileAsync('firewall-cmd', ['--permanent', `--remove-rich-rule=${target}`], opt);
    } else if (s.startsWith('svc:')) {
      const svc = s.slice(4);
      if (!/^[\w.-]{1,64}$/.test(svc)) throw new Error('Ungültiger Dienst-Name');
      await execFileAsync('firewall-cmd', ['--permanent', `--remove-service=${svc}`], opt);
    } else {
      const [pRaw, prRaw] = s.split('/');
      const p  = _validPort(pRaw);
      const pr = _validProto(prRaw) || 'tcp';
      await execFileAsync('firewall-cmd', ['--permanent', `--remove-port=${p}/${pr}`], opt);
    }
    await execFileAsync('firewall-cmd', ['--reload'], opt);

  } else if (tool === 'nftables') {
    if (!/^\d+$/.test(s)) throw new Error('Ungültiger Handle');
    await execFileAsync('nft', ['delete', 'rule', 'inet', 'filter', 'input', 'handle', s], opt);

  } else if (tool === 'iptables') {
    if (!/^\d+$/.test(s)) throw new Error('Ungültige Regel-Nummer');
    await execFileAsync('iptables', ['-D', 'INPUT', s], opt);
    try { await execAsync('sh -c "iptables-save > /etc/iptables/rules.v4 2>/dev/null || true"'); } catch {}

  } else {
    throw new Error('Kein unterstütztes Firewall-Tool gefunden');
  }
}

// ─── Netzwerk ─────────────────────────────────────────────────────────────────

function getNetworkInterfaces() {
  const result = [];
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    for (const addr of (addrs || [])) {
      if (!addr.internal) result.push({
        iface: name, ifaceName: name,
        ip4: addr.family === 'IPv4' ? addr.address : '',
        ip6: addr.family === 'IPv6' ? addr.address : '',
        mac: addr.mac || '', type: addr.family, internal: false,
      });
    }
  }
  return result;
}

// Offene Ports auslesen (Modul 13)
async function getOpenPorts() {
  try {
    const { stdout } = await execAsync('ss -tuln');
    const lines = stdout.split('\n').slice(1);
    const ports = new Set();
    for (const line of lines) {
      if (!line.trim()) continue;
      const parts = line.trim().split(/\s+/);
      const localAddrStr = parts.find(p => p.includes(':') && !p.startsWith('::1') && !p.startsWith('127.'));
      if (localAddrStr) {
        const portMatch = localAddrStr.match(/:(\d+)$/);
        if (portMatch) ports.add(parseInt(portMatch[1], 10));
      }
    }
    return Array.from(ports).sort((a, b) => a - b);
  } catch (err) {
    return [];
  }
}

async function getSshSessions() {
  const sessions = [];
  try {
    let sshPort = 22;
    try {
      if (fs.existsSync('/etc/ssh/sshd_config')) {
        const c = fs.readFileSync('/etc/ssh/sshd_config', 'utf8');
        const m = c.match(/^Port\s+(\d+)/m);
        if (m) sshPort = parseInt(m[1], 10) || 22;
      }
    } catch {}

    const { stdout: ssOut } = await execAsync(`ss -tn state established sport = :${sshPort} 2>/dev/null || true`, { timeout: 3000 });
    const ssIps = new Set();
    ssOut.split('\n').slice(1).forEach(line => {
      if (!line.trim()) return;
      const parts = line.trim().split(/\s+/);
      if (parts.length >= 4) {
        const peer = parts[3];
        const match = peer.match(/^(.+):\d+$/);
        if (match) ssIps.add(match[1]);
      }
    });

    const { stdout: wOut } = await execAsync('w -h 2>/dev/null || who 2>/dev/null || true', { timeout: 3000 });
    const loggedIn = [];
    wOut.split('\n').forEach(line => {
      if (!line.trim()) return;
      const parts = line.trim().split(/\s+/);
      if (parts.length >= 3) {
        const user = parts[0];
        const tty = parts[1];
        const from = parts[2].replace(/[()]/g, '');
        loggedIn.push({ user, tty, from });
      }
    });

    for (const ip of ssIps) {
      const matchLogin = loggedIn.find(l => l.from === ip);
      sessions.push({
        ip,
        user: matchLogin?.user || 'ssh-session',
        terminal: matchLogin?.tty || null
      });
    }

    for (const l of loggedIn) {
      if (l.from && !sessions.some(s => s.ip === l.from) && !l.from.startsWith(':')) {
        sessions.push({
          ip: l.from,
          user: l.user,
          terminal: l.tty
        });
      }
    }
  } catch {}
  return sessions;
}

// Netzwerk-Traffic — Live-Messung (für /network/stats, 1s Messfenster)
async function getNetworkStats() {
  try {
    const s1 = readProcNet();
    await sleep(1000);
    const s2 = readProcNet();
    return Object.entries(s2)
      .filter(([iface]) => iface !== 'lo')
      .map(([iface, v]) => ({
        iface,
        rx_sec:   Math.max(0, v.rx - (s1[iface]?.rx || 0)),
        tx_sec:   Math.max(0, v.tx - (s1[iface]?.tx || 0)),
        rx_bytes: v.rx,
        tx_bytes: v.tx,
      }));
  } catch { return []; }
}

function getPublicIp() {
  return new Promise((resolve) => {
    const req = https.get('https://api.ipify.org?format=json',
      { headers: { 'User-Agent': 'panel-agent' } },
      (res) => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => { try { resolve({ ip: JSON.parse(data).ip }); } catch { resolve({ ip: null }); } });
      }
    );
    req.on('error', () => resolve({ ip: null }));
    req.setTimeout(8000, () => { req.destroy(); resolve({ ip: null }); });
  });
}

// ─── Cron ─────────────────────────────────────────────────────────────────────

function getCronUsers() {
  try {
    const passwd = fs.readFileSync('/etc/passwd', 'utf8');
    return passwd.split('\n').filter(Boolean).map(line => {
      const parts = line.split(':');
      return { user: parts[0], uid: parseInt(parts[2], 10) };
    }).filter(u => !isNaN(u.uid) && (u.uid >= 1000 || u.user === 'root')).map(u => u.user);
  } catch {
    return ['root'];
  }
}

async function getCronJobs(user) {
  if (!/^[a-z_][a-z0-9_-]*[$]?$/.test(user)) throw new Error('Ungültiger Benutzername');
  try {
    const { stdout } = await execAsync(`crontab -u ${user} -l`, { timeout: 5000 });
    const lines = stdout.split('\n');
    const jobs = [];
    lines.forEach((line, index) => {
      if (!line.trim() || line.trim().startsWith('#')) return; // skip comments and empty lines
      const parts = line.trim().split(/\s+/);
      if (parts.length >= 6 || (parts.length >= 2 && parts[0].startsWith('@'))) {
        let schedule = '';
        let command = '';
        if (parts[0].startsWith('@')) {
           schedule = parts[0];
           command = parts.slice(1).join(' ');
        } else {
           schedule = parts.slice(0, 5).join(' ');
           command = parts.slice(5).join(' ');
        }
        jobs.push({ index, schedule, command, raw: line });
      } else {
        jobs.push({ index, schedule: '', command: line, raw: line });
      }
    });
    return jobs;
  } catch (e) {
    if (e.message.includes('no crontab for')) return [];
    throw new Error('Fehler beim Abrufen der Cron-Jobs: ' + e.message);
  }
}

async function addCronJob(user, schedule, command) {
  if (!/^[a-z_][a-z0-9_-]*[$]?$/.test(user)) throw new Error('Ungültiger Benutzername');
  if (!schedule || !command) throw new Error('Zeitplan und Befehl sind erforderlich');
  // Ohne diese Prüfung schmuggelt ein command/schedule mit eingebettetem \n eine
  // zweite, unsichtbare Crontab-Zeile ein — der Aufruf fügt scheinbar nur den einen
  // sichtbaren Job hinzu, tatsächlich landet ein zweiter, unauditierter Job daneben.
  if (/[\r\n]/.test(schedule) || /[\r\n]/.test(command)) throw new Error('Zeilenumbrüche sind nicht erlaubt');
  try {
    let crontab = '';
    try {
      const { stdout } = await execAsync(`crontab -u ${user} -l`, { timeout: 5000 });
      crontab = stdout;
    } catch (e) {
      if (!e.message.includes('no crontab for')) throw e;
    }
    const newLine = `${schedule} ${command}\n`;
    const newCrontab = crontab.endsWith('\n') || crontab === '' ? crontab + newLine : crontab + '\n' + newLine;
    
    const child = require('child_process').spawn('crontab', ['-u', user, '-']);
    child.stdin.write(newCrontab);
    child.stdin.end();
    await new Promise((resolve, reject) => {
      child.on('close', code => {
        if (code === 0) resolve();
        else reject(new Error(`crontab beendet mit Code ${code}`));
      });
    });
    return { success: true };
  } catch (e) {
    throw new Error('Fehler beim Hinzufügen des Cron-Jobs: ' + e.message);
  }
}

async function deleteCronJob(user, index) {
  if (!/^[a-z_][a-z0-9_-]*[$]?$/.test(user)) throw new Error('Ungültiger Benutzername');
  const targetIndex = parseInt(index, 10);
  try {
    const { stdout } = await execAsync(`crontab -u ${user} -l`, { timeout: 5000 });
    const lines = stdout.split('\n');
    if (targetIndex < 0 || targetIndex >= lines.length) throw new Error('Ungültiger Index');
    
    lines.splice(targetIndex, 1);
    const newCrontab = lines.join('\n') + (lines.length > 0 && lines[lines.length-1] !== '' ? '\n' : '');
    
    const child = require('child_process').spawn('crontab', ['-u', user, '-']);
    child.stdin.write(newCrontab);
    child.stdin.end();
    await new Promise((resolve, reject) => {
      child.on('close', code => {
        if (code === 0) resolve();
        else reject(new Error(`crontab beendet mit Code ${code}`));
      });
    });
    return { success: true };
  } catch (e) {
    throw new Error('Fehler beim Löschen des Cron-Jobs: ' + e.message);
  }
}

// ─── SSH & Sicherheit ─────────────────────────────────────────────────────────

async function getSshKeys() {
  const keys = [];
  try {
    // 1. root-Keys
    if (fs.existsSync('/root/.ssh/authorized_keys')) {
      const content = fs.readFileSync('/root/.ssh/authorized_keys', 'utf8');
      content.split('\n').forEach(line => {
        const l = line.trim();
        if (l && !l.startsWith('#')) {
          const parts = l.split(' ');
          if (parts.length >= 2) {
             const keyData = Buffer.from(parts[1], 'base64');
             const fingerprint = crypto.createHash('sha256').update(keyData).digest('base64').replace(/=$/, '');
             keys.push({ user: 'root', type: parts[0], key: parts[1], comment: parts.slice(2).join(' '), fingerprint: 'SHA256:' + fingerprint, raw: l });
          }
        }
      });
    }
    // 2. User-Keys (/home/*/.ssh/authorized_keys)
    const users = getCronUsers().filter(u => u !== 'root'); // borrow getCronUsers since it reads /etc/passwd users >=1000
    for (const u of users) {
       const keyPath = `/home/${u}/.ssh/authorized_keys`;
       if (fs.existsSync(keyPath)) {
          const content = fs.readFileSync(keyPath, 'utf8');
          content.split('\n').forEach(line => {
            const l = line.trim();
            if (l && !l.startsWith('#')) {
              const parts = l.split(' ');
              if (parts.length >= 2) {
                 const keyData = Buffer.from(parts[1], 'base64');
                 const fingerprint = crypto.createHash('sha256').update(keyData).digest('base64').replace(/=$/, '');
                 keys.push({ user: u, type: parts[0], key: parts[1], comment: parts.slice(2).join(' '), fingerprint: 'SHA256:' + fingerprint, raw: l });
              }
            }
          });
       }
    }
  } catch (e) {
    // Ignorieren, falls nicht lesbar
  }
  return keys;
}

async function addSshKey(user, keyLine) {
  if (!user || typeof user !== 'string' || !/^[a-z_][a-z0-9_-]*[$]?$/.test(user)) {
    throw new Error('Ungültiger Benutzername');
  }
  const cleanLine = (keyLine || '').trim();
  if (!cleanLine || !/^(ssh-(ed25519|rsa|dss)|ecdsa-sha2-[a-z0-9-]+)\s+[A-Za-z0-9+/=]+(\s+.*)?$/.test(cleanLine)) {
    throw new Error('Ungültiges SSH-Public-Key Format');
  }
  const sshDir = user === 'root' ? '/root/.ssh' : `/home/${user}/.ssh`;
  const keyPath = path.join(sshDir, 'authorized_keys');
  if (!fs.existsSync(sshDir)) {
    fs.mkdirSync(sshDir, { mode: 0o700, recursive: true });
  }
  let existing = '';
  if (fs.existsSync(keyPath)) {
    existing = fs.readFileSync(keyPath, 'utf8');
  }
  const keyParts = cleanLine.split(' ');
  const keyBody = keyParts[1];
  if (existing.includes(keyBody)) {
    return { success: true, message: 'Schlüssel ist bereits vorhanden' };
  }
  const updated = existing.trim() ? existing.trim() + '\n' + cleanLine + '\n' : cleanLine + '\n';
  fs.writeFileSync(keyPath, updated, { mode: 0o600, encoding: 'utf8' });
  return { success: true, message: 'Schlüssel erfolgreich hinterlegt' };
}

async function removeSshKey(identifier) {
  let removed = 0;
  try {
    const paths = ['/root/.ssh/authorized_keys'];
    const users = getCronUsers().filter(u => u !== 'root');
    for (const u of users) paths.push(`/home/${u}/.ssh/authorized_keys`);
    
    for (const p of paths) {
      if (!fs.existsSync(p)) continue;
      const content = fs.readFileSync(p, 'utf8');
      const lines = content.split('\n');
      const newLines = [];
      let changed = false;
      
      for (const line of lines) {
         const l = line.trim();
         if (!l || l.startsWith('#')) {
           newLines.push(line);
           continue;
         }
         const parts = l.split(' ');
         if (parts.length >= 2) {
           const keyData = Buffer.from(parts[1], 'base64');
           const fingerprint = 'SHA256:' + crypto.createHash('sha256').update(keyData).digest('base64').replace(/=$/, '');

           // Nur nach Fingerprint löschen (das Panel schickt ohnehin immer den
           // Fingerprint, nie einen Kommentar). Kommentare sind Freitext und oft
           // nicht eindeutig (z.B. mehrere Keys mit demselben "deploy@ci") — ein
           // Vergleich darauf könnte einen falschen, fremden Key mitlöschen.
           if (fingerprint === identifier) {
             changed = true;
             removed++;
             continue; // Skip this line (remove)
           }
         }
         newLines.push(line);
      }
      
      if (changed) {
        fs.writeFileSync(p, newLines.join('\n') + (newLines.length > 0 && newLines[newLines.length-1] !== '' ? '\n' : ''), 'utf8');
      }
    }
  } catch (e) {
    throw new Error('Fehler beim Entfernen des Schlüssels: ' + e.message);
  }
  return { success: true, removed };
}

async function getSshConfig() {
  const config = {
    PermitRootLogin: 'yes', // Default Annahme falls nicht gefunden (Worst case)
    PasswordAuthentication: 'yes',
    PubkeyAuthentication: 'yes',
    Port: '22',
    fail2ban: { installed: false, active: false, jails: [] },
    firewall: { tool: 'none', active: false },
    listeningPorts: []
  };
  try {
    const { stdout: sshdOut } = await execAsync('sshd -T 2>/dev/null', { timeout: 4000 }).catch(() => ({ stdout: '' }));
    if (sshdOut) {
      sshdOut.split('\n').forEach(line => {
        const l = line.trim();
        if (!l) return;
        const parts = l.split(/\s+/);
        const k = parts[0].toLowerCase();
        if (k === 'permitrootlogin') config.PermitRootLogin = parts[1];
        if (k === 'passwordauthentication') config.PasswordAuthentication = parts[1];
        if (k === 'pubkeyauthentication') config.PubkeyAuthentication = parts[1];
        if (k === 'port') config.Port = parts[1];
      });
    } else if (fs.existsSync('/etc/ssh/sshd_config')) {
      const content = fs.readFileSync('/etc/ssh/sshd_config', 'utf8');
      content.split('\n').forEach(line => {
        const l = line.trim();
        if (!l || l.startsWith('#')) return;
        const parts = l.split(/\s+/);
        if (parts[0] === 'PermitRootLogin') config.PermitRootLogin = parts[1];
        if (parts[0] === 'PasswordAuthentication') config.PasswordAuthentication = parts[1];
        if (parts[0] === 'PubkeyAuthentication') config.PubkeyAuthentication = parts[1];
        if (parts[0] === 'Port') config.Port = parts[1];
      });
    }
  } catch (e) {}

  try {
    const { stdout: f2bActive } = await execAsync('systemctl is-active fail2ban 2>/dev/null', { timeout: 2500 }).catch(() => ({ stdout: '' }));
    if (f2bActive.trim() === 'active') {
      config.fail2ban.installed = true;
      config.fail2ban.active = true;
      const { stdout: f2bStatus } = await execAsync('fail2ban-client status 2>/dev/null', { timeout: 2500 }).catch(() => ({ stdout: '' }));
      const jailMatch = f2bStatus.match(/Jail list:\s*(.+)/);
      if (jailMatch) {
        config.fail2ban.jails = jailMatch[1].split(',').map(s => s.trim()).filter(Boolean);
      }
    } else {
      const hasF2b = await programmVorhanden('fail2ban-client');
      config.fail2ban.installed = !!hasF2b;
      config.fail2ban.active = false;
    }
  } catch {}

  // Das Frontend (Sicherheits-Audit) liest die flachen Felder fail2banInstalled/
  // Active/Jails. Bisher gab es nur die verschachtelte Form `fail2ban.{…}`, weshalb
  // fail2ban dort IMMER als „nicht installiert" galt und pauschal −15 im Score kostete
  // (aus 90 wurde 75), obwohl der Dienst lief. Beide Formen bereitstellen.
  config.fail2banInstalled = config.fail2ban.installed;
  config.fail2banActive    = config.fail2ban.active;
  config.fail2banJails     = config.fail2ban.jails;

  try {
    const fw = await detectAgentFirewall();
    config.firewall.tool = fw.tool;
    if (fw.tool !== 'none') {
      const st = await agentFilterZustand(fw.tool);
      config.firewall.active = !!st.filtert;
    }
  } catch {}

  try {
    const { stdout: ssOut } = await execAsync('ss -tulnp 2>/dev/null', { timeout: 4000 }).catch(() => ({ stdout: '' }));
    const lines = ssOut.split('\n').slice(1);
    const seen = new Set();
    const ports = [];
    for (const line of lines) {
      if (!line.trim()) continue;
      const parts = line.trim().split(/\s+/);
      const proto = parts[0]?.toLowerCase()?.includes('udp') ? 'udp' : 'tcp';
      const local = parts.find((p, idx) => idx >= 3 && p.includes(':'));
      if (!local) continue;
      const portMatch = local.match(/:(\d+)$/);
      if (!portMatch) continue;
      const portNum = parseInt(portMatch[1], 10);
      const isPublic = !local.startsWith('127.') && !local.startsWith('::1') && (local.startsWith('0.0.0.0') || local.startsWith('[::]') || local.startsWith('*'));
      
      let procName = null;
      const procMatch = line.match(/users:\(\("([^"]+)"/);
      if (procMatch) procName = procMatch[1];

      const key = `${proto}:${portNum}`;
      if (!seen.has(key)) {
        seen.add(key);
        ports.push({
          port: portNum,
          proto,
          isPublic,
          local,
          process: procName || 'Unbekannt'
        });
      }
    }
    config.listeningPorts = ports.sort((a, b) => a.port - b.port);
  } catch {}

  return config;
}

// ─── HTTP Handler ─────────────────────────────────────────────────────────────
// ── Modul 7: Festplatten-Gesundheit & System-Aufräumen ───────────────────────

async function getSmartData() {
  const disks = [];
  try {
    const { stdout: scanOut } = await execAsync('smartctl --scan', { timeout: 8000 }).catch(() => ({ stdout: '' }));
    const lines = scanOut.trim().split('\n');
    for (const line of lines) {
      if (!line) continue;
      const match = line.match(/^(\/dev\/\S+)/);
      if (!match) continue;
      const dev = match[1];
      
      try {
        const { stdout: smartOut } = await execAsync(`smartctl -j -a ${dev}`, { timeout: 8000 });
        const data = JSON.parse(smartOut);
        
        let passed = data.smart_status?.passed;
        let temp = data.temperature?.current || null;
        let wearout = null;
        let pOH = data.power_on_time?.hours || null;
        
        // NVMe (Percentage Used)
        if (data.nvme_smart_health_information_log) {
          const used = data.nvme_smart_health_information_log.percentage_used;
          if (used !== undefined) wearout = used;
        }
        
        // SSD (Wear Leveling Count etc.)
        if (data.ata_smart_attributes?.table) {
          const wearAttr = data.ata_smart_attributes.table.find(a => 
            a.name.toLowerCase().includes('wear_leveling') || 
            a.name.toLowerCase().includes('media_wearout_indicator')
          );
          if (wearAttr) wearout = 100 - wearAttr.value; // Value ist oft remaining health
        }
        
        disks.push({
          device: dev,
          model: data.model_name || data.device?.name || 'Unbekannt',
          serial: data.serial_number || 'Unbekannt',
          passed,
          temperature: temp,
          wearout,
          powerOnHours: pOH,
          isVirtual: false
        });
      } catch (err) {
        // smartctl fails on virtual disks or if smart not supported
      }
    }
  } catch (e) {}

  // Fallback & Ergänzung für KVM / V-Server & Block-Devices (lsblk + df)
  try {
    const [{ stdout: lsblkOut }, { stdout: dfOut }] = await Promise.all([
      execAsync('lsblk -J -b -o NAME,SIZE,TYPE,MOUNTPOINT,FSTYPE,MODEL,ROTA,RO 2>/dev/null', { timeout: 8000 }).catch(() => ({ stdout: '' })),
      execAsync('df -kP 2>/dev/null', { timeout: 8000 }).catch(() => ({ stdout: '' }))
    ]);

    const dfMap = {};
    if (dfOut) {
      dfOut.trim().split('\n').slice(1).forEach(l => {
        const parts = l.trim().split(/\s+/);
        if (parts.length >= 6) {
          const mount = parts[5];
          const dev = parts[0];
          const totalKb = parseInt(parts[1], 10) || 0;
          const usedKb = parseInt(parts[2], 10) || 0;
          const availKb = parseInt(parts[3], 10) || 0;
          const cap = parts[4];
          const info = {
            totalBytes: totalKb * 1024,
            usedBytes: usedKb * 1024,
            availBytes: availKb * 1024,
            usedPercent: parseInt(cap.replace('%', ''), 10) || 0,
            mountpoint: mount
          };
          dfMap[mount] = info;
          dfMap[dev] = info;
        }
      });
    }

    if (lsblkOut) {
      const parsed = JSON.parse(lsblkOut);
      const devices = parsed.blockdevices || [];
      for (const bdev of devices) {
        if (bdev.type !== 'disk') continue;
        const devPath = `/dev/${bdev.name}`;
        const existing = disks.find(d => d.device === devPath);
        
        const isKvmOrVirtual = !existing && (
          (bdev.model && /qemu|virtio|vmware|virtual|vbox|xen/i.test(bdev.model)) ||
          /^vd[a-z]/.test(bdev.name) ||
          /^xvd[a-z]/.test(bdev.name) ||
          disks.length === 0
        );

        const partitions = [];
        const scanParts = (children) => {
          if (!children || !Array.isArray(children)) return;
          for (const ch of children) {
            const chPath = `/dev/${ch.name}`;
            const dfInfo = (ch.mountpoint && dfMap[ch.mountpoint]) || dfMap[chPath];
            partitions.push({
              name: ch.name,
              path: chPath,
              sizeBytes: ch.size || bdev.size,
              mountpoint: ch.mountpoint || null,
              fstype: ch.fstype || 'Unbekannt',
              readOnly: ch.ro === true,
              usedBytes: dfInfo ? dfInfo.usedBytes : null,
              availBytes: dfInfo ? dfInfo.availBytes : null,
              usedPercent: dfInfo ? dfInfo.usedPercent : null
            });
            if (ch.children) scanParts(ch.children);
          }
        };
        scanParts(bdev.children);

        if (existing) {
          existing.sizeBytes = bdev.size;
          existing.rotational = bdev.rota;
          existing.readOnly = bdev.ro === true;
          existing.partitions = partitions;
        } else {
          disks.push({
            device: devPath,
            model: bdev.model || (isKvmOrVirtual ? 'KVM / Virtuelle Festplatte' : 'Standard Block-Device'),
            serial: 'Virtuell (Hypervisor)',
            passed: bdev.ro === true ? false : true,
            temperature: null,
            wearout: null,
            powerOnHours: null,
            sizeBytes: bdev.size,
            rotational: bdev.rota,
            readOnly: bdev.ro === true,
            isVirtual: true,
            partitions
          });
        }
      }
    }
  } catch (err) {}

  return disks;
}

async function runSmartTest(disk) {
  try {
    await execAsync(`smartctl -t short ${disk}`);
    return { success: true };
  } catch (e) {
    throw new Error(`Konnte Test auf ${disk} nicht starten: ${e.message}`);
  }
}

async function runCleanup(tasks) {
  const results = {};
  
  if (tasks.apt) {
    try {
      await execAsync('apt-get clean && apt-get autoremove -y', { timeout: 60000 });
      results.apt = 'Erfolgreich gereinigt';
    } catch (e) { results.apt = `Fehler: ${e.message}`; }
  }
  
  if (tasks.journal) {
    try {
      await execAsync('journalctl --vacuum-time=3d', { timeout: 30000 });
      results.journal = 'Erfolgreich bereinigt';
    } catch (e) { results.journal = `Fehler: ${e.message}`; }
  }
  
  if (tasks.docker) {
    try {
      await execAsync('docker system prune -a -f', { timeout: 120000 });
      results.docker = 'Docker Ressourcen erfolgreich entfernt';
    } catch (e) { results.docker = `Fehler: ${e.message}`; }
  }
  
  return { success: true, results };
}


function respond(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

// Zeitkonstanter Vergleich. Ein gewöhnliches `!==` bricht beim ersten abweichenden
// Zeichen ab; aus der Antwortzeit ließe sich das Token theoretisch Zeichen für Zeichen
// erraten. Über das Netz ist das durch Laufzeitschwankungen praktisch nicht auswertbar —
// der Aufwand hier ist aber so gering, dass sich die Überlegung erübrigt.
// Zuerst die Länge über einen Hash angleichen, weil `timingSafeEqual` sonst bei
// ungleich langen Puffern wirft und damit selbst wieder etwas verrät.
function tokenGleich(vorgelegt) {
  if (!TOKEN || typeof vorgelegt !== 'string' || !vorgelegt) return false;
  const a = crypto.createHash('sha256').update(vorgelegt).digest();
  const b = crypto.createHash('sha256').update(TOKEN).digest();
  return crypto.timingSafeEqual(a, b);
}

async function handler(req, res) {
  // SICHERHEIT: Leerer TOKEN bedeutet nicht "kein Schutz" sondern "alle abweisen"
  if (!tokenGleich(req.headers['x-agent-token'])) {
    return respond(res, 401, { error: 'Unauthorized' });
  }

  const url = req.url.split('?')[0];

  try {
    // ── System ────────────────────────────────────────────────────────────────
    if (url === '/ping' && req.method === 'GET') {
      respond(res, 200, { ok: true, hostname: os.hostname(), tls: req.socket.encrypted || false, version: VERSION,
                          terminal: TERMINAL_BEREIT, terminalSetup: TERMINAL_SETUP.zustand, terminalMeldung: TERMINAL_SETUP.meldung });

    } else if (url === '/version' && req.method === 'GET') {
      respond(res, 200, { version: VERSION, nodeVersion: process.version, terminal: TERMINAL_BEREIT });

    // Stößt die Installation von ws/node-pty an. Läuft im Hintergrund weiter, weil das
    // Übersetzen von node-pty (und ggf. das Nachladen der Build-Werkzeuge) Minuten dauert.
    } else if (url === '/terminal/setup' && req.method === 'POST') {
      if (TERMINAL_BEREIT) {
        respond(res, 200, { bereit: true, zustand: 'fertig', meldung: 'Terminal-Module sind bereits vorhanden' });
      } else {
        terminalNachruesten();   // bewusst nicht abgewartet
        respond(res, 202, { gestartet: true, zustand: TERMINAL_SETUP.zustand });
      }

    } else if (url === '/config' && req.method === 'POST') {
      const body = await new Promise((resolve) => {
        const chunks = []; req.on('data', c => chunks.push(c));
        req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch { resolve({}); } });
      });
      if (body.panelUrl !== undefined) {
        // SICHERHEIT: .env ist zugleich die EnvironmentFile= des systemd-Diensts und
        // enthält PANEL_AGENT_TOKEN. Ein panelUrl mit eingebettetem Zeilenumbruch
        // würde beim Schreiben eine zusätzliche, frei wählbare Zeile einschleusen —
        // z.B. eine zweite PANEL_AGENT_TOKEN=... (systemd nimmt bei doppeltem Key die
        // letzte Zeile) oder NODE_OPTIONS=--require=... beim nächsten Neustart. Deshalb
        // strikt auf eine gültige http(s)-URL ohne Kontrollzeichen prüfen.
        let parsed;
        try { parsed = new URL(String(body.panelUrl)); } catch { parsed = null; }
        const gueltig = parsed
          && (parsed.protocol === 'http:' || parsed.protocol === 'https:')
          && !/[\r\n\0]/.test(body.panelUrl);
        if (!gueltig) {
          respond(res, 400, { error: 'panelUrl muss eine gültige http(s)-URL ohne Zeilenumbrüche sein' });
          return;
        }

        const envPath = path.join(DIR, '.env');
        let envContent = '';
        try { envContent = fs.readFileSync(envPath, 'utf8'); } catch {}

        const lines = envContent.split('\n').filter(l => l.trim() && !l.startsWith('PANEL_URL='));
        lines.push(`PANEL_URL=${body.panelUrl}`);
        fs.writeFileSync(envPath, lines.join('\n') + '\n', 'utf8');

        respond(res, 200, { success: true, message: 'PANEL_URL aktualisiert' });
      } else {
        respond(res, 400, { error: 'panelUrl fehlt im Body' });
      }

    } else if (url === '/update' && req.method === 'POST') {
      const tmpPath  = path.join(DIR, '_panel-agent.new.js');
      const selfPath = path.join(DIR, 'panel-agent.js');

      // Body lesen (Panel schickt { script: "..." } direkt)
      const body = await new Promise((resolve) => {
        const chunks = [];
        req.on('data', c => chunks.push(c));
        req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch { resolve({}); } });
      });

      try {
        let content;
        if (body.script && typeof body.script === 'string' && body.script.length > 100) {
          // Vom Panel direkt übermittelt → HMAC-Signatur prüfen
          if (!body.hmac) {
            return respond(res, 403, { error: 'Fehlende HMAC-Signatur — Update abgelehnt' });
          }
          const expected = crypto.createHmac('sha256', TOKEN).update(body.script).digest('hex');
          if (body.hmac !== expected) {
            return respond(res, 403, { error: 'Ungültige HMAC-Signatur — Update abgelehnt' });
          }
          content = body.script;
        } else {
          // Fallback: von GitHub laden (kein script-Feld → kein HMAC nötig)
          await downloadFile(REPO_RAW, tmpPath);
          content = fs.readFileSync(tmpPath, 'utf8');
        }
        const newVersion = (content.match(/^const VERSION\s*=\s*['"]([^'"]+)['"]/m) || [])[1] || 'unbekannt';
        fs.writeFileSync(tmpPath, content, 'utf8');
        fs.renameSync(tmpPath, selfPath);
        respond(res, 200, { success: true, oldVersion: VERSION, newVersion, message: 'Agent wird neu gestartet…' });
        setTimeout(() => exec('systemctl restart panel-agent', () => {}), 1500);
      } catch (err) {
        try { fs.unlinkSync(tmpPath); } catch {}
        respond(res, 500, { error: err.message });
      }

    } else if (url === '/stats' && req.method === 'GET') {
      respond(res, 200, await getStats());

    } else if (url === '/services' && req.method === 'GET') {
      respond(res, 200, await getServices());

    } else if (url.startsWith('/services/') && req.method === 'POST') {
      const parts = url.split('/');
      const output = await serviceAction(decodeURIComponent(parts[2]), parts[3]);
      respond(res, 200, { success: true, output });

    } else if (url === '/processes' && req.method === 'GET') {
      respond(res, 200, await getProcesses());

    } else if (url.startsWith('/processes/') && url.endsWith('/kill') && req.method === 'POST') {
      const parts = url.split('/');
      const pid = decodeURIComponent(parts[2]);
      const raw = await new Promise((resolve) => { const chunks = []; req.on('data', c => chunks.push(c)); req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8'))); });
      const { signal } = JSON.parse(raw || '{}');
      const output = await killProcess(pid, signal);
      respond(res, 200, { success: true, message: output });

    } else if (url === '/run-command' && req.method === 'POST') {
      const raw = await new Promise((resolve) => { const chunks = []; req.on('data', c => chunks.push(c)); req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8'))); });
      const { command } = JSON.parse(raw || '{}');
      if (!command) return respond(res, 400, { error: 'Kein Kommando übergeben' });
      try {
        const { stdout, stderr } = await execAsync(command, { timeout: 30000 });
        respond(res, 200, { success: true, output: (stdout + '\n' + stderr).trim() });
      } catch (err) {
        respond(res, 500, { success: false, error: err.message, output: err.stdout + '\n' + err.stderr });
      }


    // ── Cron-Jobs ──────────────────────────────────────────────────────────────
    } else if (url === '/cron/users' && req.method === 'GET') {
      respond(res, 200, await getCronUsers());

    } else if (url.startsWith('/cron/jobs/') && req.method === 'GET') {
      const user = decodeURIComponent(url.split('/')[3] || '');
      respond(res, 200, await getCronJobs(user));

    } else if (url.startsWith('/cron/jobs/') && req.method === 'POST') {
      const user = decodeURIComponent(url.split('/')[3] || '');
      const raw = await new Promise((resolve) => { const chunks = []; req.on('data', c => chunks.push(c)); req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8'))); });
      const { schedule, command } = JSON.parse(raw || '{}');
      await addCronJob(user, schedule, command);
      respond(res, 200, { success: true });

    } else if (url.startsWith('/cron/jobs/') && req.method === 'DELETE') {
      const parts = url.split('/');
      const user = decodeURIComponent(parts[3] || '');
      const idx = parts[4] || '';
      await deleteCronJob(user, idx);
      respond(res, 200, { success: true });

    // ── Firewall ──────────────────────────────────────────────────────────────
    } else if (url === '/firewall/detect' && req.method === 'GET') {
      const erkannt = await detectAgentFirewall();
      const zustand = erkannt.tool !== 'none'
        ? await agentFilterZustand(erkannt.tool)
        : { filtert: false, grund: 'Kein Firewall-Werkzeug gefunden.' };
      respond(res, 200, { ...erkannt, ...zustand });

    } else if (url === '/firewall/toggle' && req.method === 'POST') {
      const raw = await new Promise((resolve) => { const chunks = []; req.on('data', c => chunks.push(c)); req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8'))); });
      const { enable, tool: reqTool } = JSON.parse(raw || '{}');
      if (typeof enable !== 'boolean') return respond(res, 400, { error: 'enable (bool) erforderlich' });
      const { tool } = await detectAgentFirewall();
      const targetTool = tool !== 'none' ? tool : reqTool;
      if (!targetTool || targetTool === 'none') return respond(res, 400, { error: 'Kein Firewall-Tool gefunden' });
      if (targetTool === 'ufw') {
        await execAsync(enable ? 'ufw --force enable' : 'ufw disable', { timeout: 10000 });
      } else if (targetTool === 'firewalld') {
        await execAsync(enable ? 'systemctl start firewalld' : 'systemctl stop firewalld', { timeout: 10000 });
      } else if (targetTool === 'nftables') {
        await execAsync(enable ? 'systemctl start nftables' : 'systemctl stop nftables', { timeout: 10000 });
      } else if (targetTool === 'iptables') {
        try { await execAsync(enable ? 'systemctl start iptables' : 'systemctl stop iptables', { timeout: 10000 }); }
        catch {
          if (enable) {
            // `-P INPUT DROP` allein kappt auch die bestehende SSH-Sitzung und macht den
            // Server in derselben Sekunde unerreichbar. Erst die Regeln setzen, ohne die
            // ein DROP unweigerlich aussperrt (Spiegelung von firewallAdapters.js).
            const sichern = async (regel) => {
              try { await execAsync(`iptables -C ${regel}`, { timeout: 5000 }); }
              catch { await execAsync(`iptables -I ${regel}`, { timeout: 5000 }); }
            };
            await sichern('INPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT');
            await sichern('INPUT -i lo -j ACCEPT');
            await sichern('INPUT -p tcp --dport 22 -j ACCEPT');
            await execAsync('iptables -P INPUT DROP', { timeout: 5000 });
          } else {
            await execAsync('iptables -P INPUT ACCEPT', { timeout: 5000 });
          }
        }
      }
      respond(res, 200, { success: true });

    } else if (url === '/firewall/status' && req.method === 'GET') {
      respond(res, 200, await getFirewallStatus());

    } else if (url === '/firewall/rules' && req.method === 'GET') {
      const { tool } = await detectAgentFirewall();
      respond(res, 200, { tool, rules: await getFirewallRules() });

    } else if ((url === '/firewall/allow' || url === '/firewall/deny') && req.method === 'POST') {
      const raw = await new Promise((resolve) => { const chunks = []; req.on('data', c => chunks.push(c)); req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8'))); });
      const { port, proto, from, route } = JSON.parse(raw || '{}');
      const action = url.endsWith('/allow') ? 'allow' : 'deny';
      await firewallAllow(port, proto, from, action, !!route);
      respond(res, 200, { success: true });

    // Bearbeiten = löschen + neu anlegen, wie es die lokale Panel-Route vormacht.
    // Fehlte hier bislang ganz, weshalb „Bearbeiten" bei Remote-Servern ins Leere lief.
    } else if (url.startsWith('/firewall/rules/') && req.method === 'PUT') {
      const raw = await new Promise((resolve) => { const chunks = []; req.on('data', c => chunks.push(c)); req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8'))); });
      const { port, proto, from, action, route } = JSON.parse(raw || '{}');
      if (!port || !action) return respond(res, 400, { error: 'Port und Aktion erforderlich' });
      if (action !== 'allow' && action !== 'deny') return respond(res, 400, { error: 'Ungültige Aktion' });
      const id = decodeURIComponent(url.split('/').slice(3).join('/'));
      await firewallDeleteRule(id);
      await firewallAllow(port, proto, from, action, !!route);
      respond(res, 200, { success: true });

    } else if (url.startsWith('/firewall/rules/') && req.method === 'DELETE') {
      const id = decodeURIComponent(url.split('/').slice(3).join('/'));
      await firewallDeleteRule(id);
      respond(res, 200, { success: true });

    // ── Festplatten & System (Modul 7) ─────────────────────────────────────────
    } else if (url === '/disks/smart' && req.method === 'GET') {
      respond(res, 200, await getSmartData());
    } else if (url === '/disks/smart/test' && req.method === 'POST') {
      const raw = await new Promise((resolve) => { const chunks = []; req.on('data', c => chunks.push(c)); req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8'))); });
      const { disk } = JSON.parse(raw || '{}');
      if (!disk) return respond(res, 400, { error: 'Keine Festplatte angegeben' });
      respond(res, 200, await runSmartTest(disk));
    } else if (url === '/system/cleanup' && req.method === 'POST') {
      const raw = await new Promise((resolve) => { const chunks = []; req.on('data', c => chunks.push(c)); req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8'))); });
      const tasks = JSON.parse(raw || '{}');
      respond(res, 200, await runCleanup(tasks));

    // ── SSH & Sicherheit ──────────────────────────────────────────────────────
    } else if (url === '/ssh/keys' && req.method === 'GET') {
      respond(res, 200, await getSshKeys());
    } else if (url === '/ssh/keys' && req.method === 'POST') {
      const body = await new Promise((resolve) => {
        const chunks = []; req.on('data', c => chunks.push(c));
        req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch { resolve({}); } });
      });
      try {
        const result = await addSshKey(body.user || 'root', body.key);
        respond(res, 200, result);
      } catch (err) {
        respond(res, 400, { error: err.message });
      }
    } else if (url.startsWith('/ssh/keys/') && req.method === 'DELETE') {
      const identifier = decodeURIComponent(url.split('/')[3] || '');
      respond(res, 200, await removeSshKey(identifier));
    } else if (url === '/ssh/audit' && req.method === 'GET') {
      respond(res, 200, await getSshConfig());

    // ── Docker ────────────────────────────────────────────────────────────────
    } else if (url === '/docker/containers' && req.method === 'GET') {
      respond(res, 200, await getDockerContainers());
    } else if (url === '/docker/images' && req.method === 'GET') {
      respond(res, 200, await getDockerImages());
    } else if (url.startsWith('/docker/containers/') && url.endsWith('/stats') && req.method === 'GET') {
      const id = decodeURIComponent(url.split('/')[3] || '');
      respond(res, 200, await getDockerStats(id));
    } else if (url.startsWith('/docker/containers/') && url.endsWith('/logs') && req.method === 'GET') {
      const id = decodeURIComponent(url.split('/')[3] || '');
      const tail = (req.url.match(/tail=(\d+)/) || [])[1] || 100;
      respond(res, 200, await getDockerLogs(id, tail));
    } else if (url.startsWith('/docker/containers/') && req.method === 'POST') {
      const parts = url.split('/');
      if (parts.length === 5) {
        respond(res, 200, await dockerAction(decodeURIComponent(parts[3]), parts[4]));
      } else { respond(res, 404, { error: 'Not found' }); }

    } else if (url === '/docker/stacks' && req.method === 'GET') {
      respond(res, 200, await getDockerStacks());
    } else if (url.startsWith('/docker/stacks/') && url.endsWith('/file') && req.method === 'GET') {
      const parts = url.split('/');
      respond(res, 200, await getDockerStackFile(decodeURIComponent(parts[3])));
    } else if (url.startsWith('/docker/stacks/') && url.endsWith('/file') && req.method === 'PUT') {
      const parts = url.split('/');
      const raw = await new Promise((resolve) => { const chunks = []; req.on('data', c => chunks.push(c)); req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8'))); });
      const { content } = JSON.parse(raw || '{}');
      if (!content) return respond(res, 400, { error: 'Content fehlt' });
      respond(res, 200, await writeDockerStackFile(decodeURIComponent(parts[3]), content));
    } else if (url.startsWith('/docker/stacks/') && req.method === 'POST') {
      const parts = url.split('/');
      if (parts.length === 5) {
        if (parts[4] === 'deploy') return deployDockerStack(decodeURIComponent(parts[3]), res);
        respond(res, 200, await dockerStackAction(decodeURIComponent(parts[3]), parts[4]));
      } else { respond(res, 404, { error: 'Not found' }); }
      
    } else if (url === '/docker/volumes' && req.method === 'GET') {
      respond(res, 200, await getDockerVolumes());
    } else if (url === '/docker/volumes/prune' && req.method === 'POST') {
      await execAsync('docker volume prune -f', { timeout: 30000 });
      respond(res, 200, { success: true });
    } else if (url.startsWith('/docker/volumes/') && req.method === 'DELETE') {
      const id = decodeURIComponent(url.split('/')[3] || '');
      if (!id) return respond(res, 400, { error: 'Volume-Name fehlt' });
      await execFileAsync('docker', ['volume', 'rm', id], { timeout: 10000 });
      respond(res, 200, { success: true });

    } else if (url === '/docker/networks' && req.method === 'GET') {
      respond(res, 200, await getDockerNetworks());
    } else if (url === '/docker/networks/prune' && req.method === 'POST') {
      await execAsync('docker network prune -f', { timeout: 30000 });
      respond(res, 200, { success: true });
    } else if (url.startsWith('/docker/networks/') && req.method === 'DELETE') {
      const id = decodeURIComponent(url.split('/')[3] || '');
      if (!id) return respond(res, 400, { error: 'Netzwerk-ID fehlt' });
      await execFileAsync('docker', ['network', 'rm', id], { timeout: 10000 });
      respond(res, 200, { success: true });

    } else if (url === '/docker/images/prune' && req.method === 'POST') {
      await execAsync('docker image prune -a -f', { timeout: 60000 });
      respond(res, 200, { success: true });
    } else if (url === '/docker/images/pull' && req.method === 'POST') {
      const raw = await new Promise((resolve) => { const chunks = []; req.on('data', c => chunks.push(c)); req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8'))); });
      const { image } = JSON.parse(raw || '{}');
      if (!image) return respond(res, 400, { error: 'image fehlt' });
      // Der Agent verlässt sich nicht darauf, dass das Panel bereits validiert hat.
      if (!/^[a-zA-Z0-9][a-zA-Z0-9._/:@-]{0,220}$/.test(image)) {
        return respond(res, 400, { error: 'Ungültige Image-Referenz' });
      }
      await execFileAsync('docker', ['pull', image], { timeout: 300000 });
      respond(res, 200, { success: true });
    } else if (url.startsWith('/docker/images/') && req.method === 'DELETE') {
      const id = decodeURIComponent(url.split('/')[3] || '');
      if (!id) return respond(res, 400, { error: 'Image-ID fehlt' });
      await execFileAsync('docker', ['rmi', '-f', id], { timeout: 10000 });
      respond(res, 200, { success: true });

    } else if (url === '/network/interfaces' && req.method === 'GET') {
      respond(res, 200, getNetworkInterfaces());

    } else if (url === '/network/stats' && req.method === 'GET') {
      respond(res, 200, await getNetworkStats());

    } else if (url === '/network/public-ip' && req.method === 'GET') {
      respond(res, 200, await getPublicIp());

    } else if (url === '/network/ports' && req.method === 'GET') {
      respond(res, 200, await getOpenPorts());

    } else if (url === '/network/ssh-sessions' && req.method === 'GET') {
      respond(res, 200, await getSshSessions());

    // ── Logs ──
    } else if (url === '/logs' && req.method === 'GET') {
      const q = new URL(req.url, 'http://localhost').searchParams;
      const since = q.get('since');
      respond(res, 200, await getSyslogs(since));

    // ── Packages ────────────────────────────────────────────────────────────────
    } else if (url === '/packages/update' && req.method === 'POST') {
      if (PAKET_UPDATE_LAEUFT) {
        respond(res, 409, { error: 'Es läuft bereits ein Paket-Update auf diesem Server.' });
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Transfer-Encoding': 'chunked' });
      const mgr = await programmVorhanden('apt-get') ? 'apt-get' : (await programmVorhanden('dnf') ? 'dnf' : null);
      if (!mgr) {
        res.end('Fehler: Weder apt-get noch dnf auf diesem System gefunden.\n');
        return;
      }
      res.write(`Start Paket-Update via ${mgr}...\n\n`);
      // `--with-new-pkgs`: Ohne diese Option lässt `apt-get upgrade` jedes Paket liegen,
      // das ein neues Paket mitbringt — in der Praxis genau die Kernel-Updates
      // (linux-image-amd64 → linux-image-6.1.0-53-amd64). Die blieben sonst dauerhaft
      // als "ausstehend" stehen, egal wie oft man das Update anstößt. Entfernt wird
      // dabei nichts; das täte erst `dist-upgrade`.
      // Danach wird gemeldet, falls trotzdem etwas zurückgehalten wurde.
      const aptCmd =
        'apt-get update && ' +
        'DEBIAN_FRONTEND=noninteractive apt-get -y -o Dpkg::Options::="--force-confold" --with-new-pkgs upgrade; ' +
        'code=$?; ' +
        'rest=$(apt-get -s upgrade 2>/dev/null | grep -c "^Inst" || true); ' +
        '[ "$rest" != "0" ] && printf "\\nHinweis: %s Paket(e) wurden zurückgehalten — sie erfordern das Entfernen anderer Pakete und müssen von Hand mit \'apt-get dist-upgrade\' geprüft werden.\\n" "$rest"; ' +
        'exit $code';
      const args = mgr === 'apt-get'
        ? ['-c', aptCmd]
        : ['-c', 'dnf upgrade -y'];
      PAKET_UPDATE_LAEUFT = true;
      const child = require('child_process').spawn('sh', args, { env: { ...process.env, DEBIAN_FRONTEND: 'noninteractive' } });
      // apt-get/dnf können bei einer Sperren-Kollision (z.B. unattended-upgrades) oder
      // einem hängenden Postinst-Skript unbegrenzt blockieren. Nach 30 Minuten hart
      // abbrechen, statt den Prozess und die offene Antwort auf ewig hängen zu lassen.
      const killTimer = setTimeout(() => { try { child.kill('SIGKILL'); } catch {} }, 30 * 60 * 1000);
      const fertig = () => { clearTimeout(killTimer); PAKET_UPDATE_LAEUFT = false; };
      child.stdout.on('data', d => res.write(d));
      child.stderr.on('data', d => res.write(d));
      child.on('close', code => { fertig(); res.end(`\n[Vorgang beendet mit Code ${code}]\n`); });
      child.on('error', err => { fertig(); res.end(`\n[Fehler: ${err.message}]\n`); });

    // ── Deinstallation ────────────────────────────────────────────────────────
    } else if (url === '/uninstall' && req.method === 'POST') {
      // Antwort sofort senden, dann im Hintergrund deinstallieren
      respond(res, 200, { success: true, message: 'Agent wird deinstalliert…' });
      setTimeout(() => {
        // & entkoppelt den bash-Prozess vom Node.js-Prozess (läuft weiter nach systemctl stop)
        exec(
          `bash -c 'sleep 1 && systemctl disable panel-agent --now && ` +
          `rm -f /etc/systemd/system/panel-agent.service && systemctl daemon-reload && ` +
          `ufw delete allow ${PORT}/tcp 2>/dev/null; rm -rf /opt/panel-agent' &`,
          () => {}
        );
      }, 600);

    } else {
      respond(res, 404, { error: 'Not found' });
    }
  } catch (err) {
    respond(res, 500, { error: err.message });
  }
}

// ─── Server starten ──────────────────────────────────────────────────────────

const certPath = path.join(DIR, 'cert.pem');
const keyPath  = path.join(DIR, 'key.pem');
const useTLS   = fs.existsSync(certPath) && fs.existsSync(keyPath);

const server = useTLS
  ? https.createServer({ cert: fs.readFileSync(certPath), key: fs.readFileSync(keyPath) }, handler)
  : http.createServer(handler);

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`FEHLER: Port ${PORT} ist bereits belegt. Läuft der Agent schon? (${err.message})`);
  } else if (err.code === 'EACCES') {
    console.error(`FEHLER: Keine Berechtigung für Port ${PORT}. Port < 1024 benötigt root. (${err.message})`);
  } else {
    console.error(`FEHLER beim Starten des Servers: ${err.message}`);
  }
  process.exit(1);
});

server.listen(PORT, '0.0.0.0', () => {
  const proto = useTLS ? 'HTTPS' : 'HTTP (kein Zertifikat gefunden — unsicher!)';
  console.log(`Panel Agent v${VERSION} [${proto}] läuft auf Port ${PORT}`);
  if (!TOKEN) {
    console.error('SICHERHEIT: Kein PANEL_AGENT_TOKEN gesetzt — alle Anfragen werden abgewiesen!');
    console.error('           Bitte /etc/panel-agent/env konfigurieren und den Service neu starten.');
  }
});

// ─── WebSocket Terminal ────────────────────────────────────────────────────────
try {
  const WebSocketServer = require('ws').Server;
  const pty = require('node-pty');
  TERMINAL_BEREIT = true;

  const wss = new WebSocketServer({ server });
  
  wss.on('connection', (ws, req) => {
    // Authentifizierung via Header oder URL (für Browser)
    const tokenHeader = req.headers['x-agent-token'];
    let tokenUrl = '';
    try {
      const u = new URL(req.url, `http://${req.headers.host}`);
      tokenUrl = u.searchParams.get('token');
    } catch {}
    
    if (!tokenGleich(tokenHeader) && !tokenGleich(tokenUrl)) {
      ws.close(1008, 'Unauthorized');
      return;
    }

    const match = req.url.match(/^\/docker\/containers\/([^/?]+)\/terminal/);
    if (!match) {
      ws.close(1008, 'Invalid endpoint');
      return;
    }
    const containerId = decodeURIComponent(match[1]);

    // pseudo-tty erstellen mit docker exec -it.
    // Nicht fest auf bash gehen: Alpine-basierte Images (nginx:alpine, redis:alpine, …)
    // haben nur sh. Die Shell wird deshalb im Container selbst ausgewählt.
    const term = pty.spawn('docker', [
      'exec', '-it', containerId,
      'sh', '-c', 'if command -v bash >/dev/null 2>&1; then exec bash; else exec sh; fi'
    ], {
      name: 'xterm-color',
      cols: 80,
      rows: 24,
      cwd: process.env.HOME,
      env: process.env
    });

    term.onData((data) => {
      if (ws.readyState === 1) ws.send(data);
    });

    ws.on('message', (msg) => {
      // Wenn die Nachricht Resize-Infos enthält, Terminalgröße anpassen (oft als JSON-String {cols, rows})
      try {
        const obj = JSON.parse(msg);
        if (obj.cols && obj.rows) {
          term.resize(obj.cols, obj.rows);
          return;
        }
      } catch {}
      term.write(msg);
    });

    ws.on('close', () => {
      try { term.kill(); } catch {}
    });
    
    // Kurz warten, damit eine letzte Fehlermeldung von `docker exec` (z. B. wenn der
    // Container gar keine Shell hat) noch beim Browser ankommt, bevor zugemacht wird.
    term.onExit(() => {
      setTimeout(() => { if (ws.readyState === 1) ws.close(); }, 100);
    });
  });
} catch (e) {
  // Ohne diese beiden Module gibt es keine Container-Konsole. Die Meldung nennt jetzt
  // ausdrücklich den Weg zurück — sie stand hier jahrelang und wurde übersehen, während
  // im Panel nur ein nichtssagender Verbindungsfehler ankam.
  console.error('WARNUNG: Container-Konsole nicht verfügbar — ' + e.message);
  console.error('         Nachrüsten mit:  cd /opt/panel-agent && npm install --save ws node-pty && systemctl restart panel-agent');
}
