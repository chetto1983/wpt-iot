'use client';

// Phase 43 D-26 hop 2/3/4 data fetchers, factored out of
// `debug-drill-sheet.tsx` purely to respect the 500-LOC cap (CLAUDE.md
// Hard Stops). All three hooks are single-consumer and page-scoped — they
// are NOT promoted to `/hooks/` because they have no other caller.

import { useEffect, useMemo, useState } from 'react';
import type { IDebugSnapshotAtResponse } from '@wpt/types';

import { apiFetch } from '@/lib/api';

// ---------------------------------------------------------------------------
// Hop 3 — raw snapshot values at event.observedAt (BLOCKER #3 grep target).
// Consumes /api/anomaly/debug/snapshot (Plan 43-01).
// ---------------------------------------------------------------------------

export type SnapshotAtStatus =
  | 'idle'
  | 'loading'
  | 'ok'
  | 'notFound'
  | 'error';

export interface UseDebugSnapshotAtResult {
  data: IDebugSnapshotAtResponse | null;
  error: string | null;
  status: SnapshotAtStatus;
}

export function useDebugSnapshotAt(
  iso: string | null,
): UseDebugSnapshotAtResult {
  const [data, setData] = useState<IDebugSnapshotAtResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<SnapshotAtStatus>('idle');

  useEffect(() => {
    if (!iso) {
      setData(null);
      setStatus('idle');
      setError(null);
      return;
    }
    const ctrl = new AbortController();
    setStatus('loading');
    setError(null);
    apiFetch<IDebugSnapshotAtResponse>(
      `/api/anomaly/debug/snapshot?at=${encodeURIComponent(iso)}`,
      { signal: ctrl.signal },
    )
      .then((resp) => {
        if (ctrl.signal.aborted) return;
        setData(resp);
        setStatus('ok');
      })
      .catch((err: unknown) => {
        if ((err as Error).name === 'AbortError') return;
        // Plan 43-01 returns { error: 'No snapshot within tolerance' } on 404.
        const msg = (err as Error).message ?? '';
        if (msg.includes('No snapshot within tolerance')) {
          setStatus('notFound');
        } else {
          setError(msg);
          setStatus('error');
        }
      });
    return () => ctrl.abort();
  }, [iso]);

  return { data, error, status };
}

// ---------------------------------------------------------------------------
// Hop 2 — nearby cycle lookup against /api/cycles (paginated list).
// Response envelope is `{ cycles, pagination }` per lib/api/cycles.ts.
// ---------------------------------------------------------------------------

export interface CycleStripRow {
  cycleNumber: number;
  startedAt: string;
  endedAt: string | null;
  cycleStatusLabel: string | null;
}

interface CyclesListResponse {
  cycles: Array<{
    cycleNumber: number;
    startedAt: string;
    endedAt: string;
    cycleStatusLabel?: string | null;
  }>;
}

export type NearbyCycleStatus =
  | 'idle'
  | 'loading'
  | 'found'
  | 'notFound'
  | 'error';

export interface UseNearbyCycleResult {
  cycle: CycleStripRow | null;
  status: NearbyCycleStatus;
  error: string | null;
}

export function useNearbyCycle(observedAt: string | null): UseNearbyCycleResult {
  const [cycle, setCycle] = useState<CycleStripRow | null>(null);
  const [status, setStatus] = useState<NearbyCycleStatus>('idle');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!observedAt) {
      setCycle(null);
      setStatus('idle');
      setError(null);
      return;
    }
    const ctrl = new AbortController();
    setStatus('loading');
    setError(null);
    setCycle(null);

    const observed = new Date(observedAt);
    const windowFrom = new Date(observed.getTime() - 5 * 60_000).toISOString();
    const windowTo = new Date(observed.getTime() + 5 * 60_000).toISOString();

    apiFetch<CyclesListResponse>(
      `/api/cycles?from=${encodeURIComponent(windowFrom)}&to=${encodeURIComponent(windowTo)}&page=1&limit=25`,
      { signal: ctrl.signal },
    )
      .then((resp) => {
        if (ctrl.signal.aborted) return;
        const obsMs = observed.getTime();
        const match = resp.cycles.find((c) => {
          const startMs = new Date(c.startedAt).getTime();
          const endMs = c.endedAt ? new Date(c.endedAt).getTime() : Date.now();
          return startMs <= obsMs && obsMs <= endMs;
        });
        if (match) {
          setCycle({
            cycleNumber: match.cycleNumber,
            startedAt: match.startedAt,
            endedAt: match.endedAt || null,
            cycleStatusLabel: match.cycleStatusLabel ?? null,
          });
          setStatus('found');
        } else {
          setStatus('notFound');
        }
      })
      .catch((err: unknown) => {
        if ((err as Error).name === 'AbortError') return;
        setError((err as Error).message);
        setStatus('error');
      });
    return () => ctrl.abort();
  }, [observedAt]);

  return { cycle, status, error };
}

// ---------------------------------------------------------------------------
// Hop 4 — mini-chart data from /api/charts/data (WARNING #6 verified
// against charts.ts:14). Window = observedAt ±30min. `fields` is the
// comma-joined form already emitted by charts/page.tsx:175.
// ---------------------------------------------------------------------------

export interface ChartDataResponse {
  resolution: 'raw' | '5min' | '1h';
  points: Array<Record<string, number>>;
}

export interface UseMiniChartDataResult {
  data: ChartDataResponse | null;
  windowFrom: string | null;
  windowTo: string | null;
  status: 'idle' | 'loading' | 'ok' | 'error';
  error: string | null;
}

export function useMiniChartData(
  feature: string | null,
  observedAt: string | null,
): UseMiniChartDataResult {
  const [data, setData] = useState<ChartDataResponse | null>(null);
  const [status, setStatus] = useState<'idle' | 'loading' | 'ok' | 'error'>(
    'idle',
  );
  const [error, setError] = useState<string | null>(null);

  const { windowFrom, windowTo } = useMemo(() => {
    if (!observedAt) return { windowFrom: null, windowTo: null };
    const observed = new Date(observedAt);
    return {
      windowFrom: new Date(observed.getTime() - 30 * 60_000).toISOString(),
      windowTo: new Date(observed.getTime() + 30 * 60_000).toISOString(),
    };
  }, [observedAt]);

  useEffect(() => {
    if (!feature || !windowFrom || !windowTo) {
      setData(null);
      setStatus('idle');
      return;
    }
    const ctrl = new AbortController();
    setStatus('loading');
    setError(null);
    apiFetch<ChartDataResponse>(
      `/api/charts/data?fields=${encodeURIComponent(feature)}&from=${encodeURIComponent(windowFrom)}&to=${encodeURIComponent(windowTo)}`,
      { signal: ctrl.signal },
    )
      .then((resp) => {
        if (ctrl.signal.aborted) return;
        setData(resp);
        setStatus('ok');
      })
      .catch((err: unknown) => {
        if ((err as Error).name === 'AbortError') return;
        setError((err as Error).message);
        setStatus('error');
      });
    return () => ctrl.abort();
  }, [feature, windowFrom, windowTo]);

  return { data, windowFrom, windowTo, status, error };
}
