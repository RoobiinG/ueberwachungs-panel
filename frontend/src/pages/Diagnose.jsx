import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import {
  Stethoscope, RefreshCw, Copy, Check, ChevronDown, ChevronRight,
  Share2, AlertTriangle,
} from 'lucide-react';
import { Card } from '../components/ui/Card';

const ABSCHNITTE = [
  { key: 'panel',             titel: 'Panel',             untertitel: 'Version, Laufzeit, Verschlüsselung' },
  { key: 'host',              titel: 'Maschine',          untertitel: 'Speicher, Platte, Last — eine volle Platte legt Container lahm' },
  { key: 'runtime',           titel: 'Runtime',           untertitel: 'Node.js, Plattform, Architektur, PID und Speicherverbrauch' },
  { key: 'database',          titel: 'Datenbank',         untertitel: 'Dateigröße, WAL-Modus, Tabellen-Zeilen und Quick-Check' },
  { key: 'agents',            titel: 'Agents',            untertitel: 'Erreichbarkeit, Latenz und Version aller registrierten Server' },
  { key: 'webSocket',         titel: 'WebSocket',         untertitel: 'Aktive Verbindungen und authentifizierte Clients' },
  { key: 'backgroundWorkers', titel: 'Hintergrund-Worker', untertitel: 'Letzter Durchlauf, Fehler und Status aller Hintergrund-Dienste' },
  { key: 'sslMonitor',        titel: 'SSL-Monitor',       untertitel: 'Zertifikats-Status und bald ablaufende Domains' },
  { key: 'updateCheck',       titel: 'Update-Check',      untertitel: 'Verfügbare Versionen für Panel und Remote-Agents' },
  { key: 'smtp',              titel: 'SMTP',              untertitel: 'Mailversand-Konfiguration und Verbindungsstatus' },
  { key: 'config',            titel: 'Konfiguration',     untertitel: 'Einstellungen — Geheimnisse nur als „gesetzt“' },
  { key: 'logs',              titel: 'Logs',              untertitel: 'die letzten Zeilen, Adressen unkenntlich gemacht' },
];

// Standardmäßig sind wie im Mail-Panel die ersten beiden Sektionen geöffnet
const OFFEN_STANDARD = new Set(['panel', 'host']);

