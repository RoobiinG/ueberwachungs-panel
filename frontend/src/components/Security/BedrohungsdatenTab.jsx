import { useCallback, useEffect, useRef, useState } from 'react';
import axios from 'axios';
import {
  Database, RefreshCw, Download, Globe, Network, ShieldAlert, ArrowRight, ArrowDown,
  CheckCircle2, AlertTriangle, Loader2, Info, Archive, Cloud, HardDrive,
} from 'lucide-react';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import { useAuth } from '../../context/AuthContext';

// Takt: schnell, solange ein Download läuft (Fortschritt), sonst gemächlich.
const POLL_LAEUFT_MS = 3_000;
const POLL_RUHE_MS   = 60_000;

const QUELLE = {
  geo:   { titel: 'Geo-DB',       icon: Globe },
  asn:   { titel: 'ASN-DB',       icon: Network },
  ipsum: { titel: 'Threat-Liste', icon: ShieldAlert },
};

const ERGEBNIS = { aktuell: 'aktuell', aktualisiert: 'aktualisiert', fehler: 'fehlgeschlagen' };

// ── Formatierung ─────────────────────────────────────────────────────────────
const uhrzeit = (d) => d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
const tagDiff = (d) => {
  const a = new Date(); a.setHours(0, 0, 0, 0);
  const b = new Date(d); b.setHours(0, 0, 0, 0);
  return Math.round((b - a) / 86_400_000);
};

/** „heute, 03:42", „gestern, 18:10", „vor 4 Tagen", „morgen, 02:00", „01.11., 02:00". */
function wann(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d)) return null;
  const t = tagDiff(d);
  if (t === 0)  return `heute, ${uhrzeit(d)}`;
  if (t === -1) return `gestern, ${uhrzeit(d)}`;
  if (t === 1)  return `morgen, ${uhrzeit(d)}`;
  if (t < 0 && t > -7) return `vor ${-t} Tagen`;
  return `${d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', ...(t < 0 ? { year: 'numeric' } : {}) })}, ${uhrzeit(d)}`;
}

/** Stand der Datei: Monat bei DB-IP („September 2026"), Tag bei IPsum. */
function stand(q) {
  if (!q.version) return null;
  if (/^\d{4}-\d{2}$/.test(q.version)) {
    const [j, m] = q.version.split('-').map(Number);
    return new Date(Date.UTC(j, m - 1, 1)).toLocaleDateString('de-DE', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  }
  const d = new Date(`${q.version}T00:00:00`);
  return isNaN(d) ? q.version : d.toLocaleDateString('de-DE');
}

const mb = (b) => (b == null ? null : `${(b / 1e6).toFixed(b < 1e7 ? 1 : 0).replace('.', ',')} MB`);
const zahl = (n) => (n == null ? null : n.toLocaleString('de-DE'));

function badge(q) {
  if (q.laedt)              return { color: 'blue',   label: 'Wird geladen' };
  if (q.status === 'aktiv') return q.veraltet ? { color: 'orange', label: 'Veraltet' } : { color: 'green', label: 'Aktiv' };
  if (q.status === 'fehler') return { color: 'red',   label: 'Fehler' };
  if (q.status === 'aus')    return { color: 'gray',  label: 'Aus' };
  return { color: 'orange', label: 'Fehlt' };
}

// ── Bausteine ────────────────────────────────────────────────────────────────
function Fortschritt({ f }) {
  const pct = f?.gesamt ? Math.min(100, Math.round((f.geladen / f.gesamt) * 100)) : null;
  return (
    <div className="space-y-1">
      <div className="h-1.5 w-full rounded bg-panel-surface overflow-hidden">
        <div
          className={`h-full bg-panel-accent transition-all duration-500 ${pct === null ? 'w-full animate-pulse' : ''}`}
          style={pct === null ? undefined : { width: `${pct}%` }}
        />
      </div>
      <p className="text-[11px] text-panel-muted">
        {f?.geladen ? `${mb(f.geladen)}${f.gesamt ? ` von ${mb(f.gesamt)} (${pct} %)` : ''}` : 'Verbindung wird aufgebaut …'}
      </p>
    </div>
  );
}

function QuellenKarte({ q }) {
  const { titel, icon: Icon } = QUELLE[q.id] || { titel: q.name, icon: Database };
  const b = badge(q);
  const zeilen = [
    ['Stand', stand(q)],
    ['Letztes Update', wann(q.aktualisiertAt) || (q.status === 'aktiv' ? 'unbekannt' : null)],
    ['Zuletzt geprüft', wann(q.geprueftAt)],
    ['Nächste Prüfung', q.status === 'aus' ? null : (wann(q.naechstePruefung) || (q.status === 'aktiv' ? null : 'in Kürze'))],
    ['Größe', mb(q.groesse)],
    ...(q.id === 'ipsum' && q.eintraege != null
      ? [['Einträge', `${zahl(q.eintraege)} IPs, davon ${zahl(q.missbrauch)} auf ≥ 3 Listen`]]
      : []),
  ].filter(([, v]) => v);

  return (
    <div className="rounded-lg border border-panel-border bg-panel-surface/40 p-3 space-y-2.5 min-w-0">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <div className={`p-1.5 rounded-md bg-panel-card ${q.status === 'aktiv' ? 'text-panel-accent' : 'text-panel-muted'}`}>
            <Icon size={15} />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-panel-text leading-tight">{titel}</p>
            <p className="text-[11px] text-panel-muted truncate" title={`${q.name} — ${q.zweck}`}>{q.name} · {q.zweck}</p>
          </div>
        </div>
        <Badge color={b.color}>{b.label}</Badge>
      </div>

      {q.laedt && <Fortschritt f={q.fortschritt} />}

      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
        {zeilen.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-panel-muted">{k}</dt>
            <dd className="text-panel-text min-w-0 break-words">{v}</dd>
          </div>
        ))}
      </dl>

      {q.fehler && (
        <p className={`flex items-start gap-1.5 text-[11px] ${q.status === 'aktiv' ? 'text-panel-orange' : 'text-panel-red'}`}>
          <AlertTriangle size={12} className="mt-0.5 shrink-0" />
          <span>
            {q.status === 'aktiv' ? 'Letzte Aktualisierung fehlgeschlagen, bisheriger Stand bleibt aktiv: ' : 'Download fehlgeschlagen: '}
            {q.fehler}
          </span>
        </p>
      )}
    </div>
  );
}

