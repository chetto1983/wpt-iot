'use client';

import { createContext, useContext, useMemo } from 'react';
import type { ReactNode } from 'react';
import { useWebSocket } from '@/hooks/use-websocket';
import type { SubscribeWsMessage, WsState } from '@/hooks/use-websocket';
import { useAuth } from '@/lib/auth-context';

/**
 * Phase 43 D-07 / D-12 — the context carries TWO values:
 *   1. `state`  — the Phase 42 frozen `WsState` contract (byte-identical;
 *       `useWsData()` keeps returning this directly).
 *   2. `subscribeWsMessage` — a side-channel accessor that lets page-scoped
 *       hooks (e.g. `useReplayStream`) register a raw-message handler
 *       WITHOUT widening `WsState`. Exposed via `useWsMessageSubscribe()`.
 */
export interface WsContextValue {
  state: WsState;
  subscribeWsMessage: SubscribeWsMessage;
}

const WsContext = createContext<WsContextValue | null>(null);

export function WebSocketProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const wsState = useWebSocket(Boolean(user));

  const value = useMemo<WsContextValue>(
    () => ({
      state: {
        machineData: wsState.machineData,
        alarms: wsState.alarms,
        anomaly: wsState.anomaly,
        connected: wsState.connected,
        lastUpdate: wsState.lastUpdate,
        plcConnected: wsState.plcConnected,
        plcLastPacketAt: wsState.plcLastPacketAt,
      },
      subscribeWsMessage: wsState.subscribeWsMessage,
    }),
    [
      wsState.machineData,
      wsState.alarms,
      wsState.anomaly,
      wsState.connected,
      wsState.lastUpdate,
      wsState.plcConnected,
      wsState.plcLastPacketAt,
      wsState.subscribeWsMessage,
    ],
  );

  return <WsContext.Provider value={value}>{children}</WsContext.Provider>;
}

/**
 * Phase 42 frozen contract — returns the byte-identical `WsState` shape
 * (machineData, alarms, anomaly, connected, lastUpdate, plcConnected,
 * plcLastPacketAt). Existing callers remain unaffected by Phase 43's
 * side-channel addition.
 */
export function useWsData(): WsState {
  const context = useContext(WsContext);
  if (!context) {
    throw new Error('useWsData must be used within a WebSocketProvider');
  }
  return context.state;
}

/**
 * Phase 43 D-07 / D-12 — side-channel accessor for page-scoped consumers.
 * Returns a stable `subscribe(handler) => unsubscribe` function. Callers
 * MUST invoke the returned unsubscribe in their `useEffect` cleanup
 * (threat register T-43-02-05 — DoS via listener leak).
 */
export function useWsMessageSubscribe(): SubscribeWsMessage {
  const context = useContext(WsContext);
  if (!context) {
    throw new Error(
      'useWsMessageSubscribe must be used within a WebSocketProvider',
    );
  }
  return context.subscribeWsMessage;
}
