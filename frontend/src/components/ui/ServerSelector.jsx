import { useEffect, useState } from 'react';
import axios from 'axios';
import { Monitor, Server } from 'lucide-react';

/**
 * Server-Auswahl-Leiste: "Lokal" + alle Remote-Agents als Pills.
 * onChange(null)   → Lokal ausgewählt
 * onChange(id)     → Remote-Agent mit dieser ID ausgewählt
 */
export function ServerSelector({ selected, onChange }) {
  const [agents, setAgents] = useState([]);

  useEffect(() => {
    axios.get('/api/agents').then(r => setAgents(r.data)).catch(() => {});
  }, []);

  // Wenn keine Agents vorhanden: nichts rendern (alles läuft lokal)
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
      <button className={pill(!selected)} onClick={() => onChange(null)}>
        <Monitor size={12} />Lokal
      </button>
      {agents.map(a => (
        <button key={a.id} className={pill(selected === a.id)} onClick={() => onChange(a.id)}>
          <Server size={12} />{a.name}
        </button>
      ))}
    </div>
  );
}
