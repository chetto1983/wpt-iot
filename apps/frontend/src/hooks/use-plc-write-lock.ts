'use client';

import { useState, useCallback, useRef, useEffect } from 'react';

type LockState = 'idle' | 'loaded' | 'expired';

const LOCK_DURATION_MS = 300_000; // 5 minutes

/**
 * Shared safety lock hook for PLC write operations.
 * Manages a 5-minute countdown after a successful read:
 *   idle    -> user has not read yet (write disabled)
 *   loaded  -> read succeeded, countdown active (write enabled)
 *   expired -> countdown reached 0 (write disabled, must read again)
 *
 * D-03: canWrite only true in 'loaded' state
 * D-04: 5-minute countdown from read success
 * D-05: page navigation resets lock via useEffect cleanup
 * D-06: single deadline ref as source of truth avoids drift
 */
export function usePlcWriteLock() {
  const [state, setState] = useState<LockState>('idle');
  const [remainingSeconds, setRemainingSeconds] = useState(0);

  const deadlineRef = useRef(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const visibilityHandlerRef = useRef<(() => void) | null>(null);

  const clearTimer = useCallback(() => {
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  // Single visibilitychange handler: when the tab returns to visible, recalc
  // remainingSeconds from the wall-clock deadlineRef so the displayed value
  // matches the source of truth within one frame (no 1Hz-throttled drift).
  // Only attached while a loaded lock is armed; detached on write/reset/unmount.
  const attachVisibilityListener = useCallback(() => {
    if (visibilityHandlerRef.current !== null) return;
    const handler = () => {
      if (document.visibilityState !== 'visible') return;
      if (deadlineRef.current <= 0) return;
      const remaining = Math.max(
        0,
        Math.ceil((deadlineRef.current - Date.now()) / 1000),
      );
      setRemainingSeconds(remaining);
      if (remaining <= 0) {
        setState('expired');
        if (intervalRef.current !== null) {
          clearInterval(intervalRef.current);
          intervalRef.current = null;
        }
      }
    };
    document.addEventListener('visibilitychange', handler);
    visibilityHandlerRef.current = handler;
  }, []);

  const detachVisibilityListener = useCallback(() => {
    if (visibilityHandlerRef.current !== null) {
      document.removeEventListener('visibilitychange', visibilityHandlerRef.current);
      visibilityHandlerRef.current = null;
    }
  }, []);

  const markReadSuccess = useCallback(() => {
    clearTimer();

    const deadline = Date.now() + LOCK_DURATION_MS;
    deadlineRef.current = deadline;
    setState('loaded');
    setRemainingSeconds(300);

    intervalRef.current = setInterval(() => {
      const remaining = Math.max(0, Math.ceil((deadlineRef.current - Date.now()) / 1000));
      setRemainingSeconds(remaining);

      if (remaining <= 0) {
        setState('expired');
        if (intervalRef.current !== null) {
          clearInterval(intervalRef.current);
          intervalRef.current = null;
        }
      }
    }, 1000);

    attachVisibilityListener();
  }, [clearTimer, attachVisibilityListener]);

  const markWriteSuccess = useCallback(() => {
    detachVisibilityListener();
    clearTimer();
    setState('idle');
    setRemainingSeconds(0);
  }, [clearTimer, detachVisibilityListener]);

  const restoreLoadedState = useCallback((remaining: number) => {
    const normalized = Math.max(0, Math.ceil(remaining));
    if (normalized <= 0) {
      clearTimer();
      setState('expired');
      setRemainingSeconds(0);
      return;
    }

    clearTimer();

    const deadline = Date.now() + normalized * 1000;
    deadlineRef.current = deadline;
    setState('loaded');
    setRemainingSeconds(normalized);

    intervalRef.current = setInterval(() => {
      const nextRemaining = Math.max(
        0,
        Math.ceil((deadlineRef.current - Date.now()) / 1000),
      );
      setRemainingSeconds(nextRemaining);

      if (nextRemaining <= 0) {
        setState('expired');
        if (intervalRef.current !== null) {
          clearInterval(intervalRef.current);
          intervalRef.current = null;
        }
      }
    }, 1000);

    attachVisibilityListener();
  }, [clearTimer, attachVisibilityListener]);

  const reset = useCallback(() => {
    detachVisibilityListener();
    clearTimer();
    setState('idle');
    setRemainingSeconds(0);
  }, [clearTimer, detachVisibilityListener]);

  // D-05: cleanup on unmount (page navigation) — also detach visibility listener
  useEffect(() => {
    return () => {
      clearTimer();
      detachVisibilityListener();
    };
  }, [clearTimer, detachVisibilityListener]);

  return {
    state,
    remainingSeconds,
    canWrite: state === 'loaded',
    markReadSuccess,
    markWriteSuccess,
    restoreLoadedState,
    reset,
  };
}
