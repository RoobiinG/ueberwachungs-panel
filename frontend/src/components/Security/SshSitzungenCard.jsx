import { useCallback, useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { RefreshCw, Terminal, LogOut, AlertTriangle } from 'lucide-react';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import { Modal } from '../ui/Modal';
import { useAuth } from '../../context/AuthContext';
import { IpHerkunft } from './IpIntel';

const POLL_MS = 15_000;

// „seit 2 Std 5 Min" — relativ zur Uhr des Browsers; das genaue Datum steht im Tooltip.
function seitText(iso, jetzt) {
  if (!iso) return '—';
  const s = Math.max(0, Math.floor((jetzt - new Date(iso).getTime()) / 1000));
  const t = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  if (t > 0) return `${t} T ${h} Std`;
  if (h > 0) return `${h} Std ${m} Min`;
  if (m > 0) return `${m} Min`;
  return 'gerade eben';
}

/**
 * Aktive SSH-Sitzungen: wer, von wo, seit wann — und, mit dem Recht `security.ssh_kick`,
 * der Knopf „Auswerfen". Ohne das Recht existieren weder Spalte, Knopf noch Dialog im DOM.
 * Die Checkbox „IP zusätzlich dauerhaft sperren" gibt es nur mit `fail2ban.ban`.
 */
export default function SshSitzungenCard({ agentId }) {
  const { hasPermission } = useAuth();
  const darfAuswerfen = hasPermission('security.ssh_kick');
  const darfSperren   = hasPermission('fail2ban.ban');

  const [sitzungen, setSitzungen] = useState(null);
  const [fehler, setFehler]       = useState('');
  const [loading, setLoading]     = useState(false);
  const [jetzt, setJetzt]         = useState(Date.now());
  const [kick, setKick]           = useState(null);       // Sitzung im Dialog
  const [sperren, setSperren]     = useState(false);
  const [grund, setGrund]         = useState('');
  const [laeuft, setLaeuft]       = useState(false);
  const [kickFehler, setKickFehler] = useState('');
  const [rueckfrage, setRueckfrage] = useState('');
  const anfrage = useRef(0);

  const load = useCallback(async () => {
    const nr = ++anfrage.current;
    setLoading(true);
    try {
      const { data } = await axios.get(`/api/agents/${agentId}/ssh/sessions`);
      if (nr !== anfrage.current) return;
      setSitzungen(Array.isArray(data) ? data : []);
      setFehler('');
    } catch (e) {
      if (nr !== anfrage.current) return;
      setSitzungen([]);
      setFehler(e.response?.data?.error || e.message);
    }
    setJetzt(Date.now());
    setLoading(false);
  }, [agentId]);

  useEffect(() => {
    setSitzungen(null);
    load();
    const t = setInterval(load, POLL_MS);
    return () => clearInterval(t);
  }, [load]);

  const oeffnen = (s) => { setKick(s); setSperren(false); setGrund(''); setKickFehler(''); setRueckfrage(''); };

  const auswerfen = async (trotzdem = false) => {
    setLaeuft(true); setKickFehler('');
    try {
      await axios.post(`/api/agents/${agentId}/ssh/sessions/kick`, {
        pid: kick.pid, startTicks: kick.startTicks,
        sperren: darfSperren && sperren, grund: grund.trim() || undefined, trotzdem,
      });
      setKick(null);
      await load();
    } catch (e) {
      const d = e.response?.data || {};
      if (e.response?.status === 409 && d.bestaetigungNoetig && !trotzdem) setRueckfrage(d.error);
      else setKickFehler(d.error || e.message);
    }
    setLaeuft(false);
  };

  const liste = sitzungen || [];
  return (
    <Card
      title="Aktive SSH-Sitzungen"
      action={
        <Button size="sm" variant="ghost" onClick={load} disabled={loading}>
          <RefreshCw size={13} className={`mr-1 ${loading ? 'animate-spin' : ''}`} /> Aktualisieren
        </Button>
      }
    >
      {sitzungen === null ? (
        <p className="text-xs text-panel-muted">Lade aktive Sitzungen …</p>
      ) : fehler ? (
        <p className="text-xs text-panel-red">{fehler}</p>
      ) : liste.length === 0 ? (
        <p className="text-xs text-panel-muted">Keine aktiven SSH-Verbindungen gefunden.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-panel-muted border-b border-panel-border">
                <th className="py-1.5 pr-3 font-medium">Benutzer</th>
                <th className="py-1.5 pr-3 font-medium">Von</th>
                <th className="py-1.5 pr-3 font-medium">Herkunft</th>
                <th className="py-1.5 pr-3 font-medium">Terminal</th>
                <th className="py-1.5 pr-3 font-medium">Seit</th>
                {darfAuswerfen && <th className="py-1.5 font-medium text-right sr-only sm:not-sr-only">Aktion</th>}
              </tr>
            </thead>
            <tbody>
              {liste.map((s, i) => (
                <tr key={s.id || `${s.ip}-${i}`} className="border-b border-panel-border/40 last:border-0">
                  <td className="py-1.5 pr-3">
                    <span className="inline-flex items-center gap-1.5">
                      <Terminal size={12} className="text-panel-accent" />
                      {s.user ? <Badge color={s.user === 'root' ? 'orange' : 'blue'}>{s.user}</Badge> : <span className="text-panel-muted">—</span>}
                    </span>
                  </td>
                  <td className="py-1.5 pr-3 font-mono text-panel-text">{s.ip}{s.port ? <span className="text-panel-muted">:{s.port}</span> : null}</td>
                  <td className="py-1.5 pr-3"><IpHerkunft intel={s.intel} /></td>
                  <td className="py-1.5 pr-3 font-mono text-panel-muted">
                    {s.tty === 'notty' ? <span title="Ohne Terminal — z. B. SFTP oder Port-Weiterleitung">SFTP/Tunnel</span> : (s.tty || '—')}
                  </td>
                  <td className="py-1.5 pr-3 text-panel-muted whitespace-nowrap"
                      title={s.loginAt ? new Date(s.loginAt).toLocaleString('de-DE') : undefined}>
                    {seitText(s.loginAt, jetzt)}
                  </td>
                  {darfAuswerfen && (
                    <td className="py-1.5 text-right">
                      {s.kickable && (
                        <Button size="sm" variant="danger" onClick={() => oeffnen(s)}>
                          <LogOut size={12} className="mr-1" /> Auswerfen
                        </Button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          {liste.some(s => !s.kickable) && darfAuswerfen && (
            <p className="text-[11px] text-panel-muted mt-2">Ohne „Auswerfen"-Knopf: Der Agent kann diese Sitzung keinem Prozess zuordnen (Agent ab v2.19.0 nötig).</p>
          )}
        </div>
      )}

      {darfAuswerfen && (
        <Modal
          open={!!kick}
          onClose={() => setKick(null)}
          title={<span className="flex items-center gap-2"><LogOut size={14} className="text-panel-red" /> SSH-Sitzung beenden</span>}
          footer={
            <>
              <Button variant="ghost" onClick={() => setKick(null)} disabled={laeuft}>Abbrechen</Button>
              {rueckfrage
                ? <Button variant="danger" onClick={() => auswerfen(true)} disabled={laeuft}>Trotzdem auswerfen</Button>
                : <Button variant="danger" onClick={() => auswerfen(false)} disabled={laeuft}>{sperren ? 'Sperren & auswerfen' : 'Auswerfen'}</Button>}
            </>
          }
        >
          {kick && (
            <div className="space-y-3 text-xs">
              <p className="text-panel-muted">
                Die Verbindung von <strong className="text-panel-text">{kick.user}</strong> aus{' '}
                <span className="font-mono text-panel-text">{kick.ip}</span>
                {kick.tty ? <> ({kick.tty})</> : null} wird sofort getrennt, laufende Programme dieser Sitzung werden beendet.
              </p>
              {darfSperren && (
                <>
                  <label className="flex items-start gap-2 text-panel-muted cursor-pointer">
                    <input type="checkbox" className="mt-0.5" checked={sperren} onChange={e => { setSperren(e.target.checked); setRueckfrage(''); }} />
                    <span><strong className="text-panel-text">{kick.ip}</strong> zusätzlich dauerhaft sperren, damit sich die Gegenstelle nicht sofort neu verbindet</span>
                  </label>
                  {sperren && (
                    <input className="w-full bg-panel-surface border border-panel-border rounded-md px-3 py-2 text-sm text-panel-text focus:outline-none focus:border-panel-accent"
                           value={grund} maxLength={200} onChange={e => setGrund(e.target.value)} placeholder="Grund (optional)" />
                  )}
                </>
              )}
              {rueckfrage && (
                <div className="flex items-start gap-2 p-2.5 rounded bg-panel-red/10 border border-panel-red/40 text-panel-red">
                  <AlertTriangle size={14} className="shrink-0 mt-0.5" />
                  <span><strong>Achtung:</strong> {rueckfrage} Vermutlich ist das deine eigene Sitzung.</span>
                </div>
              )}
              {kickFehler && <p className="text-panel-red">{kickFehler}</p>}
            </div>
          )}
        </Modal>
      )}
    </Card>
  );
}
