'use client';

// Phase 43 D-15 + D-16 + D-17 + D-34 — Recharts BarChart + <Brush> for
// pre-start window selection of the replay panel (Plan 43-05 file 1 of 3).
//
// Fetches snapshot-count histogram for the replay window from
// GET /api/anomaly/debug/snapshot-histogram (Plan 43-01). Admin drags the
// Brush to pick a replay sub-window; selection is reported upward via
// onSelectionChange — the parent (debug-replay-panel) reconciles to URL
// state via nuqs (Plan 43-06 owns the URL sync).
//
// Strict fork discipline (D-27): zero imports from the operator-facing
// anomaly component directory.

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Bar,
  BarChart,
  Brush,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { ISnapshotHistogramResponse } from '@wpt/types';

import { apiFetch } from '@/lib/api';
import { useAppLocale } from '@/lib/locale';

export interface DebugReplayHistogramProps {
  /** Histogram fetch window start (ISO). Also the initial replay window. */
  from: string;
  /** Histogram fetch window end (ISO). Also the initial replay window. */
  to: string;
  /**
   * Called on Brush drag release with the ISO-string sub-window the user
   * selected. Parent reconciles back to URL state + re-renders the histogram
   * (via updated from/to props) if needed.
   */
  onSelectionChange: (selection: { from: string; to: string }) => void;
}

interface ChartBucket {
  bucket: string;
  bucketTs: number;
  count: number;
}

export function DebugReplayHistogram({
  from,
  to,
  onSelectionChange,
}: DebugReplayHistogramProps) {
  const [data, setData] = useState<ISnapshotHistogramResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const { formatDateTime } = useAppLocale();

  useEffect(() => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setError(null);
    setData(null);
    apiFetch<ISnapshotHistogramResponse>(
      `/api/anomaly/debug/snapshot-histogram?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
      { signal: controller.signal },
    )
      .then((res) => {
        if (!controller.signal.aborted) setData(res);
      })
      .catch((err: unknown) => {
        if ((err as Error)?.name === 'AbortError') return;
        setError((err as Error).message);
      });
    return () => controller.abort();
  }, [from, to]);

  const chartData = useMemo<ChartBucket[]>(() => {
    if (!data) return [];
    return data.buckets.map((b) => ({
      bucket: b.bucket,
      bucketTs: new Date(b.bucket).getTime(),
      count: b.count,
    }));
  }, [data]);

  if (error) {
    return (
      <div
        role="alert"
        className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive"
      >
        {error}
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex h-[140px] w-full items-center justify-center rounded-md border border-border/60 text-xs text-muted-foreground">
        Loading histogram…
      </div>
    );
  }

  if (chartData.length === 0) {
    return (
      <div className="flex h-[140px] w-full items-center justify-center rounded-md border border-border/60 text-xs text-muted-foreground">
        No snapshots in this window
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={140}>
      <BarChart
        data={chartData}
        margin={{ top: 8, right: 12, left: 12, bottom: 4 }}
      >
        <XAxis
          dataKey="bucketTs"
          type="number"
          domain={['dataMin', 'dataMax']}
          scale="time"
          tickFormatter={(v: number) => formatDateTime(new Date(v))}
          tick={{ fontSize: 10, fill: '#888' }}
          tickLine={false}
          axisLine={false}
          minTickGap={48}
        />
        <YAxis
          tick={{ fontSize: 10, fill: '#888' }}
          tickLine={false}
          axisLine={false}
          width={32}
          allowDecimals={false}
        />
        <Tooltip
          contentStyle={{
            background: 'hsl(var(--card))',
            border: '1px solid hsl(var(--border))',
            borderRadius: 8,
            fontSize: 12,
          }}
          labelFormatter={(v) =>
            typeof v === 'number' ? formatDateTime(new Date(v)) : String(v)
          }
          formatter={(value) => [`${Number(value)} snapshots`, 'Count']}
        />
        {/* D-16: D-34 — live-mode animation discipline even on static data,
         *  because the admin may drag the Brush repeatedly. */}
        <Bar
          dataKey="count"
          fill="var(--chart-1, oklch(0.56 0.158 242))"
          isAnimationActive={false}
          maxBarSize={24}
        />
        {/* D-16: Brush over the histogram. Each Brush drag emits the
         *  underlying `bucket` ISO strings back up so the parent can
         *  reconcile to URL state / re-fetch. */}
        <Brush
          dataKey="bucketTs"
          height={28}
          stroke="var(--color-primary)"
          tickFormatter={(v: number) => formatDateTime(new Date(v))}
          onChange={(range: {
            startIndex?: number;
            endIndex?: number;
          } | null) => {
            if (!range) return;
            const s = range.startIndex ?? 0;
            const e = range.endIndex ?? chartData.length - 1;
            const startBucket = chartData[s]?.bucket;
            const endBucket = chartData[e]?.bucket;
            if (startBucket && endBucket) {
              onSelectionChange({ from: startBucket, to: endBucket });
            }
          }}
        />
      </BarChart>
    </ResponsiveContainer>
  );
}
