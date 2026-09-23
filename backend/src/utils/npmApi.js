const axios = require('axios');
const db = require('../db');

/**
 * Holt eine Einstellung aus der DB
 */
const getSetting = (key) => {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : null;
};

function getNpmBaseUrl() {
  const host = (getSetting('npm_host') || '').trim();
  if (!host) return null;
  const port = parseInt(getSetting('npm_port')) || 81;
  const noSlash = host.replace(/\/+$/, '');
  if (/:\d+$/.test(noSlash)) {
    return noSlash;
  }
  return `${noSlash}:${port}`;
}

/**
 * Aktualisiert das Token, falls es abgelaufen sein sollte.
 * (NPM Tokens laufen standardmäßig ab, wir müssen uns dann neu einloggen)
 */
async function refreshTokenIfNeeded() {
  const baseUrl = getNpmBaseUrl();
  const email = getSetting('npm_email');
  const password = getSetting('npm_password');
  
  if (!baseUrl || !email || !password) return null;

  try {
    const url = `${baseUrl}/api/tokens`;
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
  const baseUrl = getNpmBaseUrl();

  if (!baseUrl || (!token && !isRetry)) {
    // Falls noch kein Token da ist, aber Host existiert, versuchen wir einzuloggen
    if (baseUrl && !token) token = await refreshTokenIfNeeded();
    if (!token) return [];
  }

  try {
    const url = `${baseUrl}/api/nginx/certificates`;
    const { data } = await axios.get(url, {
      headers: { 'Authorization': `Bearer ${token}` },
      timeout: 10000
    });
    return data;
  } catch (err) {
    const errMsg = err.response?.data?.error?.message || err.response?.data?.message || err.message || '';
    const isExpired = err.response?.status === 401 ||
                      err.response?.status === 400 && /token.*expired|jwt expired/i.test(errMsg);

    if (isExpired && !isRetry) {
      // Token abgelaufen, wir versuchen ein Refresh
      const newToken = await refreshTokenIfNeeded();
      if (newToken) {
        return fetchCertificates(true);
      }
      // Wenn kein Refresh möglich ist (z. B. kein Passwort hinterlegt), abgelaufenes Token löschen,
      // um Dauer-400 im Hintergrund-Log zu verhindern.
      db.prepare("DELETE FROM settings WHERE key = 'npm_token'").run();
      console.warn('[NPM] Token ist abgelaufen und konnte nicht automatisch erneuert werden. Bitte in den Einstellungen neu anmelden.');
      return [];
    }
    console.error('[NPM] Fehler beim Abrufen der Zertifikate:', errMsg);
    throw err;
  }
}

module.exports = {
  fetchCertificates
};
