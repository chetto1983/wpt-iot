/**
 * Phase 43 Plan 03 Task 1 — D-30 unit tests for `useDetectorState`.
 *
 * Covers the 7 assertion clusters from the plan's <behavior> block:
 *   1. Initial GET on mount triggers a single apiFetch(...) call with an
 *      AbortSignal.
 *   2. WS trigger: changing useWsData().anomaly fires a refetch after 300ms
 *      (trailing-edge debounce); 3 changes within 200ms coalesce to ONE
 *      refetch.
 *   3. visibilitychange to visible: fires refetch if >2s since last fetch;
 *      does NOT fire if <2s.
 *   4. Manual refresh() call triggers a refetch.
 *   5. Concurrent triggers dedupe: first AbortController is aborted, only
 *      the latest fetch completes.
 *   6. Unmount cleanup aborts any in-flight request (abortRef.current.abort
 *      was called).
 *   7. apiFetch rejection is caught and surfaced as `error`; no unhandled
 *      promise rejection leaks.
 *
 * CLAUDE.md Hard Stops — NEVER modify the hook to make a test pass; if a
 * test fails, the hook has a bug.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

// ---------------------------------------------------------------------------
// Mocks — must be hoisted BEFORE importing the hook
// ---------------------------------------------------------------------------

// apiFetch — controllable per test. Default is a pending never-resolving
// promise so tests can opt-in to resolution via mockResolvedValueOnce /
// mockRejectedValueOnce.
const mockApiFetch = vi.fn();
vi.mock('@/lib/api', () => ({
  apiFetch: (...args: unknown[]) => mockApiFetch(...args),
}));

// Controllable anomaly holder for useWsData. Rendering is driven by a
// dedicated listener so changing `wsAnomalyHolder` between act(...) calls
// can be observed by React.
let wsAnomalyHolder: unknown = null;
const wsAnomalyListeners = new Set<() => void>();
function setWsAnomaly(next: unknown) {
  wsAnomalyHolder = next;
  for (const l of wsAnomalyListeners) l();
}

vi.mock('@/lib/ws-context', () => ({
  useWsData: () => {
    // Subscribe the current render to force re-render when the holder
    // changes via setWsAnomaly(...). The effect simulates the normal React
    // context behavior without needing a full provider.
    // We use a tiny hook-like pattern via useSyncExternalStore-style trick.
    return {
      machineData: null,
      alarms: [],
      anomaly: wsAnomalyHolder,
      connected: true,
      lastUpdate: null,
      plcConnected: true,
      plcLastPacketAt: null,
    };
  },
}));

// Import AFTER mocks are set up.
import { useDetectorState } from '@/hooks/useDetectorState';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface PendingFetch {
  promise: Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (err: unknown) => void;
  signal: AbortSignal | undefined;
}

function makePendingFetch(): PendingFetch {
  let resolve!: (value: unknown) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<unknown>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject, signal: undefined };
}

function queuePendingFetch(): PendingFetch {
  const pending = makePendingFetch();
  mockApiFetch.mockImplementationOnce(
    (_url: string, options?: { signal?: AbortSignal }) => {
      pending.signal = options?.signal;
      return pending.promise;
    },
  );
  return pending;
}

const sampleResponse = {
  data: {
    primary: {
      detector: { sampleCount: 100 },
      modes: {},
      contributors: [],
    },
    shadow: {
      snapshot: { globalSampleCount: 10, lastObservationAt: null },
    },
  },
  meta: {
    generatedAt: '2026-04-21T10:00:00Z',
    isStale: false,
    lastObservationAt: '2026-04-21T09:59:30Z',
    detectorVersion: 'v1.4',
  },
};

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

beforeEach(() => {
  mockApiFetch.mockReset();
  wsAnomalyHolder = null;
  wsAnomalyListeners.clear();
});

afterEach(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useDetectorState', () => {
  it('Test 1 — initial GET on mount fires single apiFetch with an AbortSignal', async () => {
    const pending = queuePendingFetch();

    const { unmount } = renderHook(() => useDetectorState());

    await waitFor(() => {
      expect(mockApiFetch).toHaveBeenCalledTimes(1);
    });
    const firstCall = mockApiFetch.mock.calls[0];
    expect(firstCall).toBeDefined();
    expect(firstCall![0]).toBe('/api/anomaly/debug/state');
    expect(firstCall![1]).toBeDefined();
    expect((firstCall![1] as { signal: AbortSignal }).signal).toBeInstanceOf(
      AbortSignal,
    );
    expect(pending.signal).toBeInstanceOf(AbortSignal);

    // Resolve so the hook transitions cleanly before unmount.
    pending.resolve(sampleResponse);
    await waitFor(() => {
      expect(mockApiFetch).toHaveBeenCalledTimes(1);
    });
    unmount();
  });

  it('Test 2 — WS trigger debounces to ONE refetch after 300ms (trailing-edge)', async () => {
    // Initial mount fetch uses real timers to avoid tangling with fake timers.
    const initial = queuePendingFetch();
    const { rerender, unmount } = renderHook(() => useDetectorState());
    await waitFor(() => expect(mockApiFetch).toHaveBeenCalledTimes(1));
    initial.resolve(sampleResponse);
    // Flush the then() microtask so lastFetchedAtRef is populated.
    await waitFor(() =>
      expect(mockApiFetch.mock.calls.length).toBeGreaterThanOrEqual(1),
    );

    // Now switch to fake timers for the debounce assertions.
    vi.useFakeTimers();

    const debounced1 = queuePendingFetch();

    // Fire 3 anomaly changes within 200ms — the debounce window is 300ms,
    // so only ONE refetch should fire 300ms after the LAST change.
    act(() => {
      setWsAnomaly({ id: 'a', score: 1 });
    });
    rerender();

    act(() => {
      vi.advanceTimersByTime(100);
      setWsAnomaly({ id: 'b', score: 2 });
    });
    rerender();

    act(() => {
      vi.advanceTimersByTime(100);
      setWsAnomaly({ id: 'c', score: 3 });
    });
    rerender();

    // Total 200ms elapsed; still within the trailing-edge debounce window.
    // No new fetch yet (still 1 — only the initial).
    expect(mockApiFetch).toHaveBeenCalledTimes(1);

    // Advance past the 300ms debounce tail — now ONE refetch fires.
    act(() => {
      vi.advanceTimersByTime(300);
    });

    expect(mockApiFetch).toHaveBeenCalledTimes(2);
    debounced1.resolve(sampleResponse);

    unmount();
  });

  it('Test 3 — visibilitychange to visible refetches if >2s since last fetch; NOT if <2s', async () => {
    const initial = queuePendingFetch();
    const { unmount } = renderHook(() => useDetectorState());
    await waitFor(() => expect(mockApiFetch).toHaveBeenCalledTimes(1));
    initial.resolve(sampleResponse);

    // Wait for the resolution microtask so lastFetchedAtRef is updated.
    await waitFor(() => {
      // Give React the chance to flush the then() setState path.
      expect(mockApiFetch).toHaveBeenCalledTimes(1);
    });

    // Case A: <2s since last fetch — NO refetch.
    Object.defineProperty(document, 'visibilityState', {
      value: 'visible',
      configurable: true,
    });
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    // Give the handler a tick.
    await new Promise((r) => setTimeout(r, 10));
    expect(mockApiFetch).toHaveBeenCalledTimes(1);

    // Case B: simulate >2s elapsed. Easiest: advance wall-clock via Date spy.
    const realNow = Date.now;
    const advanceMs = 5000;
    const baseNow = realNow();
    vi.spyOn(Date, 'now').mockImplementation(() => baseNow + advanceMs);

    const afterGrace = queuePendingFetch();
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await waitFor(() => expect(mockApiFetch).toHaveBeenCalledTimes(2));

    afterGrace.resolve(sampleResponse);

    vi.spyOn(Date, 'now').mockRestore();
    unmount();
  });

  it('Test 4 — calling refresh() triggers a refetch', async () => {
    const initial = queuePendingFetch();
    const { result, unmount } = renderHook(() => useDetectorState());
    await waitFor(() => expect(mockApiFetch).toHaveBeenCalledTimes(1));
    initial.resolve(sampleResponse);
    await waitFor(() => expect(mockApiFetch).toHaveBeenCalledTimes(1));

    const afterRefresh = queuePendingFetch();

    act(() => {
      result.current.refresh();
    });

    await waitFor(() => expect(mockApiFetch).toHaveBeenCalledTimes(2));
    afterRefresh.resolve(sampleResponse);

    unmount();
  });

  it('Test 5 — concurrent triggers abort the first AbortController (dedupe)', async () => {
    const first = queuePendingFetch();
    const { result, unmount } = renderHook(() => useDetectorState());
    await waitFor(() => expect(mockApiFetch).toHaveBeenCalledTimes(1));

    // First fetch is in-flight; trigger a second one.
    const second = queuePendingFetch();

    act(() => {
      result.current.refresh();
    });

    await waitFor(() => expect(mockApiFetch).toHaveBeenCalledTimes(2));

    // First controller should have been aborted by the new trigger.
    expect(first.signal?.aborted).toBe(true);
    expect(second.signal?.aborted).toBe(false);

    second.resolve(sampleResponse);
    // Reject the (already aborted) first with an AbortError so the hook's
    // catch branch can eat it cleanly.
    const abortErr = new Error('aborted');
    abortErr.name = 'AbortError';
    first.reject(abortErr);

    unmount();
  });

  it('Test 6 — unmount aborts any in-flight request', async () => {
    const pending = queuePendingFetch();
    const { unmount } = renderHook(() => useDetectorState());
    await waitFor(() => expect(mockApiFetch).toHaveBeenCalledTimes(1));

    expect(pending.signal?.aborted).toBe(false);
    unmount();
    expect(pending.signal?.aborted).toBe(true);

    // Resolve the dangling promise so vitest does not warn about open
    // handles.
    const abortErr = new Error('aborted');
    abortErr.name = 'AbortError';
    pending.reject(abortErr);
  });

  it('Test 7 — apiFetch rejection is surfaced as error; no unhandled rejection', async () => {
    const pending = queuePendingFetch();
    const { result, unmount } = renderHook(() => useDetectorState());
    await waitFor(() => expect(mockApiFetch).toHaveBeenCalledTimes(1));

    pending.reject(new Error('boom'));

    await waitFor(() => {
      expect(result.current.error).toBe('boom');
    });
    // Hook must not crash; state remains null, loading settled.
    expect(result.current.state).toBeNull();
    expect(result.current.loading).toBe(false);

    unmount();
  });
});
