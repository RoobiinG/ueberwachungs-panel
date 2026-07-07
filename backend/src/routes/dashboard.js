const router = require('express').Router();
const db     = require('../db');
const patchmon = require('./patchmon');   // .fetchHosts
const { getPermissions } = require('../middleware/requirePermission');

const getSetting = (k) => db.prepare('SELECT value FROM settings WHERE key = ?').get(k)?.value ?? null;

// SQLite-Datetime (UTC ohne Marker) oder ISO → Epoch ms
const toEpoch = (s) => {
  if (!s) return 0;
  if (typeof s === 'number') return s;
  if (/[zZ]|[+-]\d\d:?\d\d$/.test(s)) return new Date(s).getTime();
  return new Date(s.replace(' ', 'T') + 'Z').getTime();
};

const AUDIT_VERB = { create:'angelegt', add:'hinzugefügt', edit:'bearbeitet', update:'aktualisiert', delete:'gelöscht', start:'gestartet', stop:'gestoppt', restart:'neugestartet', enable:'aktiviert', disable:'deaktiviert', allow:'erlaubt', deny:'gesperrt', test:'getestet', repin:'neu gepinnt', uninstall:'deinstalliert' };
const AUDIT_NOUN = { agent:'Server', container:'Container', docker:'Container', service:'Dienst', firewall:'Firewall', rule:'Firewall-Regel', webhook:'Webhook', user:'Benutzer', role:'Rolle', alert_rule:'Alert-Regel', alert:'Alert-Regel', settings:'Einstellung' };
function auditLabel(action, name) {
  if (action === 'login') return 'Anmeldung';
  const [obj, verb] = String(action || '').split('.');
  const noun = AUDIT_NOUN[obj] || obj || 'Aktion';
  const v = AUDIT_VERB[verb] || verb || '';
  return `${noun}${name ? ` „${name}"` : ''}${v ? ' ' + v : ''}`.trim();
}

// GET /api/dashboard/activity — gemergter Ereignis-Feed (Alerts + Audit + PatchMon)
router.get('/activity', async (req, res) => {
  const perms  = getPermissions(req.user?.role || '');
  const events = [];

  // Alerts
  try {
    const rows = db.prepare(`
      SELECT h.triggered_at, h.type, r.name AS rule_name, a.name AS agent_name
      FROM alert_history h
      LEFT JOIN alert_rules   r ON h.rule_id  = r.id
      LEFT JOIN remote_agents a ON r.agent_id = a.id
      ORDER BY h.triggered_at DESC LIMIT 15
    `).all();
    for (const r of rows) {
      const fired = r.type !== 'resolved';
      events.push({
        kind: 'alert', severity: fired ? 'danger' : 'success',
        title: `${fired ? 'Alert ausgelöst' : 'Alert erholt'} — ${r.rule_name || 'Regel'}`,
        sub: r.agent_name || 'Lokal', at: toEpoch(r.triggered_at),
      });
    }
  } catch {}

  // Audit-Aktionen (nur mit Recht)
  if (perms.includes('audit.view')) {
    try {
      const rows = db.prepare('SELECT username, action, target_name, created_at FROM audit_log ORDER BY created_at DESC LIMIT 15').all();
      for (const r of rows) {
        events.push({
          kind: 'audit', severity: r.action === 'login' ? 'login' : 'info',
          title: auditLabel(r.action, r.target_name), sub: r.username || 'System', at: toEpoch(r.created_at),
        });
      }
    } catch {}
  }

  // PatchMon: Server mit Updates (Stand = letzter Check-in)
  if (perms.includes('patchmon.view')) {
    const url = getSetting('patchmonUrl'), key = getSetting('patchmonTokenKey'), sec = getSetting('patchmonTokenSecret');
    if (url && key && sec) {
      try {
        const { hosts } = await patchmon.fetchHosts(url, key, sec);
        for (const h of hosts) {
          if (!h.updatesAvailable) continue;
          events.push({
            kind: 'patchmon', severity: 'warning',
            title: `PatchMon — ${h.updatesCount} Update${h.updatesCount === 1 ? '' : 's'}${h.securityCount > 0 ? ` (${h.securityCount} Security)` : ''}`,
            sub: h.name, at: toEpoch(h.lastCheckIn),
          });
        }
      } catch {}
    }
  }

  events.sort((a, b) => b.at - a.at);
  res.json({ events: events.slice(0, 18) });
});

// GET  /api/dashboard/layout  — Layout des angemeldeten Users
router.get('/layout', (req, res) => {
  const row = db.prepare('SELECT layout FROM dashboard_layouts WHERE user_id = ?').get(req.user.id);
  res.json({ layout: row ? JSON.parse(row.layout) : null });
});

// PUT  /api/dashboard/layout  — Layout speichern
router.put('/layout', (req, res) => {
  const { layout } = req.body;
  if (!Array.isArray(layout)) return res.status(400).json({ error: 'layout muss ein Array sein' });
  db.prepare(`
    INSERT INTO dashboard_layouts (user_id, layout, updated_at)
    VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(user_id) DO UPDATE SET layout = excluded.layout, updated_at = CURRENT_TIMESTAMP
  `).run(req.user.id, JSON.stringify(layout));
  res.json({ ok: true });
});

// GET/PUT /api/dashboard/home-layout — Layout der Startseite (Dashboard), separat vom Monitoring
router.get('/home-layout', (req, res) => {
  const row = db.prepare('SELECT layout FROM home_layouts WHERE user_id = ?').get(req.user.id);
  res.json({ layout: row ? JSON.parse(row.layout) : null });
});
router.put('/home-layout', (req, res) => {
  const { layout } = req.body;
  if (!Array.isArray(layout)) return res.status(400).json({ error: 'layout muss ein Array sein' });
  db.prepare(`
    INSERT INTO home_layouts (user_id, layout, updated_at)
    VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(user_id) DO UPDATE SET layout = excluded.layout, updated_at = CURRENT_TIMESTAMP
  `).run(req.user.id, JSON.stringify(layout));
  res.json({ ok: true });
});

module.exports = router;
