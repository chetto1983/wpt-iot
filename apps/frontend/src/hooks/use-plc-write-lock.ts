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

  const clearTimer = useCallback(() => {
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
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
  }, [clearTimer]);

  const markWriteSuccess = useCallback(() => {
    clearTimer();
    setState('idle');
    setRemainingSeconds(0);
  }, [clearTimer]);

  const reset = useCallback(() => {
    clearTimer();
    setState('idle');
    setRemainingSeconds(0);
  }, [clearTimer]);

  // D-05: cleanup on unmount (page navigation)
  useEffect(() => {
    return clearTimer;
  }, [clearTimer]);

  return {
    state,
    remainingSeconds,
    canWrite: state === 'loaded',
    markReadSuccess,
    markWriteSuccess,
    reset,
  };
}
