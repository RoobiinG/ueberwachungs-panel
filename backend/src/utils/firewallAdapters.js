/**
 * firewallAdapters.js
 * Erkennt die aktive Firewall-Software und gibt einen einheitlichen Adapter zurück.
 * Unterstützte Tools: UFW, firewalld, nftables, iptables
 */

// ─── Validation Helpers ───────────────────────────────────────────────────────

// Einzelport oder Bereich „von:bis". Die alte Fassung prüfte nur auf bis zu fünf
// Ziffern — „99999" galt damit als gültig und lief erst im Firewall-Tool auf einen
// Fehler, der beim Benutzer als unverständliche Rohausgabe ankam.
const validPort = (p) => {
  const s = String(p ?? '').trim();
  const m = s.match(/^(\d{1,5})(?::(\d{1,5}))?$/);
  if (!m) return null;
  const lo = +m[1];
  const hi = m[2] != null ? +m[2] : lo;
  if (lo < 1 || hi > 65535 || lo > hi) return null;
  return s;
};

const validProto = (p) => ['tcp', 'udp'].includes(p) ? p : null;

const IPV4_RE = /^(\d{1,3}\.){3}\d{1,3}(\/\d{1,2})?$/;
// Der Doppelpunkt ist Pflicht: Ohne ihn galt jede reine Hex-Folge als IPv6-Adresse —
// „abc" kam so bis zum Firewall-Tool durch, das dann versuchte, einen Hostnamen
// aufzulösen. Im Test auf einem echten Server nachgestellt.
const IPV6_RE = /^(?=.*:)[0-9a-fA-F:]+(%[a-z0-9]+)?(\/\d{1,3})?$/;

// Eine angegebene Quelle muss gültig sein. Vorher wurde eine unbrauchbare Eingabe
// still zu `null` — die Regel galt dann für *alle* Quellen statt für die eine
// gewünschte, ohne dass es jemand gemerkt hätte. Deshalb wird jetzt geworfen.
const validFrom = (f) => {
  const s = String(f ?? '').trim();
  if (!s) return null;
  if (!IPV4_RE.test(s) && !IPV6_RE.test(s)) {
    throw new Error(`Ungültige Quell-Adresse: „${s}" — erwartet wird eine IPv4/IPv6-Adresse, optional mit Präfix (z. B. 10.0.0.0/8)`);
  }
  return s;
};

const isIPv6 = (addr) => addr.includes(':');

