/**
 * patchmonNotifier.js
 * Prüft periodisch die PatchMon-Hosts und benachrichtigt via Webhook,
 * sobald NEUE Updates auftauchen (Zähler steigt gegenüber dem letzten Snapshot).
 *
 * Konfiguration (settings-Tabelle):
 *   patchmonNotifyEnabled       '1' | '0'
 *   patchmonNotifyWebhookId      Webhook-ID
 *   patchmonNotifySecurityOnly  '1' | '0'  (nur bei neuen Security-Updates melden)
 *   patchmonNotifySnapshot       JSON { [hostId]: { u, s } } — interner Zustand
 */
const db              = require('./db');
const { sendWebhook } = require('./utils/sendWebhook');
const patchmon        = require('./routes/patchmon');   // exportiert .fetchHosts

const getSetting = (k) => db.prepare('SELECT value FROM settings WHERE key = ?').get(k)?.value ?? null;
const setSetting = (k, v) => db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(k, v);

const INTERVAL = 15 * 60 * 1000; // 15 Minuten

async function check() {
  if (getSetting('patchmonNotifyEnabled') !== '1') return;

  const webhookId = getSetting('patchmonNotifyWebhookId');
  if (!webhookId) return;

  const url    = getSetting('patchmonUrl');
  const key    = getSetting('patchmonTokenKey');
  const secret = getSetting('patchmonTokenSecret');
  if (!url || !key || !secret) return;

  const wh = db.prepare('SELECT type, url, active FROM webhooks WHERE id = ?').get(webhookId);
  if (!wh || !wh.active) return;

  const securityOnly = getSetting('patchmonNotifySecurityOnly') === '1';

  let hosts;
  try { ({ hosts } = await patchmon.fetchHosts(url, key, secret)); }
  catch { return; } // PatchMon nicht erreichbar → still überspringen

  let snap = {};
  try { snap = JSON.parse(getSetting('patchmonNotifySnapshot') || '{}'); } catch {}
  const isFirstRun = Object.keys(snap).length === 0;

  const newSnap = {};
  const changed = [];
  for (const h of hosts) {
    const u = h.updatesCount  || 0;
    const s = h.securityCount || 0;
    newSnap[h.id] = { u, s };

    const prev        = snap[h.id] || { u: 0, s: 0 };
    const metric      = securityOnly ? s : u;
    const prevMetric  = securityOnly ? prev.s : prev.u;
    if (metric > prevMetric) changed.push({ h, u, s });
  }

  setSetting('patchmonNotifySnapshot', JSON.stringify(newSnap));

  // Erster Lauf: nur Snapshot anlegen, nicht die bereits vorhandenen Updates melden.
  if (isFirstRun || changed.length === 0) return;

  const lines = changed
    .map(c => `• ${c.h.name}: ${c.u} Update${c.u === 1 ? '' : 's'}${c.s > 0 ? ` (${c.s} Security)` : ''}`)
    .join('\n');
  const title = securityOnly ? '🔒 PatchMon: Neue Security-Updates' : '🔧 PatchMon: Neue Updates verfügbar';
  try {
    await sendWebhook({ type: wh.type, url: wh.url }, `${title}\n${lines}`);
  } catch (err) {
    console.error('[PatchMon-Notifier] Webhook fehlgeschlagen:', err.message);
  }
}

function start() {
  setTimeout(() => check().catch(() => {}), 20_000);           // kurz nach Start
  setInterval(() => check().catch(() => {}), INTERVAL);        // danach alle 15 min
  console.log('PatchMon-Notifier gestartet (alle 15 min)');
}

module.exports = { start };
