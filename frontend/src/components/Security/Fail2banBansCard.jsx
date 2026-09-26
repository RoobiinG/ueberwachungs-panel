import { useEffect, useState, useCallback, useRef } from 'react';
import axios from 'axios';
import { RefreshCw, AlertTriangle, Ban, Unlock } from 'lucide-react';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import { useAuth } from '../../context/AuthContext';

const POLL_MS = 30_000;

// Hinweistexte für alle Zustände, in denen keine Liste angezeigt werden kann.
const STATE_HINTS = {
  offline:           'fail2ban läuft nicht',
  not_installed:     'fail2ban ist nicht installiert',
  agent_outdated:    'Agent zu alt',
  agent_unreachable: 'Agent nicht erreichbar',
  error:             'Abfrage fehlgeschlagen',
};

// Restzeit lesbar: unter einer Stunde mm:ss, darunter h:mm:ss, ab einem Tag „2 T 5 Std".
function formatRemaining(sec) {
  if (sec <= 0) return 'läuft ab …';
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  if (d > 0) return `${d} T ${h} Std`;
  const mmss = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return h > 0 ? `${h}:${mmss}` : mmss;
}

export default function Fail2banBansCard({ agentId }) {
  const { hasPermission } = useAuth();
  // Entsperren ist eine Schreibaktion mit eigenem Recht; ohne es gibt es den Knopf gar nicht.
  const darfEntsperren = hasPermission('fail2ban.manage');
  const [data, setData]         = useState(null);
  const [fetchedAt, setFetched] = useState(0);
  const [loading, setLoading]   = useState(false);
  const [now, setNow]           = useState(Date.now());
  const [entsperrt, setEntsperrt] = useState(null);   // `${jail}|${ip}` während der Anfrage

  // Antworten eines inzwischen abgewählten Servers verwerfen.
  const anfrage = useRef(0);

  const load = useCallback(async () => {
    const nr = ++anfrage.current;
    setLoading(true);
    let d;
    try {
      ({ data: d } = await axios.get(`/api/agents/${agentId}/fail2ban/bans`));
    } catch (e) {
      d = { available: false, state: 'error', message: e.response?.data?.error || e.message, jails: [], bans: [] };
    }
    if (nr !== anfrage.current) return;
    setData(d);
    setFetched(Date.now());
    setLoading(false);
  }, [agentId]);

  useEffect(() => {
    setData(null);
    load();
    const t = setInterval(load, POLL_MS);
    return () => clearInterval(t);
  }, [load]);

  const unban = async (b) => {
    if (!confirm(`${b.ip} im Jail „${b.jail}" entsperren?`)) return;
    setEntsperrt(`${b.jail}|${b.ip}`);
    try {
      await axios.post(`/api/agents/${agentId}/fail2ban/unban`, { jail: b.jail, ip: b.ip });
      await load();
    } catch (e) {
      alert(e.response?.data?.error || e.message);
    }
    setEntsperrt(null);
  };

  // Sekundentakt nur, solange es etwas herunterzuzählen gibt.
  const hasCountdown = !!data?.bans?.some(b => !b.permanent);
  useEffect(() => {
    if (!hasCountdown) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [hasCountdown]);

  // Restzeit relativ zum Abrufzeitpunkt herunterzählen — unabhängig davon, ob die Uhr
  // des Browsers von der des Servers abweicht.
  const elapsed = Math.max(0, (now - fetchedAt) / 1000);
  const bans = data?.bans || [];
  const jailErrors = (data?.jails || []).filter(j => j.error);

  return (
    <Card
      title="Gesperrte IPs (Fail2ban)"
      action={
        <Button size="sm" variant="ghost" onClick={load} disabled={loading}>
          <RefreshCw size={13} className={`mr-1 ${loading ? 'animate-spin' : ''}`} /> Aktualisieren
        </Button>
      }
    >
      {!data ? (
        <p className="text-xs text-panel-muted flex items-center gap-2">
          <RefreshCw size={12} className="animate-spin" /> Lade Sperrliste …
        </p>
      ) : !data.available ? (
        <div className="flex items-start gap-2.5 p-2.5 rounded bg-panel-orange/10 border border-panel-orange/30 text-xs">
          <AlertTriangle size={15} className="text-panel-orange shrink-0 mt-0.5" />
          <div className="min-w-0">
            <span className="font-semibold text-panel-orange">{STATE_HINTS[data.state] || 'Nicht verfügbar'}</span>
            {data.message && <p className="text-[11px] text-panel-muted mt-0.5 break-words">{data.message}</p>}
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-panel-muted">
            <span>{bans.length === 1 ? '1 gesperrte IP' : `${bans.length} gesperrte IPs`} in</span>
            {data.jails.map(j => (
              <Badge key={j.name} color={j.error ? 'red' : j.bannedCount > 0 ? 'orange' : 'gray'}>
                {j.name} · {j.bannedCount}
              </Badge>
            ))}
          </div>

          {jailErrors.map(j => (
            <p key={j.name} className="text-[11px] text-panel-red flex items-start gap-1.5">
              <AlertTriangle size={11} className="shrink-0 mt-0.5" />
              Jail {j.name}: {j.error}
            </p>
          ))}

          {bans.length === 0 ? (
            <p className="text-xs text-panel-muted">Aktuell ist keine IP gesperrt.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-panel-muted border-b border-panel-border">
                    <th className="py-1.5 pr-3 font-medium">IP-Adresse</th>
                    <th className="py-1.5 pr-3 font-medium">Jail</th>
                    <th className="py-1.5 pr-3 font-medium">Gesperrt seit</th>
                    <th className="py-1.5 font-medium text-right">Restzeit</th>
                    {darfEntsperren && <th className="py-1.5 pl-3 font-medium text-right sr-only sm:not-sr-only">Aktion</th>}
                  </tr>
                </thead>
                <tbody>
                  {bans.map(b => (
                    <tr key={`${b.jail}|${b.ip}`} className="border-b border-panel-border/40 last:border-0">
                      <td className="py-1.5 pr-3 font-mono text-panel-text">
                        <span className="inline-flex items-center gap-1.5"><Ban size={11} className="text-panel-red" />{b.ip}</span>
                      </td>
                      <td className="py-1.5 pr-3 text-panel-muted">{b.jail}</td>
                      <td className="py-1.5 pr-3 text-panel-muted whitespace-nowrap">
                        {new Date(b.bannedAt).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' })}
                      </td>
                      <td className="py-1.5 text-right font-mono whitespace-nowrap">
                        {b.permanent
                          ? <span className="text-panel-red">dauerhaft</span>
                          : <span className="text-panel-text">{formatRemaining(b.remainingSeconds - elapsed)}</span>}
                      </td>
                      {darfEntsperren && (
                        <td className="py-1.5 pl-3 text-right">
                          <Button size="sm" variant="ghost" onClick={() => unban(b)} disabled={entsperrt === `${b.jail}|${b.ip}`}>
                            <Unlock size={12} className="mr-1" /> Entsperren
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
