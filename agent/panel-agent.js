#!/usr/bin/env node
/**
 * Überwachungs-Panel Agent
 * Installieren: curl -sL https://raw.githubusercontent.com/RoobiinG/ueberwachungs-panel/master/agent/install.sh | bash
 */
const http  = require('http');
const https = require('https');
const os    = require('os');
const path  = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');
const fs = require('fs');

const execAsync = promisify(exec);
const VERSION = '2.2.0';
const REPO_RAW = 'https://raw.githubusercontent.com/RoobiinG/ueberwachungs-panel/master/agent/panel-agent.js';
const PORT  = parseInt(process.env.PANEL_AGENT_PORT || '7331');
const TOKEN = process.env.PANEL_AGENT_TOKEN || '';
const DIR   = __dirname;

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ─── Datei-Download (HTTPS, folgt Weiterleitungen) ───────────────────────────

function downloadFile(url, dest, redirects = 5) {
  return new Promise((resolve, reject) => {
    if (redirects <= 0) return reject(new Error('Zu viele Weiterleitungen'));
    const file = fs.createWriteStream(dest);
    const req = https.get(url, { headers: { 'User-Agent': 'panel-agent-updater' } }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        file.destroy(); fs.unlink(dest, () => {});
        return downloadFile(res.headers.location, dest, redirects - 1).then(resolve).catch(reject);
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
  const valid = ['start', 'stop', 'restart', 'reload', 'enable', 'disable'];
  if (!valid.includes(action)) throw new Error('Ungültige Aktion');
  if (!/^[a-zA-Z0-9@._:-]+$/.test(name)) throw new Error('Ungültiger Service-Name');
  const { stdout } = await execAsync(`systemctl ${action} ${name}`, { timeout: 10000 });
  return stdout;
}

// ─── Docker API (via Unix Socket) ────────────────────────────────────────────

const DOCKER_SOCKET = '/var/run/docker.sock';
const DOCKER_API    = 'v1.41';

function dockerApi(urlPath, method = 'GET', body = null) {
  return new Promise((resolve) => {
    if (!fs.existsSync(DOCKER_SOCKET)) return resolve(null);
    const opts = {
      socketPath: DOCKER_SOCKET,
      path: `/${DOCKER_API}${urlPath}`,
      method,
      headers: {},
    };
    if (body) {
      const bodyStr = JSON.stringify(body);
      opts.headers['Content-Type'] = 'application/json';
      opts.headers['Content-Length'] = Buffer.byteLength(bodyStr);
    }
    const req = http.request(opts, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString())); }
        catch { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.setTimeout(8000, () => { req.destroy(); resolve(null); });
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function calcCpuPercent(stats) {
  if (!stats?.cpu_stats?.cpu_usage) return 0;
  const cpuDelta  = (stats.cpu_stats.cpu_usage.total_usage  || 0) - (stats.precpu_stats?.cpu_usage?.total_usage || 0);
  const sysDelta  = (stats.cpu_stats.system_cpu_usage || 0) - (stats.precpu_stats?.system_cpu_usage || 0);
  const numCpus   = stats.cpu_stats.online_cpus || stats.cpu_stats.cpu_usage.percpu_usage?.length || 1;
  if (sysDelta <= 0) return 0;
  return Math.round((cpuDelta / sysDelta) * numCpus * 100 * 10) / 10;
}

async function getDockerContainers() {
  const containers = await dockerApi('/containers/json?all=true');
  if (!Array.isArray(containers)) return null;

  // Stats nur für laufende Container (parallel, mit Timeout-Schutz)
  const running = containers.filter(c => c.State === 'running');
  const statsMap = {};
  if (running.length > 0 && running.length <= 30) { // Limit: max 30 Container
    const results = await Promise.allSettled(
      running.map(c =>
        dockerApi(`/containers/${c.Id}/stats?stream=false&one-shot=true`)
          .then(s => ({ id: c.Id, s }))
      )
    );
    results.forEach(r => {
      if (r.status === 'fulfilled' && r.value?.s) statsMap[r.value.id] = r.value.s;
    });
  }

  return containers.map(c => {
    const s    = statsMap[c.Id];
    const cpu  = s ? calcCpuPercent(s) : 0;
    const memUsed  = s?.memory_stats?.usage  || 0;
    const memLimit = s?.memory_stats?.limit  || 0;
    const netRx = Object.values(s?.networks || {}).reduce((a, n) => a + (n.rx_bytes || 0), 0);
    const netTx = Object.values(s?.networks || {}).reduce((a, n) => a + (n.tx_bytes || 0), 0);
    return {
      id:         c.Id.slice(0, 12),
      name:       (c.Names?.[0] || '').replace(/^\//, '') || c.Id.slice(0, 12),
      image:      c.Image,
      state:      c.State,
      status:     c.Status,
      cpu,
      memUsed,
      memLimit,
      memPercent: memLimit > 0 ? Math.round(memUsed / memLimit * 100 * 10) / 10 : 0,
      netRx,
      netTx,
      stack:      c.Labels?.['com.docker.compose.project'] || null,
      ports:      (c.Ports || []).filter(p => p.PublicPort)
                    .map(p => `${p.PublicPort}:${p.PrivatePort}/${p.Type}`).slice(0, 4),
      created:    c.Created,
    };
  });
}

async function getDockerOverview() {
  const [info, df, rawEvents] = await Promise.all([
    dockerApi('/info'),
    dockerApi('/system/df'),
    dockerApi(`/events?since=${Math.floor(Date.now() / 1000) - 86400}&until=${Math.floor(Date.now() / 1000)}&filters=${encodeURIComponent(JSON.stringify({ type: ['container'] }))}`),
  ]);

  if (!info) return null;

  // Events kommen als NDJSON-Stream (eine JSON-Zeile pro Event)
  let events = [];
  if (typeof rawEvents === 'string') {
    events = rawEvents.trim().split('\n')
      .filter(Boolean)
      .map(line => { try { return JSON.parse(line); } catch { return null; } })
      .filter(Boolean);
  } else if (Array.isArray(rawEvents)) {
    events = rawEvents;
  }
  events = events.slice(-50).reverse(); // Neueste zuerst, max 50

  return {
    containers: {
      running: info.ContainersRunning || 0,
      stopped: info.ContainersStopped || 0,
      paused:  info.ContainersPaused  || 0,
      total:   info.Containers || 0,
    },
    images:   info.Images || 0,
    volumes:  (await dockerApi('/volumes'))?.Volumes?.length || 0,
    networks: (await dockerApi('/networks'))?.length || 0,
    serverVersion: info.ServerVersion,
    df: df ? {
      images:     { size: df.LayersSize || 0, count: df.Images?.length || 0, reclaimable: df.Images?.reduce((a, i) => a + (i.Reclaimable || 0), 0) || 0 },
      containers: { size: df.Containers?.reduce((a, c) => a + (c.SizeRw || 0), 0) || 0, count: df.Containers?.length || 0 },
      volumes:    { size: df.Volumes?.reduce((a, v) => a + (v.UsageData?.Size || 0), 0) || 0, count: df.Volumes?.length || 0 },
    } : null,
    events: events.map(e => ({
      action: e.Action,
      actor:  e.Actor?.Attributes?.name || e.Actor?.ID?.slice(0, 12) || '',
      image:  e.Actor?.Attributes?.image || '',
      time:   e.time || e.timeNano,
    })),
  };
}

// ─── Firewall (UFW) ──────────────────────────────────────────────────────────

async function getFirewallStatus() {
  const { stdout } = await execAsync('ufw status verbose', { timeout: 5000 });
  return { status: stdout };
}

async function getFirewallRules() {
  try {
    const { stdout } = await execAsync('ufw status numbered', { timeout: 5000 });
    return stdout.split('\n').filter(l => /^\[\s*\d+\]/.test(l)).map(line => {
      const m = line.match(/^\[\s*(\d+)\]\s+(.+?)\s{2,}(.+?)\s{2,}(.+)$/);
      if (!m) return { raw: line.trim() };
      return { num: m[1].trim(), to: m[2].trim(), action: m[3].trim(), from: m[4].trim() };
    });
  } catch { return []; }
}

const _validPort  = (p) => {
  if (!p) throw new Error('Port erforderlich');
  const s = String(p);
  if (!/^\d{1,5}(:\d{1,5})?$/.test(s)) throw new Error('Ungültiger Port');
  return s;
};
const _validProto = (p) => { if (p && !['tcp', 'udp'].includes(p)) throw new Error('Ungültiges Protokoll'); return p; };
const _IPV4_RE    = /^(\d{1,3}\.){3}\d{1,3}(\/\d{1,2})?$/;
const _IPV6_RE    = /^[0-9a-fA-F:]+(%[a-z0-9]+)?(\/\d{1,3})?$/;
const _validFrom  = (f) => {
  if (!f) return f;
  if (!_IPV4_RE.test(f) && !_IPV6_RE.test(f)) throw new Error('Ungültige IP/CIDR');
  return f;
};

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

// Netzwerk-Traffic aus /proc/net/dev (2× lesen, Rate berechnen)
async function getNetworkStats() {
  try {
    const readNet = () => {
      const lines = fs.readFileSync('/proc/net/dev', 'utf8').split('\n').slice(2);
      const out = {};
      for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        if (parts.length < 10) continue;
        const iface = parts[0].replace(':', '');
        out[iface] = { rx: parseInt(parts[1]) || 0, tx: parseInt(parts[9]) || 0 };
      }
      return out;
    };
    const s1 = readNet();
    await sleep(1000);
    const s2 = readNet();
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
  if (TOKEN && req.headers['x-agent-token'] !== TOKEN) {
    return respond(res, 401, { error: 'Unauthorized' });
  }

  const url = req.url.split('?')[0];

  try {
    // ── System ────────────────────────────────────────────────────────────────
    if (url === '/ping' && req.method === 'GET') {
      respond(res, 200, { ok: true, hostname: os.hostname(), tls: req.socket.encrypted || false, version: VERSION });

    } else if (url === '/version' && req.method === 'GET') {
      respond(res, 200, { version: VERSION, nodeVersion: process.version });

    } else if (url === '/update' && req.method === 'POST') {
      const tmpPath  = path.join(DIR, '_panel-agent.new.js');
      const selfPath = path.join(DIR, 'panel-agent.js');
      try {
        await downloadFile(REPO_RAW, tmpPath);
        const content    = fs.readFileSync(tmpPath, 'utf8');
        const newVersion = (content.match(/^const VERSION\s*=\s*['"]([^'"]+)['"]/m) || [])[1] || 'unbekannt';
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

    // ── Docker ────────────────────────────────────────────────────────────────
    } else if (url === '/docker' && req.method === 'GET') {
      const overview = await getDockerOverview();
      if (!overview) return respond(res, 503, { error: 'Docker nicht verfügbar' });
      respond(res, 200, overview);

    } else if (url === '/docker/containers' && req.method === 'GET') {
      const containers = await getDockerContainers();
      if (!containers) return respond(res, 503, { error: 'Docker nicht verfügbar' });
      respond(res, 200, containers);

    } else if (url.startsWith('/docker/containers/') && req.method === 'POST') {
      const parts   = url.split('/');
      const cid     = parts[3];
      const action  = parts[4];
      const valid   = ['start', 'stop', 'restart', 'pause', 'unpause', 'kill'];
      if (!valid.includes(action)) return respond(res, 400, { error: 'Ungültige Aktion' });
      if (!/^[a-fA-F0-9]{12,64}$/.test(cid)) return respond(res, 400, { error: 'Ungültige Container-ID' });
      const result  = await dockerApi(`/containers/${cid}/${action}`, 'POST');
      respond(res, 200, { success: true, result });

    // ── Firewall ──────────────────────────────────────────────────────────────
    } else if (url === '/firewall/status' && req.method === 'GET') {
      respond(res, 200, await getFirewallStatus());

    } else if (url === '/firewall/rules' && req.method === 'GET') {
      respond(res, 200, await getFirewallRules());

    } else if ((url === '/firewall/allow' || url === '/firewall/deny') && req.method === 'POST') {
      const raw = await new Promise((resolve) => {
        let data = '';
        req.on('data', c => data += c);
        req.on('end', () => resolve(data));
      });
      const { port, proto, from } = JSON.parse(raw || '{}');
      const action = url.endsWith('/allow') ? 'allow' : 'deny';
      const p  = _validPort(port);
      const pr = _validProto(proto);
      const fr = _validFrom(from);
      const cmd = (action === 'allow' && fr)
        ? `ufw allow from ${fr} to any port ${p}${pr ? ' proto ' + pr : ''}`
        : `ufw ${action} ${p}${pr ? '/' + pr : ''}`;
      await execAsync(cmd, { timeout: 10000 });
      respond(res, 200, { success: true });

    } else if (url.startsWith('/firewall/rules/') && req.method === 'DELETE') {
      const num = url.split('/')[3];
      if (!/^\d+$/.test(num)) return respond(res, 400, { error: 'Ungültige Regel-Nummer' });
      await execAsync(`sh -c 'echo y | ufw delete ${num}'`, { timeout: 10000 });
      respond(res, 200, { success: true });

    // ── Netzwerk ──────────────────────────────────────────────────────────────
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

server.listen(PORT, '0.0.0.0', () => {
  const proto = useTLS ? 'HTTPS' : 'HTTP (kein Zertifikat gefunden — unsicher!)';
  console.log(`Panel Agent [${proto}] läuft auf Port ${PORT}`);
  if (!TOKEN) console.warn('WARNUNG: Kein PANEL_AGENT_TOKEN gesetzt!');
  if (fs.existsSync(DOCKER_SOCKET)) {
    console.log('Docker-Socket gefunden — Docker-Monitoring aktiv');
  } else {
    console.log('Kein Docker-Socket — Docker-Monitoring deaktiviert');
  }
});
