'use client';

// Phase 43 D-26 — rendering helpers for DebugDrillSheet sections 1, 2, 4.
// Factored out of `debug-drill-sheet.tsx` purely to respect the 500-LOC
// cap (CLAUDE.md Hard Stops). The feature-accordion (hop 3) stays in the
// main file because it is the Sheet's most load-bearing surface and
// references the BLOCKER #3 grep targets directly.

import NextLink from 'next/link';
import { ExternalLink as ExternalLinkIcon } from 'lucide-react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { IMachineAnomalyEvent } from '@wpt/types';

import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import type {
  CycleStripRow,
  NearbyCycleStatus,
  UseMiniChartDataResult,
} from './debug-drill-hooks';

interface EventHeaderProps {
  event: IMachineAnomalyEvent;
  observedAtLabel: string;
}

export function DrillEventHeader({
  event,
  observedAtLabel,
}: EventHeaderProps) {
  return (
    <div className="space-y-2 rounded-md border border-border/60 bg-card p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Badge variant="outline">#{event.id}</Badge>
          <span className="font-mono text-sm font-semibold tabular-nums">
            score {event.score.toFixed(3)}
          </span>
          {event.flagged ? (
            <Badge severity="critical">FLAGGED</Badge>
          ) : (
            <Badge variant="secondary">OBSERVED</Badge>
          )}
          <Badge variant="outline">{event.modeKey}</Badge>
        </div>
        <span className="text-xs text-muted-foreground">
          {observedAtLabel}
        </span>
      </div>
      {event.topContributors.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {event.topContributors.slice(0, 3).map((c) => (
            <Badge key={c.feature} variant="secondary">
              <span className="font-mono text-xs">{c.feature}</span>
              {c.contribution !== undefined && (
                <span className="ml-1 tabular-nums text-muted-foreground">
                  {(c.contribution * 100).toFixed(1)}%
                </span>
              )}
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}

interface CycleStripProps {
  status: NearbyCycleStatus;
  cycle: CycleStripRow | null;
  labels: {
    notFound: string;
    active: string;
    loadFailed: string;
  };
  formatDateLabel: (d: Date) => string;
  formatDateTimeLabel: (d: Date) => string;
}

export function DrillCycleStrip({
  status,
  cycle,
  labels,
  formatDateLabel,
  formatDateTimeLabel,
}: CycleStripProps) {
  if (status === 'loading') return <Skeleton className="h-4 w-56" />;
  if (status === 'notFound') {
    return <p className="text-xs text-muted-foreground">{labels.notFound}</p>;
  }
  if (status === 'error') {
    return <p className="text-xs text-muted-foreground">{labels.loadFailed}</p>;
  }
  if (status === 'found' && cycle) {
    return (
      <div className="flex flex-wrap items-center gap-2 rounded-md border border-border/60 bg-card p-3 text-xs">
        <Badge variant="outline">#{cycle.cycleNumber}</Badge>
        <span className="tabular-nums">
          {formatDateLabel(new Date(cycle.startedAt))}{' '}
          {formatDateTimeLabel(new Date(cycle.startedAt)).split(' ')[1]}
        </span>
        <span className="text-muted-foreground">→</span>
        <span className="tabular-nums">
          {cycle.endedAt
            ? formatDateTimeLabel(new Date(cycle.endedAt))
            : labels.active}
        </span>
        {cycle.cycleStatusLabel && (
          <Badge variant="secondary">{cycle.cycleStatusLabel}</Badge>
        )}
      </div>
    );
  }
  return null;
}

interface MiniChartProps {
  mini: UseMiniChartDataResult;
  primaryFeature: string | null;
  chartLinkHref: string | null;
  labels: {
    sectionTitle: string;
    openInCharts: string;
    noPrimary: string;
  };
}

export function DrillMiniChart({
  mini,
  primaryFeature,
  chartLinkHref,
  labels,
}: MiniChartProps) {
  return (
    <>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="font-heading text-sm font-medium">
          {labels.sectionTitle}
          {primaryFeature && (
            <span className="ml-2 font-mono text-xs text-muted-foreground">
              {primaryFeature}
            </span>
          )}
        </h3>
        {chartLinkHref && (
          <NextLink
            href={chartLinkHref}
            className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
          >
            {labels.openInCharts}
            <ExternalLinkIcon className="size-3" />
          </NextLink>
        )}
      </div>
      {primaryFeature && mini.status === 'loading' && (
        <Skeleton className="h-[120px] w-full" />
      )}
      {primaryFeature && mini.status === 'error' && (
        <p className="text-xs text-muted-foreground">{mini.error}</p>
      )}
      {primaryFeature && mini.status === 'ok' && mini.data && (
        <ResponsiveContainer width="100%" height={120}>
          <LineChart
            data={mini.data.points}
            margin={{ top: 4, right: 8, left: 0, bottom: 0 }}
          >
            <CartesianGrid
              strokeDasharray="3 3"
              vertical={false}
              stroke="hsl(var(--border))"
            />
            <XAxis dataKey="timestamp" hide />
            <YAxis
              width={32}
              tick={{ fontSize: 10, fill: '#888' }}
              tickLine={false}
              axisLine={false}
            />
            <RechartsTooltip
              contentStyle={{
                background: 'hsl(var(--card))',
                border: '1px solid hsl(var(--border))',
                borderRadius: 8,
                fontSize: 12,
              }}
            />
            <Line
              type="monotone"
              dataKey={primaryFeature}
              stroke="var(--color-primary)"
              dot={false}
              strokeWidth={1.5}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      )}
      {!primaryFeature && (
        <p className="text-xs text-muted-foreground">{labels.noPrimary}</p>
      )}
    </>
  );
}
