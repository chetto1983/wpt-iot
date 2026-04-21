/**
 * Phase 43 Plan 03 Task 2 — D-31 unit tests for `useReplayStream`.
 *
 * Covers the 5 assertion clusters from the plan's <behavior> block:
 *   1. Ref accumulation: 12 sequential `chunk` frames grow framesRef.current
 *      to 12 entries with NO React state update per frame.
 *   2. Terminal setState on `phase:'end'` fires exactly ONE setState wrapped
 *      in startTransition and the resulting state contains all 12 chunks.
 *   3. Seq-gap detection: frames arriving 0,1,2,5 → `toast.warning` called
 *      with a gap message + `onSeqGap` callback called once with `(3, 5)`.
 *   4. Abort: calling `abort()` dispatches DELETE to the correct URL.
 *   5. Error-frame state: `phase:'error'` sets `error={ code, message }`
 *      and flips status to `'error'`.
 *
 * CLAUDE.md Hard Stops — NEVER modify the hook to make a test pass.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

// ---------------------------------------------------------------------------
// Mocks — must be hoisted BEFORE importing the hook
// ---------------------------------------------------------------------------

// Capture the registered subscriber so tests can dispatch synthetic frames.
let registeredHandler: ((msg: unknown) => void) | null = null;

// Stable subscribe function — the real `useWsMessageSubscribe()` returns
// a `useCallback`-stable function from context. If we created a new
// arrow function on every call the hook's useEffect dep array would
// churn and re-subscribe / reset state on every render, which is NOT
// the real behaviour.
const stableSubscribe = (handler: (msg: unknown) => void) => {
  registeredHandler = handler;
  return () => {
    registeredHandler = null;
  };
};
vi.mock('@/lib/ws-context', () => ({
  useWsMessageSubscribe: () => stableSubscribe,
}));

// Sonner toast — capturable + no-op.
const toastWarningMock = vi.fn();
vi.mock('sonner', () => ({
  toast: {
    warning: (...args: unknown[]) => toastWarningMock(...args),
  },
}));

// apiFetch — used by abort() for DELETE.
const mockApiFetch = vi.fn().mockResolvedValue(undefined);
vi.mock('@/lib/api', () => ({
  apiFetch: (...args: unknown[]) => mockApiFetch(...args),
}));

// Import AFTER mocks.
import { useReplayStream } from '@/hooks/useReplayStream';

// ---------------------------------------------------------------------------
// Frame builders — keep in lock-step with @wpt/types replayFrameSchema.
// ---------------------------------------------------------------------------

function makeChunk(streamId: string, seq: number, rowCount = 3) {
  return {
    type: 'REPLAY_FRAME' as const,
    streamId,
    seq,
    phase: 'chunk' as const,
    rows: Array.from({ length: rowCount }, (_, i) => ({
      observedAt: new Date(Date.UTC(2026, 3, 21, 10, 0, i)).toISOString(),
      modeKey: 'default',
      score: 0.5 + i * 0.01,
      flagged: false,
      topContributors: [],
    })),
  };
}

function makeProgress(streamId: string, seq: number, processed: number) {
  return {
    type: 'REPLAY_FRAME' as const,
    streamId,
    seq,
    phase: 'progress' as const,
    processed,
    total: 100,
    etaMs: 1000,
  };
}

function makeEnd(streamId: string, seq: number, processed = 100, durationMs = 3000) {
  return {
    type: 'REPLAY_FRAME' as const,
    streamId,
    seq,
    phase: 'end' as const,
    processed,
    durationMs,
    ok: true as const,
  };
}

function makeError(streamId: string, seq: number, code = 'aborted', message = 'Cancelled') {
  return {
    type: 'REPLAY_FRAME' as const,
    streamId,
    seq,
    phase: 'error' as const,
    code,
    message,
  };
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

beforeEach(() => {
  registeredHandler = null;
  toastWarningMock.mockReset();
  mockApiFetch.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useReplayStream', () => {
  it("Test 1 — 12 chunk frames accumulate in ref without React state churn", () => {
    const streamId = 'stream-1';
    let renderCount = 0;
    const { result } = renderHook(() => {
      renderCount += 1;
      return useReplayStream({ streamId });
    });

    // Subscriber registered on streamId mount.
    expect(registeredHandler).not.toBeNull();

    // `running` status transitions may bump the render count once on mount.
    const baselineRenders = renderCount;

    // Dispatch 12 chunks in sequence.
    act(() => {
      for (let seq = 0; seq < 12; seq++) {
        registeredHandler!(makeChunk(streamId, seq));
      }
    });

    // CRITICAL: chunk frames must NOT trigger React state updates — the
    // render count must be unchanged from baseline.
    expect(renderCount).toBe(baselineRenders);

    // But the hook exposes nothing about framesRef directly; instead the
    // final setState on 'end' will surface the 12 chunks. That is covered
    // in Test 2. Here we also assert `result` is still running with no
    // intermediate `result.result` payload.
    expect(result.current.status).toBe('running');
    expect(result.current.result).toBeNull();
  });

  it("Test 2 — phase:'end' fires ONE terminal setState with all 12 chunks", async () => {
    const streamId = 'stream-2';
    let renderCount = 0;
    const { result } = renderHook(() => {
      renderCount += 1;
      return useReplayStream({ streamId });
    });

    const baselineRenders = renderCount;

    act(() => {
      for (let seq = 0; seq < 12; seq++) {
        registeredHandler!(makeChunk(streamId, seq));
      }
    });
    // Still no renders yet.
    expect(renderCount).toBe(baselineRenders);

    // Terminal 'end' — single setState wrapped in startTransition.
    act(() => {
      registeredHandler!(makeEnd(streamId, 12, 36, 3000));
    });

    await waitFor(() => {
      expect(result.current.status).toBe('completed');
    });

    expect(result.current.result).not.toBeNull();
    expect(result.current.result?.chunks.length).toBe(12);
    expect(result.current.result?.processed).toBe(36);
    expect(result.current.result?.durationMs).toBe(3000);

    // startTransition may cause more than one render as React flushes
    // the transition; the point is that we did NOT get a setState per
    // chunk — that would have been 12+ renders before 'end'.
    expect(baselineRenders).toBeGreaterThan(0); // sanity check
    expect(renderCount).toBeGreaterThan(baselineRenders); // end DID trigger
    // Liberal upper bound — one transition flush may re-render twice.
    expect(renderCount - baselineRenders).toBeLessThanOrEqual(3);
  });

  it('Test 3 — seq gap fires toast.warning + onSeqGap callback once', () => {
    const streamId = 'stream-3';
    const onSeqGap = vi.fn();
    renderHook(() => useReplayStream({ streamId, onSeqGap }));

    act(() => {
      registeredHandler!(makeChunk(streamId, 0));
      registeredHandler!(makeChunk(streamId, 1));
      registeredHandler!(makeChunk(streamId, 2));
      // Skip 3 and 4 — jump to seq 5.
      registeredHandler!(makeChunk(streamId, 5));
    });

    expect(toastWarningMock).toHaveBeenCalledTimes(1);
    const toastArg = toastWarningMock.mock.calls[0]?.[0] as string;
    expect(toastArg).toMatch(/gap/i);
    expect(toastArg).toContain('3');
    expect(toastArg).toContain('5');

    expect(onSeqGap).toHaveBeenCalledTimes(1);
    expect(onSeqGap).toHaveBeenCalledWith(3, 5);
  });

  it('Test 4 — abort() dispatches DELETE to /api/anomaly/debug/replay/:streamId', async () => {
    const streamId = 'stream-4';
    const { result } = renderHook(() => useReplayStream({ streamId }));

    await act(async () => {
      await result.current.abort();
    });

    expect(mockApiFetch).toHaveBeenCalledTimes(1);
    const [url, options] = mockApiFetch.mock.calls[0] as [string, { method: string }];
    expect(url).toBe(`/api/anomaly/debug/replay/${streamId}`);
    expect(options.method).toBe('DELETE');

    await waitFor(() => {
      expect(result.current.status).toBe('idle');
    });
  });

  it("Test 5 — phase:'error' sets error state and status='error'", async () => {
    const streamId = 'stream-5';
    const { result } = renderHook(() => useReplayStream({ streamId }));

    act(() => {
      registeredHandler!(makeProgress(streamId, 0, 50));
      registeredHandler!(makeChunk(streamId, 1));
      registeredHandler!(makeError(streamId, 2, 'aborted', 'Cancelled by user'));
    });

    await waitFor(() => {
      expect(result.current.status).toBe('error');
    });

    expect(result.current.error).not.toBeNull();
    expect(result.current.error?.code).toBe('aborted');
    expect(result.current.error?.message).toBe('Cancelled by user');
    // Result is NOT populated on error.
    expect(result.current.result).toBeNull();
  });
});
