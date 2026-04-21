'use client';

// Phase 43 D-05 + D-27 strict fork of anomaly-feature-chart.tsx.
//
// Engineer-facing Pareto contributor chart for /debug/detector. Differences
// from the operator-facing source:
//   - Raw feature keys — NO i18n translation via `t.has(...)` / `t(...)`
//     of feature names (D-05, D-29).
//   - Direct `contributors: IAnomalyContributor[]` prop (NOT
//     `IAnomalyLiveResponse | null`) — the debug surface feeds from
//     IDebugStateResponse.data.primary.contributors per Phase 42 D-12,
//     plus the replay Pareto (Plan 43-05 D-21) passes its own contributors.
//   - Optional `label` badge ("Current" vs "Replay (from — to)") so the
//     same component renders the two instances (D-21, one component two
//     instances — avoid a second fork).
//   - NEW `onBarClick?: (feature: string) => void` prop (WARNING #4
//     Pareto-bar drill entry). Cursor and click wiring are CONDITIONAL so
//     the chart keeps its non-interactive affordance when used without a
//     handler (e.g. the replay instance in Plan 43-05).
//   - isAnimationActive={false} on the Bar (D-34 live-mode discipline).
//
// The operator-facing anomaly-feature-chart.tsx stays byte-identical — do
// NOT edit it; do NOT import from the operator-facing component directory.

