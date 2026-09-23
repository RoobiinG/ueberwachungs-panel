// Öffentliche Share-Seite für Diagnose-Berichte — kein Login nötig
// Erreichbar über /s/diagnose/<token>

import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import axios from 'axios';
import {
  Stethoscope, Copy, Check, ChevronDown, ChevronRight, Shield, AlertCircle,
} from 'lucide-react';

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

export default function DiagnoseShare() {
  const { token } = useParams();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [textKopiert, setTextKopiert] = useState(false);

  useEffect(() => {
    axios.get(`/api/diagnose/share/${token}`)
      .then(res => setData(res.data))
      .catch(err => setError(err.response?.data?.error || 'Fehler beim Laden des Berichts'))
      .finally(() => setLoading(false));
  }, [token]);

  const alsTextKopieren = () => {
    if (!data?.text) return;
    navigator.clipboard.writeText(data.text).then(() => {
      setTextKopiert(true);
      setTimeout(() => setTextKopiert(false), 2000);
    });
  };

  const groesseKb = data?.text ? Math.round(new Blob([data.text]).size / 1024) : 0;

  return (
    <div className="min-h-screen bg-panel-bg text-panel-text p-4 sm:p-6 md:p-8 flex flex-col items-center">
      <div className="w-full max-w-5xl space-y-4">
        {/* Kopfzeile */}
        <div className="flex items-center justify-between py-2 border-b border-panel-border/50">
          <div className="flex items-center gap-2 text-panel-muted text-xs">
            <Shield size={14} className="text-panel-accent" />
            <span>Überwachungs-Panel — Geteilter Diagnose-Bericht</span>
          </div>
          <Link
            to="/login"
            className="text-xs text-panel-muted hover:text-panel-text transition-colors"
          >
            Zum Login →
          </Link>
        </div>

        {/* Ladezustand */}
        {loading && (
          <div className="text-center py-20 text-panel-muted text-sm">
            Lade Diagnose-Bericht…
          </div>
        )}

        {/* Fehlerzustand */}
        {error && (
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-6 text-center space-y-2">
            <AlertCircle size={28} className="text-red-400 mx-auto" />
            <p className="text-sm font-semibold text-red-300">{error}</p>
            <p className="text-xs text-panel-muted">
              Dieser Freigabelink ist möglicherweise abgelaufen oder ungültig.
            </p>
          </div>
        )}

        {/* Bericht-Anzeige */}
        {data?.bericht && (
          <>
            <div className="rounded-xl border border-panel-border/70 bg-panel-surface/60 p-5 space-y-4 shadow-sm">
              <div className="flex items-start justify-between gap-4 flex-wrap sm:flex-nowrap">
                <div className="flex items-start gap-3">
                  <Stethoscope className="text-panel-accent shrink-0 mt-0.5" size={22} />
                  <div>
                    <h1 className="text-sm font-semibold text-panel-text">
                      Diagnose-Bericht (Freigabe)
                    </h1>
                    <p className="text-xs text-panel-muted mt-1 leading-relaxed">
                      Sammelt an einer Stelle, was zum Fehlersuchen nötig ist. Sensible Zugangsdaten sind maskiert.
                    </p>
                  </div>
                </div>

                <button
                  onClick={alsTextKopieren}
                  className="px-3 py-1.5 rounded-lg border border-panel-border bg-panel-surface/80 hover:bg-panel-surface text-panel-text text-xs font-medium flex items-center gap-1.5 transition-colors shrink-0"
                >
                  {textKopiert ? <Check size={12} className="text-panel-green" /> : <Copy size={12} />}
                  <span>{textKopiert ? 'Kopiert' : 'Als Text kopieren'}</span>
                </button>
              </div>

              <div className="flex items-center gap-3 text-xs text-panel-muted flex-wrap pt-1 border-t border-panel-border/40">
                <span>{groesseKb} kB</span>
                <span>•</span>
                <span>Erstellt: {formatDatum(data.createdAt || data.bericht.erstellt)}</span>
                {data.expiresAt && (
                  <>
                    <span>•</span>
                    <span className="text-panel-muted/80">Gültig bis: {formatDatum(data.expiresAt)}</span>
                  </>
                )}
              </div>
            </div>

            {/* Accordion-Sektionen */}
            <div className="space-y-2">
              {ABSCHNITTE.map(abs => (
                <AccordionAbschnitt
                  key={abs.key}
                  titel={abs.titel}
                  untertitel={abs.untertitel}
                  value={data.bericht[abs.key]}
                  defaultOpen={OFFEN_STANDARD.has(abs.key)}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
