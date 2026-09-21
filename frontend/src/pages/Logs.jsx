import { useEffect, useState } from 'react';
import axios from 'axios';
import { Terminal, Search, AlertCircle, Info, AlertTriangle, RefreshCw, Server, Filter } from 'lucide-react';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';

export default function Logs() {
  const [logs, setLogs] = useState([]);
  const [total, setTotal] = useState(0);
  const [agents, setAgents] = useState([]);
  const [loading, setLoading] = useState(true);

  const [filterAgent, setFilterAgent] = useState('');
  const [filterLevel, setFilterLevel] = useState('');
  const [filterSearch, setFilterSearch] = useState('');
  const [page, setPage] = useState(1);
  const limit = 100;

  useEffect(() => {
    fetchAgents();
  }, []);

  useEffect(() => {
    fetchLogs();
    // eslint-disable-next-line
  }, [filterAgent, filterLevel, page]);

  const fetchAgents = async () => {
    try {
      const res = await axios.get('/api/agents');
      setAgents(res.data);
    } catch (err) {
      console.error('Fehler beim Laden der Server', err);
    }
  };

  const fetchLogs = async () => {
    setLoading(true);
    try {
      const params = {
        limit,
        offset: (page - 1) * limit
      };
      if (filterAgent) params.agent_id = filterAgent;
      if (filterLevel) params.level = filterLevel;
      if (filterSearch) params.search = filterSearch;

      const res = await axios.get('/api/logs', { params });
      setLogs(res.data.logs || []);
      setTotal(res.data.total || 0);
    } catch (err) {
      console.error('Fehler beim Laden der Logs', err);
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = (e) => {
    e.preventDefault();
    setPage(1);
    fetchLogs();
  };

  const getLevelColor = (level) => {
    if (level === 'error') return 'text-panel-red bg-panel-red/10 border-panel-red/20';
    if (level === 'warn') return 'text-panel-yellow bg-panel-yellow/10 border-panel-yellow/20';
    return 'text-panel-muted bg-panel-surface border-panel-border';
  };

  const getLevelIcon = (level) => {
    if (level === 'error') return <AlertCircle size={14} className="mr-1" />;
    if (level === 'warn') return <AlertTriangle size={14} className="mr-1" />;
    return <Info size={14} className="mr-1" />;
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-panel-text flex items-center gap-2">
            <Terminal className="text-panel-accent" /> Zentrale Logs
          </h1>
          <p className="text-sm text-panel-muted mt-1">
            Serverübergreifendes Systemprotokoll (Journald / Syslog). Letzte 7 Tage.
          </p>
        </div>
        <Button onClick={() => fetchLogs()} variant="outline" className="flex items-center gap-2">
          <RefreshCw size={16} className={loading ? "animate-spin" : ""} /> Aktualisieren
        </Button>
      </div>

      <Card className="p-4 bg-panel-bg/40">
        <form onSubmit={handleSearch} className="flex flex-wrap gap-4 items-end">
          <div className="flex-1 min-w-[200px]">
            <label className="block text-xs text-panel-muted mb-1">Server</label>
            <div className="relative">
              <Server size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-panel-muted" />
              <select
                value={filterAgent}
                onChange={(e) => { setFilterAgent(e.target.value); setPage(1); }}
                className="w-full bg-panel-surface border border-panel-border rounded-lg pl-9 pr-3 py-2 text-sm text-panel-text focus:outline-none focus:border-panel-accent"
              >
                <option value="">Alle Server</option>
                {agents.map(a => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="w-40">
            <label className="block text-xs text-panel-muted mb-1">Loglevel</label>
            <div className="relative">
              <Filter size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-panel-muted" />
              <select
                value={filterLevel}
                onChange={(e) => { setFilterLevel(e.target.value); setPage(1); }}
                className="w-full bg-panel-surface border border-panel-border rounded-lg pl-9 pr-3 py-2 text-sm text-panel-text focus:outline-none focus:border-panel-accent"
              >
                <option value="">Alle Level</option>
                <option value="error">Error</option>
                <option value="warn">Warnung</option>
                <option value="info">Info</option>
              </select>
            </div>
          </div>

          <div className="flex-1 min-w-[200px]">
            <label className="block text-xs text-panel-muted mb-1">Volltextsuche</label>
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-panel-muted" />
              <input
                type="text"
                placeholder="Nach Fehlermeldungen suchen..."
                value={filterSearch}
                onChange={(e) => setFilterSearch(e.target.value)}
                className="w-full bg-panel-surface border border-panel-border rounded-lg pl-9 pr-3 py-2 text-sm text-panel-text focus:outline-none focus:border-panel-accent"
              />
            </div>
          </div>
          
          <Button type="submit">Suchen</Button>
        </form>
      </Card>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm whitespace-nowrap">
            <thead className="bg-panel-surface text-panel-muted text-xs uppercase font-semibold">
              <tr>
                <th className="px-4 py-3">Zeitstempel</th>
                <th className="px-4 py-3">Server</th>
                <th className="px-4 py-3">Level</th>
                <th className="px-4 py-3">Quelle</th>
                <th className="px-4 py-3 w-full">Nachricht</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-panel-border font-mono text-[13px]">
              {loading && logs.length === 0 ? (
                <tr>
                  <td colSpan="5" className="px-4 py-8 text-center text-panel-muted">Lade Logs...</td>
                </tr>
              ) : logs.length === 0 ? (
                <tr>
                  <td colSpan="5" className="px-4 py-8 text-center text-panel-muted">Keine Logs für diese Filter gefunden.</td>
                </tr>
              ) : (
                logs.map((log) => (
                  <tr key={log.id} className="hover:bg-panel-surface/50 transition-colors">
                    <td className="px-4 py-2.5 text-panel-muted">
                      {new Date(String(log.timestamp).replace(' ', 'T') + 'Z').toLocaleString('de-DE')}
                    </td>
                    <td className="px-4 py-2.5 text-panel-text">
                      {log.agent_name || `ID ${log.agent_id}`}
                    </td>
                    <td className="px-4 py-2.5">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded border text-[11px] font-sans ${getLevelColor(log.level)}`}>
                        {getLevelIcon(log.level)}
                        {log.level.toUpperCase()}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-panel-muted">{log.source}</td>
                    <td className="px-4 py-2.5 text-panel-text truncate max-w-lg" title={log.message}>
                      {log.message}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        
        {total > limit && (
          <div className="p-4 bg-panel-surface/30 border-t border-panel-border flex justify-between items-center text-sm">
            <span className="text-panel-muted">
              Zeige {((page - 1) * limit) + 1} bis {Math.min(page * limit, total)} von {total} Einträgen
            </span>
            <div className="flex gap-2">
              <Button variant="ghost" disabled={page === 1} onClick={() => { setPage(p => p - 1); window.scrollTo(0, 0); }}>Zurück</Button>
              <Button variant="ghost" disabled={page * limit >= total} onClick={() => { setPage(p => p + 1); window.scrollTo(0, 0); }}>Weiter</Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
