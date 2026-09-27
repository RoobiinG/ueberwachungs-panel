import { useEffect, useState } from 'react';
import axios from 'axios';
import { Ban, AlertTriangle, CheckCircle2, XCircle } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';

/**
 * Dialog „IP dauerhaft sperren". Wird nur gerendert, wenn der Aufrufer das Recht
 * `fail2ban.ban` hat — ohne Recht existiert er nicht im DOM. Das Backend prüft das
 * Recht unabhängig davon noch einmal.
 *
 * vorschlag: { cidr, grund, quelle } — z. B. aus einer fail2ban-Zeile vorbelegt.
 * Antwortet der Server mit 409 + bestaetigungNoetig (eigene Adresse, laufende SSH-Sitzung
 * von dort), folgt eine zweite, deutlich markierte Rückfrage.
 */
export default function SperrenDialog({ open, onClose, agentId, vorschlag, onErfolg }) {
  const [cidr, setCidr]             = useState('');
  const [grund, setGrund]           = useState('');
  const [alleServer, setAlleServer] = useState(false);
  const [laeuft, setLaeuft]         = useState(false);
  const [fehler, setFehler]         = useState('');
  const [rueckfrage, setRueckfrage] = useState('');
  const [ergebnisse, setErgebnisse] = useState(null);

  useEffect(() => {
    if (!open) return;
    setCidr(vorschlag?.cidr || '');
    setGrund(vorschlag?.grund || '');
    setAlleServer(false);
    setFehler(''); setRueckfrage(''); setErgebnisse(null);
  }, [open, vorschlag]);

  const senden = async (trotzdem = false) => {
    setLaeuft(true); setFehler('');
    try {
      const { data } = await axios.post(`/api/agents/${agentId}/blocklist`, {
        cidr: cidr.trim(), grund: grund.trim() || undefined, quelle: vorschlag?.quelle, alleServer, trotzdem,
      });
      if (alleServer) {
        setErgebnisse(data.ergebnisse || []);
        setRueckfrage(data.ergebnisse?.some(r => r.bestaetigungNoetig) && !trotzdem
          ? 'Auf mindestens einem Server besteht gerade eine SSH-Sitzung von dieser Adresse.' : '');
        onErfolg?.();
      } else {
        onErfolg?.();
        onClose();
      }
    } catch (e) {
      const d = e.response?.data || {};
      if (e.response?.status === 409 && d.bestaetigungNoetig && !trotzdem) setRueckfrage(d.error);
      else setFehler(d.error || e.message);
    }
    setLaeuft(false);
  };

  const inputCls = 'w-full bg-panel-surface border border-panel-border rounded-md px-3 py-2 text-sm text-panel-text focus:outline-none focus:border-panel-accent';

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={<span className="flex items-center gap-2"><Ban size={14} className="text-panel-red" /> IP dauerhaft sperren</span>}
      footer={ergebnisse ? (
        <Button variant="ghost" onClick={onClose}>Schließen</Button>
      ) : (
        <>
          <Button variant="ghost" onClick={onClose} disabled={laeuft}>Abbrechen</Button>
          {rueckfrage
            ? <Button variant="danger" onClick={() => senden(true)} disabled={laeuft}>Trotzdem sperren</Button>
            : <Button variant="danger" onClick={() => senden(false)} disabled={laeuft || !cidr.trim()}>Dauerhaft sperren</Button>}
        </>
      )}
    >
      <div className="space-y-3 text-xs">
        <p className="text-panel-muted">
          Die Adresse wird per nftables verworfen — für alle Ports, auch für Docker-Container, und über
          Neustarts hinweg. Die Sperre gilt, bis sie hier wieder aufgehoben wird.
        </p>
        <div>
          <label className="block text-panel-muted mb-1">IP-Adresse oder Netz (CIDR)</label>
          <input className={`${inputCls} font-mono`} value={cidr} onChange={e => { setCidr(e.target.value); setRueckfrage(''); }}
                 placeholder="z. B. 203.0.113.7 oder 198.51.100.0/24" disabled={!!ergebnisse} autoFocus={!vorschlag?.cidr} />
          <p className="text-[11px] text-panel-muted mt-1">Netze ab /16 (IPv4) bzw. /32 (IPv6). Private und eigene Adressen sind ausgenommen.</p>
        </div>
        <div>
          <label className="block text-panel-muted mb-1">Grund (optional)</label>
          <input className={inputCls} value={grund} maxLength={200} onChange={e => setGrund(e.target.value)}
                 placeholder="z. B. wiederholte SSH-Angriffe" disabled={!!ergebnisse} />
        </div>
        <label className="flex items-start gap-2 text-panel-muted cursor-pointer">
          <input type="checkbox" className="mt-0.5" checked={alleServer} onChange={e => setAlleServer(e.target.checked)} disabled={!!ergebnisse} />
          <span>Auf <strong className="text-panel-text">allen Servern</strong> sperren, auf die ich Zugriff habe</span>
        </label>

        {rueckfrage && (
          <div className="flex items-start gap-2 p-2.5 rounded bg-panel-red/10 border border-panel-red/40 text-panel-red">
            <AlertTriangle size={14} className="shrink-0 mt-0.5" />
            <span><strong>Achtung:</strong> {rueckfrage} Wirklich sperren?</span>
          </div>
        )}
        {fehler && <p className="text-panel-red">{fehler}</p>}

        {ergebnisse && (
          <ul className="space-y-1">
            {ergebnisse.map(r => (
              <li key={r.agentId} className="flex items-start gap-2">
                {r.ok ? <CheckCircle2 size={13} className="text-panel-green shrink-0 mt-0.5" /> : <XCircle size={13} className="text-panel-red shrink-0 mt-0.5" />}
                <span><strong className="text-panel-text">{r.name}</strong>: {r.ok ? (r.bereits ? 'war bereits gesperrt' : 'gesperrt') : r.error}</span>
              </li>
            ))}
          </ul>
        )}
        {ergebnisse && rueckfrage && (
          <Button size="sm" variant="danger" onClick={() => senden(true)} disabled={laeuft}>Auf allen Servern trotzdem sperren</Button>
        )}
      </div>
    </Modal>
  );
}
