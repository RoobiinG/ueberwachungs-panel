import { Lock } from 'lucide-react';

/**
 * Kennzeichnet eine Firewall-Regel, die das Panel nicht verwaltet (z. B. die Dauersperren aus
 * der nftables-Tabelle panel_guard). Sie wird angezeigt, lässt sich hier aber weder bearbeiten
 * noch löschen. `grund` kommt mit der Regel vom Backend und steht als Tooltip daran.
 */
export default function SystemRegelBadge({ grund }) {
  return (
    <span title={grund || 'Vom System verwaltet — hier nicht änderbar.'}
      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium border bg-panel-muted/20 text-panel-muted border-panel-muted/30 cursor-help flex-shrink-0 font-sans">
      <Lock size={9} />System
    </span>
  );
}
