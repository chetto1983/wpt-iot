'use client';

// Phase 43 D-12..D-23 + D-34 — replay panel orchestrator (Plan 43-05 file
// 3 of 3). Owns the finite-state machine (idle / running / completed /
// error / cooldown), consumes useReplayStream, coordinates histogram +
// progress + results + error banners.
//
// HARD RULES (D-18 SC #3 amendment + D-23 layered UX):
//   - The D-18 amendment deletes DVR-style playback controls from the
//     replay UX (acceptance criteria enforce this at the file level via
//     grep — do NOT re-introduce pace / rate / tempo / DVR widgets).
//   - Progress rendered as shadcn <Progress> inline (D-19) — never toast,
//     never modal.
//   - Cancel button visible during `running` state → DELETE /replay/:id
//     (useReplayStream.abort()).
//   - phase:'error' terminal → persistent inline <Alert> (D-23).
//   - HTTP 429 → sonner toast with Retry-After countdown, honor the
//     Retry-After HTTP header over JSON body fallback (D-23 RFC 6585 —
//     WARNING #5 resolution Option C: raw fetch() for the POST path so
//     headers and body stay in scope; apiFetch strips both).
//   - useEffect cleanup on unmount → DELETE the in-flight replay (D-23
//     layered safety net).
//
// Strict fork discipline (D-27): zero imports from @/components/anomaly/**.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';
import type { IReplayStartResponse } from '@wpt/types';

import { apiFetch } from '@/lib/api';
import { useReplayStream } from '@/hooks/useReplayStream';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';

import { DebugReplayHistogram } from './debug-replay-histogram';
import { DebugReplayResults } from './debug-replay-results';

export interface DebugReplayPanelProps {
  /** Replay window start (ISO). URL-sync'd at the page layer (Plan 43-06). */
  from: string;
  /** Replay window end (ISO). URL-sync'd at the page layer (Plan 43-06). */
  to: string;
  /**
   * Called when the admin drags the histogram Brush to pick a new window.
   * Plan 43-06 reconciles to the nuqs `?from=&to=` state.
   */
  onRangeChange: (from: string, to: string) => void;
  /**
   * Called when useReplayStream detects a REPLAY_FRAME seq gap. Wired to
   * useDetectorState.refresh() at the page-composition layer so the
   * detector state is re-pulled after a dropped frame (Phase 43 D-12
   * TCP/Phoenix Channels resync convention).
   */
  onSeqGap?: (expected: number, got: number) => void;
}

type PanelStatus =
  | 'idle'
  | 'running'
  | 'completed'
  | 'error'
  | 'cooldown';

/**
 * WARNING #5 resolution — Option C (raw fetch for the POST path).
 * apiFetch rejects with `Error(message)` on non-2xx and drops the Response
 * object, losing the `Retry-After` HTTP header + the full JSON body. The
 * only call site that needs those is exactly the start-replay POST; keep
 * the helper local so the rest of the app keeps using apiFetch.
 *
 * Phase 42 D-05 emits the JSON body `{ error: 'Concurrency limit',
 * retryAfter: 30, active: 2 }` as defense-in-depth. D-23 canonical order:
 * prefer the HTTP Retry-After header (RFC 6585 §4); fall back to the JSON
 * body; final fallback is the Phase 42 D-08 server-side default (30s).
 */
async function postReplayStart(
  from: string,
  to: string,
): Promise<
  | { ok: true; streamId: string }
  | { ok: false; retryAfterSec: number | null; message: string }
> {
  const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? '';
  const res = await fetch(`${API_BASE}/api/anomaly/debug/replay`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to }),
  });
  if (res.ok) {
    const data = (await res.json()) as IReplayStartResponse;
    return { ok: true, streamId: data.streamId };
  }
  if (res.status === 429) {
    const headerVal = res.headers.get('Retry-After');
    let retryAfterSec: number | null = null;
    if (headerVal) {
      const n = Number(headerVal);
      if (Number.isFinite(n) && n >= 0) retryAfterSec = n;
    }
    if (retryAfterSec === null) {
      try {
        const body = (await res.json()) as {
          retryAfter?: number;
          error?: string;
        };
        if (typeof body.retryAfter === 'number' && body.retryAfter >= 0) {
          retryAfterSec = body.retryAfter;
        }
      } catch {
        // JSON parse failed; retryAfterSec stays null and default kicks in.
      }
    }
    return {
      ok: false,
      retryAfterSec: retryAfterSec ?? 30,
      message: 'Concurrency limit',
    };
  }
  let message = `Request failed: ${res.status}`;
  try {
    const body = (await res.json()) as { error?: string };
    if (typeof body.error === 'string') message = body.error;
  } catch {
    // JSON parse failed — keep fallback message.
  }
  return { ok: false, retryAfterSec: null, message };
}

