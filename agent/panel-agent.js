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
const VERSION = '2.6.2';

// Ob die Container-Konsole angeboten werden kann. Steht erst nach dem Laden von
// ws/node-pty am Ende dieser Datei fest und wird über /ping und /version gemeldet,
// damit das Panel den Grund nennen kann, statt nur einen Verbindungsfehler zu zeigen.
let TERMINAL_BEREIT = false;
const REPO_RAW = 'https://raw.githubusercontent.com/RoobiinG/ueberwachungs-panel/master/agent/panel-agent.js';
const PORT  = parseInt(process.env.PANEL_AGENT_PORT || '7331');
const TOKEN = process.env.PANEL_AGENT_TOKEN || '';
const DIR   = __dirname;

const sleep = ms => new Promise(r => setTimeout(r, ms));

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

// Erkennt aktive Firewall-Software — inaktive Tools werden übersprungen
async function detectAgentFirewall() {
  try { const { stdout } = await execAsync('which ufw 2>/dev/null', { timeout: 3000 });
    if (stdout.trim()) { try { const { stdout: s } = await execAsync('ufw status 2>/dev/null', { timeout: 3000 }); if (/Status:\s*active/i.test(s)) return { tool: 'ufw', active: true }; } catch {} }
  } catch {}
  try { const { stdout } = await execAsync('which firewall-cmd 2>/dev/null', { timeout: 3000 });
    if (stdout.trim()) { try { const { stdout: s } = await execAsync('firewall-cmd --state 2>/dev/null', { timeout: 3000 }); if (s.trim() === 'running') return { tool: 'firewalld', active: true }; } catch {} }
  } catch {}
  try { const { stdout } = await execAsync('which nft 2>/dev/null', { timeout: 3000 });
    if (stdout.trim()) { try { await execAsync('nft list tables 2>/dev/null', { timeout: 3000 }); return { tool: 'nftables', active: true }; } catch {} }
  } catch {}
  try { const { stdout } = await execAsync('which iptables 2>/dev/null', { timeout: 3000 }); if (stdout.trim()) return { tool: 'iptables', active: true }; } catch {}
  return { tool: 'none', active: false };
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

// Regeln abrufen (einheitliches Format)
async function getFirewallRules() {
  const { tool } = await detectAgentFirewall();
  const rules = [];
  try {
    if (tool === 'ufw') {
      const { stdout } = await execAsync('ufw status numbered', { timeout: 5000 });
      return stdout.split('\n').filter(l => /^\[\s*\d+\]/.test(l)).map(line => {
        const m = line.match(/^\[\s*(\d+)\]\s+(.+?)\s{2,}(.+?)\s{2,}(.+)$/);
        if (!m) return { id: null, port: '?', proto: 'any', action: '?', from: 'any', raw: line.trim() };
        const to = m[2].trim(); const pm = to.match(/^(\d[\d:]*)(?:\/(tcp|udp))?/i);
        return { id: m[1].trim(), port: pm ? pm[1] : to, proto: pm?.[2]?.toLowerCase() ?? 'any', action: m[3].trim().toLowerCase().includes('allow') ? 'allow' : 'deny', from: m[4].trim() === 'Anywhere' ? 'any' : m[4].trim(), raw: line.trim() };
      });
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
    const { stdout } = await execAsync("docker compose ls -a --format '{{json .}}'", { timeout: 10000 });
    return stdout.trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
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
async function firewallAllow(port, proto, from, action) {
  const { tool } = await detectAgentFirewall();
  const p   = _validPort(port);
  const pr  = _validProto(proto);
  const fr  = _validFrom(from);
  const opt = { timeout: 10000 };

  if (tool === 'ufw') {
    const args = fr
      ? [action, 'from', fr, 'to', 'any', 'port', p, ...(pr ? ['proto', pr] : [])]
      : [action, pr ? `${p}/${pr}` : p];
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

// ─── HTTP Handler ─────────────────────────────────────────────────────────────

function respond(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

async function handler(req, res) {
  // SICHERHEIT: Leerer TOKEN bedeutet nicht "kein Schutz" sondern "alle abweisen"
  if (!TOKEN || req.headers['x-agent-token'] !== TOKEN) {
    return respond(res, 401, { error: 'Unauthorized' });
  }

  const url = req.url.split('?')[0];

  try {
    // ── System ────────────────────────────────────────────────────────────────
    if (url === '/ping' && req.method === 'GET') {
      respond(res, 200, { ok: true, hostname: os.hostname(), tls: req.socket.encrypted || false, version: VERSION, terminal: TERMINAL_BEREIT });

    } else if (url === '/version' && req.method === 'GET') {
      respond(res, 200, { version: VERSION, nodeVersion: process.version, terminal: TERMINAL_BEREIT });

    } else if (url === '/config' && req.method === 'POST') {
      const body = await new Promise((resolve) => {
        const chunks = []; req.on('data', c => chunks.push(c));
        req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch { resolve({}); } });
      });
      if (body.panelUrl !== undefined) {
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


    // ── Firewall ──────────────────────────────────────────────────────────────
    } else if (url === '/firewall/detect' && req.method === 'GET') {
      respond(res, 200, await detectAgentFirewall());

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
        catch { await execAsync(enable ? 'iptables -P INPUT DROP' : 'iptables -P INPUT ACCEPT', { timeout: 5000 }); }
      }
      respond(res, 200, { success: true });

    } else if (url === '/firewall/status' && req.method === 'GET') {
      respond(res, 200, await getFirewallStatus());

    } else if (url === '/firewall/rules' && req.method === 'GET') {
      const { tool } = await detectAgentFirewall();
      respond(res, 200, { tool, rules: await getFirewallRules() });

    } else if ((url === '/firewall/allow' || url === '/firewall/deny') && req.method === 'POST') {
      const raw = await new Promise((resolve) => { const chunks = []; req.on('data', c => chunks.push(c)); req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8'))); });
      const { port, proto, from } = JSON.parse(raw || '{}');
      const action = url.endsWith('/allow') ? 'allow' : 'deny';
      await firewallAllow(port, proto, from, action);
      respond(res, 200, { success: true });

    // Bearbeiten = löschen + neu anlegen, wie es die lokale Panel-Route vormacht.
    // Fehlte hier bislang ganz, weshalb „Bearbeiten" bei Remote-Servern ins Leere lief.
    } else if (url.startsWith('/firewall/rules/') && req.method === 'PUT') {
      const raw = await new Promise((resolve) => { const chunks = []; req.on('data', c => chunks.push(c)); req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8'))); });
      const { port, proto, from, action } = JSON.parse(raw || '{}');
      if (!port || !action) return respond(res, 400, { error: 'Port und Aktion erforderlich' });
      if (action !== 'allow' && action !== 'deny') return respond(res, 400, { error: 'Ungültige Aktion' });
      const id = decodeURIComponent(url.split('/').slice(3).join('/'));
      await firewallDeleteRule(id);
      await firewallAllow(port, proto, from, action);
      respond(res, 200, { success: true });

    } else if (url.startsWith('/firewall/rules/') && req.method === 'DELETE') {
      const id = decodeURIComponent(url.split('/').slice(3).join('/'));
      await firewallDeleteRule(id);
      respond(res, 200, { success: true });

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
    } else if (url.startsWith('/docker/stacks/') && req.method === 'POST') {
      const parts = url.split('/');
      if (parts.length === 5) {
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
    
    if (!TOKEN || (tokenHeader !== TOKEN && tokenUrl !== TOKEN)) {
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
