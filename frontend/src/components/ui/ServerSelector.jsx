import { useEffect, useState } from 'react';
import axios from 'axios';
import { Monitor, Server } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';

/**
 * Server-Auswahl-Leiste: "Lokal" + alle Remote-Agents als Pills.
 * onChange(null)   → Lokal ausgewählt
 * onChange(id)     → Remote-Agent mit dieser ID ausgewählt
 *
 * Wenn die Rolle hideLocal=true hat, wird "Lokal" nicht angezeigt.
 * Wenn keine sichtbaren Optionen übrig bleiben, wird nichts gerendert.
 */
export function ServerSelector({ selected, onChange }) {
  const [agents, setAgents] = useState([]);
  const { hideLocal } = useAuth();

  useEffect(() => {
    axios.get('/api/agents').then(r => setAgents(r.data)).catch(() => {});
  }, []);

  // Wenn hideLocal und kein Agent vorhanden → nichts rendern
  // Wenn kein Agent vorhanden und lokal sichtbar → auch nichts rendern (nur eine Option)
  if (agents.length === 0) return null;

  // Wenn lokal ausgeblendet und es gibt Agents: beim ersten Render automatisch ersten Agent wählen
  // (wird via useEffect im aufrufenden Component behandelt — wir zeigen nur nichts für "Lokal")

  const pill = (active) =>
    `flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap ${
      active
        ? 'bg-panel-accent text-white'
        : 'bg-panel-surface border border-panel-border text-panel-muted hover:text-panel-text hover:border-panel-accent/50'
    }`;

  return (
    <div className="flex flex-wrap gap-2 items-center">
      <span className="text-xs text-panel-muted flex-shrink-0">Server:</span>
      {!hideLocal && (
        <button className={pill(!selected)} onClick={() => onChange(null)}>
          <Monitor size={12} />Lokal
        </button>
      )}
      {agents.map(a => (
        <button key={a.id} className={pill(selected === a.id)} onClick={() => onChange(a.id)}>
          <Server size={12} />{a.name}
        </button>
      ))}
    </div>
  );
}
