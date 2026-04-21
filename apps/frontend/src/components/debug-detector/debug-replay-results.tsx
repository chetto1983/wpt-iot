'use client';

// Phase 43 D-13 + D-18 + D-20 + D-21 + D-34 — post-end static replay
// results rendering (Plan 43-05 file 2 of 3).
//
// Renders three vertically-stacked sections below the histogram after the
// replay stream completes (phase:'end'):
//   1. Top-50-by-score-desc scored observation table (D-20 default per
//      CONTEXT discretion).
//   2. Replay Pareto aggregate via DebugContributorChart with
//      label="Replay ({from} — {to})" (D-21; one component, two instances).
//   3. Replay score time-series with SECONDARY Recharts <Brush> for
//      unlimited result-set rescrub + useDeferredValue (D-18, D-13).
//
// Strict fork discipline (D-27): zero imports from @/components/anomaly/**.
// Consumes `DebugContributorChart` from the sibling Plan 43-04 fork.

import { useDeferredValue, useMemo, useState } from 'react';
import {
  CartesianGrid,
  Brush,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { IAnomalyContributor, IReplayFrame } from '@wpt/types';

import { useAppLocale } from '@/lib/locale';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

import { DebugContributorChart } from './debug-contributor-chart';

type ChunkFrame = Extract<IReplayFrame, { phase: 'chunk' }>;
type ReplayRow = ChunkFrame['rows'][number];

export interface DebugReplayResultsProps {
  /** Chunk frames from useReplayStream.result.chunks — flattened below. */
  chunks: ChunkFrame[];
  /** Replay window boundaries (ISO) — rendered in the Pareto label. */
  fromWindow: string;
  toWindow: string;
}

const TOP_ROW_LIMIT = 50;

function formatScore(n: number): string {
  if (!Number.isFinite(n)) return '—';
  return n.toFixed(3);
}

/**
 * Aggregate top-N Pareto contributors across the full result set: sum the
 * squared-z contribution % per feature, then renormalize so values sum to 1
 * and DebugContributorChart's percentage pipeline stays intact.
 */
function aggregateContributors(rows: ReplayRow[]): IAnomalyContributor[] {
  if (rows.length === 0) return [];
  const bag = new Map<
    string,
    { contribution: number; zScore: number; direction: 'HIGH' | 'LOW' | null; count: number }
  >();
  for (const r of rows) {
    for (const c of r.topContributors) {
      const entry = bag.get(c.feature) ?? {
        contribution: 0,
        zScore: 0,
        direction: null,
        count: 0,
      };
      if (c.contribution !== undefined) entry.contribution += c.contribution;
      entry.zScore += Math.abs(c.zScore);
      entry.count += 1;
      // Majority-direction by last-writer-wins (contributors rarely flip
      // direction across a window); HIGH preferred on tie.
      if (c.direction && entry.direction === null) entry.direction = c.direction;
      bag.set(c.feature, entry);
    }
  }
  const entries = [...bag.entries()];
  const sumContribution = entries.reduce((acc, [, v]) => acc + v.contribution, 0);
  const useContribution = sumContribution > 0;
  return entries
    .map<IAnomalyContributor>(([feature, v]) => ({
      feature,
      zScore: v.count > 0 ? v.zScore / v.count : v.zScore,
      ...(useContribution
        ? { contribution: v.contribution / sumContribution }
        : {}),
      ...(v.direction ? { direction: v.direction } : {}),
    }))
    .sort((a, b) => (b.contribution ?? b.zScore) - (a.contribution ?? a.zScore))
    .slice(0, 20);
}

export function DebugReplayResults({
  chunks,
  fromWindow,
  toWindow,
}: DebugReplayResultsProps) {
  const { formatDateTime } = useAppLocale();

  // Flatten chunk frames into a single rows array. Stable identity via
  // chunks reference — the parent only re-renders this component on a new
  // replay result (phase:'end' terminal setState).
  const rows = useMemo<ReplayRow[]>(
    () => chunks.flatMap((c) => c.rows),
    [chunks],
  );

  // Section 1 — top-N rows by score descending (D-20 default discretion).
  const topRows = useMemo(() => {
    return [...rows]
      .sort((a, b) => b.score - a.score)
      .slice(0, TOP_ROW_LIMIT);
  }, [rows]);

  // Section 2 — aggregated Pareto across full result set.
  const aggregateContribs = useMemo(() => aggregateContributors(rows), [rows]);

  // Section 3 — time-series + secondary <Brush>. D-13 useDeferredValue on
  // the Brush-filtered slice keeps the rescrub smooth under ~200 row x-axis.
  const seriesData = useMemo(() => {
    return rows
      .slice()
      .sort(
        (a, b) =>
          new Date(a.observedAt).getTime() - new Date(b.observedAt).getTime(),
      )
      .map((r) => ({
        ts: new Date(r.observedAt).getTime(),
        score: r.score,
        flagged: r.flagged ? 1 : 0,
      }));
  }, [rows]);

  const [brushRange, setBrushRange] = useState<{
    from: number;
    to: number;
  } | null>(null);
  // D-13 — defer the filter-derived slice so dragging the Brush does not
  // stall the main thread on large result sets.
  const deferredRange = useDeferredValue(brushRange);
  const visibleSeries = useMemo(() => {
    if (!deferredRange) return seriesData;
    return seriesData.filter(
      (p) => p.ts >= deferredRange.from && p.ts <= deferredRange.to,
    );
  }, [seriesData, deferredRange]);

  const replayLabel = `Replay (${formatDateTime(new Date(fromWindow))} — ${formatDateTime(new Date(toWindow))})`;

  if (rows.length === 0) {
    return (
      <div className="rounded-md border border-border/60 bg-card p-4 text-sm text-muted-foreground">
        No observations in the replay window.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* ── Section 1: scored-observation table (top-50 by score desc) ─── */}
      <section aria-labelledby="replay-results-table-heading">
        <div className="mb-2 flex items-center justify-between">
          <h3
            id="replay-results-table-heading"
            className="font-heading text-sm font-medium"
          >
            Top {TOP_ROW_LIMIT} observations (by score)
          </h3>
          <Badge variant="secondary">{rows.length} total</Badge>
        </div>
        <div className="max-h-[360px] overflow-y-auto rounded-md border">
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-background">
              <TableRow>
                <TableHead>Observed At</TableHead>
                <TableHead>Mode</TableHead>
                <TableHead className="text-right">Score</TableHead>
                <TableHead>Flagged</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {topRows.map((r, i) => (
                <TableRow key={`${r.observedAt}-${i}`}>
                  <TableCell className="font-mono text-xs">
                    {formatDateTime(new Date(r.observedAt))}
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {r.modeKey}
                  </TableCell>
                  <TableCell className="tabular-nums text-right">
                    {formatScore(r.score)}
                  </TableCell>
                  <TableCell>
                    {r.flagged ? (
                      <Badge severity="critical">YES</Badge>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </section>

      {/* ── Section 2: aggregate Pareto via DebugContributorChart ────── */}
      <section aria-labelledby="replay-results-pareto-heading">
        <h3
          id="replay-results-pareto-heading"
          className="mb-2 font-heading text-sm font-medium"
        >
          Aggregate contributors
        </h3>
        {/* D-21 — second instance of DebugContributorChart, label-differentiated. */}
        <DebugContributorChart
          contributors={aggregateContribs}
          label={replayLabel}
          emptyCopy="No flagged contributors in replay window"
        />
      </section>

      {/* ── Section 3: score time-series with secondary Brush (D-18) ─── */}
      <section aria-labelledby="replay-results-series-heading">
        <h3
          id="replay-results-series-heading"
          className="mb-2 font-heading text-sm font-medium"
        >
          Score over time
        </h3>
        <ResponsiveContainer width="100%" height={220}>
          <LineChart
            data={visibleSeries}
            margin={{ top: 8, right: 12, left: 12, bottom: 4 }}
          >
            <CartesianGrid
              strokeDasharray="3 3"
              vertical={false}
              stroke="hsl(var(--border))"
            />
            <XAxis
              dataKey="ts"
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
              width={40}
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
              formatter={(value, name) => [
                name === 'score' && typeof value === 'number'
                  ? formatScore(value)
                  : String(value ?? ''),
                String(name ?? ''),
              ]}
            />
            {/* D-34 carve-out — animations allowed on post-end result chart. */}
            <Line
              type="monotone"
              dataKey="score"
              stroke="var(--color-primary)"
              dot={false}
              strokeWidth={1.5}
              isAnimationActive
            />
            {/* D-18 SECONDARY Brush — result-set rescrub, zero network. */}
            <Brush
              dataKey="ts"
              height={28}
              stroke="var(--color-primary)"
              tickFormatter={(v: number) => formatDateTime(new Date(v))}
              onChange={(range: {
                startIndex?: number;
                endIndex?: number;
              } | null) => {
                if (!range) return;
                const s = range.startIndex ?? 0;
                const e = range.endIndex ?? seriesData.length - 1;
                const fromTs = seriesData[s]?.ts;
                const toTs = seriesData[e]?.ts;
                if (fromTs !== undefined && toTs !== undefined) {
                  setBrushRange({ from: fromTs, to: toTs });
                }
              }}
            />
          </LineChart>
        </ResponsiveContainer>
      </section>
    </div>
  );
}
