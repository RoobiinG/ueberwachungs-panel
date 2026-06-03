/**
 * firewallAdapters.js
 * Erkennt die aktive Firewall-Software und gibt einen einheitlichen Adapter zurück.
 * Unterstützte Tools: UFW, firewalld, nftables, iptables
 */

// ─── Validation Helpers ───────────────────────────────────────────────────────
const validPort  = (p) => { if (!/^\d{1,5}(:\d{1,5})?$/.test(String(p)) || (+p < 1 && !String(p).includes(':')) ) return null; return String(p); };
const validProto = (p) => ['tcp', 'udp'].includes(p) ? p : null;
const IPV4_RE    = /^(\d{1,3}\.){3}\d{1,3}(\/\d{1,2})?$/;
const IPV6_RE    = /^[0-9a-fA-F:]+(%[a-z0-9]+)?(\/\d{1,3})?$/;
const validFrom  = (f) => (!f || IPV4_RE.test(f) || IPV6_RE.test(f)) ? f || null : null;

// ─── Erkennung ────────────────────────────────────────────────────────────────
/**
 * @param {Function} exec  - async (cmd) => { stdout, stderr }
 * @returns {{ tool: string, active: boolean }}
 */
async function detectFirewall(exec) {
  // Nur AKTIVE Tools werden zurückgegeben — inaktive werden übersprungen

  // 1. UFW
  try {
    const { stdout } = await exec('which ufw 2>/dev/null');
    if (stdout.trim()) {
      const { stdout: s } = await exec('ufw status 2>/dev/null').catch(() => ({ stdout: '' }));
      if (/Status:\s*active/i.test(s)) return { tool: 'ufw', active: true };
      // UFW installiert aber inaktiv → nächstes Tool prüfen
    }
  } catch {}

  // 2. firewalld
  try {
    const { stdout } = await exec('which firewall-cmd 2>/dev/null');
    if (stdout.trim()) {
      const { stdout: s } = await exec('firewall-cmd --state 2>/dev/null').catch(() => ({ stdout: '' }));
      if (s.trim() === 'running') return { tool: 'firewalld', active: true };
    }
  } catch {}

  // 3. nftables
  try {
    const { stdout } = await exec('which nft 2>/dev/null');
    if (stdout.trim()) {
      await exec('nft list tables 2>/dev/null');
      return { tool: 'nftables', active: true };
    }
  } catch {}

  // 4. iptables (Fallback — wenn installiert, gilt als aktiv)
  try {
    const { stdout } = await exec('which iptables 2>/dev/null');
    if (stdout.trim()) return { tool: 'iptables', active: true };
  } catch {}

  return { tool: 'none', active: false };
}

// ─── Adapter-Factory ─────────────────────────────────────────────────────────
function getAdapter(tool, exec) {
  switch (tool) {
    case 'ufw':      return new UfwAdapter(exec);
    case 'firewalld':return new FirewalldAdapter(exec);
    case 'nftables': return new NftablesAdapter(exec);
    case 'iptables': return new IptablesAdapter(exec);
    default:         return null;
  }
}

// ─── UFW Adapter ─────────────────────────────────────────────────────────────
class UfwAdapter {
  constructor(exec) { this.exec = exec; }

  async getStatus() {
    const { stdout } = await this.exec('ufw status verbose');
    return { tool: 'ufw', active: /Status:\s*active/i.test(stdout), rawOutput: stdout };
  }

  async getRules() {
    const { stdout } = await this.exec('ufw status numbered');
    return stdout.split('\n')
      .filter(l => l.match(/^\[\s*\d+\]/))
      .map(line => {
        const m = line.match(/^\[\s*(\d+)\]\s+(.+?)\s{2,}(.+?)\s{2,}(.+)$/);
        if (!m) return { id: null, port: '?', proto: 'any', action: '?', from: 'any', raw: line.trim() };
        const to = m[2].trim();
        const portMatch = to.match(/^(\d[\d:]*)(?:\/(tcp|udp))?/i);
        return {
          id:     m[1].trim(),
          port:   portMatch ? portMatch[1] : to,
          proto:  portMatch?.[2]?.toLowerCase() ?? 'any',
          action: m[3].trim().toLowerCase().startsWith('allow') ? 'allow' : 'deny',
          from:   m[4].trim() === 'Anywhere' ? 'any' : m[4].trim(),
          raw:    line.trim(),
        };
      });
  }

  async allow(port, proto, from) {
    const p = validPort(port); if (!p) throw new Error('Ungültiger Port');
    const pr = validProto(proto);
    const fr = validFrom(from);
    const cmd = fr
      ? `ufw allow from ${fr} to any port ${p}${pr ? ' proto ' + pr : ''}`
      : `ufw allow ${p}${pr ? '/' + pr : ''}`;
    const { stdout } = await this.exec(cmd);
    return stdout;
  }

