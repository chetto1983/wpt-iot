'use client';

import { createContext, useContext, useMemo } from 'react';
import type { ReactNode } from 'react';
import { useWebSocket } from '@/hooks/use-websocket';
import type { WsState } from '@/hooks/use-websocket';
import { useAuth } from '@/lib/auth-context';

const WsContext = createContext<WsState | null>(null);

export function WebSocketProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const wsState = useWebSocket(Boolean(user));

  const value = useMemo<WsState>(
    () => ({
      machineData: wsState.machineData,
      alarms: wsState.alarms,
      connected: wsState.connected,
      lastUpdate: wsState.lastUpdate,
    }),
    [wsState.machineData, wsState.alarms, wsState.connected, wsState.lastUpdate],
  );

  return <WsContext.Provider value={value}>{children}</WsContext.Provider>;
}

export function useWsData(): WsState {
  const context = useContext(WsContext);
  if (!context) {
    throw new Error('useWsData must be used within a WebSocketProvider');
  }
  return context;
}