import { memo, useMemo } from 'react';
import {
  Bar,
  BarChart,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { IAnomalyContributor } from '@wpt/types';
import { Badge } from '@/components/ui/badge';

interface DebugContributorChartProps {
  /** Raw contributors. Primary section only — shadow view NEVER renders
   *  this component (D-04). */
  contributors: IAnomalyContributor[];
  /** Badge label. "Current" for live instance, "Replay (from — to)" for
   *  replay instance (D-21). */
  label?: string | null;
  /** Engineer-facing empty-state copy. Plan 43-06 supplies the key via
   *  the page, OR this component falls back to a raw English string —
   *  debugDetector.empty.noContributors. */
  emptyCopy?: string;
  /**
   * Fired when a Pareto bar is clicked, with the underlying feature key.
   * Plan 43-06 page.tsx wires this to open the drill-Sheet by looking up
   * the most-recent event where this feature is a top contributor.
   * D-25 drill entry (WARNING #4 user decision).
   *
   * When omitted, the chart renders as pure read-only (no pointer cursor,
   * no onClick on the Bar).
   */
  onBarClick?: (feature: string) => void;
}

interface ChartDatum {
  name: string;
  value: number;
  direction: 'HIGH' | 'LOW' | null;
}

export const DebugContributorChart = memo(function DebugContributorChart({
  contributors,
  label,
  emptyCopy = 'No contributors',
  onBarClick,
}: DebugContributorChartProps) {
  const criticalColor =
    typeof window !== 'undefined'
      ? getComputedStyle(document.documentElement)
          .getPropertyValue('--severity-critical')
          .trim()
      : 'oklch(0.577 0.245 27.3)';
  const mediumColor =
    typeof window !== 'undefined'
      ? getComputedStyle(document.documentElement)
          .getPropertyValue('--severity-medium')
          .trim()
      : 'oklch(0.58 0.179 59)';
  const lowColor =
    typeof window !== 'undefined'
      ? getComputedStyle(document.documentElement)
          .getPropertyValue('--severity-low')
          .trim()
      : 'oklch(0.56 0.158 242)';

  function barColor(z: number): string {
    if (z >= 3.5) return criticalColor;
    if (z >= 2.5) return mediumColor;
    return lowColor;
  }

  // Phase 40 D-13: route direction → warm/cool palette tokens. HIGH = warm
  // (above EMA), LOW = cool (below EMA). Both tokens already exist in the
  // severity palette — no new hex.
  function contributionBarColor(
    direction: 'HIGH' | 'LOW' | null,
    value: number,
  ): string {
    if (direction === 'HIGH') return mediumColor;
    if (direction === 'LOW') return lowColor;
    return barColor(value);
  }

  const { data, mode: chartMode } = useMemo<{
    data: ChartDatum[];
    mode: 'contribution' | 'zscore';
  }>(() => {
    // Phase 40 D-13: prefer contribution% when the detector populated it;
    // fall back to zScore for historical rows (pre-Phase-40).
    const useContribution = contributors.some(
      (c) => c.contribution !== undefined,
    );

    if (useContribution) {
      const points: ChartDatum[] = contributors
        .filter((c) => c.contribution !== undefined && c.contribution > 0.001)
        .map((c) => ({
          // Phase 43 D-05 + D-29 — engineer-facing, raw feature keys.
          name: c.feature,
          // 0..100 percent for Pareto display.
          value: Number(((c.contribution ?? 0) * 100).toFixed(1)),
          direction: c.direction ?? null,
        }))
        .sort((a, b) => b.value - a.value);
      return { data: points, mode: 'contribution' };
    }

    // Fallback — historical row. Keep existing zScore behaviour.
    const points: ChartDatum[] = contributors
      .filter((c) => c.zScore >= 0.05)
      .map((c) => ({
        name: c.feature,
        value: Number(c.zScore.toFixed(2)),
        direction: null,
      }));
    return { data: points, mode: 'zscore' };
  }, [contributors]);

  if (data.length === 0) {
    return (
      <div className="space-y-2">
        {label ? (
          <div>
            <Badge variant="secondary">{label}</Badge>
          </div>
        ) : null}
        <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
          {emptyCopy}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {label ? (
        <div>
          <Badge variant="secondary">{label}</Badge>
        </div>
      ) : null}
      <ResponsiveContainer
        width="100%"
        height={Math.max(140, Math.min(320, data.length * 28))}
      >
        <BarChart
          data={data}
          layout="vertical"
          margin={{ left: 0, right: 8, top: 4, bottom: 4 }}
        >
          <XAxis
            type="number"
            domain={chartMode === 'contribution' ? [0, 100] : [0, 'auto']}
            tick={{ fontSize: 10, fill: '#888' }}
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            type="category"
            dataKey="name"
            tick={{ fontSize: 11, fill: '#aaa' }}
            tickLine={false}
            axisLine={false}
            width={95}
          />
          <Tooltip
            contentStyle={{
              background: 'hsl(var(--card))',
              border: '1px solid hsl(var(--border))',
              borderRadius: 8,
              fontSize: 12,
            }}
            formatter={(value, _name, entry) => {
              if (chartMode === 'contribution') {
                const d = (
                  entry?.payload as
                    | { direction?: 'HIGH' | 'LOW' | null }
                    | undefined
                )?.direction;
                const labelSuffix = d ? ` · ${d}` : '';
                return [
                  `${Number(value).toFixed(1)}%${labelSuffix}`,
                  'Contribution',
                ];
              }
              return [`z = ${Number(value).toFixed(2)}`, 'Z-Score'];
            }}
          />
          {/* Reference lines only meaningful in zScore fallback mode */}
          {chartMode === 'zscore' && (
            <>
              <ReferenceLine
                x={2.5}
                stroke={mediumColor}
                strokeDasharray="3 3"
                strokeOpacity={0.5}
              />
              <ReferenceLine
                x={3.5}
                stroke={criticalColor}
                strokeDasharray="3 3"
                strokeOpacity={0.5}
              />
            </>
          )}
          {/* WARNING #4 drill entry: onClick fires with the raw feature
           *  key when onBarClick is provided. Cursor + role/aria on the
           *  cells flip to affordance mode only then. */}
          <Bar
            dataKey="value"
            radius={[0, 4, 4, 0]}
            maxBarSize={20}
            isAnimationActive={false}
            cursor={onBarClick ? 'pointer' : undefined}
            onClick={
              onBarClick
                ? (entry: { name?: string }) => {
                    if (entry?.name) onBarClick(entry.name);
                  }
                : undefined
            }
          >
            {data.map((entry, i) => (
              <Cell
                key={i}
                fill={
                  chartMode === 'contribution'
                    ? contributionBarColor(entry.direction, entry.value)
                    : barColor(entry.value)
                }
                role={onBarClick ? 'button' : undefined}
                aria-label={
                  onBarClick
                    ? `Open drill-down for ${entry.name}`
                    : undefined
                }
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
});
