import { useState } from 'react';
import axios from 'axios';
import {
  Stethoscope, RefreshCw, Copy, Check, ChevronDown, ChevronRight, ShieldAlert,
} from 'lucide-react';
import { Card } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';

const TITEL = {
  panel: 'Panel', runtime: 'Runtime', host: 'Host-Ressourcen', database: 'Datenbank',
  agents: 'Agents', webSocket: 'WebSocket', backgroundWorkers: 'Hintergrund-Worker',
  sslMonitor: 'SSL-Monitor', updateCheck: 'Update-Check', smtp: 'SMTP', logs: 'Panel-Logs',
  config: 'Konfiguration',
};

// Sektionen, die standardmäßig aufgeklappt sind — die wichtigsten auf einen Blick.
const OFFEN_STANDARD = new Set(['panel', 'database', 'agents', 'backgroundWorkers']);

// Grobe Einschätzung, ob eine Sektion "auffällig" ist, für die Badge-Farbe.
function sektionStatus(value) {
  if (value == null) return 'gray';
  if (typeof value === 'object' && !Array.isArray(value) && value.fehler) return 'red';
  if (Array.isArray(value)) {
    if (value.some(v => v && typeof v === 'object' && v.ok === false)) return 'orange';
    return 'green';
  }
  if (typeof value === 'object') {
    const vals = Object.values(value);
    if (vals.some(v => v && typeof v === 'object' && v.lastError)) return 'orange';
    if (vals.some(v => v && typeof v === 'object' && v.ok === false)) return 'orange';
  }
  return 'green';
}

function Abschnitt({ titel, value, defaultOpen }) {
  const [open, setOpen] = useState(defaultOpen);
  if (value === undefined) return null;
  const status = sektionStatus(value);
  return (
    <Card className="p-0 overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2 px-4 py-2.5 bg-panel-surface/40 hover:bg-panel-surface/70 transition-colors text-left"
      >
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <span className="text-sm font-semibold flex-1">{titel}</span>
        <Badge color={status}>{status === 'red' ? 'Fehler' : status === 'orange' ? 'Auffällig' : 'OK'}</Badge>
      </button>
      {open && (
        <pre className="text-[11px] leading-relaxed p-3 overflow-auto max-h-[420px] bg-panel-bg/40 font-mono border-t border-panel-border">
          {JSON.stringify(value, null, 2)}
        </pre>
      )}
    </Card>
  );
}

export default function Diagnose() {
  const [bericht, setBericht] = useState(null);
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [kopiert, setKopiert] = useState(false);

  const berichtErstellen = () => {
    setLoading(true);
    setError('');
    axios.get('/api/diagnose', { params: { logs: 50 } })
      .then(r => {
        setBericht(r.data.bericht);
        setText(r.data.text);
      })
      .catch(err => setError(err.response?.data?.error || err.message))
      .finally(() => setLoading(false));
  };

  const alsTextKopieren = () => {
    navigator.clipboard.writeText(text).then(() => {
      setKopiert(true);
      setTimeout(() => setKopiert(false), 2000);
    });
  };

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-panel-text flex items-center gap-2">
            <Stethoscope className="text-panel-accent" size={24} />
            Diagnose
          </h1>
          <p className="text-sm text-panel-muted mt-1">
            Momentaufnahme des Panel-Zustands — Datenbank, Host-Ressourcen, Agent-Erreichbarkeit,
            Hintergrund-Worker, SSL, Updates, SMTP und die letzten Panel-Logs.
          </p>
        </div>
        <Button onClick={berichtErstellen} disabled={loading}>
          {loading
            ? <RefreshCw size={14} className="animate-spin" />
            : <RefreshCw size={14} />}
          {bericht ? 'Neu erstellen' : 'Bericht erstellen'}
        </Button>
      </div>

      <Card className="border-panel-accent/30 bg-panel-accent/5">
        <div className="flex gap-3 text-sm text-panel-muted">
          <ShieldAlert className="text-panel-accent shrink-0 mt-0.5" size={18} />
          <div>
            Der Bericht wird jedes Mal frisch erzeugt und nirgends gespeichert. Er prüft
            live per TCP/TLS, ob registrierte Agents erreichbar sind, und liest Datenbank-
            und Prozess-Kennzahlen dieses Panels. Passwörter, Tokens und andere Zugangsdaten
            erscheinen ausschließlich als „gesetzt"/„nicht gesetzt", nie im Klartext. Es wird
            dabei keine Testmail verschickt.
          </div>
        </div>
      </Card>

      {error && (
        <Card className="border-panel-red/40 bg-panel-red/5 text-sm text-panel-red">{error}</Card>
      )}

      {bericht && (
        <>
          <div className="flex items-center justify-between text-xs text-panel-muted">
            <span>Erstellt: {new Date(bericht.erstellt).toLocaleString('de-DE')}</span>
            <Button variant="ghost" size="sm" onClick={alsTextKopieren}>
              {kopiert ? <Check size={13} /> : <Copy size={13} />}
              {kopiert ? 'Kopiert' : 'Als Text kopieren'}
            </Button>
          </div>

          <div className="space-y-3">
            {Object.entries(TITEL).map(([key, titel]) => (
              <Abschnitt
                key={key}
                titel={titel}
                value={bericht[key]}
                defaultOpen={OFFEN_STANDARD.has(key)}
              />
            ))}
          </div>
        </>
      )}

      {!bericht && !loading && !error && (
        <div className="text-center text-sm text-panel-muted py-12">
          Noch kein Bericht erstellt.
        </div>
      )}
    </div>
  );
}