// Die drei Stufen, die jede Adresse der Reihe nach durchläuft.
function Wasserfall({ data }) {
  const aktiv = data.quellen.filter(q => q.status === 'aktiv').length;
  const e = data.extern || {};
  const stufen = [
    {
      nr: 1, icon: Archive, titel: 'Cache',
      wert: `${zahl(data.cache?.eintraege ?? 0)} Adressen`,
      text: `Ergebnisse von ipapi.is, ${data.cache?.gueltigTage ?? 14} Tage gültig`,
      ok: true,
    },
    {
      nr: 2, icon: HardDrive, titel: 'Lokale Datenbanken',
      wert: `${aktiv} von ${data.quellen.length} aktiv`,
      text: 'Land, Stadt, Provider, Blocklisten — ohne Netzwerkzugriff',
      ok: aktiv === data.quellen.length,
    },
    {
      nr: 3, icon: Cloud, titel: 'Extern · ipapi.is',
      wert: e.eingerichtet ? `heute ${zahl(e.heuteAbgefragt)} / ${zahl(e.tagesBudget)}` : 'nicht eingerichtet',
      text: e.eingerichtet
        ? `VPN-, Proxy-, Tor-Einstufung${e.warteschlange ? ` · ${e.warteschlange} in der Warteschlange` : ''}`
        : 'Optional: Key unter Einstellungen → GeoIP & Bedrohungsdaten',
      ok: !!e.eingerichtet && !e.fehler,
      neutral: !e.eingerichtet,
    },
  ];

  return (
    <div className="flex flex-col md:flex-row md:items-stretch gap-2">
      {stufen.map((s, i) => (
        <div key={s.nr} className="contents">
          <div className="flex-1 min-w-0 rounded-lg border border-panel-border bg-panel-surface/40 p-3">
            <div className="flex items-center gap-2 mb-1">
              <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-panel-accent/20 text-panel-accent text-[11px] font-bold">{s.nr}</span>
              <s.icon size={13} className="text-panel-muted shrink-0" />
              <span className="text-xs font-semibold text-panel-text truncate">{s.titel}</span>
            </div>
            <p className={`text-sm font-semibold ${s.neutral ? 'text-panel-muted' : s.ok ? 'text-panel-green' : 'text-panel-orange'}`}>{s.wert}</p>
            <p className="text-[11px] text-panel-muted">{s.text}</p>
          </div>
          {i < stufen.length - 1 && (
            <div className="flex items-center justify-center text-panel-muted" aria-hidden="true">
              <ArrowRight size={16} className="hidden md:block" />
              <ArrowDown size={16} className="md:hidden" />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function Gesamtlage({ data }) {
  const q = data.quellen;
  let ton, Icon, text;
  if (data.laeuft || q.some(x => x.laedt)) {
    ton = 'text-panel-accent border-panel-accent/30 bg-panel-accent/10'; Icon = Loader2;
    text = 'Datenbanken werden im Hintergrund geprüft und aktualisiert — das Panel bleibt dabei voll bedienbar.';
  } else if (q.some(x => x.status !== 'aktiv')) {
    const n = q.filter(x => x.status !== 'aktiv').length;
    ton = 'text-panel-red border-panel-red/30 bg-panel-red/10'; Icon = AlertTriangle;
    text = `${n} von ${q.length} lokalen Datenbanken nicht verfügbar.${data.downloads ? ' Das Panel versucht es automatisch erneut.' : ''}`;
  } else if (q.some(x => x.veraltet || x.fehler)) {
    ton = 'text-panel-orange border-panel-orange/30 bg-panel-orange/10'; Icon = AlertTriangle;
    text = 'Alle Datenbanken aktiv, aber nicht alle auf dem neuesten Stand.';
  } else {
    ton = 'text-panel-green border-panel-green/30 bg-panel-green/10'; Icon = CheckCircle2;
    text = 'Alle lokalen Datenbanken aktiv und aktuell.';
  }
  return (
    <div className={`flex items-start gap-2 rounded-md border px-3 py-2 text-xs ${ton}`}>
      <Icon size={14} className={`mt-0.5 shrink-0 ${Icon === Loader2 ? 'animate-spin' : ''}`} />
      <span>{text}</span>
    </div>
  );
}

/**
 * Tab „Bedrohungsdaten" im Security Center: Gesundheit der lokalen Geo-, ASN- und
 * Blocklisten-Datenbanken und der drei Stufen der IP-Prüfung. Serverunabhängig.
 *
 * Rechte, wie im Backend durchgesetzt (routes/threatIntel.js):
 *   security.view          → Status lesen (Tab-Voraussetzung)
 *   security.intel_update  → „Datenbanken jetzt aktualisieren" — ohne das Recht wird
 *                            der Knopf gar nicht erst gerendert.
 */
export default function BedrohungsdatenTab() {
  const { hasPermission } = useAuth();
  const darfAktualisieren = hasPermission('security.intel_update');

  const [data, setData]       = useState(null);
  const [fehler, setFehler]   = useState(null);
  const [laden, setLaden]     = useState(false);
  const [sendet, setSendet]   = useState(false);
  const [meldung, setMeldung] = useState(null);   // { ok, text }
  const anfrage = useRef(0);

  const load = useCallback(async () => {
    const nr = ++anfrage.current;
    setLaden(true);
    try {
      const { data: d } = await axios.get('/api/threat-intel/status');
      if (nr !== anfrage.current) return;
      setData(d);
      setFehler(null);
    } catch (e) {
      if (nr !== anfrage.current) return;
      setFehler(e.response?.data?.error || e.message);
    } finally {
      if (nr === anfrage.current) setLaden(false);
    }
  }, []);

  const laeuft = !!data?.laeuft;
  useEffect(() => {
    load();
    const t = setInterval(load, laeuft ? POLL_LAEUFT_MS : POLL_RUHE_MS);
    return () => clearInterval(t);
  }, [load, laeuft]);

  const aktualisieren = async () => {
    setSendet(true);
    setMeldung(null);
    try {
      const { data: r } = await axios.post('/api/threat-intel/update');
      setMeldung({ ok: true, text: `${r.message || 'Aktualisierung gestartet'} — neue Stände werden geladen, sobald verfügbar.` });
    } catch (e) {
      setMeldung({ ok: false, text: e.response?.data?.error || 'Aktualisierung konnte nicht gestartet werden' });
    }
    setSendet(false);
    load();
  };

  const lauf = data?.letzterLauf;

  return (
    <div className="space-y-4">
      <Card
        title={<span className="flex items-center gap-2"><Database size={14} />Datenbank-Gesundheit</span>}
        action={
          <div className="flex items-center gap-2">
            <Button size="sm" variant="ghost" onClick={load} disabled={laden} title="Status neu laden" aria-label="Status neu laden">
              <RefreshCw size={12} className={laden ? 'animate-spin' : ''} />
            </Button>
            {darfAktualisieren && (
              <Button size="sm" onClick={aktualisieren} disabled={sendet || laeuft || data?.downloads === false}>
                <Download size={12} />
                <span className="hidden sm:inline">{laeuft ? 'Aktualisierung läuft …' : 'Datenbanken jetzt aktualisieren'}</span>
                <span className="sm:hidden">{laeuft ? 'Läuft …' : 'Aktualisieren'}</span>
              </Button>
            )}
          </div>
        }
      >
        {!data ? (
          fehler
            ? <p className="text-xs text-panel-red">{fehler}</p>
            : <p className="text-xs text-panel-muted">Lade Status …</p>
        ) : (
          <div className="space-y-4">
            <Gesamtlage data={data} />

            {meldung && (
              <p className={`text-xs ${meldung.ok ? 'text-panel-green' : 'text-panel-red'}`}>{meldung.text}</p>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
              {data.quellen.map(q => <QuellenKarte key={q.id} q={q} />)}
            </div>

            {(data.geoRueckfall || !data.downloads) && (
              <p className="flex items-start gap-1.5 text-[11px] text-panel-muted">
                <Info size={12} className="mt-0.5 shrink-0" />
                <span>
                  {!data.downloads && 'Automatische Downloads sind auf diesem Server abgeschaltet (THREAT_INTEL_DOWNLOADS=off). '}
                  {data.geoRueckfall && 'Bis die Geo-DB bereit ist, bestimmt das Panel Land und Stadt mit der eingebauten, älteren Standort-Datenbank.'}
                </span>
              </p>
            )}

            {lauf && (
              <p className="text-[11px] text-panel-muted">
                Letzter Lauf {wann(lauf.at)}{lauf.manuell ? ` (manuell${lauf.von ? ` von ${lauf.von}` : ''})` : ' (automatisch)'}:{' '}
                {Object.entries(lauf.ergebnisse || {}).map(([id, r]) => `${QUELLE[id]?.titel || id} ${ERGEBNIS[r] || r}`).join(' · ')}
              </p>
            )}
            {fehler && <p className="text-[11px] text-panel-red">Status konnte nicht aktualisiert werden: {fehler}</p>}
          </div>
        )}
      </Card>

      {data && (
        <Card title={<span className="flex items-center gap-2"><ShieldAlert size={14} />IP-Prüfung in drei Stufen</span>}>
          <div className="space-y-3">
            <Wasserfall data={data} />
            <p className="text-[11px] text-panel-muted">
              Jede Adresse durchläuft die Stufen der Reihe nach: Was der Cache schon kennt, wird nicht erneut
              abgefragt. Land, Stadt, Provider und Blocklisten-Treffer kommen aus den lokalen Datenbanken, die das Panel
              selbst herunterlädt und aktuell hält — dabei verlässt keine Adresse den Server. Nur die Einstufung als VPN,
              Proxy, Tor oder Rechenzentrum fragt, falls eingerichtet, ipapi.is.
            </p>
          </div>
        </Card>
      )}

      <p className="text-[11px] text-panel-muted">
        <a href="https://db-ip.com" target="_blank" rel="noopener noreferrer" className="underline hover:text-panel-text">IP Geolocation by DB-IP</a>
        {' '}(CC BY 4.0) · Blocklisten-Treffer aus{' '}
        <a href="https://github.com/stamparm/ipsum" target="_blank" rel="noopener noreferrer" className="underline hover:text-panel-text">IPsum</a>
        {' '}— ab {data?.missbrauchAb ?? 3} Listen gilt eine Adresse als bekannte Missbrauchsquelle.
      </p>
    </div>
  );
}
