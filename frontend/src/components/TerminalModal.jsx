import { useEffect, useRef, useState } from 'react';
import { Modal } from './ui/Modal';
import { Terminal } from 'xterm';
import { FitAddon } from '@xterm/addon-fit';
import 'xterm/css/xterm.css';
import { useAuth } from '../context/AuthContext';

export function TerminalModal({ agentId, containerId, containerName, onClose }) {
  const terminalRef = useRef(null);
  const termInstance = useRef(null);
  const wsRef = useRef(null);
  const fitAddon = useRef(null);
  const { token } = useAuth();
  const [error, setError] = useState('');

  useEffect(() => {
    if (!terminalRef.current) return;

    termInstance.current = new Terminal({
      cursorBlink: true,
      theme: {
        background: '#0d0d0d',
        foreground: '#e5e5e5',
        cursor: '#4b9eff',
      },
      fontFamily: '"Fira Code", monospace',
      fontSize: 13,
    });
    fitAddon.current = new FitAddon();
    termInstance.current.loadAddon(fitAddon.current);
    termInstance.current.open(terminalRef.current);
    
    // Kleiner Delay für Addon-Fit, damit das Modal fully gerendert ist
    setTimeout(() => {
      if (fitAddon.current) fitAddon.current.fit();
    }, 50);

    const wsUrl = `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/api/agents/${agentId}/docker/containers/${containerId}/terminal?token=${token}`;
    
    wsRef.current = new WebSocket(wsUrl);

    wsRef.current.onopen = () => {
      termInstance.current.focus();
      // Initiale Größe senden
      if (termInstance.current.cols && termInstance.current.rows) {
        wsRef.current.send(JSON.stringify({ cols: termInstance.current.cols, rows: termInstance.current.rows }));
      }
    };

    wsRef.current.onmessage = (ev) => {
      termInstance.current.write(ev.data);
    };

    wsRef.current.onerror = () => {
      setError('Verbindung zum Terminal fehlgeschlagen.');
    };

    wsRef.current.onclose = () => {
      termInstance.current.write('\r\n\x1b[31m[Terminal geschlossen]\x1b[0m\r\n');
    };

    termInstance.current.onData((data) => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(data);
      }
    });

    const handleResize = () => {
      if (fitAddon.current) {
        fitAddon.current.fit();
        if (wsRef.current?.readyState === WebSocket.OPEN && termInstance.current) {
          wsRef.current.send(JSON.stringify({
            cols: termInstance.current.cols,
            rows: termInstance.current.rows
          }));
        }
      }
    };

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      if (wsRef.current) {
        wsRef.current.close();
      }
      if (termInstance.current) {
        termInstance.current.dispose();
      }
    };
  }, [agentId, containerId, token]);

  return (
    <Modal
      open={true}
      onClose={onClose}
      title={`Terminal: ${containerName || containerId.slice(0, 12)}`}
    >
      {error && <div className="text-panel-red text-xs mb-2">{error}</div>}
      <div 
        ref={terminalRef} 
        className="w-full h-[60vh] bg-[#0d0d0d] rounded overflow-hidden p-2"
      />
    </Modal>
  );
}