  async deny(port, proto) {
    const p = validPort(port); if (!p) throw new Error('Ungültiger Port');
    const pr = validProto(proto);
    const { stdout } = await this.exec(`ufw deny ${p}${pr ? '/' + pr : ''}`);
    return stdout;
  }

  async deleteRule(id) {
    if (!/^\d+$/.test(String(id))) throw new Error('Ungültige Regel-ID');
    const { stdout } = await this.exec(`sh -c 'echo y | ufw delete ${id}'`);
    return stdout;
  }
}

// ─── iptables Adapter ─────────────────────────────────────────────────────────
class IptablesAdapter {
  constructor(exec) { this.exec = exec; }

  async getStatus() {
    try {
      const { stdout } = await this.exec('iptables -L INPUT -n --line-numbers 2>/dev/null');
      return { tool: 'iptables', active: true, rawOutput: stdout };
    } catch (e) {
      return { tool: 'iptables', active: false, rawOutput: e.message };
    }
  }

  async getRules() {
    const { stdout } = await this.exec('iptables -L INPUT -n --line-numbers 2>/dev/null');
    const rules = [];
    for (const line of stdout.split('\n').slice(2)) { // erste 2 Zeilen = Header
      const m = line.match(/^(\d+)\s+(ACCEPT|DROP|REJECT)\s+(\w+)\s+--\s+(\S+)\s+\S+(?:.*dpt:(\d+)(?::(\d+))?)?/i);
      if (!m) continue;
      rules.push({
        id:     m[1],
        port:   m[6] ? `${m[5]}:${m[6]}` : (m[5] || 'any'),
        proto:  m[3].toLowerCase() === 'all' ? 'any' : m[3].toLowerCase(),
        action: m[2].toLowerCase() === 'accept' ? 'allow' : 'deny',
        from:   m[4] === '0.0.0.0/0' ? 'any' : m[4],
        raw:    line.trim(),
      });
    }
    return rules;
  }

  async allow(port, proto, from) {
    const p = validPort(port); if (!p) throw new Error('Ungültiger Port');
    const pr = validProto(proto) || 'tcp';
    const fr = validFrom(from);
    const src = fr ? `-s ${fr}` : '';
    const portRange = p.includes(':') ? `--dport ${p.replace(':', ':')}` : `--dport ${p}`;
    const { stdout } = await this.exec(`iptables -I INPUT -p ${pr} ${src} ${portRange} -j ACCEPT`);
    await this._persist();
    return stdout;
  }

  async deny(port, proto) {
    const p = validPort(port); if (!p) throw new Error('Ungültiger Port');
    const pr = validProto(proto) || 'tcp';
    const portRange = p.includes(':') ? `--dport ${p}` : `--dport ${p}`;
    const { stdout } = await this.exec(`iptables -I INPUT -p ${pr} ${portRange} -j DROP`);
    await this._persist();
    return stdout;
  }

  async deleteRule(id) {
    if (!/^\d+$/.test(String(id))) throw new Error('Ungültige Regel-Nummer');
    const { stdout } = await this.exec(`iptables -D INPUT ${id}`);
    await this._persist();
    return stdout;
  }

  async _persist() {
    // Regeln persistieren sofern iptables-persistent installiert
    try { await this.exec('sh -c "iptables-save > /etc/iptables/rules.v4 2>/dev/null || true"'); } catch {}
  }
}

// ─── nftables Adapter ─────────────────────────────────────────────────────────
class NftablesAdapter {
  constructor(exec) { this.exec = exec; }

  async getStatus() {
    try {
      const { stdout } = await this.exec('nft list tables 2>/dev/null');
      return { tool: 'nftables', active: true, rawOutput: stdout };
    } catch (e) {
      return { tool: 'nftables', active: false, rawOutput: e.message };
    }
  }

