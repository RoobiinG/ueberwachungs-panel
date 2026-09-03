const axios = require('axios');
const db = require('../db');

/**
 * Holt eine Einstellung aus der DB
 */
const getSetting = (key) => {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : null;
};

/**
 * Aktualisiert das Token, falls es abgelaufen sein sollte.
 * (NPM Tokens laufen standardmäßig ab, wir müssen uns dann neu einloggen)
 */
async function refreshTokenIfNeeded() {
  const host = getSetting('npm_host');
  const port = getSetting('npm_port') || 81;
  const email = getSetting('npm_email');
  const password = getSetting('npm_password');
  
  if (!host || !email || !password) return null;

  try {
    const url = `${host}:${port}/api/tokens`;
    const { data } = await axios.post(url, {
      identity: email,
      secret: password
    }, { timeout: 10000 });

    if (data && data.token) {
      db.prepare('INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)')
        .run('npm_token', data.token);
      return data.token;
    }
  } catch (err) {
    console.error('[NPM] Auto-Login fehlgeschlagen:', err.message);
  }
  return null;
}

/**
 * Holt alle Zertifikate von der NPM API.
 * Retries 1x if token expired (401).
 */
async function fetchCertificates(isRetry = false) {
  let token = getSetting('npm_token');
  const host = getSetting('npm_host');
  const port = getSetting('npm_port') || 81;

  if (!host || (!token && !isRetry)) {
    // Falls noch kein Token da ist, aber Host existiert, versuchen wir einzuloggen
    if (host && !token) token = await refreshTokenIfNeeded();
    if (!token) return [];
  }

  try {
    const url = `${host}:${port}/api/nginx/certificates`;
    const { data } = await axios.get(url, {
      headers: { 'Authorization': `Bearer ${token}` },
      timeout: 10000
    });
    return data;
  } catch (err) {
    if (err.response?.status === 401 && !isRetry) {
      // Token vermutlich abgelaufen, wir versuchen ein Refresh
      const newToken = await refreshTokenIfNeeded();
      if (newToken) {
        return fetchCertificates(true);
      }
    }
    console.error('[NPM] Fehler beim Abrufen der Zertifikate:', err.message);
    throw err;
  }
}

module.exports = {
  fetchCertificates
};
