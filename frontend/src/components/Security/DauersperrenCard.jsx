import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import { RefreshCw, AlertTriangle, ShieldBan, Unlock, Plus, RotateCcw, Search } from 'lucide-react';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import { useAuth } from '../../context/AuthContext';
import { IpHerkunft, IpProvider, IpTyp } from './IpIntel';
import SperrenDialog from './SperrenDialog';

const POLL_MS = 30_000;

const STATE_HINTS = {
  agent_outdated:    'Agent zu alt',
  agent_unreachable: 'Agent nicht erreichbar',
  error:             'Abfrage fehlgeschlagen',
};

// Außerhalb der Komponente, damit der Dialog bei jedem Neuladen der Liste (30-s-Takt)
// nicht seine Eingaben verliert — er setzt sich zurück, sobald sich der Vorschlag ändert.
const MANUELL = { quelle: 'manuell' };

const HERKUNFT = (e) => {
  if (e.herkunft === 'ssh-kick') return 'nach SSH-Auswurf';
  if (e.herkunft?.startsWith('fail2ban:')) return `aus Jail ${e.herkunft.slice(9)}`;
  return null;
};

/**
 * Alle dauerhaften Sperren eines Servers — unabhängig davon, woher sie stammen:
 * die Sperrliste des Panels (nftables) und fail2ban-Sperren mit unbegrenzter Dauer
 * aus jedem Jail. Lesen: security.view. Sperren/Aufheben der Panel-Liste: fail2ban.ban;
 * eine unbegrenzte fail2ban-Sperre aufheben: fail2ban.manage.
 */
