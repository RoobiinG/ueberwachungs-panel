// ─── Wiederholung vorübergehender Fehler bei Aufrufen an Fremddienste ────────
//
// Ein einzelner Timeout bei einem externen Dienst (z. B. NGINX Proxy Manager) ist meist
// ein Aussetzer und kein Defekt. Statt ihn als 500 an die Oberfläche zu reichen, wird der
// Aufruf mit Exponential Backoff wiederholt — begrenzt durch ein Gesamtbudget, damit die
// Anfrage unter dem Timeout des Reverse Proxys bleibt.
//
// Bewusst ohne axios-Import: Der Helfer arbeitet nur mit `err.code` und `err.response`,
// lässt sich dadurch ohne Abhängigkeiten testen und ist für fetch genauso nutzbar.

const VORUEBERGEHEND_CODES  = new Set(['ECONNABORTED', 'ETIMEDOUT', 'ECONNRESET', 'EAI_AGAIN', 'ECONNREFUSED', 'EPIPE']);
const VORUEBERGEHEND_STATUS = new Set([408, 425, 429, 502, 503, 504]);

// Fehler, bei denen die Anfrage den Dienst garantiert nicht erreicht hat. Nur diese darf
// man auch bei einmaligen Vorgängen (z. B. 2FA-Challenge) wiederholen — nach einem Timeout
// weiß man nicht, ob die Gegenseite die Anfrage schon verarbeitet hat.
const VOR_VERBINDUNG_CODES = new Set(['ECONNREFUSED', 'EAI_AGAIN']);

const UNERREICHBAR_CODES = new Set(['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'ECONNRESET', 'EPIPE', 'EHOSTUNREACH', 'ENETUNREACH']);
const TIMEOUT_CODES      = new Set(['ECONNABORTED', 'ETIMEDOUT', 'ESOCKETTIMEDOUT']);

// Andere 4xx (falsches Passwort, ungültige Anfrage) werden nie wiederholt — das ändert
// nichts am Ergebnis und kann Fehlversuchs-Sperren der Gegenseite auslösen.
function istVorruebergehend(err) {
  const status = err?.response?.status;
  if (status) return VORUEBERGEHEND_STATUS.has(status);
  return VORUEBERGEHEND_CODES.has(err?.code);
}

function istVorVerbindung(err) {
  return !err?.response && VOR_VERBINDUNG_CODES.has(err?.code);
}

const schlafen = (ms) => new Promise(r => setTimeout(r, ms));

// `Retry-After` in Sekunden → Millisekunden (Datumsangaben werden ignoriert).
function retryAfterMs(err) {
  const roh = err?.response?.headers?.['retry-after'];
  const s = Number(roh);
  return Number.isFinite(s) && s >= 0 ? s * 1000 : null;
}

/**
 * Führt `fn` aus und wiederholt bei vorübergehenden Fehlern.
 *
 * `fn` bekommt `{ versuch, verbleibendMs }` — der Aufrufer sollte den Timeout seiner Anfrage
 * darauf begrenzen (`Math.min(8000, verbleibendMs)`), sonst kann der letzte Versuch das
 * Gesamtbudget überschreiten.
 *
 * Wartezeit: Exponential Backoff mit „Equal Jitter" — die halbe Obergrenze fest, die andere
 * Hälfte zufällig. Das verhindert einen Takt zwischen mehreren gleichzeitigen Aufrufern,
 * ohne dass die Pause je gegen null läuft.
 */
async function mitRetry(fn, opts = {}) {
  const {
    versuche  = 3,
    basisMs   = 500,
    maxMs     = 4000,
    gesamtMs  = 25_000,
    soll      = istVorruebergehend,
    warten    = schlafen,
    jetzt     = Date.now,
    zufall    = Math.random,
  } = opts;

  const start = jetzt();
  let letzter;
  for (let n = 1; n <= versuche; n++) {
    try {
      return await fn({ versuch: n, verbleibendMs: Math.max(0, gesamtMs - (jetzt() - start)) });
    } catch (err) {
      letzter = err;
      if (err && typeof err === 'object') err.versuche = n;
      if (n >= versuche || !soll(err)) break;

      const deckel = Math.min(maxMs, basisMs * 2 ** (n - 1));
      const pause  = Math.min(maxMs, retryAfterMs(err) ?? Math.round(deckel / 2 + zufall() * deckel / 2));
      // Reicht das Budget nicht mehr für Pause *und* einen sinnvollen Versuch, lieber jetzt aufgeben.
      if (jetzt() - start + pause >= gesamtMs) break;
      await warten(pause);
    }
  }
  throw letzter;
}

/**
 * Übersetzt einen Fehler eines Fremddienstes in HTTP-Status und strukturierten Body für die
 * Oberfläche. `upstream: true` kennzeichnet ihn als Zustand der Gegenseite und nicht als
 * Fehler des Panels (die Oberfläche meldet solche Antworten nicht als Panel-Fehler).
 * Hostnamen und Adressen stehen bewusst nicht im Text.
 *
 * @param {Error} err
 * @param {string} dienst  Anzeigename, z. B. 'NPM'
 * @returns {{ status: number, body: { error: string, code: string, upstream: true, retryable: boolean, versuche?: number } }}
 */
function upstreamFehler(err, dienst = 'Dienst') {
  const praefix = dienst.toUpperCase().replace(/[^A-Z0-9]/g, '') || 'DIENST';
  const mit = (status, suffix, error, retryable) => ({
    status,
    body: {
      error, code: `${praefix}_${suffix}`, upstream: true, retryable,
      ...(err?.versuche ? { versuche: err.versuche } : {}),
    },
  });
  const wiederholt = err?.versuche > 1 ? ` (nach ${err.versuche} Versuchen)` : '';

  const status = err?.response?.status;
  if (status) {
    const data = err.response.data;
    const meldung = data?.error?.message || data?.message || (typeof data?.error === 'string' ? data.error : '') || `HTTP ${status}`;
    if (status >= 500) return mit(502, 'UPSTREAM', `${dienst} meldet einen internen Fehler (HTTP ${status})${wiederholt}. Bitte später erneut versuchen.`, true);
    if (status === 400 || status === 401 || status === 403) return mit(status, 'AUTH', `${dienst} API Fehler: ${meldung}`, false);
    return mit(status, 'FEHLER', `${dienst} API Fehler: ${meldung}`, istVorruebergehend(err));
  }

  if (TIMEOUT_CODES.has(err?.code)) {
    return mit(504, 'TIMEOUT', `${dienst} antwortet nicht${wiederholt}: Zeitüberschreitung. Läuft der Dienst und ist er vom Panel aus erreichbar? Bitte später erneut versuchen.`, true);
  }
  if (UNERREICHBAR_CODES.has(err?.code)) {
    return mit(502, 'UNREACHABLE', `${dienst} ist nicht erreichbar${wiederholt}. Bitte Adresse und Port prüfen und ob der Dienst läuft.`, true);
  }
  return mit(502, 'FEHLER', `${dienst} konnte nicht abgefragt werden. Details stehen im Panel-Log.`, false);
}

module.exports = { mitRetry, istVorruebergehend, istVorVerbindung, upstreamFehler };
