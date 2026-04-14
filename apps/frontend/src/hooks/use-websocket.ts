'use client';

import { startTransition, useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { WsMessageType } from '@wpt/types';
import type {
  IActiveAlarm,
  ILiveAnomalyState,
  IMachineSnapshot,
  IPlcStatus,
  IWsMessage,
} from '@wpt/types';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || '';
const MIN_RECONNECT_DELAY = 1000;
const MAX_RECONNECT_DELAY = 30000;
const MAX_LOGGED_MESSAGE_CHARS = 200;

function getWsUrl(): string {
  const base = (API_BASE || window.location.origin).replace(/\/$/, '');
  return `${base.replace(/^http/, 'ws')}/api/ws`;
}

export interface WsState {
  machineData: Partial<IMachineSnapshot> | null;
  alarms: IActiveAlarm[];
  anomaly: ILiveAnomalyState | null;
  connected: boolean;
  lastUpdate: Date | null;
  plcConnected: boolean | null;
  plcLastPacketAt: string | null;
}

export function useWebSocket(enabled: boolean): WsState {
  const [machineData, setMachineData] = useState<Partial<IMachineSnapshot> | null>(null);
  const [alarms, setAlarms] = useState<IActiveAlarm[]>([]);
  const [anomaly, setAnomaly] = useState<ILiveAnomalyState | null>(null);
  const [connected, setConnected] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [plcConnected, setPlcConnected] = useState<boolean | null>(null);
  const [plcLastPacketAt, setPlcLastPacketAt] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const attemptRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevConnectedRef = useRef(false);
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
      prevConnectedRef.current = true;
    };

    ws.onclose = (event) => {
      setConnected(false);
      if (wsRef.current === ws) {
        wsRef.current = null;
      }

      // Show disconnect toast only on true->false transition (not initial mount)
      if (prevConnectedRef.current === true && event.code !== 1000 && event.code !== 4401) {
        toast.warning('Connection lost. Attempting to reconnect...', { duration: 5000 });
      }
      prevConnectedRef.current = false;

      if (event.code === 4401) {
        // Preserve current URL for post-login redirect
        const returnUrl = encodeURIComponent(window.location.pathname + window.location.search);
        toast.warning('Your session has expired. Please log in again.');
        setTimeout(() => {
          window.location.href = `/?expired=true&returnUrl=${returnUrl}`;
        }, 1500);
        return;
      }

      if (event.code !== 1000) {
        console.warn('[ws] connection closed', {
          code: event.code,
          reason: event.reason || '(empty)',
        });
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
      // Browser WebSocket error events do not expose the underlying cause.
      // Skip logging when the socket was already detached by cleanup (React 18
      // Strict Mode unmounts the effect immediately, closing the socket before
      // it connects — this is harmless dev-only noise).
      if (wsRef.current !== ws) return;
      console.error('[ws] connection error', { url: getWsUrl() });
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
              setLastUpdate(new Date());
            });
            break;
          case WsMessageType.ALARM_UPDATE:
            startTransition(() => {
              setAlarms(message.payload as IActiveAlarm[]);
            });
            break;
          case WsMessageType.ANOMALY_UPDATE:
            startTransition(() => {
              setAnomaly(message.payload as ILiveAnomalyState);
            });
            break;
          case WsMessageType.PLC_STATUS: {
            const status = message.payload as IPlcStatus;
            startTransition(() => {
              setPlcConnected(status.connected);
              setPlcLastPacketAt(status.lastPacketAt);
            });
            break;
          }
          default:
            console.warn('[ws] unsupported message type', { type: message.type });
            break;
        }
      } catch (error) {
        const raw = event.data.length > MAX_LOGGED_MESSAGE_CHARS
          ? `${event.data.slice(0, MAX_LOGGED_MESSAGE_CHARS)}...`
          : event.data;
        console.error('[ws] failed to parse message', {
          error: error instanceof Error ? error.message : String(error),
          raw,
        });
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
      setPlcConnected(null);
      setPlcLastPacketAt(null);
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
      setPlcConnected(null);
      setPlcLastPacketAt(null);
    };
  }, [enabled, connect]);

  return { machineData, alarms, anomaly, connected, lastUpdate, plcConnected, plcLastPacketAt };
}
