import { useEffect, useRef, useState } from 'react';

export const useWebSocket = (token) => {
  const [data, setData] = useState(null);
  const [connected, setConnected] = useState(false);
  const wsRef = useRef(null);

  useEffect(() => {
    if (!token) return;
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    // Token NICHT im URL-Parameter übergeben (wird in Server-Logs gespeichert)
    // Stattdessen als erste Nachricht nach dem Verbindungsaufbau senden
    const ws = new WebSocket(`${proto}//${window.location.host}/ws`);
    wsRef.current = ws;
    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'auth', token }));
    };
    ws.onclose = () => setConnected(false);
    ws.onerror = () => setConnected(false);
    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === 'connected') setConnected(true);
        if (msg.type === 'stats') setData(msg.payload);
      } catch {}
    };
    return () => ws.close();
  }, [token]);

  return { data, connected };
};
