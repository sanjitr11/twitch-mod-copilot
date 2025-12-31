'use client';

import { useEffect, useRef, useState } from 'react';
import { WebSocketMessage } from '../types';

export function useWebSocket(url: string) {
  const [isConnected, setIsConnected] = useState(false);
  const [lastMessage, setLastMessage] = useState<WebSocketMessage | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout>();

  useEffect(() => {
    const connect = () => {
      try {
        const ws = new WebSocket(url);

        ws.onopen = () => {
          console.log('[WebSocket] Connected');
          setIsConnected(true);
        };

        ws.onmessage = (event) => {
          try {
            const message: WebSocketMessage = JSON.parse(event.data);
            setLastMessage(message);
          } catch (error) {
            console.error('[WebSocket] Failed to parse message:', error);
          }
        };

        ws.onclose = () => {
          console.log('[WebSocket] Disconnected, reconnecting in 3s...');
          setIsConnected(false);
          wsRef.current = null;

          // Reconnect after 3 seconds
          reconnectTimeoutRef.current = setTimeout(connect, 3000);
        };

        ws.onerror = (error) => {
          console.error('[WebSocket] Error:', error);
        };

        wsRef.current = ws;
      } catch (error) {
        console.error('[WebSocket] Failed to connect:', error);
        reconnectTimeoutRef.current = setTimeout(connect, 3000);
      }
    };

    connect();

    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [url]);

  return { isConnected, lastMessage };
}
