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
    : 'oklch(0.666 0.179 58.9)';
  const lowColor = typeof window !== 'undefined'
    ? getComputedStyle(document.documentElement).getPropertyValue('--severity-low').trim()
    : 'oklch(0.588 0.158 242.0)';

  function barColor(z: number): string {
    if (z >= 3.5) return criticalColor;
    if (z >= 2.5) return mediumColor;
    return lowColor;
  }

  const data = useMemo(() => {
    const contributors = live?.latest?.topContributors ?? [];
    return contributors
      .filter((c) => c.zScore >= 0.05)
      .map((c) => ({
        name: t.has(`anomaly.featureChart.labels.${c.feature}`)
          ? t(`anomaly.featureChart.labels.${c.feature}`)
          : c.feature,
        zScore: Number(c.zScore.toFixed(2)),
      }));
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
            domain={[0, 'auto']}
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
            formatter={(value) => [`z = ${Number(value).toFixed(2)}`, 'Z-Score']}
          />
          <ReferenceLine x={2.5} stroke={mediumColor} strokeDasharray="3 3" strokeOpacity={0.5} />
          <ReferenceLine x={3.5} stroke={criticalColor} strokeDasharray="3 3" strokeOpacity={0.5} />
          <Bar dataKey="zScore" radius={[0, 4, 4, 0]} maxBarSize={20}>
            {data.map((entry, i) => (
              <Cell key={i} fill={barColor(entry.zScore)} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
});