  async getRules() {
    const rules = [];
    try {
      // JSON-Output versuchen (nft >= 0.9.1)
      const { stdout } = await this.exec('nft -j list ruleset 2>/dev/null');
      const parsed = JSON.parse(stdout);
      const items = parsed?.nftables || [];
      for (const item of items) {
        if (!item.rule) continue;
        const rule = item.rule;
        const handle = String(rule.handle ?? '');
        const expr = rule.expr || [];
        // Verdict (accept/drop)
        const verdict = expr.find(e => e.accept !== undefined || e.drop !== undefined || e?.jump || e?.verdict);
        const action = verdict ? (verdict.accept !== undefined ? 'allow' : 'deny') : 'unknown';
        // Port
        let port = 'any', proto = 'any';
        for (const e of expr) {
          if (e.match?.left?.payload?.field === 'dport') {
            const right = e.match?.right;
            port = typeof right === 'object' ? `${right.range?.[0]}:${right.range?.[1]}` : String(right ?? 'any');
          }
          if (e.match?.left?.meta?.key === 'l4proto' || e.match?.left?.payload?.protocol) {
            proto = String(e.match?.right ?? 'any');
          }
        }
        rules.push({ id: handle, port, proto, action, from: 'any', raw: JSON.stringify(rule) });
      }
    } catch {
      // Fallback: Text-Output parsen
      try {
        const { stdout } = await this.exec('nft list ruleset 2>/dev/null');
        for (const line of stdout.split('\n')) {
          const m = line.match(/(\w+)\s+dport\s+(\S+)\s+(accept|drop).*#\s*handle\s+(\d+)/i);
          if (m) {
            rules.push({
              id:     m[4],
              port:   m[2].replace('{', '').replace('}', '').trim(),
              proto:  m[1].toLowerCase(),
              action: m[3].toLowerCase() === 'accept' ? 'allow' : 'deny',
              from:   'any',
              raw:    line.trim(),
            });
          }
        }
      } catch {}
    }
    return rules;
  }

  async allow(port, proto, _from) {
    const p = validPort(port); if (!p) throw new Error('Ungültiger Port');
    const pr = validProto(proto) || 'tcp';
    const dport = p.includes(':') ? `{ ${p.replace(':', '-')} }` : p;
    await this._ensureChain();
    const { stdout } = await this.exec(`nft add rule inet filter input ${pr} dport ${dport} accept`);
    return stdout;
  }

  async deny(port, proto) {
    const p = validPort(port); if (!p) throw new Error('Ungültiger Port');
    const pr = validProto(proto) || 'tcp';
    const dport = p.includes(':') ? `{ ${p.replace(':', '-')} }` : p;
    await this._ensureChain();
    const { stdout } = await this.exec(`nft add rule inet filter input ${pr} dport ${dport} drop`);
    return stdout;
  }

  async deleteRule(id) {
    if (!/^\d+$/.test(String(id))) throw new Error('Ungültiger Handle');
    const { stdout } = await this.exec(`nft delete rule inet filter input handle ${id}`);
    return stdout;
  }

  async _ensureChain() {
    // Sicherstellen dass die Tabelle/Chain existiert
    try { await this.exec('nft add table inet filter 2>/dev/null'); } catch {}
    try { await this.exec('nft add chain inet filter input \'{ type filter hook input priority 0; }\' 2>/dev/null'); } catch {}
  }
}

// ─── firewalld Adapter ────────────────────────────────────────────────────────
class FirewalldAdapter {
  constructor(exec) { this.exec = exec; }

  async getStatus() {
    try {
      const { stdout } = await this.exec('firewall-cmd --state 2>/dev/null');
      return { tool: 'firewalld', active: stdout.trim() === 'running', rawOutput: stdout };
    } catch (e) {
      return { tool: 'firewalld', active: false, rawOutput: e.message };
    }
  }

  async getRules() {
    const rules = [];
    try {
      // Ports
      const { stdout: portsOut } = await this.exec('firewall-cmd --list-ports 2>/dev/null');
      const ports = portsOut.trim().split(/\s+/).filter(Boolean);
      for (const portProto of ports) {
        const [p, pr] = portProto.split('/');
        rules.push({
          id:     portProto,  // firewalld: ID = port/proto (kein Handle)
          port:   p,
          proto:  pr || 'tcp',
          action: 'allow',
          from:   'any',
          raw:    portProto,
        });
      }
      // Services
      const { stdout: svcOut } = await this.exec('firewall-cmd --list-services 2>/dev/null');
      const services = svcOut.trim().split(/\s+/).filter(Boolean);
      for (const svc of services) {
        rules.push({ id: `svc:${svc}`, port: svc, proto: 'service', action: 'allow', from: 'any', raw: svc });
      }
    } catch {}
    return rules;
  }

  async allow(port, proto, _from) {
    const p = validPort(port); if (!p) throw new Error('Ungültiger Port');
    const pr = validProto(proto) || 'tcp';
    await this.exec(`firewall-cmd --permanent --add-port=${p}/${pr}`);
    await this.exec('firewall-cmd --reload');
    return `Port ${p}/${pr} freigegeben`;
  }

  async deny(port, proto) {
    return this.deleteRule(`${port}/${proto || 'tcp'}`);
  }

  async deleteRule(id) {
    // ID ist entweder "PORT/PROTO" oder "svc:SERVICE"
    if (id.startsWith('svc:')) {
      const svc = id.slice(4);
      await this.exec(`firewall-cmd --permanent --remove-service=${svc}`);
    } else {
      const [p, pr] = id.split('/');
      await this.exec(`firewall-cmd --permanent --remove-port=${p}/${pr || 'tcp'}`);
    }
    await this.exec('firewall-cmd --reload');
    return `Regel ${id} entfernt`;
  }
}

module.exports = { detectFirewall, getAdapter };
