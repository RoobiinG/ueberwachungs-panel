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
const { exec } = require('child_process');
const { promisify } = require('util');
const fs = require('fs');

const execAsync = promisify(exec);
const VERSION = '2.4.2';
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

const _IPV4_RE   = /^(\d{1,3}\.){3}\d{1,3}(\/\d{1,2})?$/;
const _IPV6_RE   = /^[0-9a-fA-F:]+(%[a-z0-9]+)?(\/\d{1,3})?$/;
const _validPort  = (p) => { if (!p || !/^\d{1,5}(:\d{1,5})?$/.test(String(p))) throw new Error('Ungültiger Port'); return String(p); };
const _validProto = (p) => ['tcp','udp'].includes(p) ? p : null;
const _validFrom  = (f) => (!f || _IPV4_RE.test(f) || _IPV6_RE.test(f)) ? (f||null) : null;

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
      return rules;
    } else if (tool === 'nftables') {
      try {
        const { stdout } = await execAsync('nft -j list ruleset 2>/dev/null', { timeout: 5000 });
        const items = JSON.parse(stdout)?.nftables || [];
        for (const item of items) {
          if (!item.rule) continue;
          const r = item.rule; const expr = r.expr || [];
          const verdict = expr.find(e => e.accept !== undefined || e.drop !== undefined);
          const action = verdict ? (verdict.accept !== undefined ? 'allow' : 'deny') : 'unknown';
          let port = 'any', proto = 'any';
          for (const e of expr) {
            if (e.match?.left?.payload?.field === 'dport') { const rr = e.match?.right; port = typeof rr === 'object' ? `${rr.range?.[0]}:${rr.range?.[1]}` : String(rr ?? 'any'); }
            if (e.match?.left?.meta?.key === 'l4proto') { proto = String(e.match?.right ?? 'any'); }
          }
          rules.push({ id: String(r.handle ?? ''), port, proto, action, from: 'any', raw: JSON.stringify(r) });
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
    const { stdout } = await execAsync(`docker stats ${id} --no-stream --format '{{json .}}'`, { timeout: 10000 });
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
    const { stdout, stderr } = await execAsync(`docker logs --tail ${tail} ${id}`, { timeout: 10000 });
    return stdout + stderr;
  } catch { throw new Error('Ressource nicht gefunden'); }
}

async function dockerAction(id, action) {
  try {
    const valid = ['start', 'stop', 'restart', 'pause', 'unpause', 'kill'];
    if (!valid.includes(action)) throw new Error('Ungültige Aktion');
    await execAsync(`docker ${action} ${id}`, { timeout: 30000 });
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
    
    if (action === 'up') await execAsync(`docker compose -f "${path}" up -d`, { timeout: 60000 });
    if (action === 'down') await execAsync(`docker compose -f "${path}" down`, { timeout: 60000 });
    if (action === 'pull') await execAsync(`docker compose -f "${path}" pull`, { timeout: 60000 });
    if (action === 'restart') await execAsync(`docker compose -f "${path}" restart`, { timeout: 60000 });
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

// Firewall-Regel hinzufügen/löschen
async function firewallAllow(port, proto, from, action) {
  const { tool } = await detectAgentFirewall();
  const p  = _validPort(port);
  const pr = _validProto(proto);
  const fr = _validFrom(from);
  if (tool === 'ufw') {
    const cmd = (action === 'allow' && fr) ? `ufw allow from ${fr} to any port ${p}${pr?' proto '+pr:''}` : `ufw ${action} ${p}${pr?'/'+pr:''}`;
    await execAsync(cmd, { timeout: 10000 });
  } else if (tool === 'firewalld') {
    if (action === 'allow') { await execAsync(`firewall-cmd --permanent --add-port=${p}/${pr||'tcp'}`, { timeout: 10000 }); }
    else { await execAsync(`firewall-cmd --permanent --remove-port=${p}/${pr||'tcp'}`, { timeout: 10000 }); }
    await execAsync('firewall-cmd --reload', { timeout: 10000 });
  } else if (tool === 'nftables') {
    try { await execAsync('nft add table inet filter 2>/dev/null'); } catch {}
    try { await execAsync("nft add chain inet filter input '{ type filter hook input priority 0; }' 2>/dev/null"); } catch {}
    const verdict = action === 'allow' ? 'accept' : 'drop';
    await execAsync(`nft add rule inet filter input ${pr||'tcp'} dport ${p} ${verdict}`, { timeout: 10000 });
  } else if (tool === 'iptables') {
    const target = action === 'allow' ? 'ACCEPT' : 'DROP';
    const src = fr ? `-s ${fr}` : '';
    await execAsync(`iptables -I INPUT -p ${pr||'tcp'} ${src} --dport ${p} -j ${target}`, { timeout: 10000 });
    try { await execAsync('sh -c "iptables-save > /etc/iptables/rules.v4 2>/dev/null || true"'); } catch {}
  } else {
    throw new Error('Kein unterstütztes Firewall-Tool gefunden');
  }
}

async function firewallDeleteRule(id) {
  const { tool } = await detectAgentFirewall();
  if (tool === 'ufw') {
    if (!/^\d+$/.test(String(id))) throw new Error('Ungültige Regel-Nummer');
    await execAsync(`sh -c 'echo y | ufw delete ${id}'`, { timeout: 10000 });
  } else if (tool === 'firewalld') {
    if (String(id).startsWith('svc:')) { await execAsync(`firewall-cmd --permanent --remove-service=${id.slice(4)}`, { timeout: 10000 }); }
    else { const [p,pr] = id.split('/'); await execAsync(`firewall-cmd --permanent --remove-port=${p}/${pr||'tcp'}`, { timeout: 10000 }); }
    await execAsync('firewall-cmd --reload', { timeout: 10000 });
  } else if (tool === 'nftables') {
    if (!/^\d+$/.test(String(id))) throw new Error('Ungültiger Handle');
    await execAsync(`nft delete rule inet filter input handle ${id}`, { timeout: 10000 });
  } else if (tool === 'iptables') {
    if (!/^\d+$/.test(String(id))) throw new Error('Ungültige Regel-Nummer');
    await execAsync(`iptables -D INPUT ${id}`, { timeout: 10000 });
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
      respond(res, 200, { ok: true, hostname: os.hostname(), tls: req.socket.encrypted || false, version: VERSION });

    } else if (url === '/version' && req.method === 'GET') {
      respond(res, 200, { version: VERSION, nodeVersion: process.version });

    } else if (url === '/config' && req.method === 'POST') {
      const body = await new Promise((resolve) => {
        let d = ''; req.on('data', c => { d += c; });
        req.on('end', () => { try { resolve(JSON.parse(d || '{}')); } catch { resolve({}); } });
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
        let d = '';
        req.on('data', c => { d += c; });
        req.on('end', () => { try { resolve(JSON.parse(d || '{}')); } catch { resolve({}); } });
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
      const raw = await new Promise((resolve) => { let d = ''; req.on('data', c => d += c); req.on('end', () => resolve(d)); });
      const { signal } = JSON.parse(raw || '{}');
      const output = await killProcess(pid, signal);
      respond(res, 200, { success: true, message: output });


    // ── Firewall ──────────────────────────────────────────────────────────────
    } else if (url === '/firewall/detect' && req.method === 'GET') {
      respond(res, 200, await detectAgentFirewall());

    } else if (url === '/firewall/toggle' && req.method === 'POST') {
      const raw = await new Promise((resolve) => { let d = ''; req.on('data', c => d += c); req.on('end', () => resolve(d)); });
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
      const raw = await new Promise((resolve) => { let d = ''; req.on('data', c => d += c); req.on('end', () => resolve(d)); });
      const { port, proto, from } = JSON.parse(raw || '{}');
      const action = url.endsWith('/allow') ? 'allow' : 'deny';
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
      const id = url.split('/')[3];
      respond(res, 200, await getDockerStats(id));
    } else if (url.startsWith('/docker/containers/') && url.endsWith('/logs') && req.method === 'GET') {
      const id = url.split('/')[3];
      const tail = (req.url.match(/tail=(\d+)/) || [])[1] || 100;
      respond(res, 200, await getDockerLogs(id, tail));
    } else if (url.startsWith('/docker/containers/') && req.method === 'POST') {
      const parts = url.split('/');
      if (parts.length === 5) {
        respond(res, 200, await dockerAction(parts[3], parts[4]));
      } else { respond(res, 404, { error: 'Not found' }); }
      
    } else if (url === '/docker/stacks' && req.method === 'GET') {
      respond(res, 200, await getDockerStacks());
    } else if (url.startsWith('/docker/stacks/') && req.method === 'POST') {
      const parts = url.split('/');
      if (parts.length === 5) {
        respond(res, 200, await dockerStackAction(parts[3], parts[4]));
      } else { respond(res, 404, { error: 'Not found' }); }
      
    } else if (url === '/docker/volumes' && req.method === 'GET') {
      respond(res, 200, await getDockerVolumes());
    } else if (url === '/docker/volumes/prune' && req.method === 'POST') {
      await execAsync('docker volume prune -f', { timeout: 30000 });
      respond(res, 200, { success: true });
    } else if (url.startsWith('/docker/volumes/') && req.method === 'DELETE') {
      const id = url.split('/')[3];
      await execAsync(`docker volume rm ${id}`, { timeout: 10000 });
      respond(res, 200, { success: true });
      
    } else if (url === '/docker/networks' && req.method === 'GET') {
      respond(res, 200, await getDockerNetworks());
    } else if (url === '/docker/networks/prune' && req.method === 'POST') {
      await execAsync('docker network prune -f', { timeout: 30000 });
      respond(res, 200, { success: true });
    } else if (url.startsWith('/docker/networks/') && req.method === 'DELETE') {
      const id = url.split('/')[3];
      await execAsync(`docker network rm ${id}`, { timeout: 10000 });
      respond(res, 200, { success: true });
      
    } else if (url === '/docker/images/prune' && req.method === 'POST') {
      await execAsync('docker image prune -a -f', { timeout: 60000 });
      respond(res, 200, { success: true });
    } else if (url === '/docker/images/pull' && req.method === 'POST') {
      const raw = await new Promise((resolve) => { let d = ''; req.on('data', c => d += c); req.on('end', () => resolve(d)); });
      const { image } = JSON.parse(raw || '{}');
      if (!image) return respond(res, 400, { error: 'image fehlt' });
      await execAsync(`docker pull ${image}`, { timeout: 300000 });
      respond(res, 200, { success: true });
    } else if (url.startsWith('/docker/images/') && req.method === 'DELETE') {
      const id = url.split('/')[3];
      await execAsync(`docker rmi -f ${id}`, { timeout: 10000 });
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

    const match = req.url.match(/^\/docker\/containers\/(.+)\/terminal/);
    if (!match) {
      ws.close(1008, 'Invalid endpoint');
      return;
    }
    const containerId = match[1];

    // pseudo-tty erstellen mit docker exec -it
    const term = pty.spawn('docker', ['exec', '-it', containerId, 'bash'], {
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
    
    term.onExit(() => {
      if (ws.readyState === 1) ws.close();
    });
  });
} catch (e) {
  console.log('Terminal WebSocket-Support deaktiviert (ws oder node-pty fehlt).');
}
