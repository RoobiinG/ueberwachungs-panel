import { useState } from 'react';
import { useWS, useWSMessage } from '../context/WSContext';

/**
 * Thin Consumer: abonniert 'stats'-Nachrichten aus dem gemeinsamen WS-Context.
 */
export const useWebSocket = () => {
  const { connected } = useWS();
  const [data, setData] = useState(null);
  useWSMessage('stats', (msg) => setData(msg.payload));
  return { data, connected };
};
