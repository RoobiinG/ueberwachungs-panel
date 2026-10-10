import { ChevronDown, ChevronRight, Trash2, Lock } from 'lucide-react';
import { Button } from '../ui/Button';

// Herkunft der schreibgeschützten Regeln, in der Reihenfolge der Anzeige. Agents ab 2.20.3
// liefern `quelle` selbst; ältere kennzeichnen die Regel nur über die ID (nft:<Familie>:<Tabelle>:…).
const QUELLEN = [
  { key: 'iptables', titel: 'Plesk / iptables (Tabelle „ip filter“)',
    hinweis: 'Von der Plesk-Firewall oder iptables angelegt. Löschen ist möglich — Plesk legt die Regeln beim nächsten Neuladen der Firewall aber wieder an.' },
  { key: 'panel', titel: 'Panel-Schutz (Security Center)',
    hinweis: 'Dauerhafte Sperren, Whitelist und Threat-Feed. Verwaltung unter Security Center → Dauerhaft gesperrte IPs.' },
  { key: 'sonstige', titel: 'Weitere nftables-Tabellen',
    hinweis: 'Das Panel verwaltet nur „inet filter input“ — diese Regeln sind nur zur Ansicht da.' },
];

const quelleVon = (r) => {
  if (r.quelle) return r.quelle;
  const id = String(r.id ?? '');
  if (id.includes(':panel_guard:')) return 'panel';
  if (id.startsWith('nft:ip:filter:INPUT:')) return 'iptables';
  return 'sonstige';
};

const istErlaubt = (r) => r.action === 'allow' || r.action?.toUpperCase?.().includes('ALLOW');

/**
 * Schreibgeschützte Regeln (Plesk-Firewall, Panel-Schutz, fremde nft-Tabellen) in einem
 * eigenen, einklappbaren Bereich unter den Panel-Regeln — nach Herkunft gruppiert.
 * Standardmäßig zu: Auf einem Plesk-Server sind das schnell 40 Zeilen, die niemand bearbeiten kann.
 * Löschen gibt es nur für Regeln mit `loeschbar` (Plesk/iptables) und mit `firewall.manage`.
 */
export default function SystemRegelnBereich({ regeln, gesamt, offen, onToggle, darfSchreiben, onLoeschen }) {
  if (!gesamt) return null;

  return (
    <div className="bg-panel-card border border-panel-border rounded-lg overflow-hidden">
      <button type="button" onClick={onToggle}
        className="w-full flex items-center gap-2 px-4 py-3 text-left hover:bg-panel-surface/50 transition-colors">
        {offen ? <ChevronDown size={14} className="text-panel-muted" /> : <ChevronRight size={14} className="text-panel-muted" />}
        <Lock size={12} className="text-panel-muted" />
        <span className="text-sm font-semibold text-panel-text">Systemregeln</span>
        <span className="text-[11px] px-2 py-0.5 rounded-full bg-panel-surface border border-panel-border text-panel-muted">
          {gesamt}
        </span>
        <span className="text-[11px] text-panel-muted ml-1 hidden sm:inline">
          nicht vom Panel angelegt — {offen ? 'zuklappen' : 'aufklappen'}
        </span>
      </button>

      {offen && (
        <div className="border-t border-panel-border">
          {regeln.length === 0 && (
            <div className="text-panel-muted text-xs px-4 py-4">Keine Systemregeln für die aktuelle Suche.</div>
          )}
          {QUELLEN.map(q => {
            const liste = regeln.filter(r => quelleVon(r) === q.key);
            if (liste.length === 0) return null;
            return (
              <div key={q.key} className="border-b border-panel-border/50 last:border-0">
                <div className="px-4 py-2 bg-panel-surface/40">
                  <div className="text-xs font-semibold text-panel-text">
                    {q.titel} <span className="text-panel-muted font-normal">· {liste.length}</span>
                  </div>
                  <div className="text-[11px] text-panel-muted">{q.hinweis}</div>
                </div>
                <ul>
                  {liste.map((r, i) => {
                    const port = (r.port && r.port !== 'any') ? r.port : null;
                    const from = (r.from && r.from !== 'any') ? r.from : null;
                    const proto = (r.proto && r.proto !== 'any') ? r.proto.toUpperCase() : null;
                    return (
                      <li key={`${q.key}-${i}`}
                        className="flex items-center gap-3 px-4 py-2 border-t border-panel-border/30 text-xs hover:bg-panel-surface/40">
                        <span className="font-mono w-28 truncate text-panel-text">
                          {port ?? <span className="italic text-panel-muted font-sans">alle Ports</span>}
                        </span>
                        <span className="font-mono text-[11px] w-12 text-panel-muted">{proto ?? '—'}</span>
                        <span className={`font-semibold w-20 ${istErlaubt(r) ? 'text-panel-green' : 'text-panel-red'}`}>
                          {istErlaubt(r) ? '✓ Erlaubt' : '✗ Gesperrt'}
                        </span>
                        <span className="font-mono flex-1 min-w-0 truncate text-panel-text">
                          {from ?? <span className="text-panel-muted/60 font-sans">alle</span>}
                        </span>
                        {darfSchreiben && r.loeschbar && (
                          <Button size="sm" variant="ghost" onClick={() => onLoeschen(r)}
                            className="text-panel-red hover:border-panel-red/40">
                            <Trash2 size={11} />Löschen
                          </Button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
