import { useEffect, useRef, useCallback } from 'react';
import API from '../api';

const WS_BASE = API.replace(/^http/, 'ws');

/**
 * WebSocket signaling hook.
 *
 * Connects to ws://<host>/ws/lesson/<roomId>/
 * and exposes send(message) + onMessage callback.
 *
 * @param {string} roomId
 * @param {function} onMessage  — called with parsed JSON message
 */
export default function useSignaling(roomId, onMessage) {
  const ws = useRef(null);
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;

  useEffect(() => {
    if (!roomId) return;

    const socket = new WebSocket(`${WS_BASE}/ws/lesson/${roomId}/`);
    ws.current = socket;

    socket.onopen = () => {
      console.log('[signaling] connected to room', roomId);
    };

    socket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        onMessageRef.current?.(data);
      } catch (e) {
        console.error('[signaling] bad message', e);
      }
    };

    socket.onerror = (e) => console.error('[signaling] error', e);
    socket.onclose = () => console.log('[signaling] disconnected');

    return () => {
      socket.close();
      ws.current = null;
    };
  }, [roomId]);

  const send = useCallback((message) => {
    if (ws.current?.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify(message));
    } else {
      console.warn('[signaling] not connected, dropping message', message);
    }
  }, []);

  return { send };
}
