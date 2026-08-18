// ─── Pelican Panel ────────────────────────────────────────────────────────────
//
// Gameserver, die über das Pelican Panel verwaltet werden, laufen als Docker-Container,
// deren Name die Server-UUID ist (z. B. 6d3bdebc-ded6-48aa-84a7-c268d4d07e83). Im
// Überwachungs-Panel ist davon nichts abzulesen. Hier wird deshalb die Zuordnung
// UUID → Klarname geholt.
//
// Es wird ausschließlich gelesen; an den Containern selbst ändert sich nichts.
// Die Schnittstelle ist Pterodactyl-kompatibel: GET /api/application/servers,
// Anmeldung per Bearer-Token (im Pelican Panel unter Admin → API Credentials).

const axios = require('axios');
const db    = require('../db');

const getSetting = (k) =>
  db.prepare('SELECT value FROM settings WHERE key = ?').get(k)?.value ?? '';

const CACHE_MS = 5 * 60 * 1000;
let cache = { zeit: 0, karte: null };

function konfiguration() {
  const url   = (getSetting('pelicanUrl') || '').trim().replace(/\/+$/, '');
  const token = (getSetting('pelicanToken') || '').trim();
  return { url, token, fertig: !!(url && token) };
}

function client(timeout = 15000) {
  const { url, token, fertig } = konfiguration();
  if (!fertig) throw new Error('Pelican ist nicht eingerichtet (URL oder API-Schlüssel fehlt)');
  return axios.create({
    baseURL: url,
    timeout,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept:        'application/json',
      'Content-Type': 'application/json',
    },
  });
}

// Alle Server holen — die Schnittstelle liefert seitenweise.
async function serverAbrufen() {
  const api = client();
  const gefunden = [];
  let seite = 1;
  let letzte = 1;

  do {
    let res;
    try {
      res = await api.get('/api/application/servers', { params: { per_page: 100, page: seite } });
    } catch (err) {
      const code = err.response?.status;
      if (code === 401 || code === 403) throw new Error('Pelican: API-Schlüssel ungültig oder ohne Berechtigung');
      if (code === 404) throw new Error('Pelican: Adresse erreichbar, aber keine Application-API gefunden — stimmt die URL?');
      throw new Error(`Pelican: ${err.response?.data?.errors?.[0]?.detail || err.message}`);
    }

    for (const eintrag of (res.data?.data || [])) {
      const a = eintrag?.attributes;
      if (a?.uuid && a?.name) {
        gefunden.push({ uuid: String(a.uuid), kurz: String(a.identifier || ''), name: String(a.name) });
      }
    }

    letzte = res.data?.meta?.pagination?.total_pages || 1;
    seite += 1;
  } while (seite <= letzte && seite <= 20);   // Deckel gegen endloses Blättern

  return gefunden;
}

/**
 * Zuordnung { uuid → name }, zusätzlich unter der kurzen Kennung abgelegt.
 * Fünf Minuten zwischengespeichert, damit die pollende Docker-Seite die
 * Pelican-Instanz nicht bei jedem Aufruf befragt.
 */
async function namensKarte(frisch = false) {
  if (!frisch && cache.karte && Date.now() - cache.zeit < CACHE_MS) return cache.karte;

  const server = await serverAbrufen();
  const karte = {};
  for (const s of server) {
    karte[s.uuid.toLowerCase()] = s.name;
    if (s.kurz) karte[s.kurz.toLowerCase()] = s.name;
  }
  cache = { zeit: Date.now(), karte };
  return karte;
}

const cacheLeeren = () => { cache = { zeit: 0, karte: null }; };

module.exports = { konfiguration, serverAbrufen, namensKarte, cacheLeeren };
