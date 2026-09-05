import React, { useEffect, useRef, useState } from 'react';
import { Modal } from './ui/Modal';
import { Button } from './ui/Button';

export default function SystemUpdateModal({ agentId, onClose }) {
  const [logs, setLogs] = useState('');
  const [status, setStatus] = useState('idle'); // idle, running, done, error
  const logsEndRef = useRef(null);
  
  useEffect(() => {
    if (logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs]);

  const startUpdate = async () => {
    setStatus('running');
    setLogs('Verbinde zum Agenten für System-Update...\n');
    try {
      const response = await fetch(`/api/agents/${agentId}/packages/update`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        }
      });
      
      if (!response.ok) {
        const text = await response.text();
        let errorMsg = 'Serverfehler';
        try {
          const data = JSON.parse(text);
          errorMsg = data.error || errorMsg;
        } catch {
          errorMsg = `Serverfehler (HTTP ${response.status}): Die Antwort war kein JSON.`;
          console.error('Non-JSON Error Response:', text);
        }
        throw new Error(errorMsg);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        setLogs(prev => prev + chunk);
      }
      setStatus('done');
    } catch (err) {
      setLogs(prev => prev + `\n\n[FEHLER] ${err.message}\n`);
      setStatus('error');
    }
  };

  useEffect(() => {
    // Direkt beim Öffnen starten
    startUpdate();
  }, [agentId]);

  return (
    <Modal open={true} onClose={status === 'running' ? undefined : onClose} className="max-w-4xl w-full">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-xl font-bold text-panel-text flex items-center gap-2">
          📦 Paket-Update läuft
        </h2>
        {status !== 'running' && (
          <Button variant="ghost" onClick={onClose}>Schließen</Button>
        )}
      </div>

      <div className="bg-[#0c0c0c] text-[#00ff00] font-mono p-4 rounded-xl h-[60vh] overflow-y-auto whitespace-pre-wrap break-all text-sm border border-panel-border">
        {logs}
        {status === 'running' && <span className="animate-pulse">_</span>}
        <div ref={logsEndRef} />
      </div>
      
      <div className="mt-4 flex justify-end">
        <Button 
          variant={status === 'running' ? 'ghost' : (status === 'error' ? 'danger' : 'primary')} 
          onClick={onClose} 
          disabled={status === 'running'}
        >
          {status === 'running' ? 'Update läuft...' : 'Schließen'}
        </Button>
      </div>
    </Modal>
  );
}
