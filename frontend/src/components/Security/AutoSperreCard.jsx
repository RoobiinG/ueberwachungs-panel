import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import { ShieldBan, RefreshCw, Save, AlertTriangle, Rss, Flame, Info } from 'lucide-react';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import { useAuth } from '../../context/AuthContext';

const POLL_MS        = 30_000;
const POLL_SCHNELL_MS = 3_000;
const SCHWELLEN = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

const zahl = (n) => (n == null ? '—' : Number(n).toLocaleString('de-DE'));
const zeit = (iso) => (iso ? new Date(iso).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' }) : '—');

// Dieselbe Optik wie der Schalter in den Einstellungen.
function Schalter({ an, onChange, label }) {
  return (
    <button type="button" role="switch" aria-checked={an} aria-label={label} onClick={() => onChange(!an)}
      className={`relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full transition-colors duration-200 ease-in-out focus:outline-none focus-visible:ring-2 focus-visible:ring-panel-accent/50 ${an ? 'bg-panel-accent' : 'bg-panel-border'}`}>
      <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition duration-200 ease-in-out mt-0.5 ${an ? 'translate-x-4' : 'translate-x-0.5'}`} />
    </button>
  );
}

function SchwellenWahl({ wert, onChange, verteilung, label }) {
  return (
    <select value={wert} onChange={e => onChange(Number(e.target.value))} aria-label={label}
      className="bg-panel-surface border border-panel-border rounded px-2 py-1 text-xs text-panel-text focus:outline-none focus:border-panel-accent">
      {SCHWELLEN.map(s => (
        <option key={s} value={s}>ab {s} {s === 1 ? 'Liste' : 'Listen'}{verteilung?.[s] != null ? ` (${zahl(verteilung[s])} IPs)` : ''}</option>
      ))}
    </select>
  );
}

/**
 * Automatische Sperre im Tab „Bedrohungsdaten":
 *   Threat-Feed     — Adressen ab N IPsum-Listen werden auf allen Servern vorab gesperrt.
 *   Eskalation      — fail2ban-Sperren von Adressen ab N Listen werden zu Dauersperren.
 * Lesen: security.view. Schalten: fail2ban.ban — ohne das Recht gibt es keine Schalter im DOM,
 * das Backend (PUT /api/threat-intel/auto-sperre) prüft zusätzlich.
 */
export default function AutoSperreCard() {
  const { hasPermission } = useAuth();
  const darfSchalten = hasPermission('fail2ban.ban');

  const [data, setData]       = useState(null);
  const [fehler, setFehler]   = useState(null);
  const [laden, setLaden]     = useState(false);
  const [entwurf, setEntwurf] = useState(null);
  const [sendet, setSendet]   = useState(false);
  const [meldung, setMeldung] = useState(null);
  const [schnellBis, setSchnellBis] = useState(0);
  const anfrage = useRef(0);

  const load = useCallback(async () => {
    const nr = ++anfrage.current;
    setLaden(true);
    try {
      const { data: d } = await axios.get('/api/threat-intel/auto-sperre');
      if (nr !== anfrage.current) return;
      setData(d);
      setFehler(null);
    } catch (e) {
      if (nr === anfrage.current) setFehler(e.response?.data?.error || e.message);
    } finally {
      if (nr === anfrage.current) setLaden(false);
    }
  }, []);

  const schnell = !!data?.abgleich?.laeuft || Date.now() < schnellBis;
  useEffect(() => {
    load();
    const t = setInterval(load, schnell ? POLL_SCHNELL_MS : POLL_MS);
    return () => clearInterval(t);
  }, [load, schnell]);

  // Entwurf erst übernehmen, wenn noch keiner existiert — sonst überschriebe der Takt die Eingaben.
  useEffect(() => { if (data && !entwurf) setEntwurf(data.einstellungen); }, [data, entwurf]);

  const geaendert = useMemo(() => !!(entwurf && data && JSON.stringify(entwurf) !== JSON.stringify(data.einstellungen)), [entwurf, data]);
  const setze = (k, v) => setEntwurf(e => ({ ...e, [k]: v }));

  const speichern = async (trotzdem = false) => {
    setSendet(true);
    setMeldung(null);
    try {
      await axios.put('/api/threat-intel/auto-sperre', { ...entwurf, trotzdem });
      setMeldung({ ok: true, text: 'Gespeichert — die Server werden jetzt abgeglichen.' });
      setEntwurf(null);
      setSchnellBis(Date.now() + 30_000);
      await load();
    } catch (e) {
      const d = e.response?.data;
      if (d?.bestaetigungNoetig && confirm(`${d.error}\n\nTrotzdem einschalten?`)) { setSendet(false); return speichern(true); }
      setMeldung({ ok: false, text: d?.error || e.message });
    }
    setSendet(false);
  };

  const e = entwurf || data?.einstellungen;
  const ip = data?.deineIp;

  return (
    <Card
      title={<span className="flex items-center gap-2"><ShieldBan size={14} />Automatische Sperre</span>}
      action={
        <Button size="sm" variant="ghost" onClick={load} disabled={laden} title="Status neu laden" aria-label="Status neu laden">
          <RefreshCw size={12} className={laden ? 'animate-spin' : ''} />
        </Button>
      }
    >
      {!data || !e ? (
        fehler ? <p className="text-xs text-panel-red">{fehler}</p> : <p className="text-xs text-panel-muted">Lade Einstellungen …</p>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {/* Threat-Feed */}
            <div className="rounded-lg border border-panel-border bg-panel-surface/40 p-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2 text-sm font-semibold text-panel-text"><Rss size={14} className="text-panel-accent" />Threat-Feed</span>
                {darfSchalten
                  ? <Schalter an={e.feed} onChange={v => setze('feed', v)} label="Threat-Feed ein- oder ausschalten" />
                  : <Badge color={e.feed ? 'green' : 'gray'}>{e.feed ? 'An' : 'Aus'}</Badge>}
              </div>
              <p className="text-[11px] text-panel-muted">
                Sperrt Adressen, die auf mehreren öffentlichen Blocklisten stehen, auf allen Servern vorab per nftables —
                sie erreichen fail2ban gar nicht erst. Aktualisiert sich mit jeder neuen IPsum-Liste (täglich).
              </p>
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="text-panel-muted">Sperren</span>
                {darfSchalten
                  ? <SchwellenWahl wert={e.feedSchwelle} onChange={v => setze('feedSchwelle', v)} verteilung={data.verteilung} label="Schwelle für den Threat-Feed" />
                  : <span className="text-panel-text">ab {e.feedSchwelle} Listen</span>}
                {data.verteilung && <span className="text-panel-muted">= {zahl(data.verteilung[e.feedSchwelle])} Adressen</span>}
              </div>
            </div>

            {/* fail2ban-Eskalation */}
            <div className="rounded-lg border border-panel-border bg-panel-surface/40 p-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2 text-sm font-semibold text-panel-text"><Flame size={14} className="text-panel-orange" />fail2ban-Eskalation</span>
                {darfSchalten
                  ? <Schalter an={e.eskalation} onChange={v => setze('eskalation', v)} label="fail2ban-Eskalation ein- oder ausschalten" />
                  : <Badge color={e.eskalation ? 'green' : 'gray'}>{e.eskalation ? 'An' : 'Aus'}</Badge>}
              </div>
              <p className="text-[11px] text-panel-muted">
                Sperrt fail2ban eine Adresse, die auch auf Blocklisten steht, wird daraus eine Dauersperre — sie erscheint
                unter „Dauerhaft gesperrte IPs" mit der Quelle „Automatisch". Geprüft wird alle 2 Minuten.
              </p>
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="text-panel-muted">Eskalieren</span>
                {darfSchalten
                  ? <SchwellenWahl wert={e.eskalationSchwelle} onChange={v => setze('eskalationSchwelle', v)} verteilung={null} label="Schwelle für die Eskalation" />
                  : <span className="text-panel-text">ab {e.eskalationSchwelle} {e.eskalationSchwelle === 1 ? 'Liste' : 'Listen'}</span>}
              </div>
            </div>
          </div>

          {ip?.blocklisten > 0 && (
            <p className={`flex items-start gap-1.5 text-[11px] ${ip.aufWhitelist ? 'text-panel-muted' : 'text-panel-orange'}`}>
              <AlertTriangle size={12} className="mt-0.5 shrink-0" />
              <span>
                Deine aktuelle Adresse {ip.ip} steht auf {ip.blocklisten} {ip.blocklisten === 1 ? 'Blockliste' : 'Blocklisten'}
                {ip.aufWhitelist ? ' — sie ist auf der Whitelist und wird nicht gesperrt.' : '. Trage sie in die Whitelist ein (Tab „Fail2Ban & Sperren"), bevor du den Feed einschaltest.'}
              </span>
            </p>
          )}

          {darfSchalten && (
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" onClick={() => speichern(false)} disabled={!geaendert || sendet}>
                <Save size={12} /> Speichern
              </Button>
              {geaendert && <Button size="sm" variant="ghost" onClick={() => setEntwurf(data.einstellungen)} disabled={sendet}>Verwerfen</Button>}
              {meldung && <span className={`text-xs ${meldung.ok ? 'text-panel-green' : 'text-panel-red'}`}>{meldung.text}</span>}
            </div>
          )}

          {/* Stand je Server */}
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-panel-muted border-b border-panel-border">
                  <th className="py-1.5 pr-3 font-medium">Server</th>
                  <th className="py-1.5 pr-3 font-medium">Threat-Feed</th>
                  <th className="py-1.5 pr-3 font-medium">Verworfen</th>
                  <th className="py-1.5 font-medium">Eskalation</th>
                </tr>
              </thead>
              <tbody>
                {data.server.length === 0 && (
                  <tr><td colSpan={4} className="py-2 text-panel-muted">{data.abgleich.lastRunAt ? 'Keine Server.' : 'Erster Abgleich läuft kurz nach dem Start des Panels …'}</td></tr>
                )}
                {data.server.map(s => (
                  <tr key={s.agentId} className="border-b border-panel-border/40 last:border-0">
                    <td className="py-1.5 pr-3 text-panel-text">{s.name}</td>
                    <td className="py-1.5 pr-3">
                      {s.feed?.zuAlt ? (
                        e.feed ? <Badge color="orange">Agent ab v{data.agentAb} nötig</Badge> : <span className="text-panel-muted">—</span>
                      ) : s.feed?.fehler ? (
                        <span className="text-panel-red" title={s.feed.fehler}>Fehler</span>
                      ) : s.feed?.anzahl > 0 ? (
                        <span className="text-panel-text">{zahl(s.feed.anzahl)} IPs{s.feed.uebersprungen ? <span className="text-panel-muted"> · {zahl(s.feed.uebersprungen)} ausgenommen</span> : null}</span>
                      ) : <span className="text-panel-muted">aus</span>}
                    </td>
                    <td className="py-1.5 pr-3 text-panel-muted">{s.feed?.drops ? `${zahl(s.feed.drops.pakete)} Pakete` : '—'}</td>
                    <td className="py-1.5 text-panel-muted">
                      {!e.eskalation ? 'aus' : s.eskalation?.fehler ? <span className="text-panel-red" title={s.eskalation.fehler}>Fehler</span>
                        : s.eskalation?.geprueftAt ? `geprüft ${zeit(s.eskalation.geprueftAt)}` : 'ausstehend'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {data.letzteEskalationen.length > 0 && (
            <div className="space-y-1">
              <p className="text-[11px] font-semibold text-panel-muted uppercase tracking-wide">Zuletzt automatisch gesperrt</p>
              <ul className="text-xs space-y-0.5">
                {data.letzteEskalationen.slice(0, 10).map((x, i) => (
                  <li key={`${x.agentId}-${x.cidr}-${i}`} className="flex flex-wrap gap-x-2 text-panel-muted">
                    <span className="font-mono text-panel-text">{x.cidr}</span>
                    <span>{x.server} · Jail {x.jail} · {x.listen} {x.listen === 1 ? 'Liste' : 'Listen'}</span>
                    <span>{zeit(x.at)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <p className="flex items-start gap-1.5 text-[11px] text-panel-muted">
            <Info size={12} className="mt-0.5 shrink-0" />
            <span>
              Nie gesperrt werden die Adressen der Server selbst, die des Panels, private Netze, Einträge der Whitelist und
              Adressen mit einer aktiven SSH-Sitzung. Benötigt Agent v{data.agentAb} oder neuer.
              {data.abgleich.lastRunAt && ` Letzter Abgleich: ${zeit(data.abgleich.lastRunAt)}.`}
              {data.abgleich.lastError && <span className="text-panel-red"> {data.abgleich.lastError}</span>}
            </span>
          </p>
        </div>
      )}
    </Card>
  );
}
