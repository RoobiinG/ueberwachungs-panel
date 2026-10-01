// ─── Whitelist (Security Center → Fail2Ban & Sperren) ────────────────────────
//
// Adressen und Netze, die auf keinem Server gesperrt werden: fail2ban ignoriert sie
// (ignoreip), und vor jeder Sperre der Panel-Tabelle steht für sie ein accept.
// Verteilt wird sie von utils/autoSperre.js (ab Agent v2.20.0).
//
// Lesen: security.view. Ändern: fail2ban.whitelist — ein eigenes Recht, weil ein Eintrag
// fail2ban für diese Adresse vollständig abschaltet (zunächst nur Admin-Rollen).

const express = require('express');
const db = require('../db');
const { requirePermission, getPermissions } = require('../middleware/requirePermission');
const { auditLog } = require('../utils/audit');
const { notifyAction } = require('../utils/actionNotify');
const { canAccessAgent } = require('../utils/agentAccess');
const { parseCidr, ueberlappt } = require('../utils/ipPruefung');
const { anreichern } = require('../utils/ipIntel');
const { agentApi, anfrageIp, agentFehler, whitelistEintraege, whitelistTreffer } = require('../utils/sperren');
const autoSperre = require('../utils/autoSperre');

const router = express.Router();
const MAX_EINTRAEGE = 500;

const saeubern = (s, max) =>
  (typeof s === 'string' ? s : '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

router.get('/', requirePermission('security.view'), (req, res) => {
  const eintraege = whitelistEintraege();
  const intel = anreichern(eintraege.map(e => e.cidr), { extern: false });
  const s = autoSperre.getStatus();
  const ip = anfrageIp(req);
  res.json({
    eintraege: eintraege.map(e => ({ ...e, intel: intel[e.cidr] || null })),
    server: s.server
      .filter(x => canAccessAgent(x.agentId, req.user?.role))
      .map(x => ({ agentId: x.agentId, name: x.name, whitelist: x.whitelist })),
    abgleich: { laeuft: s.running, lastRunAt: s.lastRunAt },
    deineIp: ip ? { ip, aufWhitelist: !!whitelistTreffer(ip) } : null,
    agentAb: autoSperre.AGENT_AB,
  });
});

router.post('/', requirePermission('fail2ban.whitelist'), async (req, res) => {
  let e;
  try { e = parseCidr(req.body?.cidr); } catch (err) { return res.status(400).json({ error: err.message }); }
  if (whitelistEintraege().length >= MAX_EINTRAEGE) return res.status(409).json({ error: `Die Whitelist ist voll (${MAX_EINTRAEGE} Einträge)` });
  const doppelt = whitelistTreffer(e);
  if (doppelt) return res.status(409).json({ error: `${e.cidr} überschneidet sich mit dem Eintrag ${doppelt.cidr}` });

  // Dauersperren, die die Whitelist sonst still außer Kraft setzen würde: nachfragen, dann aufheben.
  const sperren = db.prepare(`
    SELECT pb.agent_id, pb.cidr, ra.name FROM permanent_bans pb JOIN remote_agents ra ON ra.id = pb.agent_id
  `).all().filter(b => { try { return ueberlappt(e, parseCidr(b.cidr, { minPraefix: { 4: 0, 6: 0 } })); } catch { return false; } });
  const aufgehoben = [], fehlgeschlagen = [];
  if (sperren.length) {
    const liste = sperren.map(b => `${b.cidr} auf ${b.name}`).join(', ');
    if (req.body?.trotzdem !== true) {
      return res.status(409).json({
        error: `Dauerhaft gesperrt: ${liste}. Beim Aufnehmen in die Whitelist werden diese Sperren aufgehoben.`,
        bestaetigungNoetig: true,
      });
    }
    if (!getPermissions(req.user?.role).includes('fail2ban.ban')) {
      return res.status(403).json({ error: `Dauerhaft gesperrt: ${liste}. Zum Aufheben fehlt das Recht „IP dauerhaft sperren".` });
    }
    if (sperren.some(b => !canAccessAgent(b.agent_id, req.user?.role))) {
      return res.status(403).json({ error: 'Die Adresse ist auf einem Server dauerhaft gesperrt, auf den du keinen Zugriff hast.' });
    }
    for (const b of sperren) {
      const agent = db.prepare('SELECT * FROM remote_agents WHERE id = ?').get(b.agent_id);
      try {
        await agentApi(agent).post('/blocklist/remove', { cidr: b.cidr });
      } catch (err) {
        // 409 = steht dort ohnehin nicht (mehr) — dann nur den Panel-Eintrag aufräumen.
        if (err.response?.status !== 409) { fehlgeschlagen.push(`${b.name}: ${agentFehler(err)}`); continue; }
      }
      db.prepare('DELETE FROM permanent_bans WHERE agent_id = ? AND cidr = ?').run(b.agent_id, b.cidr);
      auditLog(req, 'agent.blocklist.remove', 'agent', b.name, { cidr: b.cidr, grund: 'Whitelist' });
      aufgehoben.push({ server: b.name, cidr: b.cidr });
    }
    if (fehlgeschlagen.length) {
      return res.status(502).json({ error: `Nicht alle Sperren ließen sich aufheben — Eintrag nicht angelegt: ${fehlgeschlagen.join(' · ')}`, aufgehoben });
    }
  }

  const notiz = saeubern(req.body?.notiz, 120) || null;
  try {
    db.prepare('INSERT INTO fail2ban_whitelist (cidr, notiz, erstellt_von) VALUES (?, ?, ?)').run(e.cidr, notiz, req.user?.username || null);
  } catch {
    return res.status(409).json({ error: `${e.cidr} steht bereits auf der Whitelist` });
  }
  auditLog(req, 'fail2ban.whitelist.add', 'whitelist', e.cidr, { notiz, aufgehoben });
  notifyAction(req, 'ip_whitelist', `alle Server: ${e.cidr}`).catch(() => {});
  autoSperre.anstossen();
  res.status(201).json({ success: true, cidr: e.cidr, aufgehoben });
});

router.delete('/:id', requirePermission('fail2ban.whitelist'), (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'Ungültige ID' });
  const w = db.prepare('SELECT cidr FROM fail2ban_whitelist WHERE id = ?').get(id);
  if (!w) return res.status(404).json({ error: 'Eintrag nicht gefunden' });
  db.prepare('DELETE FROM fail2ban_whitelist WHERE id = ?').run(id);
  auditLog(req, 'fail2ban.whitelist.remove', 'whitelist', w.cidr);
  notifyAction(req, 'ip_unwhitelist', `alle Server: ${w.cidr}`).catch(() => {});
  autoSperre.anstossen();
  res.json({ success: true, cidr: w.cidr });
});

module.exports = router;
