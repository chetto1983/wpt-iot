'use client';

import { useEffect, useState } from 'react';
import { useWsData } from '@/lib/ws-context';

// ─────────────────────────────────────────────────────────────────────────────
// Mirrors canUseServiceWorker() from pwa-manager.tsx.
// SW message listener is only registered when the SW API is available and
// we are in a secure context (HTTPS or localhost).
// ─────────────────────────────────────────────────────────────────────────────
function canUseServiceWorker(): boolean {
  if (typeof window === 'undefined') return false;
  const isLocalhost =
    window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1';
  return 'serviceWorker' in navigator && (window.isSecureContext || isLocalhost);
}

export interface ConnectionStatus {
  wsConnected: boolean;
  networkOnline: boolean;
  cacheFallbackActive: boolean;
  isOffline: boolean; // derived: !wsConnected || !networkOnline || cacheFallbackActive
}

/**
 * Unified offline-detection hook.
 *
 * Combines three signals:
 * 1. wsConnected — from WsContext (WebSocket to backend live)
 * 2. networkOnline — from navigator.onLine / online/offline window events
 * 3. cacheFallbackActive — from SW CACHE_FALLBACK_USED postMessage
 *
 * isOffline is true when ANY signal indicates the app is operating on stale data.
 *
 * Must be used inside the WebSocketProvider tree (the authenticated (app) layout).
 */
export function useConnectionStatus(): ConnectionStatus {
  const { connected: wsConnected } = useWsData();
  const [networkOnline, setNetworkOnline] = useState<boolean>(
    typeof navigator !== 'undefined' ? navigator.onLine : true,
  );
  const [cacheFallbackActive, setCacheFallbackActive] = useState<boolean>(false);

  // Listen for browser online/offline events.
  // Mirror: use-mobile.ts matchMedia listener style.
  useEffect(() => {
    const onOnline = () => {
      setNetworkOnline(true);
    };
    const onOffline = () => {
      setNetworkOnline(false);
    };
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  // Listen for CACHE_FALLBACK_USED postMessage from the Serwist SW.
  // Fires when a NetworkFirst handler falls back to cached response because
  // the network request failed or timed out (networkTimeoutSeconds: 5).
  // Mirror: use-websocket.ts ws.onmessage dispatch pattern.
  useEffect(() => {
    if (!canUseServiceWorker()) return;

    const onMessage = (event: MessageEvent<{ type?: string }>) => {
      if (event.data?.type === 'CACHE_FALLBACK_USED') {
        setCacheFallbackActive(true);
      }
    };

    navigator.serviceWorker.addEventListener('message', onMessage);
    return () => {
      navigator.serviceWorker.removeEventListener('message', onMessage);
    };
  }, []);

  const isOffline = !wsConnected || !networkOnline || cacheFallbackActive;

  return { wsConnected, networkOnline, cacheFallbackActive, isOffline };
}