export function DebugReplayPanel({
  from,
  to,
  onRangeChange,
  onSeqGap,
}: DebugReplayPanelProps) {
  const t = useTranslations();

  const [streamId, setStreamId] = useState<string | null>(null);
  const [cooldownUntil, setCooldownUntil] = useState<number | null>(null);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  const {
    progress,
    result,
    error,
    status: streamStatus,
    abort,
  } = useReplayStream({ streamId, onSeqGap });

  // ── cooldown ticking: a cheap 1-second interval while cooling drives
  // the countdown label. Cleared as soon as we leave cooldown state.
  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    if (cooldownUntil === null) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [cooldownUntil]);

  // D-22 FSM derivation — cooldown overrides stream status; otherwise
  // useReplayStream owns the transition.
  const inCooldown =
    cooldownUntil !== null && now < cooldownUntil;
  useEffect(() => {
    if (cooldownUntil !== null && now >= cooldownUntil) {
      setCooldownUntil(null);
    }
  }, [cooldownUntil, now]);

  const panelStatus: PanelStatus = inCooldown
    ? 'cooldown'
    : streamStatus;

  const runReplay = useCallback(async () => {
    if (panelStatus === 'cooldown' || panelStatus === 'running' || starting) {
      return;
    }
    setStartError(null);
    setStarting(true);
    try {
      const outcome = await postReplayStart(from, to);
      if (outcome.ok) {
        setStreamId(outcome.streamId);
        return;
      }
      if (outcome.retryAfterSec !== null) {
        const until = Date.now() + outcome.retryAfterSec * 1000;
        setCooldownUntil(until);
        setNow(Date.now());
        toast.warning(
          t('debugDetector.errors.429', {
            seconds: outcome.retryAfterSec,
          }),
          { duration: outcome.retryAfterSec * 1000 },
        );
      } else {
        setStartError(outcome.message);
        toast.error(outcome.message);
      }
    } finally {
      setStarting(false);
    }
  }, [from, panelStatus, starting, t, to]);

  const runCancel = useCallback(async () => {
    await abort();
    setStreamId(null);
  }, [abort]);

  // D-23 layered safety net — on unmount, DELETE any live streamId so an
  // orphan replay never accumulates server-side. The backend's DELETE is
  // idempotent (Phase 42 D-04) and WS-close auto-cancel (D-10) covers the
  // missed-DELETE case anyway.
  useEffect(() => {
    return () => {
      if (streamId) {
        void apiFetch<void>(`/api/anomaly/debug/replay/${streamId}`, {
          method: 'DELETE',
        }).catch(() => undefined);
      }
    };
  }, [streamId]);

  const progressPct = useMemo(() => {
    if (!progress) return null;
    const total = Math.max(progress.total, 1);
    return Math.min(100, (progress.processed / total) * 100);
  }, [progress]);

  const cooldownSeconds = useMemo(() => {
    if (cooldownUntil === null) return 0;
    return Math.max(0, Math.ceil((cooldownUntil - now) / 1000));
  }, [cooldownUntil, now]);

  return (
    <section
      aria-label={t('debugDetector.panels.replay.title')}
      className="space-y-4"
      data-slot="debug-replay-panel"
    >
      <div className="flex items-center justify-between">
        <h2 className="font-heading text-base font-medium">
          {t('debugDetector.panels.replay.title')}
        </h2>
      </div>

      <DebugReplayHistogram
        from={from}
        to={to}
        onSelectionChange={({ from: f, to: t2 }) => onRangeChange(f, t2)}
      />

      {/* ── Action row ─────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2">
        {panelStatus === 'idle' && (
          <Button onClick={runReplay} disabled={starting}>
            {t('debugDetector.panels.replay.actions.run')}
          </Button>
        )}
        {panelStatus === 'completed' && (
          <Button onClick={runReplay} disabled={starting}>
            {t('debugDetector.panels.replay.actions.rerun')}
          </Button>
        )}
        {panelStatus === 'error' && (
          <Button onClick={runReplay} disabled={starting}>
            {t('debugDetector.panels.replay.actions.retry')}
          </Button>
        )}
        {panelStatus === 'cooldown' && (
          <Button disabled>
            {t('debugDetector.errors.429countdown', {
              seconds: cooldownSeconds,
            })}
          </Button>
        )}
        {panelStatus === 'running' && (
          <Button variant="outline" onClick={runCancel}>
            {t('debugDetector.panels.replay.actions.cancel')}
          </Button>
        )}
      </div>

      {/* ── Progress (D-19 inline <Progress>, never a toast/modal) ──── */}
      {panelStatus === 'running' && progress && progressPct !== null && (
        <div
          data-slot="debug-replay-panel-progress"
          className="space-y-1"
        >
          <Progress value={progressPct} />
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>
              {t('debugDetector.panels.replay.progress', {
                processed: progress.processed,
                total: progress.total,
                etaMs: Math.round(progress.etaMs),
              })}
            </span>
            <span className="tabular-nums">{progressPct.toFixed(0)}%</span>
          </div>
        </div>
      )}

      {/* ── Persistent error banner for phase:'error' terminal frames ── */}
      {panelStatus === 'error' && error && (
        <Alert variant="destructive">
          <AlertTitle>
            {t('debugDetector.errors.replayTerminalTitle')}
          </AlertTitle>
          <AlertDescription>
            <code className="mr-2 font-mono text-xs">{error.code}</code>
            {error.message}
          </AlertDescription>
        </Alert>
      )}

      {/* ── Start-call error (non-429) surfaces as a secondary banner
       *  so the admin sees it without chasing the toast. */}
      {startError && panelStatus !== 'error' && (
        <Alert severity="medium">
          <AlertTitle>
            {t('debugDetector.errors.replayStartTitle')}
          </AlertTitle>
          <AlertDescription>{startError}</AlertDescription>
        </Alert>
      )}

      {/* ── Results — post-end static panels including secondary Brush ── */}
      {panelStatus === 'completed' && result && (
        <DebugReplayResults
          chunks={result.chunks}
          fromWindow={from}
          toWindow={to}
        />
      )}
    </section>
  );
}