export default function DauersperrenCard({ agentId, aktualisieren = 0, onGeaendert }) {
  const { hasPermission } = useAuth();
  const darfSperren    = hasPermission('fail2ban.ban');
  const darfEntsperren = hasPermission('fail2ban.manage');

  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(false);
  const [suche, setSuche]     = useState('');
  const [dialog, setDialog]   = useState(false);
  const [aktion, setAktion]   = useState(null);     // cidr während einer Anfrage
  const anfrage = useRef(0);

  const load = useCallback(async () => {
    const nr = ++anfrage.current;
    setLoading(true);
    let d;
    try { ({ data: d } = await axios.get(`/api/agents/${agentId}/blocklist`)); }
    catch (e) { d = { available: false, state: 'error', message: e.response?.data?.error || e.message, eintraege: [] }; }
    if (nr !== anfrage.current) return;
    setData(d);
    setLoading(false);
  }, [agentId]);

  useEffect(() => {
    setData(null);
    load();
    const t = setInterval(load, POLL_MS);
    return () => clearInterval(t);
  }, [load]);

  // Neu laden, wenn die fail2ban-Karte daneben etwas gesperrt oder entsperrt hat.
  useEffect(() => { if (aktualisieren) load(); }, [aktualisieren, load]);

  const eintraege = useMemo(() => {
    const q = suche.trim().toLowerCase();
    const alle = data?.eintraege || [];
    if (!q) return alle;
    return alle.filter(e => [e.cidr, e.grund, e.von, e.intel?.land, e.intel?.stadt, e.intel?.isp, ...(e.jails || [])]
      .some(v => String(v || '').toLowerCase().includes(q)));
  }, [data, suche]);

  const fertig = async () => { await load(); onGeaendert?.(); };

  const aufheben = async (e) => {
    const panel = e.quellen.includes('panel');
    const text = panel
      ? `Dauerhafte Sperre für ${e.cidr} aufheben?`
      : `${e.cidr} in ${e.jails.join(', ')} (fail2ban) entsperren?`;
    if (!confirm(text)) return;
    setAktion(e.cidr);
    try {
      if (panel) await axios.delete(`/api/agents/${agentId}/blocklist`, { data: { cidr: e.cidr } });
      if (darfEntsperren) {
        for (const jail of e.jails) await axios.post(`/api/agents/${agentId}/fail2ban/unban`, { jail, ip: e.cidr });
      }
      await fertig();
    } catch (err) { alert(err.response?.data?.error || err.message); }
    setAktion(null);
  };

  const erneut = async () => {
    setAktion('*');
    try {
      const { data: r } = await axios.post(`/api/agents/${agentId}/blocklist/reapply`);
      const fehl = (r.ergebnisse || []).filter(x => !x.ok);
      if (fehl.length) alert(fehl.map(x => `${x.cidr}: ${x.error}`).join('\n'));
      await fertig();
    } catch (err) { alert(err.response?.data?.error || err.message); }
    setAktion(null);
  };

  // Ohne das jeweilige Recht gibt es den Knopf nicht; fail2ban-Sperren hängen an fail2ban.manage.
  const kannAufheben = (e) => (e.quellen.includes('panel') ? darfSperren : darfEntsperren);
  const nichtAngewendet = (data?.eintraege || []).filter(e => e.angewendet === false).length;
  const zeigeAktion = darfSperren || darfEntsperren;

  return (
    <Card
      title="Dauerhaft gesperrte IPs"
      action={
        <div className="flex items-center gap-1.5">
          {darfSperren && (
            <Button size="sm" variant="danger" onClick={() => setDialog(true)}>
              <Plus size={13} className="mr-1" /> IP sperren
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={load} disabled={loading}>
            <RefreshCw size={13} className={`mr-1 ${loading ? 'animate-spin' : ''}`} /> Aktualisieren
          </Button>
        </div>
      }
    >
      {!data ? (
        <p className="text-xs text-panel-muted flex items-center gap-2"><RefreshCw size={12} className="animate-spin" /> Lade Sperrliste …</p>
      ) : (
        <div className="space-y-3">
          {data.state && data.state !== 'ok' && (
            <div className="flex items-start gap-2.5 p-2.5 rounded bg-panel-orange/10 border border-panel-orange/30 text-xs">
              <AlertTriangle size={15} className="text-panel-orange shrink-0 mt-0.5" />
              <div className="min-w-0">
                <span className="font-semibold text-panel-orange">{STATE_HINTS[data.state] || 'Nicht verfügbar'}</span>
                {data.message && <p className="text-[11px] text-panel-muted mt-0.5 break-words">{data.message}</p>}
              </div>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2 text-[11px] text-panel-muted">
            <span>{data.eintraege.length === 1 ? '1 dauerhafte Sperre' : `${data.eintraege.length} dauerhafte Sperren`}</span>
            {data.aktiv === true && data.drops && (
              <Badge color="gray">{data.drops.pakete.toLocaleString('de-DE')} Pakete verworfen</Badge>
            )}
            {data.available && data.aktiv === false && data.eintraege.some(e => e.quellen.includes('panel')) && (
              <Badge color="red">nftables-Tabelle fehlt</Badge>
            )}
            {nichtAngewendet > 0 && (
              <span className="inline-flex items-center gap-1.5">
                <Badge color="orange">{nichtAngewendet} nicht angewendet</Badge>
                {darfSperren && (
                  <Button size="sm" variant="ghost" onClick={erneut} disabled={aktion === '*'}>
                    <RotateCcw size={12} className="mr-1" /> Erneut anwenden
                  </Button>
                )}
              </span>
            )}
            <div className="ml-auto relative">
              <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-panel-muted" />
              <input value={suche} onChange={e => setSuche(e.target.value)} placeholder="Suchen …"
                     className="bg-panel-surface border border-panel-border rounded pl-6 pr-2 py-1 text-xs text-panel-text focus:outline-none focus:border-panel-accent w-40" />
            </div>
          </div>

          {eintraege.length === 0 ? (
            <p className="text-xs text-panel-muted">{suche ? 'Keine Treffer.' : 'Keine dauerhaften Sperren.'}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-panel-muted border-b border-panel-border">
                    <th className="py-1.5 pr-3 font-medium">IP / Netz</th>
                    <th className="py-1.5 pr-3 font-medium">Quelle</th>
                    <th className="py-1.5 pr-3 font-medium">Herkunft</th>
                    <th className="py-1.5 pr-3 font-medium">Provider</th>
                    <th className="py-1.5 pr-3 font-medium">Typ</th>
                    <th className="py-1.5 pr-3 font-medium">Grund</th>
                    <th className="py-1.5 pr-3 font-medium">Seit</th>
                    {zeigeAktion && <th className="py-1.5 font-medium text-right sr-only sm:not-sr-only">Aktion</th>}
                  </tr>
                </thead>
                <tbody>
                  {eintraege.map(e => (
                    <tr key={e.cidr} className="border-b border-panel-border/40 last:border-0 align-top">
                      <td className="py-1.5 pr-3 font-mono text-panel-text whitespace-nowrap">
                        <span className="inline-flex items-center gap-1.5"><ShieldBan size={11} className="text-panel-red" />{e.cidr}</span>
                        {e.angewendet === false && <Badge color="orange" className="ml-1.5">nicht angewendet</Badge>}
                      </td>
                      <td className="py-1.5 pr-3">
                        <span className="inline-flex flex-wrap gap-1">
                          {e.quellen.includes('panel') && <Badge color="purple">Panel</Badge>}
                          {e.jails.map(j => <Badge key={j} color="orange">fail2ban · {j}</Badge>)}
                        </span>
                      </td>
                      <td className="py-1.5 pr-3"><IpHerkunft intel={e.intel} /></td>
                      <td className="py-1.5 pr-3"><IpProvider intel={e.intel} /></td>
                      <td className="py-1.5 pr-3"><IpTyp intel={e.intel} /></td>
                      <td className="py-1.5 pr-3 text-panel-muted max-w-[16rem]">
                        <span className="block truncate" title={e.grund || ''}>{e.grund || '—'}</span>
                        {HERKUNFT(e) && <span className="text-[10px]">{HERKUNFT(e)}</span>}
                      </td>
                      <td className="py-1.5 pr-3 text-panel-muted whitespace-nowrap">
                        {e.seit ? new Date(e.seit.includes('T') ? e.seit : `${e.seit.replace(' ', 'T')}Z`).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' }) : '—'}
                        {e.von && <span className="block text-[10px]">von {e.von}</span>}
                      </td>
                      {zeigeAktion && (
                        <td className="py-1.5 text-right">
                          {kannAufheben(e) && (
                            <Button size="sm" variant="ghost" onClick={() => aufheben(e)} disabled={aktion === e.cidr}>
                              <Unlock size={12} className="mr-1" /> Aufheben
                            </Button>
                          )}
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

      {darfSperren && (
        <SperrenDialog open={dialog} onClose={() => setDialog(false)} agentId={agentId}
                       vorschlag={MANUELL} onErfolg={fertig} />
      )}
    </Card>
  );
}
