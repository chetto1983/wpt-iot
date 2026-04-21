'use client';

import { startTransition, useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { WsMessageType } from '@wpt/types';
import type { IReplayFrame, IWsMessage } from '@wpt/types';

import { apiFetch } from '@/lib/api';
import { useWsMessageSubscribe } from '@/lib/ws-context';

type ChunkFrame = Extract<IReplayFrame, { phase: 'chunk' }>;
type ProgressFrame = Extract<IReplayFrame, { phase: 'progress' }>;
type ErrorFrame = Extract<IReplayFrame, { phase: 'error' }>;

export interface ReplayResult {
  chunks: ChunkFrame[];
  processed: number;
  durationMs: number;
}

export interface UseReplayStreamOptions {
  streamId: string | null;
  /**
   * Phase 43 D-12: invoked when a seq gap is detected. Wired to
   * `useDetectorState.refresh()` at the page-composition layer so the
   * detector state is re-pulled after a dropped frame (TCP/Phoenix Channels
   * resync convention — do NOT attempt to reconstruct missing frames).
   */
  onSeqGap?: (expected: number, got: number) => void;
}

export interface UseReplayStreamResult {
  progress: ProgressFrame | null;
  result: ReplayResult | null;
  error: ErrorFrame | null;
  status: 'idle' | 'running' | 'completed' | 'error';
  abort: () => Promise<void>;
}

/**
 * Phase 43 D-12, D-13, D-14 — REPLAY_FRAME consumer for `/debug/detector`.
 *
 * - Subscribes to the singleton `WebSocketProvider` via
 *   `useWsMessageSubscribe()` (Plan 43-02 side-channel, keeps `WsState`
 *   frozen per CONTEXT D-07/D-12).
 * - Chunk frames accumulate in `framesRef` — NO `setState` per frame. At
 *   ~4 Hz × ~100 rows × 33 features over ~3 s that would otherwise
 *   trigger ~12 full re-renders of Recharts + the shadcn Table.
 * - Progress frames drive `progress` state (cheap; 1 setState per ~250 ms
 *   per Phase 42 D-07), wrapped in `startTransition`.
 * - Terminal `phase:'end'` fires ONE `setState` wrapped in
 *   `startTransition` with the fully-assembled result.
 * - Seq gaps fire a warn toast + `onSeqGap(expected, got)` callback.
 *   Frames are still processed — no silent drops.
 * - `phase:'error'` transitions to error status and clears the accumulator.
 */
export function useReplayStream(options: UseReplayStreamOptions): UseReplayStreamResult {
  const { streamId, onSeqGap } = options;

  const [progress, setProgress] = useState<ProgressFrame | null>(null);
  const [result, setResult] = useState<ReplayResult | null>(null);
  const [error, setError] = useState<ErrorFrame | null>(null);
  const [status, setStatus] = useState<'idle' | 'running' | 'completed' | 'error'>('idle');

  // D-13: ref accumulator for chunk frames — no state churn during stream.
  const framesRef = useRef<ChunkFrame[]>([]);
  // Seq monotonicity tracking — D-12.
  const lastSeqRef = useRef<number>(-1);
  const subscribe = useWsMessageSubscribe();

  // Stable ref for the optional callback so the subscribe effect does not
  // need to re-run when the caller passes an inline arrow function.
  const onSeqGapRef = useRef<typeof onSeqGap>(onSeqGap);
  useEffect(() => {
    onSeqGapRef.current = onSeqGap;
  }, [onSeqGap]);

  useEffect(() => {
    // No active stream → reset to idle and skip subscription.
    if (!streamId) {
      framesRef.current = [];
      lastSeqRef.current = -1;
      setProgress(null);
      setResult(null);
      setError(null);
      setStatus('idle');
      return;
    }

    // Fresh stream — reset all state + accumulator.
    framesRef.current = [];
    lastSeqRef.current = -1;
    setProgress(null);
    setResult(null);
    setError(null);
    setStatus('running');

    const handler = (msg: IWsMessage) => {
      if (msg.type !== WsMessageType.REPLAY_FRAME) return;
      // IWsMessage<unknown> and IReplayFrame do not structurally overlap
      // (IWsMessage's payload field vs IReplayFrame's flat shape), so the
      // narrowing goes through `unknown`. Phase 42 ships REPLAY_FRAME
      // messages as flat `IReplayFrame` objects on the wire — the cast is
      // safe once `type === WsMessageType.REPLAY_FRAME`.
      const frame = msg as unknown as IReplayFrame;
      if (frame.streamId !== streamId) return;

      // D-12: seq-gap detection. First frame initializes the counter.
      const expected = lastSeqRef.current + 1;
      if (lastSeqRef.current !== -1 && frame.seq !== expected) {
        toast.warning(
          `Replay frame gap: expected ${expected}, got ${frame.seq} — re-fetching live state`,
        );
        onSeqGapRef.current?.(expected, frame.seq);
        // Continue processing — do NOT drop the frame (TCP/Phoenix Channels
        // convention).
      }
      lastSeqRef.current = frame.seq;

      switch (frame.phase) {
        case 'progress':
          startTransition(() => {
            setProgress(frame);
          });
          break;
        case 'chunk':
          // D-13: accumulate in ref; no setState during stream.
          framesRef.current.push(frame);
          break;
        case 'error':
          startTransition(() => {
            setError(frame);
            setStatus('error');
          });
          framesRef.current = [];
          break;
        case 'end': {
          // D-13/D-14: ONE terminal setState wrapped in startTransition.
          const accumulated = framesRef.current;
          startTransition(() => {
            setResult({
              chunks: accumulated,
              processed: frame.processed,
              durationMs: frame.durationMs,
            });
            setStatus('completed');
          });
          break;
        }
      }
    };

    const unsubscribe = subscribe(handler);
    return () => {
      unsubscribe();
    };
  }, [streamId, subscribe]);

  // D-23 cancel path: DELETE is idempotent on the backend (Phase 42 D-04).
  // On any failure the server-side watchdog or auto-cancel will clean up
  // anyway; swallow to keep the UX resilient.
  const abort = useCallback(async () => {
    if (!streamId) {
      framesRef.current = [];
      lastSeqRef.current = -1;
      setStatus('idle');
      return;
    }
    try {
      await apiFetch<void>(`/api/anomaly/debug/replay/${streamId}`, {
        method: 'DELETE',
      });
    } catch {
      // Idempotent on server; swallow.
    } finally {
      framesRef.current = [];
      lastSeqRef.current = -1;
      setStatus('idle');
    }
  }, [streamId]);

  return { progress, result, error, status, abort };
}
