import { useEffect, useRef, useCallback, useState } from 'react';

const RECONNECT_DELAYS = [500, 1000, 2000, 4000, 8000];
const MAX_RECONNECTS = 20;
const PING_INTERVAL = 10000;

function log(...a) { console.log('%c[sig]', 'color:#5f5', ...a); }

export default function useSignaling(roomId, onMessage, wsUrl) {
  const wsRef = useRef(null);
  const onMsgRef = useRef(onMessage);
  onMsgRef.current = onMessage;

  const queue = useRef([]);
  const reconnects = useRef(0);
  const reconnectTimer = useRef(null);
  const pingTimer = useRef(null);
  const alive = useRef(true);
  const [connected, setConnected] = useState(false);

  const cleanup = useCallback(() => {
    alive.current = false;
    clearTimeout(reconnectTimer.current);
    clearInterval(pingTimer.current);
    if (wsRef.current) {
      wsRef.current.onclose = null;
      wsRef.current.close();
      wsRef.current = null;
    }
  }, []);

  const connect = useCallback(() => {
    if (!alive.current || !roomId) return;

    let url;
    if (wsUrl) {
      url = wsUrl;
    } else {
      const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
      url = `${proto}://${window.location.host}/ws/lesson/${encodeURIComponent(roomId)}/`;
    }
    log('connecting →', url);

    const socket = new WebSocket(url);
    wsRef.current = socket;

    socket.onopen = () => {
      log('connected ✓');
      reconnects.current = 0;
      setConnected(true);

      const pending = queue.current.splice(0);
      pending.forEach(m => socket.send(JSON.stringify(m)));

      onMsgRef.current?.({ type: '__ws_ready__' });

      clearInterval(pingTimer.current);
      pingTimer.current = setInterval(() => {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: 'ping' }));
        }
      }, PING_INTERVAL);
    };

    socket.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.type === 'pong') return;
        onMsgRef.current?.(data);
      } catch {}
    };

    socket.onerror = (e) => {
      log('ws error', e);
    };

    socket.onclose = (ev) => {
      log(`ws closed code=${ev.code} reason=${ev.reason} wasClean=${ev.wasClean}`);
      setConnected(false);
      wsRef.current = null;
      clearInterval(pingTimer.current);

      if (!alive.current) return;

      const attempt = reconnects.current;
      if (attempt >= MAX_RECONNECTS) {
        log('max reconnects reached, giving up');
        return;
      }
      const delay = RECONNECT_DELAYS[Math.min(attempt, RECONNECT_DELAYS.length - 1)];
      log(`reconnect #${attempt + 1} in ${delay}ms`);
      reconnects.current = attempt + 1;
      reconnectTimer.current = setTimeout(connect, delay);
    };
  }, [roomId, wsUrl]);

  useEffect(() => {
    alive.current = true;
    connect();
    return cleanup;
  }, [connect, cleanup]);

  const send = useCallback((message) => {
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    } else {
      queue.current.push(message);
    }
  }, []);

  return { send, connected };
}
