import { useCallback, useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { ShieldCheck, RefreshCw, Plus, Trash2, CheckCircle2, AlertTriangle, Loader2, UserCheck } from 'lucide-react';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import { useAuth } from '../../context/AuthContext';
import { IpHerkunft, IpProvider } from './IpIntel';

const POLL_MS         = 30_000;
const POLL_SCHNELL_MS = 3_000;

const datum = (s) => {
  if (!s) return '—';
  const d = new Date(s.includes('T') ? s : `${s.replace(' ', 'T')}Z`);
  return isNaN(d) ? s : d.toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' });
};

// Stand der Whitelist auf dem gewählten Server, so wie ihn der letzte Abgleich gesehen hat.
function ServerStand({ server, agentAb, anzahl, laeuft }) {
  const w = server?.whitelist;
  if (!w) {
    return <p className="flex items-center gap-1.5 text-[11px] text-panel-muted"><Loader2 size={12} className="animate-spin" />Wird mit diesem Server abgeglichen …</p>;
  }
  if (w.zuAlt) {
    return anzahl
      ? <p className="flex items-center gap-1.5 text-[11px] text-panel-orange"><AlertTriangle size={12} />Auf diesem Server nicht angewendet — Agent v{agentAb} oder neuer nötig.</p>
      : null;
  }
  if (w.fehler) return <p className="flex items-center gap-1.5 text-[11px] text-panel-red"><AlertTriangle size={12} />Abgleich fehlgeschlagen: {w.fehler}</p>;
  if (!anzahl) return null;

  const f = w.fail2ban;
  const jails = f?.jails || [];
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-panel-muted">
      {laeuft ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={12} className="text-panel-green" />}
      <span>Auf diesem Server:</span>
      {f?.state === 'running' ? (
        jails.length
          ? jails.map(j => <Badge key={j.name} color={j.ok === false ? 'red' : 'green'}>fail2ban · {j.name}</Badge>)
          : <Badge color="gray">fail2ban ohne Jails</Badge>
      ) : f?.state === 'not_installed' ? <Badge color="gray">kein fail2ban</Badge> : <Badge color="orange">fail2ban läuft nicht</Badge>}
      {f?.datei && <span title="Steht in /etc/fail2ban/jail.d/zz-panel-agent-whitelist.local und gilt damit auch nach einem Neustart von fail2ban">· über Neustarts gesichert</span>}
      {f?.dateiFehler && <span className="text-panel-orange" title={f.dateiFehler}>· nur bis zum nächsten fail2ban-Neustart (wird automatisch nachgetragen)</span>}
      {w.firewall && <Badge color={w.firewall.ok ? 'green' : 'red'}>{w.firewall.ok ? 'Firewall' : 'Firewall: Fehler'}</Badge>}
    </div>
  );
}

/**
 * Whitelist für alle Server: Diese Adressen sperrt fail2ban nie (ignoreip), und keine Sperre
 * des Panels — von Hand, Eskalation oder Threat-Feed — greift für sie.
 * Lesen: security.view. Hinzufügen/Entfernen: fail2ban.whitelist — ohne das Recht gibt es
 * weder Formular noch Knöpfe im DOM; das Backend (routes/whitelist.js) prüft zusätzlich.
 */
