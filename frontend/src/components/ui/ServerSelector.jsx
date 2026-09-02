import { useEffect, useState } from 'react';
import axios from 'axios';
import { Monitor, Server } from 'lucide-react';

/**
 * Server-Auswahl-Leiste: Alle Remote-Agents als Pills.
 * onChange(id)     → Remote-Agent mit dieser ID ausgewählt
 */
export function ServerSelector({ selected, onChange }) {
  const [agents, setAgents] = useState([]);

  useEffect(() => {
    axios.get('/api/agents').then(r => {
      setAgents(r.data);
      // Auto-Select: Da es keinen "Lokal"-Server mehr gibt, wählen wir direkt den ersten Agenten, falls keiner gewählt ist
      if (!selected && r.data.length > 0) {
        onChange(r.data[0].id);
      }
    }).catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Wenn nur ein Server existiert oder keiner, können wir die Serverauswahl auch ausblenden
  // (Optional: Wir rendern es dennoch, damit der Nutzer sieht, welcher Server aktiv ist)
  if (agents.length === 0) return null;

  const pill = (active) =>
    `flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap ${
      active
        ? 'bg-panel-accent text-white'
        : 'bg-panel-surface border border-panel-border text-panel-muted hover:text-panel-text hover:border-panel-accent/50'
    }`;

  return (
    <div className="flex flex-wrap gap-2 items-center">
      <span className="text-xs text-panel-muted flex-shrink-0">Server:</span>
      {agents.map(a => (
        <button key={a.id} className={pill(selected === a.id)} onClick={() => onChange(a.id)}>
          <Server size={12} />{a.name}
        </button>
      ))}
    </div>
  );
}