// Eine Zeile aus `ufw status numbered` zerlegen. Versteht auch Weiterleitungsregeln
// (ALLOW FWD), wie ufw-docker sie für veröffentlichte Container-Ports anlegt: dort steht
// im Ziel-Feld zusätzlich die Container-IP ("172.20.0.2 10080/tcp") und die Richtung ist
// FWD statt IN. Die alte Fassung las daraus "172" als Port und hängte den Kommentartext
// an die Quelle. `to` (Ziel) und `direction` (in|out|fwd) kommen dazu; die bisherigen
// Felder bleiben unverändert.
function parseUfwRuleLine(line) {
  const m = line.match(/^\[\s*(\d+)\]\s+(.*)$/);
  if (!m) return { id: null, port: '?', proto: 'any', action: '?', from: 'any', to: null, direction: 'in', raw: line.trim() };
  const id = m[1].trim();
  let rest = m[2];
  const hash = rest.indexOf('#');          // Kommentar abtrennen
  if (hash >= 0) rest = rest.slice(0, hash);
  const cols = rest.trim().split(/\s{2,}/);
  if (cols.length < 2) return { id, port: '?', proto: 'any', action: '?', from: 'any', to: null, direction: 'in', raw: line.trim() };
  const stripV6 = (s) => s.replace(/\s*\(v6\)\s*/i, ' ').trim();
  const toCol   = stripV6(cols[0]);
  const actCol  = (cols[1] || '').toUpperCase();
  const fromCol = stripV6(cols[2] || '');
  const action    = actCol.includes('ALLOW') ? 'allow' : 'deny';
  const direction = actCol.includes('FWD') ? 'fwd' : actCol.includes('OUT') ? 'out' : 'in';
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

// ─── Erkennung ────────────────────────────────────────────────────────────────
/**
 * @param {Function} exec  - async (cmd) => { stdout, stderr }
 * @returns {{ tool: string, active: boolean }}
 */
async function detectFirewall(exec) {
  // Wir geben das am höchsten abstrahierte Tool zurück, das installiert ist (z. B. UFW
  // vor iptables), auch wenn es gerade deaktiviert ist. Nur so kann das Panel anzeigen,
  // dass es ausgeschaltet ist, und einen "Aktivieren"-Button anbieten.

  // 1. UFW
  try {
    const { stdout } = await exec('which ufw 2>/dev/null');
    if (stdout.trim()) {
      const { stdout: s } = await exec('ufw status 2>/dev/null').catch(() => ({ stdout: '' }));
      return { tool: 'ufw', active: /Status:\s*active/i.test(s), rawOutput: s };
    }
  } catch {}

  // 2. firewalld
  try {
    const { stdout } = await exec('which firewall-cmd 2>/dev/null');
    if (stdout.trim()) {
      const { stdout: s } = await exec('firewall-cmd --state 2>/dev/null').catch(() => ({ stdout: '' }));
      return { tool: 'firewalld', active: s.trim() === 'running', rawOutput: s };
    }
  } catch {}

  // 3. nftables
  try {
    const { stdout } = await exec('which nft 2>/dev/null');
    if (stdout.trim()) {
      const { stdout: s } = await exec('nft -j list ruleset 2>/dev/null').catch(() => ({ stdout: '' }));
      // nftables hat keinen einzelnen "active" Status in dem Sinne,
      // wenn das Kommando klappt, ist es einsatzbereit.
      return { tool: 'nftables', active: true, rawOutput: s };
    }
  } catch {}

  // 4. iptables (Fallback — wenn installiert, gilt als aktiv)
  try {
    const { stdout } = await exec('which iptables 2>/dev/null');
    if (stdout.trim()) {
      const { stdout: s } = await exec('iptables -S INPUT 2>/dev/null').catch(() => ({ stdout: '' }));
      return { tool: 'iptables', active: true, rawOutput: s };
    }
  } catch {}

  return { tool: 'none', active: false };
}

// ─── Filtert die Firewall wirklich? ───────────────────────────────────────────
//
// `detectFirewall` beantwortet nur, welches Werkzeug vorhanden ist — bei nftables und
// iptables gilt es dort als „aktiv", sobald es installiert ist. Das ist irreführend: Auf
// einem Server mit Docker existieren immer nft-Tabellen (Docker legt sie für seine
// Weiterleitungen an), ohne dass eine einzige eingehende Verbindung gefiltert würde. Das
// Panel meldete deshalb „aktiv", wo in Wahrheit alles offen stand.
//
// Diese Prüfung schaut nach, ob eingehender Verkehr tatsächlich eingeschränkt wird, und
// begründet ihr Ergebnis in einem Satz, der in der Oberfläche angezeigt werden kann.
async function filterZustand(tool, exec, rawOutput = null) {
  const offen = (grund) => ({ filtert: false, grund });
  const dicht = (grund) => ({ filtert: true,  grund });

  try {
    if (tool === 'ufw') {
      const stdout = rawOutput !== null ? rawOutput : (await exec('ufw status 2>/dev/null')).stdout;
      return /Status:\s*active/i.test(stdout)
        ? dicht('UFW ist eingeschaltet und filtert eingehende Verbindungen.')
        : offen('UFW ist installiert, aber ausgeschaltet — es wird nichts gefiltert.');
    }

    if (tool === 'firewalld') {
      const stdout = rawOutput !== null ? rawOutput : (await exec('firewall-cmd --state 2>/dev/null')).stdout;
      return stdout.trim() === 'running'
        ? dicht('firewalld läuft und filtert eingehende Verbindungen.')
        : offen('firewalld ist installiert, läuft aber nicht — es wird nichts gefiltert.');
    }

    if (tool === 'iptables') {
      const stdout = rawOutput !== null ? rawOutput : (await exec('iptables -S INPUT 2>/dev/null')).stdout;
      if (/^-P INPUT (DROP|REJECT)/m.test(stdout)) {
        return dicht('Alles ist gesperrt, was keine ausdrückliche Freigabe hat (Standard-Regel DROP).');
      }
      const sperrend = stdout.split('\n')
        .filter(z => /^-A INPUT/.test(z))
        .some(z => /-j\s+(DROP|REJECT)/.test(z));
      return sperrend
        ? dicht('Die Standard-Regel lässt zwar alles durch, einzelne Regeln sperren aber gezielt.')
        : offen('Die INPUT-Kette lässt alles durch: Standard-Regel ACCEPT und keine sperrende Regel.');
    }

    if (tool === 'nftables') {
      const stdout = rawOutput !== null ? rawOutput : (await exec('nft -j list ruleset 2>/dev/null')).stdout;
      let daten = {};
      try { daten = JSON.parse(stdout || '{}'); } catch { return offen('Der nftables-Regelsatz war nicht lesbar.'); }
      const eintraege = Array.isArray(daten.nftables) ? daten.nftables : [];

      // Nur Ketten, die am Eingang hängen. Alles andere (Docker-Weiterleitungen, NAT)
      // sagt nichts darüber aus, ob eingehende Verbindungen gefiltert werden.
      const eingang = eintraege.map(e => e.chain).filter(c => c && c.hook === 'input');
      if (!eingang.length) {
        return offen('Es gibt keine Kette für eingehende Verbindungen — alle Verbindungen werden zugelassen.');
      }

      const gesperrt = eingang.filter(c => ['drop', 'reject'].includes(String(c.policy || '').toLowerCase()));
      if (gesperrt.length) {
        return dicht(`Alles ist gesperrt, was keine ausdrückliche Freigabe hat (Kette „${gesperrt[0].name}“ mit Standard-Regel ${gesperrt[0].policy}).`);
      }

      // Standard-Regel lässt durch — dann zählt, ob einzelne Regeln sperren.
      const namen = new Set(eingang.map(c => c.name));
      const sperrend = eintraege
        .map(e => e.rule)
        .filter(r => r && namen.has(r.chain))
        .some(r => (r.expr || []).some(a => {
          const v = a.drop !== undefined ? 'drop' : (a.reject !== undefined ? 'reject' : null);
          return v !== null;
        }));
      return sperrend
        ? dicht('Die Standard-Regel lässt zwar alles durch, einzelne Regeln sperren aber gezielt.')
        : offen('Die Kette für eingehende Verbindungen lässt alles durch: Standard-Regel accept und keine sperrende Regel.');
    }
  } catch (err) {
    return offen('Der Zustand ließ sich nicht ermitteln: ' + (err.message || String(err)).slice(0, 120));
  }
  return offen('Kein unterstütztes Firewall-Werkzeug gefunden.');
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
      .map(parseUfwRuleLine);
  }

  // `route` legt eine Weiterleitungsregel an (`ufw route allow/deny`) statt einer
  // INPUT-Regel — nötig für veröffentlichte Docker-Container-Ports, die die INPUT-Kette
  // umgehen. Ohne das würde ein Bearbeiten solcher Regeln sie wirkungslos machen.
  async allow(port, proto, from, route = false) { return this._rule(port, proto, from, 'allow', route); }

  // `from` wurde hier früher gar nicht entgegengenommen: Wer „Port 80 für 1.2.3.4
  // sperren" wollte, sperrte ihn in Wahrheit für alle.
  async deny(port, proto, from, route = false)  { return this._rule(port, proto, from, 'deny', route); }

  async _rule(port, proto, from, action, route) {
    const p = validPort(port); if (!p) throw new Error('Ungültiger Port');
    const pr = validProto(proto);
    const fr = validFrom(from);
    let cmd;
    if (route) {
      cmd = `ufw route ${action}${pr ? ' proto ' + pr : ''}${fr ? ' from ' + fr : ''} to any port ${p}`;
    } else {
      cmd = fr
        ? `ufw ${action} from ${fr} to any port ${p}${pr ? ' proto ' + pr : ''}`
        : `ufw ${action} ${p}${pr ? '/' + pr : ''}`;
    }
    const { stdout } = await this.exec(cmd);
    return stdout;
  }

  async deleteRule(id) {
    if (!/^\d+$/.test(String(id))) throw new Error('Ungültige Regel-ID');
    const { stdout } = await this.exec(`sh -c 'echo y | ufw delete ${id}'`);
    return stdout;
  }

  async enable()  { const { stdout } = await this.exec('ufw --force enable');  return stdout; }
  async disable() { const { stdout } = await this.exec('ufw disable');          return stdout; }
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

  async allow(port, proto, from) { return this._rule(port, proto, from, 'ACCEPT'); }
  async deny (port, proto, from) { return this._rule(port, proto, from, 'DROP');   }

  async _rule(port, proto, from, target) {
    const p = validPort(port); if (!p) throw new Error('Ungültiger Port');
    const pr = validProto(proto) || 'tcp';
    const fr = validFrom(from);
    // Das Panel verwaltet hier bewusst nur die IPv4-Tabelle. Eine IPv6-Quelle würde
    // ip6tables erfordern; die Regel landete dann in einer Tabelle, die diese Seite gar
    // nicht anzeigt. Lieber klar ablehnen als eine unsichtbare Regel anlegen.
    if (fr && isIPv6(fr)) {
      throw new Error('IPv6-Quellen werden mit iptables nicht unterstützt — dafür wäre ip6tables nötig, das dieses Panel nicht verwaltet.');
    }
    const src = fr ? `-s ${fr} ` : '';
    const { stdout } = await this.exec(`iptables -I INPUT -p ${pr} ${src}--dport ${p} -j ${target}`);
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
    try { await this.exec('sh -c "iptables-save > /etc/iptables/rules.v4 2>/dev/null || true"'); } catch {}
  }

  async enable() {
    try { await this.exec('systemctl start iptables 2>/dev/null'); return 'iptables gestartet'; }
    catch {
      // Ohne systemd-Dienst bleibt nur die Standard-Policy. `-P INPUT DROP` allein trennt
      // dabei aber auch die bestehende SSH-Sitzung und alle laufenden Verbindungen — der
      // Server wäre in derselben Sekunde weg. Deshalb erst die beiden Regeln setzen, ohne
      // die ein DROP unweigerlich aussperrt: bestehende Verbindungen weiterlaufen lassen
      // und SSH offen halten. Beides ist unschädlich, falls es die Regeln schon gibt —
      // `-C` prüft das vorher.
      const sichern = async (regel) => {
        try { await this.exec(`iptables -C ${regel}`); }
        catch { await this.exec(`iptables -I ${regel}`); }
      };
      await sichern('INPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT');
      await sichern('INPUT -i lo -j ACCEPT');
      await sichern('INPUT -p tcp --dport 22 -j ACCEPT');
      await this.exec('iptables -P INPUT DROP');
      return 'Standard-Policy auf DROP gesetzt (SSH, Loopback und bestehende Verbindungen bleiben offen)';
    }
  }
  async disable() {
    try { await this.exec('systemctl stop iptables 2>/dev/null'); return 'iptables gestoppt'; }
    catch { await this.exec('iptables -P INPUT ACCEPT'); return 'Standard-Policy auf ACCEPT gesetzt'; }
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
      // JSON-Output (nft >= 0.9.1)
      const { stdout } = await this.exec('nft -j list ruleset 2>/dev/null');
      const parsed = JSON.parse(stdout);

      // Nur Ketten, die eingehenden Verkehr filtern. Ohne diese Einschränkung landete
      // auf einem Docker-Host das komplette Regelwerk in der Liste — NAT-Weiterleitungen,
      // FORWARD, raw und sämtliche DOCKER-*-Ketten, rund 50 Einträge, die mit einer
      // Firewall-Übersicht für eingehende Verbindungen nichts zu tun haben.
      const inputChains = new Set();
      for (const item of (parsed?.nftables || [])) {
        const c = item.chain;
        if (c?.hook === 'input') inputChains.add(`${c.family}/${c.table}/${c.name}`);
      }

      for (const item of (parsed?.nftables || [])) {
        if (!item.rule) continue;
        const rule = item.rule;
        if (!inputChains.has(`${rule.family}/${rule.table}/${rule.chain}`)) continue;
        const handle = String(rule.handle ?? '');
        const expr   = rule.expr || [];

        // ── Verdict bestimmen ────────────────────────────────────
        let action = 'unknown';
        for (const e of expr) {
          if ('accept' in e)            { action = 'allow'; break; }
          if ('drop' in e || 'reject' in e) { action = 'deny';  break; }
          if (e.verdict) {
            if ('accept' in e.verdict)            { action = 'allow'; break; }
            if ('drop' in e.verdict || 'reject' in e.verdict) { action = 'deny';  break; }
          }
        }
        if (action === 'unknown') continue; // Jump/Counter-only-Regeln überspringen

        // ── Port & Protokoll ────────────────────────────────────
        let port = null, proto = 'any';
        for (const e of expr) {
          const left  = e.match?.left;
          const right = e.match?.right;
          // dport — das Protokoll steht bei „tcp dport 80" im selben payload-Objekt.
          // Es wurde bisher nur gelesen, wenn *kein* Feld gesetzt war — also nie, wenn
          // es tatsächlich um einen Port ging. In der Liste stand deshalb immer „any".
          if (left?.payload?.field === 'dport') {
            if (right?.set)   port = right.set.map(String).join(', ');
            else if (right?.range) port = `${right.range[0]}:${right.range[1]}`;
            else if (right != null) port = String(right);
            if (left.payload.protocol) proto = String(left.payload.protocol);
          }
          // Protokoll aus meta l4proto (Zahl → Name)
          if (left?.meta?.key === 'l4proto') {
            const v = right;
            proto = v === 6 ? 'tcp' : v === 17 ? 'udp' : typeof v === 'string' ? v : proto;
          }
        }

        // ── Quell-IP (saddr) ────────────────────────────────────
        let from = 'any';
        for (const e of expr) {
          if (e.match?.left?.payload?.field === 'saddr') {
            const r = e.match?.right;
            from = r?.prefix
              ? `${r.prefix.addr}/${r.prefix.len}`
              : String(r ?? 'any');
          }
        }

        // Handles gelten nur je Tabelle — gelöscht wird nur in inet/filter/input. Alle anderen
        // Ketten bekommen eine eindeutige ID und sind schreibgeschützt (Spiegelung der
        // Regelliste in agent/panel-agent.js).
        const eigene = rule.family === 'inet' && rule.table === 'filter' && rule.chain === 'input';
        rules.push({
          id: eigene ? handle : `nft:${rule.family}:${rule.table}:${rule.chain}:${handle}`,
          port: port || 'any', proto, action, from, raw: JSON.stringify(rule),
          ...(eigene ? {} : { readonly: true }),
        });
      }
    } catch {
      // Fallback: Text-Output parsen
      try {
        const { stdout } = await this.exec('nft list ruleset 2>/dev/null');
        for (const line of stdout.split('\n')) {
          const m = line.match(/(\w+)\s+dport\s+(\S+)\s+(accept|drop|reject).*#\s*handle\s+(\d+)/i);
          if (m) rules.push({
            id:     m[4],
            port:   m[2].replace(/[{}]/g, '').trim(),
            proto:  m[1].toLowerCase(),
            action: m[3].toLowerCase() === 'accept' ? 'allow' : 'deny',
            from:   'any',
            raw:    line.trim(),
          });
        }
      } catch {}
    }
    return rules;
  }

  async allow(port, proto, from) { return this._rule(port, proto, from, 'accept'); }
  async deny (port, proto, from) { return this._rule(port, proto, from, 'drop');   }

  // Die Quelle wurde hier früher als `_from` entgegengenommen und weggeworfen — die
  // Regel galt dadurch immer für alle Absender. Die inet-Tabelle kann beide
  // Adressfamilien, das Schlüsselwort unterscheidet sich aber: ip bzw. ip6.
  async _rule(port, proto, from, verdict) {
    const p = validPort(port); if (!p) throw new Error('Ungültiger Port');
    const pr = validProto(proto) || 'tcp';
    const fr = validFrom(from);
    const dport = p.includes(':') ? `{ ${p.replace(':', '-')} }` : p;
    const saddr = fr ? `${isIPv6(fr) ? 'ip6' : 'ip'} saddr ${fr} ` : '';
    await this._ensureChain();
    const { stdout } = await this.exec(`nft add rule inet filter input ${saddr}${pr} dport ${dport} ${verdict}`);
    return stdout;
  }

  async deleteRule(id) {
    if (String(id).startsWith('nft:')) throw new Error('Diese Regel liegt nicht in „inet filter input" und wird nicht verwaltet');
    if (!/^\d+$/.test(String(id))) throw new Error('Ungültiger Handle');
    const { stdout } = await this.exec(`nft delete rule inet filter input handle ${id}`);
    return stdout;
  }

  async enable()  {
    try { await this.exec('systemctl start nftables 2>/dev/null'); return 'nftables gestartet'; }
    catch { await this._ensureChain(); return 'nftables-Chain sichergestellt'; }
  }
  async disable() {
    try { await this.exec('systemctl stop nftables 2>/dev/null'); return 'nftables gestoppt'; }
    catch { throw new Error('nftables kann nicht deaktiviert werden (kein systemctl)'); }
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

      // Rich Rules — alles, was eine Quelle einschränkt oder etwas sperrt, liegt hier.
      // Bewusst die permanente Liste: allow/deny schreiben ebenfalls permanent und laden
      // neu, damit Index und späteres Entfernen zusammenpassen.
      for (const [i, line] of (await this._richRules()).entries()) {
        const src = line.match(/source address="([^"]+)"/)?.[1];
        const prt = line.match(/port port="([^"]+)"/)?.[1];
        const pro = line.match(/protocol="([^"]+)"/)?.[1];
        rules.push({
          id:     `rich:${i}`,
          port:   prt ? prt.replace('-', ':') : 'any',
          proto:  pro || 'any',
          action: /\baccept\b/.test(line) ? 'allow' : 'deny',
          from:   src || 'any',
          raw:    line,
        });
      }
    } catch {}
    return rules;
  }

  async allow(port, proto, from) { return this._rule(port, proto, from, 'accept'); }
  async deny (port, proto, from) { return this._rule(port, proto, from, 'reject'); }

  // Ohne Quelle genügt --add-port. Sobald eine Quelle im Spiel ist — oder etwas gesperrt
  // statt erlaubt werden soll —, kann firewalld das nur über Rich Rules abbilden.
  // Früher wurde die Quelle stillschweigend verworfen und „sperren" hat die Erlaubnis
  // bloß entfernt, statt eine Sperre anzulegen.
  async _rule(port, proto, from, verdict) {
    const p  = validPort(port); if (!p) throw new Error('Ungültiger Port');
    const pr = validProto(proto) || 'tcp';
    const fr = validFrom(from);

    if (!fr && verdict === 'accept') {
      await this.exec(`firewall-cmd --permanent --add-port=${p}/${pr}`);
      await this.exec('firewall-cmd --reload');
      return `Port ${p}/${pr} freigegeben`;
    }

    const rule = this._buildRichRule(fr, p, pr, verdict);
    await this.exec(`firewall-cmd --permanent --add-rich-rule='${rule}'`);
    await this.exec('firewall-cmd --reload');
    return `Port ${p}/${pr}${fr ? ` für ${fr}` : ''} ${verdict === 'accept' ? 'freigegeben' : 'gesperrt'}`;
  }

  _buildRichRule(from, port, proto, verdict) {
    // firewalld schreibt Bereiche mit Bindestrich, das Panel mit Doppelpunkt.
    const portSpec = port.replace(':', '-');
    const family   = from ? ` family="${isIPv6(from) ? 'ipv6' : 'ipv4'}"` : '';
    const source   = from ? ` source address="${from}"` : '';
    return `rule${family}${source} port port="${portSpec}" protocol="${proto}" ${verdict}`;
  }

  async _richRules() {
    try {
      const { stdout } = await this.exec('firewall-cmd --permanent --list-rich-rules 2>/dev/null');
      return stdout.split('\n').map(l => l.trim()).filter(Boolean);
    } catch { return []; }
  }

  async enable()  {
    await this.exec('systemctl start firewalld');
    await this.exec('firewall-cmd --reload 2>/dev/null').catch(() => {});
    return 'firewalld gestartet';
  }
  async disable() {
    await this.exec('systemctl stop firewalld');
    return 'firewalld gestoppt';
  }

  // ID ist "PORT/PROTO", "svc:SERVICE" oder "rich:INDEX"
  async deleteRule(id) {
    const s = String(id);

    if (/^rich:\d+$/.test(s)) {
      const lines  = await this._richRules();
      const target = lines[+s.slice(5)];
      if (!target) throw new Error('Regel nicht gefunden — die Liste hat sich zwischenzeitlich geändert. Bitte neu laden.');
      // Die Zeile geht in einfachen Anführungszeichen an die Shell; ein einfaches
      // Anführungszeichen darin würde daraus ausbrechen. firewalld erzeugt so etwas
      // nicht, geprüft wird es trotzdem.
      if (target.includes("'")) throw new Error('Regel enthält unerwartete Zeichen und wird nicht entfernt.');
      await this.exec(`firewall-cmd --permanent --remove-rich-rule='${target}'`);

    } else if (s.startsWith('svc:')) {
      const svc = s.slice(4);
      if (!/^[\w.-]{1,64}$/.test(svc)) throw new Error('Ungültiger Dienst-Name');
      await this.exec(`firewall-cmd --permanent --remove-service=${svc}`);

    } else {
      const [p, pr] = s.split('/');
      if (!validPort(p)) throw new Error('Ungültiger Port');
      if (pr && !validProto(pr)) throw new Error('Ungültiges Protokoll');
      await this.exec(`firewall-cmd --permanent --remove-port=${p}/${pr || 'tcp'}`);
    }

    await this.exec('firewall-cmd --reload');
    return `Regel ${s} entfernt`;
  }
}

module.exports = { detectFirewall, getAdapter, filterZustand };
