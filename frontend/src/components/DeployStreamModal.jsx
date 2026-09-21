import { useState, useEffect, useRef } from 'react';
import { X, CheckCircle, AlertCircle, Loader2 } from 'lucide-react';
import { Button } from './ui/Button';

export function DeployStreamModal({ serverId, stackId, stackName, onClose }) {
  const [logs, setLogs] = useState('');
  const [status, setStatus] = useState('running'); // 'running', 'success', 'error'
  const logsEndRef = useRef(null);

  useEffect(() => {
    startDeploy();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs]);

  const startDeploy = async () => {
    try {
      const response = await fetch(`/api/agents/${serverId}/docker/stacks/${encodeURIComponent(stackId)}/deploy`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        }
      });
      
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        setLogs(prev => prev + `\n[System] Fehler beim Starten des Deployments: ${err.error || response.statusText}\n`);
        setStatus('error');
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        
        const chunk = decoder.decode(value, { stream: true });
        setLogs(prev => prev + chunk);
        
        if (chunk.includes('Deployment erfolgreich abgeschlossen')) setStatus('success');
        else if (chunk.includes('Deployment mit Fehlercode') || chunk.includes('Prozess-Fehler')) setStatus('error');
      }
      
      if (status === 'running') {
        setStatus(prev => prev === 'error' ? 'error' : 'success'); // fallback
      }

    } catch (err) {
      setLogs(prev => prev + `\n[System] Netzwerkfehler beim Deployment: ${err.message}\n`);
      setStatus('error');
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-panel-bg w-full max-w-4xl h-[70vh] flex flex-col rounded-xl shadow-2xl border border-panel-border overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-panel-border bg-panel-surface">
          <div className="flex items-center gap-3">
            {status === 'running' && <Loader2 size={18} className="text-panel-accent animate-spin" />}
            {status === 'success' && <CheckCircle size={18} className="text-panel-green" />}
            {status === 'error' && <AlertCircle size={18} className="text-panel-red" />}
            <div>
              <h3 className="text-sm font-semibold text-panel-text flex items-center gap-2">
                Live-Deploy: {stackName || stackId}
              </h3>
              <span className="text-[11px] text-panel-muted">
                {status === 'running' ? 'Deployment läuft...' : status === 'success' ? 'Deployment abgeschlossen' : 'Deployment fehlgeschlagen'}
              </span>
            </div>
          </div>
          <button onClick={onClose} disabled={status === 'running'} className="p-1 text-panel-muted hover:text-panel-text transition-colors rounded-lg hover:bg-panel-card disabled:opacity-50">
            <X size={18} />
          </button>
        </div>

        {/* Logs Stream */}
        <div className="flex-1 min-h-0 bg-[#0d0d0d] p-4 overflow-auto font-mono text-[13px] text-gray-300 whitespace-pre-wrap leading-relaxed">
          {logs}
          <div ref={logsEndRef} />
        </div>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-panel-border bg-panel-surface flex justify-end">
          <Button variant="outline" onClick={onClose} disabled={status === 'running'}>
            Schließen
          </Button>
        </div>
      </div>
    </div>
  );
}
