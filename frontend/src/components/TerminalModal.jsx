import { useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { Modal } from './ui/Modal';
import { Maximize2, Minimize2 } from 'lucide-react';
import { Terminal } from 'xterm';
import { FitAddon } from '@xterm/addon-fit';
import 'xterm/css/xterm.css';

const GROESSE_SPEICHER = 'panel_terminal_gross';
const VERLAUF_ZEILEN   = 200;

/**
 * Container-Konsole.
 *
 * `server` ist entweder 'local' (Container auf dem Panel-Server selbst, das Panel
 * spricht dafür die Docker-Engine direkt an) oder die ID eines Agenten. Beide Wege
 * sehen von hier aus gleich aus — nur die Adresse unterscheidet sich.
 */
export function TerminalModal({ server, containerId, containerName, onClose }) {
  const terminalRef  = useRef(null);
  const termInstance = useRef(null);
  const wsRef        = useRef(null);
  const fitAddon     = useRef(null);
  const [error, setError] = useState('');
  const [gross, setGross] = useState(() => localStorage.getItem(GROESSE_SPEICHER) === '1');

  const istLokal = !server || server === 'local';
  const basis    = istLokal
    ? `/api/docker/containers/${encodeURIComponent(containerId)}`
    : `/api/agents/${server}/docker/containers/${encodeURIComponent(containerId)}`;

  // Größe merken und nach dem Umschalten neu einpassen
  useEffect(() => {
    localStorage.setItem(GROESSE_SPEICHER, gross ? '1' : '0');
    const t = setTimeout(() => passeAn(), 120);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gross]);

  const passeAn = () => {
    if (!fitAddon.current || !termInstance.current) return;
    try { fitAddon.current.fit(); } catch { return; }
    const { cols, rows } = termInstance.current;
    if (wsRef.current?.readyState === WebSocket.OPEN && cols && rows) {
      wsRef.current.send(JSON.stringify({ cols, rows }));
    }
  };

  useEffect(() => {
    if (!terminalRef.current) return;

    const term = new Terminal({
      cursorBlink: true,
      theme: { background: '#0d0d0d', foreground: '#e5e5e5', cursor: '#4b9eff' },
      fontFamily: '"Fira Code", monospace',
      fontSize: 13,
      scrollback: 5000,
      // Rechtsklick markiert nicht das Wort, damit das Kontextmenü zum Einfügen frei bleibt
      rightClickSelectsWord: false,
    });
    termInstance.current = term;
    fitAddon.current = new FitAddon();
    term.loadAddon(fitAddon.current);
    term.open(terminalRef.current);

    // ── Kopieren & Einfügen ──────────────────────────────────────────────────
    // Strg+C darf nicht blind abgefangen werden: Ohne Markierung ist es das
    // Abbruchsignal für den laufenden Befehl und muss an die Shell durchgereicht
    // werden. Nur mit Markierung wird daraus ein Kopiervorgang.
    term.attachCustomKeyEventHandler((e) => {
      if (e.type !== 'keydown') return true;
      const strg = e.ctrlKey || e.metaKey;
      if (!strg) return true;

      if (e.key === 'c' && term.hasSelection()) {
        navigator.clipboard?.writeText(term.getSelection()).catch(() => {});
        term.clearSelection();
        return false;
      }
      if (e.key === 'v' || (e.shiftKey && e.key.toLowerCase() === 'v')) {
        navigator.clipboard?.readText()
          .then(t => { if (t && wsRef.current?.readyState === WebSocket.OPEN) wsRef.current.send(t); })
          .catch(() => {});
        return false;
      }
      if (e.shiftKey && e.key.toLowerCase() === 'c' && term.hasSelection()) {
        navigator.clipboard?.writeText(term.getSelection()).catch(() => {});
        return false;
      }
      return true;
    });

    // Markieren mit der Maus kopiert direkt; Rechtsklick fügt ein.
    const beiAuswahl = term.onSelectionChange(() => {
      const sel = term.getSelection();
      if (sel) navigator.clipboard?.writeText(sel).catch(() => {});
    });
    const beiRechtsklick = (e) => {
      e.preventDefault();
      navigator.clipboard?.readText()
        .then(t => { if (t && wsRef.current?.readyState === WebSocket.OPEN) wsRef.current.send(t); })
        .catch(() => {});
    };
    terminalRef.current.addEventListener('contextmenu', beiRechtsklick);

    setTimeout(() => passeAn(), 60);

    let abgebrochen = false;

    (async () => {
      // ── 1. Bisherigen Verlauf zeigen ───────────────────────────────────────
      // Bewusst vor dem Verbindungsaufbau, damit die Reihenfolge stimmt.
      try {
        const { data } = await axios.get(`${basis}/logs?tail=${VERLAUF_ZEILEN}`);
        const text = Array.isArray(data) ? data.join('\n') : String(data ?? '');
        if (text.trim()) {
          term.write('\x1b[90m─── bisheriger Verlauf (letzte ' + VERLAUF_ZEILEN + ' Zeilen) ───\x1b[0m\r\n');
          term.write(text.replace(/\n/g, '\r\n'));
          term.write('\r\n\x1b[90m─── Konsole aktiv ───\x1b[0m\r\n');
        }
      } catch {
        // Kein Verlauf verfügbar ist kein Grund, die Konsole nicht zu öffnen.
      }
      if (abgebrochen) return;

      // ── 2. Einmal-Ticket holen ─────────────────────────────────────────────
      // Das Session-Token darf nicht in die WebSocket-Adresse — der Reverse Proxy
      // protokolliert vollständige URLs.
      let ticket;
      try {
        const { data } = await axios.post(`${basis}/terminal-ticket`);
        ticket = data.ticket;
      } catch (err) {
        setError(err.response?.data?.error || 'Terminal-Zugriff verweigert.');
        return;
      }
      if (abgebrochen || !ticket) return;

      // ── 3. Verbinden ───────────────────────────────────────────────────────
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(`${proto}//${window.location.host}${basis}/terminal?ticket=${encodeURIComponent(ticket)}`);
      wsRef.current = ws;
      ws.binaryType = 'arraybuffer';

      // Es gibt keinen Ersatzweg mehr über Dockhand — scheitert die Verbindung, muss
      // die Meldung deshalb selbst erklären, woran es liegt.
      let offen = false;

      ws.onopen = () => {
        offen = true;
        term.focus();
        passeAn();
      };

      // Der Server schickt in aller Regel Text. Ältere Panel-Versionen (und alles, was
      // unterwegs auf Binärframes umstellt) liefern die Ausgabe als Blob — den hat xterm
      // stillschweigend verworfen, das Fenster blieb leer. Beide Formen werden angenommen.
      ws.onmessage = (ev) => {
        const d = ev.data;
        if (typeof d === 'string')         term.write(d);
        else if (d instanceof ArrayBuffer) term.write(new Uint8Array(d));
        else if (typeof d?.arrayBuffer === 'function')
          d.arrayBuffer().then(b => term.write(new Uint8Array(b))).catch(() => {});
      };

      const nichtErreichbar = istLokal
        ? 'Konsole nicht erreichbar — ist die Docker-Installation dieses Servers eingebunden?'
        : 'Konsole nicht erreichbar — läuft der Panel-Agent auf diesem Server und ist node-pty installiert?';

      ws.onerror = () => setError(offen ? 'Verbindung zum Terminal abgebrochen.' : nichtErreichbar);
      ws.onclose = () => {
        if (!offen) setError(nichtErreichbar);
        term.write('\r\n\x1b[31m[Terminal geschlossen]\x1b[0m\r\n');
      };
    })();

    term.onData((d) => {
      if (wsRef.current?.readyState === WebSocket.OPEN) wsRef.current.send(d);
    });

    window.addEventListener('resize', passeAn);

    return () => {
      abgebrochen = true;
      window.removeEventListener('resize', passeAn);
      terminalRef.current?.removeEventListener('contextmenu', beiRechtsklick);
      beiAuswahl.dispose();
      if (wsRef.current) { wsRef.current.close(); wsRef.current = null; }
      term.dispose();
      termInstance.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [server, containerId]);

  return (
    <Modal
      open={true}
      onClose={onClose}
      size={gross ? 'full' : 'wide'}
      title={`Terminal: ${containerName || containerId.slice(0, 12)}`}
      headerExtra={
        <button
          onClick={() => setGross(g => !g)}
          title={gross ? 'Auf normale Größe verkleinern' : 'Auf volle Fensterbreite vergrößern'}
          className="text-panel-muted hover:text-panel-text transition-colors p-0.5"
        >
          {gross ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
        </button>
      }
      footer={
        <span className="text-[11px] text-panel-muted mr-auto">
          Markieren kopiert · Einfügen mit Strg+V oder Rechtsklick · Strg+C bricht ab, solange nichts markiert ist
        </span>
      }
    >
      {error && <div className="text-panel-red text-xs mb-2">{error}</div>}
      <div
        ref={terminalRef}
        className={`w-full bg-[#0d0d0d] rounded overflow-hidden p-2 ${gross ? 'h-[80vh]' : 'h-[65vh]'}`}
      />
    </Modal>
  );
}