function formatDatum(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString('de-DE', {
    day: 'numeric', month: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

function AccordionAbschnitt({ titel, untertitel, value, defaultOpen }) {
  const [open, setOpen] = useState(defaultOpen);
  if (value === undefined) return null;

  return (
    <div className="w-full rounded-lg border border-panel-border/60 bg-panel-surface/40 overflow-hidden transition-colors">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2.5 px-4 py-3 hover:bg-panel-surface/80 transition-colors text-left select-none"
      >
        {open
          ? <ChevronDown size={14} className="text-panel-muted shrink-0" />
          : <ChevronRight size={14} className="text-panel-muted shrink-0" />}
        <span className="text-sm font-semibold text-panel-text">{titel}</span>
        <span className="text-xs text-panel-muted ml-2 font-normal truncate">{untertitel}</span>
      </button>
      {open && (
        <pre className="text-[12px] leading-relaxed p-4 overflow-x-auto max-h-[500px] bg-black/90 font-mono border-t border-panel-border/40 text-panel-text/90 select-all">
          {JSON.stringify(value, null, 2)}
        </pre>
      )}
    </div>
  );
}

export default function Diagnose() {
  const [bericht, setBericht] = useState(null);
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [textKopiert, setTextKopiert] = useState(false);
  const [linkKopiert, setLinkKopiert] = useState(false);
  const [ausfuehrlich, setAusfuehrlich] = useState(false);

  const berichtErstellen = useCallback((mitAusfuehrlich = ausfuehrlich) => {
    setLoading(true);
    setError('');
    axios.get('/api/diagnose', { params: { logs: mitAusfuehrlich ? 100 : 50 } })
      .then(r => {
        setBericht(r.data.bericht);
        setText(r.data.text);
      })
      .catch(err => {
        setError(err.response?.data?.error || err.message);
      })
      .finally(() => setLoading(false));
  }, [ausfuehrlich]);

  // Beim Aufruf der Seite sofort automatisch laden (wie im Mail-Panel)
  useEffect(() => {
    berichtErstellen(false);
  }, []);

  const toggleAusfuehrlich = (e) => {
    const val = e.target.checked;
    setAusfuehrlich(val);
    berichtErstellen(val);
  };

  const alsTextKopieren = () => {
    if (!text) return;
    navigator.clipboard.writeText(text).then(() => {
      setTextKopiert(true);
      setTimeout(() => setTextKopiert(false), 2000);
    });
  };

  const verschluesseltenLinkErstellen = async () => {
    if (!bericht) return;
    try {
      const { data } = await axios.post('/api/diagnose/share', { bericht });
      const link = `${window.location.origin}/s/diagnose/${data.token}`;
      await navigator.clipboard.writeText(link);
      setLinkKopiert(true);
      setTimeout(() => setLinkKopiert(false), 2500);
    } catch (err) {
      alert(err.response?.data?.error || 'Fehler beim Erstellen des Links');
    }
  };

  // Dateigröße des Berichts in kB berechnen
  const groesseKb = text ? Math.round(new Blob([text]).size / 1024) : 0;

  return (
    <div className="max-w-5xl mx-auto space-y-4">
      {/* ── Header-Kasten (Mail-Panel Vorbild) ────────────────────────────────── */}
      <div className="rounded-xl border border-panel-border/70 bg-panel-surface/60 p-5 space-y-4 shadow-sm">
        {/* Oben: Icon + Beschreibung + Neu erstellen Button */}
        <div className="flex items-start justify-between gap-4 flex-wrap sm:flex-nowrap">
          <div className="flex items-start gap-3">
            <Stethoscope className="text-panel-accent shrink-0 mt-0.5" size={22} />
            <p className="text-xs leading-relaxed text-panel-muted max-w-3xl">
              Sammelt an einer Stelle, was zum Fehlersuchen nötig ist: Zustand der Dienste, Speicher und Platte,
              die Agenten samt ihrer Erreichbarkeit, Hintergrund-Worker, Datenbank-Integrität und die letzten Logzeilen.
              Zum Weitergeben, damit niemand dafür eine Shell auf dem Server braucht.
            </p>
          </div>
          <button
            onClick={() => berichtErstellen(ausfuehrlich)}
            disabled={loading}
            className="bg-panel-accent hover:bg-panel-accent/90 text-white font-medium px-4 py-2 rounded-lg text-xs flex items-center gap-2 transition-colors shrink-0 shadow-sm disabled:opacity-50"
          >
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
            <span>Neu erstellen</span>
          </button>
        </div>

        {/* Dunkelblaue Infobox: Geheimnisse-Hinweis */}
        <div className="bg-blue-950/40 border border-blue-900/40 rounded-lg p-3 text-xs text-blue-300/90 leading-relaxed">
          <span className="font-semibold text-blue-200">Nicht enthalten:</span> Passwörter, API-Schlüssel und Token
          (nur „gesetzt“ / „nicht gesetzt“). Auch in den Logzeilen und URLs werden Adressen und Geheimnisse unkenntlich gemacht.
        </div>

        {/* Checkbox-Zeile: Ausführliche Logs */}
        <div className="flex items-center gap-2 text-xs text-red-400/90 font-normal select-none">
          <AlertTriangle size={13} className="text-red-400 shrink-0" />
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={ausfuehrlich}
              onChange={toggleAusfuehrlich}
              className="rounded border-panel-border bg-panel-bg text-panel-accent focus:ring-0 cursor-pointer"
            />
            <span>
              Ausführliche Logs mitschicken — die letzten 100 statt 50 Zeilen im Klartext. Nur, wenn eine Fehlersuche mit den Standard-Logs nicht ausreicht.
            </span>
          </label>
        </div>

        {/* Aktions-Toolbar: Buttons & Status */}
        <div className="flex items-center gap-2 flex-wrap pt-1">
          <button
            onClick={alsTextKopieren}
            disabled={!bericht}
            className="px-3 py-1.5 rounded-lg border border-panel-border bg-panel-surface/80 hover:bg-panel-surface text-panel-text text-xs font-medium flex items-center gap-1.5 transition-colors disabled:opacity-40"
          >
            {textKopiert ? <Check size={12} className="text-panel-green" /> : <Copy size={12} />}
            <span>{textKopiert ? 'Kopiert' : 'Als Text kopieren'}</span>
          </button>

          <button
            onClick={verschluesseltenLinkErstellen}
            disabled={!bericht}
            className="px-3 py-1.5 rounded-lg border border-panel-border bg-panel-surface/80 hover:bg-panel-surface text-panel-text text-xs font-medium flex items-center gap-1.5 transition-colors disabled:opacity-40"
          >
            {linkKopiert ? <Check size={12} className="text-panel-green" /> : <Share2 size={12} />}
            <span>{linkKopiert ? 'Link kopiert!' : 'Verschlüsselten Link erstellen'}</span>
          </button>

          {bericht && (
            <span className="text-xs text-panel-muted tabular-nums ml-2">
              {groesseKb} kB · erstellt {formatDatum(bericht.erstellt)}
            </span>
          )}
        </div>
      </div>

      {error && (
        <Card className="border-panel-red/40 bg-panel-red/5 text-sm text-panel-red py-3 px-4">
          {error}
        </Card>
      )}

      {/* ── Accordion-Sektionen ──────────────────────────────────────────────── */}
      {bericht && (
        <div className="space-y-2">
          {ABSCHNITTE.map(abs => (
            <AccordionAbschnitt
              key={abs.key}
              titel={abs.titel}
              untertitel={abs.untertitel}
              value={bericht[abs.key]}
              defaultOpen={OFFEN_STANDARD.has(abs.key)}
            />
          ))}
        </div>
      )}

      {/* Ladezustand / Leer */}
      {loading && !bericht && (
        <div className="text-center text-sm text-panel-muted py-16 flex items-center justify-center gap-2">
          <RefreshCw size={15} className="animate-spin text-panel-accent" />
          <span>Erstelle Diagnose-Bericht…</span>
        </div>
      )}
    </div>
  );
}
