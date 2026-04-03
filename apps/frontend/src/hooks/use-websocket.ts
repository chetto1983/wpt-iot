'use client';

import { startTransition, useCallback, useEffect, useRef, useState } from 'react';
import { WsMessageType } from '@wpt/types';
import type { IActiveAlarm, IMachineSnapshot, IWsMessage } from '@wpt/types';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || '';
const MIN_RECONNECT_DELAY = 1000;
const MAX_RECONNECT_DELAY = 30000;

function getWsUrl(): string {
  const base = (API_BASE || window.location.origin).replace(/\/$/, '');
  return `${base.replace(/^http/, 'ws')}/ws`;
}

export interface WsState {
  machineData: Partial<IMachineSnapshot> | null;
  alarms: IActiveAlarm[];
  connected: boolean;
}

export function useWebSocket(enabled: boolean): WsState {
  const [machineData, setMachineData] = useState<Partial<IMachineSnapshot> | null>(null);
  const [alarms, setAlarms] = useState<IActiveAlarm[]>([]);
  const [connected, setConnected] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const attemptRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  const connect = useCallback(() => {
    if (!enabledRef.current) {
      return;
    }

    const current = wsRef.current;
    if (
      current &&
      (current.readyState === WebSocket.OPEN || current.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }

    const ws = new WebSocket(getWsUrl());
    wsRef.current = ws;

    ws.onopen = () => {
      attemptRef.current = 0;
      setConnected(true);
    };

    ws.onclose = (event) => {
      setConnected(false);
      if (wsRef.current === ws) {
        wsRef.current = null;
      }

      if (event.code === 4401) {
        window.location.href = '/?expired=true';
        return;
      }

      if (!enabledRef.current) {
        return;
      }

      const delay = Math.min(
        MIN_RECONNECT_DELAY * Math.pow(2, attemptRef.current),
        MAX_RECONNECT_DELAY,
      );
      attemptRef.current += 1;

      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
      }

      reconnectTimerRef.current = setTimeout(() => {
        reconnectTimerRef.current = null;
        connect();
      }, delay);
    };

    ws.onerror = () => {
      // Reconnect logic is centralized in onclose.
    };

    ws.onmessage = (event) => {
      if (typeof event.data !== 'string') {
        return;
      }

      try {
        const message = JSON.parse(event.data) as IWsMessage;

        switch (message.type) {
          case WsMessageType.MACHINE_DATA:
            startTransition(() => {
              setMachineData(message.payload as Partial<IMachineSnapshot>);
            });
            break;
          case WsMessageType.ALARM_UPDATE:
            startTransition(() => {
              setAlarms(message.payload as IActiveAlarm[]);
            });
            break;
          default:
            break;
        }
      } catch {
        // Ignore malformed messages.
      }
    };
  }, []);

  useEffect(() => {
    enabledRef.current = enabled;

    if (enabled) {
      connect();
    } else {
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      if (wsRef.current) {
        const socket = wsRef.current;
        wsRef.current = null;
        socket.close();
      }
      setConnected(false);
    }

    return () => {
      enabledRef.current = false;

      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }

      if (wsRef.current) {
        const socket = wsRef.current;
        wsRef.current = null;
        socket.close();
      }

      setConnected(false);
    };
  }, [enabled, connect]);

  return { machineData, alarms, connected };
}
