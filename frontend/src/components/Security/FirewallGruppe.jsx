import { Pencil, Trash2, Tag, AlertTriangle, UserPlus } from 'lucide-react';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import { istErlaubt } from '../../utils/firewallGruppen';

const RICHTUNG = { in: 'eingehend', out: 'ausgehend', fwd: 'Weiterleitung' };

/**
 * Eine logische Regeleinheit im Firewall-Tab: alle Regeln zu Richtung + Protokoll + Port,
 * mit Beschriftung der Gruppe, Zusammenfassung („Nur für 1 Adresse erlaubt") und
 * Warnungen zur Reihenfolge. Schreib-Knöpfe gibt es nur mit `firewall.manage`
 * (darfSchreiben) — sonst sind sie nicht im DOM.
 */
export default function FirewallGruppe({ gruppe, darfSchreiben, onBearbeiten, onLoeschen, onBeschriften, onFreigeben }) {
  const warnungFuer = (r) => gruppe.warnungen.find(w => w.regel === r.fingerprint);
  const portText = gruppe.port === 'any' ? 'Alle Ports' : `Port ${gruppe.port}`;

  return (
    <div className="border border-panel-border rounded-lg overflow-hidden">
      {/* Kopf: Port, Beschriftung, Zusammenfassung */}
      <div className="flex flex-wrap items-center gap-2 px-3 py-2 bg-panel-surface/50 border-b border-panel-border">
        <span className="font-mono text-sm font-semibold text-panel-text">{portText}</span>
        {gruppe.proto !== 'any' && <span className="text-[10px] uppercase font-mono text-panel-muted">{gruppe.proto}</span>}
        {gruppe.richtung !== 'in' && (
          <span className="text-[9px] px-1 py-0.5 rounded bg-panel-accent/10 border border-panel-accent/30 text-panel-accent">
            {gruppe.richtung === 'fwd' ? 'FWD' : RICHTUNG[gruppe.richtung]}
          </span>
        )}
        {gruppe.portLabel
          ? <span className="text-sm text-panel-accent font-medium truncate max-w-[18rem]" title={gruppe.portLabel}>{gruppe.portLabel}</span>
          : <span className="text-xs text-panel-muted italic">ohne Beschriftung</span>}
        {darfSchreiben && (
          <button onClick={() => onBeschriften('port', gruppe.key, gruppe.portLabel)} title="Gruppe beschriften (z. B. „Ollama API“)"
                  className="text-panel-muted hover:text-panel-accent transition-colors">
            <Pencil size={12} />
          </button>
        )}
        <span className="ml-auto flex items-center gap-2">
          <Badge color={gruppe.farbe}>{gruppe.text}</Badge>
          {darfSchreiben && gruppe.freigabeVorSperre && (
            <Button size="sm" variant="ghost" onClick={() => onFreigeben(gruppe)} title="Eine weitere Adresse für diesen Port freigeben — die Regel wird vor die Sperre gesetzt">
              <UserPlus size={11} /> Adresse freigeben
            </Button>
          )}
        </span>
      </div>

      {/* Regeln der Gruppe in Auswertungsreihenfolge */}
      <ul>
        {gruppe.regeln.map(r => {
          const erlaubt = istErlaubt(r);
          const warnung = warnungFuer(r);
          const quelle = r.from && r.from !== 'any' ? r.from : null;
          return (
            <li key={r.ids?.join('+') ?? r.id} className="px-3 py-2 border-b border-panel-border/30 last:border-0 text-xs">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="text-[11px] text-panel-muted font-mono tabular-nums w-10">#{r.ids?.join('+') ?? r.id}</span>
                <span className={`font-semibold w-20 ${erlaubt ? 'text-panel-green' : 'text-panel-red'}`}>{erlaubt ? '✓ Erlaubt' : '✗ Gesperrt'}</span>
                <span className="font-mono">
                  {quelle ? <><span className="text-panel-muted">von </span><span className="text-panel-text">{quelle}</span></> : <span className="text-panel-muted">für alle</span>}
                </span>
                {r.families?.size > 1 && <span className="text-[9px] px-1 py-0.5 rounded bg-panel-surface border border-panel-border text-panel-muted">IPv4+IPv6</span>}
                {r.label ? (
                  <span className="inline-flex items-center gap-1 text-panel-text" title={r.notiz || (r.labelQuelle === 'firewall' ? 'Kommentar aus der Firewall' : '')}>
                    <Tag size={10} className="text-panel-muted" />{r.label}
                    {r.labelQuelle === 'firewall' && <span className="text-[9px] text-panel-muted">(Kommentar)</span>}
                  </span>
                ) : null}
                {darfSchreiben && (
                  <span className="ml-auto flex items-center gap-1">
                    <Button size="sm" variant="ghost" onClick={() => onBeschriften('rule', r.fingerprint, r.labelQuelle === 'panel' ? r.label : '', r.notiz)} title="Regel beschriften">
                      <Tag size={11} />
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => onBearbeiten(r)}><Pencil size={11} />Bearbeiten</Button>
                    <Button size="sm" variant="ghost" onClick={() => onLoeschen(r)} className="text-panel-red hover:border-panel-red/40"><Trash2 size={11} />Löschen</Button>
                  </span>
                )}
              </div>
              {warnung && (
                <p className="mt-1 ml-10 text-[11px] text-panel-orange flex items-start gap-1.5">
                  <AlertTriangle size={11} className="shrink-0 mt-0.5" />
                  <span>{warnung.text}{darfSchreiben && gruppe.freigabeVorSperre && erlaubt ? ' Zum Beheben löschen und über „Adresse freigeben" neu anlegen.' : ''}</span>
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
