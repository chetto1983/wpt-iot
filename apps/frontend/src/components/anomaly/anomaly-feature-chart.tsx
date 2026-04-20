'use client';

import { memo, useMemo } from 'react';
import { useTranslations } from 'next-intl';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  Cell,
} from 'recharts';
import type { IAnomalyLiveResponse } from '@wpt/types';

interface AnomalyFeatureChartProps {
  live: IAnomalyLiveResponse | null;
}

export const AnomalyFeatureChart = memo(function AnomalyFeatureChart({
  live,
}: AnomalyFeatureChartProps) {
  const t = useTranslations('dashboard');

  const criticalColor = typeof window !== 'undefined'
    ? getComputedStyle(document.documentElement).getPropertyValue('--severity-critical').trim()
    : 'oklch(0.577 0.245 27.3)';
  const mediumColor = typeof window !== 'undefined'
    ? getComputedStyle(document.documentElement).getPropertyValue('--severity-medium').trim()
    : 'oklch(0.58 0.179 59)';
  const lowColor = typeof window !== 'undefined'
    ? getComputedStyle(document.documentElement).getPropertyValue('--severity-low').trim()
    : 'oklch(0.56 0.158 242)';

  function barColor(z: number): string {
    if (z >= 3.5) return criticalColor;
    if (z >= 2.5) return mediumColor;
    return lowColor;
  }

  // Phase 40 D-13: route direction → warm/cool palette tokens. HIGH = warm (above EMA),
  // LOW = cool (below EMA). Both tokens already exist in the severity palette — no new hex.
  function contributionBarColor(direction: 'HIGH' | 'LOW' | null, value: number): string {
    if (direction === 'HIGH') return mediumColor;
    if (direction === 'LOW') return lowColor;
    return barColor(value);
  }

  const { data, mode: chartMode } = useMemo(() => {
    const contributors = live?.latest?.topContributors ?? [];
    // Phase 40 D-13: prefer contribution% when the detector populated it;
    // fall back to zScore for historical events (D-02, pre-Phase-40 rows).
    const useContribution = contributors.some((c) => c.contribution !== undefined);

    if (useContribution) {
      const points = contributors
        .filter((c) => c.contribution !== undefined && c.contribution > 0.001)
        .map((c) => ({
          name: t.has(`anomaly.featureChart.labels.${c.feature}`)
            ? t(`anomaly.featureChart.labels.${c.feature}`)
            : c.feature,
          // 0..100 percent for Pareto display.
          value: Number(((c.contribution ?? 0) * 100).toFixed(1)),
          direction: c.direction ?? null,
        }))
        .sort((a, b) => b.value - a.value);
      return { data: points, mode: 'contribution' as const };
    }

    // Fallback — historical row. Keep existing zScore behavior.
    const points = contributors
      .filter((c) => c.zScore >= 0.05)
      .map((c) => ({
        name: t.has(`anomaly.featureChart.labels.${c.feature}`)
          ? t(`anomaly.featureChart.labels.${c.feature}`)
          : c.feature,
        value: Number(c.zScore.toFixed(2)),
        direction: null as 'HIGH' | 'LOW' | null,
      }));
    return { data: points, mode: 'zscore' as const };
  }, [live, t]);

  if (data.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        {t('anomaly.featureChart.noData')}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {t('anomaly.featureChart.title')}
      </p>
      <ResponsiveContainer width="100%" height={Math.max(140, data.length * 28)}>
        <BarChart data={data} layout="vertical" margin={{ left: 0, right: 8, top: 4, bottom: 4 }}>
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
                const d = (entry?.payload as { direction?: 'HIGH' | 'LOW' | null } | undefined)?.direction;
                const label = d ? ` · ${d}` : '';
                return [`${Number(value).toFixed(1)}%${label}`, 'Contribution'];
              }
              return [`z = ${Number(value).toFixed(2)}`, 'Z-Score'];
            }}
          />
          {/* Reference lines only meaningful in zScore fallback mode */}
          {chartMode === 'zscore' && (
            <>
              <ReferenceLine x={2.5} stroke={mediumColor} strokeDasharray="3 3" strokeOpacity={0.5} />
              <ReferenceLine x={3.5} stroke={criticalColor} strokeDasharray="3 3" strokeOpacity={0.5} />
            </>
          )}
          <Bar dataKey="value" radius={[0, 4, 4, 0]} maxBarSize={20}>
            {data.map((entry, i) => (
              <Cell
                key={i}
                fill={
                  chartMode === 'contribution'
                    ? contributionBarColor(entry.direction, entry.value)
                    : barColor(entry.value)
                }
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
});