export default function WhitelistCard({ agentId, onGeaendert }) {
  const { hasPermission } = useAuth();
  const darfAendern = hasPermission('fail2ban.whitelist');

  const [data, setData]     = useState(null);
  const [fehler, setFehler] = useState(null);
  const [laden, setLaden]   = useState(false);
  const [cidr, setCidr]     = useState('');
  const [notiz, setNotiz]   = useState('');
  const [aktion, setAktion] = useState(null);
  const [meldung, setMeldung] = useState(null);
  const [schnellBis, setSchnellBis] = useState(0);
  const anfrage = useRef(0);

  const load = useCallback(async () => {
    const nr = ++anfrage.current;
    setLaden(true);
    try {
      const { data: d } = await axios.get('/api/whitelist');
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

  const nachAenderung = async () => {
    setSchnellBis(Date.now() + 20_000);
    await load();
    onGeaendert?.();
  };

  const hinzufuegen = async (wert = cidr, text = notiz, trotzdem = false) => {
    if (!String(wert).trim()) return;
    setAktion('neu');
    setMeldung(null);
    try {
      const { data: r } = await axios.post('/api/whitelist', { cidr: String(wert).trim(), notiz: text, trotzdem });
      setMeldung({ ok: true, text: `${r.cidr} steht jetzt auf der Whitelist${r.aufgehoben?.length ? ` — ${r.aufgehoben.length} Dauersperre(n) aufgehoben` : ''}. Die Server werden abgeglichen.` });
      setCidr(''); setNotiz('');
      await nachAenderung();
    } catch (e) {
      const d = e.response?.data;
      if (d?.bestaetigungNoetig && confirm(`${d.error}\n\nFortfahren?`)) { setAktion(null); return hinzufuegen(wert, text, true); }
      setMeldung({ ok: false, text: d?.error || e.message });
    }
    setAktion(null);
  };

  const entfernen = async (w) => {
    if (!confirm(`${w.cidr} von der Whitelist nehmen? fail2ban kann die Adresse danach wieder sperren.`)) return;
    setAktion(w.id);
    try {
      await axios.delete(`/api/whitelist/${w.id}`);
      await nachAenderung();
    } catch (e) { alert(e.response?.data?.error || e.message); }
    setAktion(null);
  };

  const server = data?.server?.find(s => String(s.agentId) === String(agentId));
  const ip = data?.deineIp;

  return (
    <Card
      title={<span className="flex items-center gap-2"><ShieldCheck size={14} className="text-panel-green" />Whitelist (alle Server)</span>}
      action={
        <Button size="sm" variant="ghost" onClick={load} disabled={laden} title="Neu laden" aria-label="Whitelist neu laden">
          <RefreshCw size={13} className={laden ? 'animate-spin' : ''} />
        </Button>
      }
    >
      {!data ? (
        fehler ? <p className="text-xs text-panel-red">{fehler}</p> : <p className="text-xs text-panel-muted">Lade Whitelist …</p>
      ) : (
        <div className="space-y-3">
          <p className="text-[11px] text-panel-muted">
            Adressen und Netze auf dieser Liste sperrt fail2ban auf keinem Server, und keine Sperre des Panels greift
            für sie — weder von Hand noch automatisch. Gilt für alle Server.
          </p>

          <ServerStand server={server} agentAb={data.agentAb} anzahl={data.eintraege.length} laeuft={data.abgleich?.laeuft} />

          {darfAendern && (
            <div className="space-y-2">
              <form className="flex flex-wrap gap-2" onSubmit={ev => { ev.preventDefault(); hinzufuegen(); }}>
                <input value={cidr} onChange={ev => setCidr(ev.target.value)} placeholder="IP oder Netz, z. B. 203.0.113.7"
                       aria-label="IP-Adresse oder Netz"
                       className="flex-1 min-w-[12rem] bg-panel-surface border border-panel-border rounded px-2.5 py-1.5 text-xs font-mono text-panel-text focus:outline-none focus:border-panel-accent" />
                <input value={notiz} onChange={ev => setNotiz(ev.target.value)} placeholder="Notiz (optional)" maxLength={120}
                       aria-label="Notiz"
                       className="flex-1 min-w-[10rem] bg-panel-surface border border-panel-border rounded px-2.5 py-1.5 text-xs text-panel-text focus:outline-none focus:border-panel-accent" />
                <Button type="submit" size="sm" variant="success" disabled={!cidr.trim() || aktion === 'neu'}>
                  <Plus size={13} /> Hinzufügen
                </Button>
              </form>
              {ip && !ip.aufWhitelist && (
                <button type="button" onClick={() => hinzufuegen(ip.ip, 'Eigene Adresse')} disabled={aktion === 'neu'}
                        className="inline-flex items-center gap-1.5 text-[11px] text-panel-accent hover:underline disabled:opacity-50">
                  <UserCheck size={12} /> Meine aktuelle Adresse eintragen ({ip.ip})
                </button>
              )}
              {meldung && <p className={`text-xs ${meldung.ok ? 'text-panel-green' : 'text-panel-red'}`}>{meldung.text}</p>}
            </div>
          )}
          {ip?.aufWhitelist && <p className="text-[11px] text-panel-green">Deine aktuelle Adresse {ip.ip} steht auf der Whitelist.</p>}

          {data.eintraege.length === 0 ? (
            <p className="text-xs text-panel-muted">Noch keine Einträge.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-panel-muted border-b border-panel-border">
                    <th className="py-1.5 pr-3 font-medium">IP / Netz</th>
                    <th className="py-1.5 pr-3 font-medium">Notiz</th>
                    <th className="py-1.5 pr-3 font-medium">Herkunft</th>
                    <th className="py-1.5 pr-3 font-medium">Provider</th>
                    <th className="py-1.5 pr-3 font-medium">Eingetragen</th>
                    {darfAendern && <th className="py-1.5 font-medium text-right sr-only sm:not-sr-only">Aktion</th>}
                  </tr>
                </thead>
                <tbody>
                  {data.eintraege.map(w => (
                    <tr key={w.id} className="border-b border-panel-border/40 last:border-0">
                      <td className="py-1.5 pr-3 font-mono text-panel-text whitespace-nowrap">{w.cidr}</td>
                      <td className="py-1.5 pr-3 text-panel-muted max-w-[14rem]"><span className="block truncate" title={w.notiz || ''}>{w.notiz || '—'}</span></td>
                      <td className="py-1.5 pr-3"><IpHerkunft intel={w.intel} /></td>
                      <td className="py-1.5 pr-3"><IpProvider intel={w.intel} /></td>
                      <td className="py-1.5 pr-3 text-panel-muted whitespace-nowrap">
                        {datum(w.erstellt_at)}
                        {w.erstellt_von && <span className="block text-[10px]">von {w.erstellt_von}</span>}
                      </td>
                      {darfAendern && (
                        <td className="py-1.5 text-right">
                          <Button size="sm" variant="ghost" onClick={() => entfernen(w)} disabled={aktion === w.id}>
                            <Trash2 size={12} /> Entfernen
                          </Button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
