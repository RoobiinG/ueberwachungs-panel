import { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';

const WSContext = createContext(null);

/**
 * Stellt eine einzige authentifizierte WebSocket-Verbindung bereit.
 * Alle Komponenten nutzen dieselbe Verbindung.
 */
export function WSProvider({ token, children }) {
  const wsRef        = useRef(null);
  const [connected, setConnected] = useState(false);
  // Map<type, Set<handler>>
  const handlersRef  = useRef(new Map());

  useEffect(() => {
    if (!token) { setConnected(false); return; }

    let active = true;   // false sobald cleanup läuft → kein Reconnect mehr
    let timer  = null;

    const connect = () => {
      if (!active) return;
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws    = new WebSocket(`${proto}//${window.location.host}/ws`);
      wsRef.current = ws;

      ws.onopen    = () => ws.send(JSON.stringify({ type: 'auth', token }));
      ws.onerror   = () => {};    // onclose feuert danach, dort reagieren
      ws.onclose   = () => {
        wsRef.current = null;
        setConnected(false);
        // Auto-Reconnect nach 3 s (solange noch aktiv)
        if (active) timer = setTimeout(connect, 3000);
      };
      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data);
          if (msg.type === 'connected') setConnected(true);
          const handlers = handlersRef.current.get(msg.type);
          if (handlers) handlers.forEach(h => h(msg));
        } catch {}
      };
    };

    connect();

    return () => {
      active = false;
      clearTimeout(timer);
      wsRef.current?.close();
      wsRef.current = null;
      setConnected(false);
    };
  }, [token]);

  const sendMessage = useCallback((obj) => {
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
  }, []);

  const subscribe = useCallback((type, fn) => {
    const map = handlersRef.current;
    if (!map.has(type)) map.set(type, new Set());
    map.get(type).add(fn);
    return () => map.get(type)?.delete(fn);
  }, []);

  return (
    <WSContext.Provider value={{ connected, sendMessage, subscribe }}>
      {children}
    </WSContext.Provider>
  );
}

export const useWS = () => useContext(WSContext);

/**
 * Abonniert Nachrichten eines bestimmten Typs.
 * Handler kann sich jederzeit ändern ohne Re-Subscribe.
 */
export function useWSMessage(type, handler) {
  const ctx = useContext(WSContext);
  const ref = useRef(handler);
  useEffect(() => { ref.current = handler; });
  useEffect(() => {
    if (!ctx?.subscribe) return;
    return ctx.subscribe(type, (msg) => ref.current(msg));
  }, [type, ctx?.subscribe]); // eslint-disable-line react-hooks/exhaustive-deps
}
