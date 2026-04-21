'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { IDebugStateResponse } from '@wpt/types';

import { apiFetch } from '@/lib/api';
import { useWsData } from '@/lib/ws-context';

// D-08: trigger timings. The plan allows a discretionary 200-500ms debounce
// window for the WS-driven refetch and a 2s grace window for the
// visibilitychange refetch; center-of-range defaults chosen here.
const WS_REFETCH_DEBOUNCE_MS = 300;
const VISIBILITY_REFETCH_GRACE_MS = 2000;

export interface UseDetectorStateResult {
  state: IDebugStateResponse | null;
  loading: boolean;
  error: string | null;
  lastFetchedAt: number | null;
  refresh: () => void;
}

/**
 * Phase 43 D-07, D-08, D-35 — single-flight fetcher for
 * `GET /api/anomaly/debug/state`. Four triggers all route through one
 * `fetchDetectorState()` with a shared AbortController:
 *   1. Initial GET on mount.
 *   2. WS trigger: `useWsData().anomaly` change, debounced 300ms
 *      trailing-edge.
 *   3. visibilitychange to visible, if >2s since last fetch.
 *   4. Manual `refresh()` call.
 *
 * Does NOT extend `WsState` (Phase 42 frozen contract, CONTEXT D-07 hard
 * wall). Subscribes to the existing `WebSocketProvider` via `useWsData()`.
 * Scoped to `/debug/detector` — not a global concern.
 */
export function useDetectorState(enabled: boolean = true): UseDetectorStateResult {
  const [state, setState] = useState<IDebugStateResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastFetchedAt, setLastFetchedAt] = useState<number | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  // D-35 ref-guard: `isFetchingRef` tracks in-flight status for the single
  // fetcher. Complements the AbortController — the controller cancels a
  // prior in-flight fetch when a new trigger fires; the flag lets
  // observability code (and future callers) see that a fetch is active
  // without routing through React state.
  const isFetchingRef = useRef(false);
  const lastFetchedAtRef = useRef<number | null>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // D-35 single fetcher — all four triggers route here. Cancels any
  // previous in-flight request via AbortController before starting a new
  // one, so a rapid sequence of triggers dedupes to exactly one completed
  // fetch (the latest).
  const fetchDetectorState = useCallback(async () => {
    if (!enabled) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    isFetchingRef.current = true;
    setLoading(true);
    setError(null);
    try {
      const data = await apiFetch<IDebugStateResponse>(
        '/api/anomaly/debug/state',
        { signal: controller.signal },
      );
      if (controller.signal.aborted) return;
      setState(data);
      const now = Date.now();
      lastFetchedAtRef.current = now;
      setLastFetchedAt(now);
    } catch (err) {
      // Swallow AbortError — it's expected from our own abort() calls
      // (unmount, trigger preemption).
      const e = err as Error;
      if (e.name === 'AbortError') return;
      setError(e.message || 'Failed to fetch detector state');
    } finally {
      // Only the latest controller clears the loading state — a preempted
      // earlier fetch lands here too, but its controller is no longer the
      // current one, so leave the flag alone.
      if (abortRef.current === controller) {
        isFetchingRef.current = false;
        setLoading(false);
      }
    }
  }, [enabled]);

  // Trigger 1: initial GET on mount.
  useEffect(() => {
    if (!enabled) return;
    void fetchDetectorState();
    return () => {
      abortRef.current?.abort();
    };
  }, [enabled, fetchDetectorState]);

  // Trigger 2: WS-driven refetch, debounced 300ms trailing-edge. Subscribe
  // to `anomaly` on the shared context; React re-runs this effect when
  // the anomaly reference changes. A fresh setTimeout replaces any pending
  // timer so rapid bursts coalesce to a single refetch.
  const { anomaly } = useWsData();
  const didMountRef = useRef(false);
  useEffect(() => {
    if (!enabled) return;
    // Skip the initial mount render — Trigger 1 already fires the initial
    // GET. Debounce only engages on true WS-driven changes.
    if (!didMountRef.current) {
      didMountRef.current = true;
      return;
    }
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = setTimeout(() => {
      void fetchDetectorState();
    }, WS_REFETCH_DEBOUNCE_MS);
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
    };
  }, [anomaly, enabled, fetchDetectorState]);

  // Trigger 3: visibilitychange to visible, if >2s grace window elapsed.
  useEffect(() => {
    if (!enabled) return;
    const handler = () => {
      if (document.visibilityState !== 'visible') return;
      const last = lastFetchedAtRef.current;
      if (last !== null && Date.now() - last < VISIBILITY_REFETCH_GRACE_MS) {
        return;
      }
      void fetchDetectorState();
    };
    document.addEventListener('visibilitychange', handler);
    return () => document.removeEventListener('visibilitychange', handler);
  }, [enabled, fetchDetectorState]);

  // Trigger 4: manual refresh.
  const refresh = useCallback(() => {
    void fetchDetectorState();
  }, [fetchDetectorState]);

  return { state, loading, error, lastFetchedAt, refresh };
}
