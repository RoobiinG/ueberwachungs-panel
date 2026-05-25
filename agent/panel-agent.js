#!/usr/bin/env node
/**
 * Überwachungs-Panel Agent
 * Installieren: curl -sL https://raw.githubusercontent.com/RoobiinG/ueberwachungs-panel/master/agent/install.sh | bash
 */
const http = require('http');
const os = require('os');
const { exec } = require('child_process');
const { promisify } = require('util');
const fs = require('fs');

const execAsync = promisify(exec);
const PORT = parseInt(process.env.PANEL_AGENT_PORT || '7331');
const TOKEN = process.env.PANEL_AGENT_TOKEN || '';

const sleep = ms => new Promise(r => setTimeout(r, ms));

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
    }).filter(d => d.mount && !['/sys', '/proc', '/dev/', '/run/'].some(p => d.mount.startsWith(p)));
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

async function getStats() {
  const [cpu, disk] = await Promise.all([cpuUsage(), getDisk()]);
  const total = os.totalmem(), free = os.freemem(), used = total - free;
  return {
    cpu: { usage: cpu, cores: os.cpus().length },
    memory: { total, used, free, usedPercent: Math.round(used / total * 100) },
    disk,
    os: getOsInfo(),
    network: [],
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
  const validActions = ['start', 'stop', 'restart', 'reload', 'enable', 'disable'];
  if (!validActions.includes(action)) throw new Error('Ungültige Aktion');
  if (!/^[a-zA-Z0-9@._:-]+$/.test(name)) throw new Error('Ungültiger Service-Name');
  const { stdout } = await execAsync(`systemctl ${action} ${name}`, { timeout: 10000 });
  return stdout;
}

function respond(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

const server = http.createServer(async (req, res) => {
  if (TOKEN && req.headers['x-agent-token'] !== TOKEN) {
    return respond(res, 401, { error: 'Unauthorized' });
  }

  const url = req.url.split('?')[0];

  try {
    if (url === '/ping' && req.method === 'GET') {
      respond(res, 200, { ok: true, hostname: os.hostname() });

    } else if (url === '/stats' && req.method === 'GET') {
      respond(res, 200, await getStats());

    } else if (url === '/services' && req.method === 'GET') {
      respond(res, 200, await getServices());

    } else if (url.startsWith('/services/') && req.method === 'POST') {
      const parts = url.split('/');
      const output = await serviceAction(decodeURIComponent(parts[2]), parts[3]);
      respond(res, 200, { success: true, output });

    } else {
      respond(res, 404, { error: 'Not found' });
    }
  } catch (err) {
    respond(res, 500, { error: err.message });
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Panel Agent läuft auf Port ${PORT}`);
  if (!TOKEN) console.warn('WARNUNG: Kein PANEL_AGENT_TOKEN gesetzt — Agent ist ungeschützt!');
});
