import { useEffect, useState } from 'react';
import axios from 'axios';
import { Monitor, Server } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';

/**
 * Server-Auswahl-Leiste: "Lokal" + alle Remote-Agents als Pills.
 * onChange(null)   → Lokal ausgewählt
 * onChange(id)     → Remote-Agent mit dieser ID ausgewählt
 *
 * Wenn die Rolle hideLocal=true hat, wird "Lokal" nicht angezeigt
 * und der erste verfügbare Agent wird automatisch gewählt.
 */
export function ServerSelector({ selected, onChange }) {
  const [agents, setAgents] = useState([]);
  const { hideLocal } = useAuth();

  useEffect(() => {
    axios.get('/api/agents').then(r => {
      setAgents(r.data);
      // Auto-Select: wenn Lokal ausgeblendet und noch kein Remote-Server gewählt
      if (hideLocal && !selected && r.data.length > 0) {
        onChange(r.data[0].id);
      }
    }).catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Wenn kein Agent vorhanden → nichts rendern (nur ein Element wäre sinnlos)
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
