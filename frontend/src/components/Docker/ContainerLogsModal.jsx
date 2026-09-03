import React, { useState, useEffect, useRef } from 'react';
import { X, RefreshCw, TerminalSquare, AlertCircle } from 'lucide-react';

export default function ContainerLogsModal({ agentId, containerId, containerName, onClose }) {
  const [logs, setLogs] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [tail, setTail] = useState(500);
  const logsEndRef = useRef(null);

  const fetchLogs = async () => {
    setLoading(true);
    setError(null);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`/api/agents/${agentId}/docker/containers/${containerId}/logs?tail=${tail}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Fehler beim Laden der Logs');
      }
      const data = await res.json();
      setLogs(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLogs();
  }, [agentId, containerId, tail]);

  useEffect(() => {
    // Scroll to bottom when logs update
    if (logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
      <div className="bg-panel-900 border border-panel-800 rounded-xl shadow-2xl w-full max-w-5xl h-[85vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-panel-800 bg-panel-950/50">
          <div className="flex items-center space-x-3">
            <div className="p-2 rounded-lg bg-blue-500/10 text-blue-400">
              <TerminalSquare size={20} />
            </div>
            <div>
              <h3 className="font-semibold text-gray-100">Logs: {containerName || containerId.slice(0, 12)}</h3>
              <p className="text-xs text-gray-400 font-mono">{containerId}</p>
            </div>
          </div>
          
          <div className="flex items-center space-x-3">
            <select
              value={tail}
              onChange={(e) => setTail(Number(e.target.value))}
              className="bg-panel-800 border border-panel-700 text-sm text-gray-200 rounded-lg px-3 py-1.5 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all"
            >
              <option value={100}>Letzte 100 Zeilen</option>
              <option value={500}>Letzte 500 Zeilen</option>
              <option value={1000}>Letzte 1000 Zeilen</option>
              <option value={5000}>Letzte 5000 Zeilen</option>
            </select>
            
            <button
              onClick={fetchLogs}
              disabled={loading}
              className="p-2 text-gray-400 hover:text-white hover:bg-panel-800 rounded-lg transition-colors disabled:opacity-50"
              title="Neu laden"
            >
              <RefreshCw size={18} className={loading ? "animate-spin" : ""} />
            </button>
            <div className="h-6 w-px bg-panel-800"></div>
            <button
              onClick={onClose}
              className="p-2 text-gray-400 hover:text-white hover:bg-panel-800 rounded-lg transition-colors"
            >
              <X size={20} />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-hidden relative bg-[#0d1117]">
          {loading && !logs && (
            <div className="absolute inset-0 flex items-center justify-center bg-[#0d1117]/80 z-10">
              <RefreshCw className="w-8 h-8 text-blue-500 animate-spin" />
            </div>
          )}
          
          {error && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#0d1117] z-10 p-6 text-center">
              <AlertCircle className="w-12 h-12 text-red-500 mb-4" />
              <h4 className="text-lg font-medium text-gray-200 mb-2">Logs konnten nicht geladen werden</h4>
              <p className="text-gray-400">{error}</p>
            </div>
          )}
          
          <div className="h-full w-full overflow-auto p-4 font-mono text-[13px] leading-relaxed text-gray-300">
            {logs ? (
              <pre className="whitespace-pre-wrap break-all">
                {logs}
                <div ref={logsEndRef} />
              </pre>
            ) : !loading && !error ? (
              <div className="flex items-center justify-center h-full text-gray-500 italic">
                Keine Logs verfügbar
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
