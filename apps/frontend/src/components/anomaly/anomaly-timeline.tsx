'use client';

import { memo } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts';

export interface ITimelinePoint {
  time: string;
  score: number;
  flagged: boolean;
}

interface AnomalyTimelineProps {
  history: ITimelinePoint[];
  warningThreshold?: number;
  criticalThreshold?: number;
}

export const AnomalyTimeline = memo(function AnomalyTimeline({
  history,
  warningThreshold = 2.5,
  criticalThreshold = 3.5,
}: AnomalyTimelineProps) {
  const t = useTranslations('dashboard');
  const locale = useLocale();

  if (history.length < 2) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        {t('anomaly.timeline.collecting')}
      </div>
    );
  }

  const fmt = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  return (
    <div className="space-y-2">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {t('anomaly.timeline.title')}
      </p>
      <ResponsiveContainer width="100%" height={200}>
        <AreaChart data={history} margin={{ left: 0, right: 8, top: 4, bottom: 4 }}>
          <defs>
            <linearGradient id="scoreGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#1ABC9C" stopOpacity={0.3} />
              <stop offset="100%" stopColor="#1ABC9C" stopOpacity={0} />
            </linearGradient>
          </defs>
          <XAxis
            dataKey="time"
            tickFormatter={(v: string) => fmt.format(new Date(v))}
            tick={{ fontSize: 10, fill: '#888' }}
            tickLine={false}
            axisLine={false}
            interval="preserveStartEnd"
            minTickGap={60}
          />
          <YAxis
            domain={[0, 'auto']}
            tick={{ fontSize: 10, fill: '#888' }}
            tickLine={false}
            axisLine={false}
            width={30}
          />
          <Tooltip
            contentStyle={{
              background: 'hsl(var(--card))',
              border: '1px solid hsl(var(--border))',
              borderRadius: 8,
              fontSize: 12,
            }}
            labelFormatter={(v) => fmt.format(new Date(String(v)))}
            formatter={(value) => [Number(value).toFixed(2), 'Score']}
          />
          <ReferenceLine
            y={warningThreshold}
            stroke="#f59e0b"
            strokeDasharray="4 4"
            strokeOpacity={0.6}
            label={{ value: 'W', position: 'right', fontSize: 9, fill: '#f59e0b' }}
          />
          <ReferenceLine
            y={criticalThreshold}
            stroke="#dc3545"
            strokeDasharray="4 4"
            strokeOpacity={0.6}
            label={{ value: 'C', position: 'right', fontSize: 9, fill: '#dc3545' }}
          />
          <Area
            type="monotone"
            dataKey="score"
            stroke="#1ABC9C"
            strokeWidth={2}
            fill="url(#scoreGrad)"
            dot={false}
            activeDot={{ r: 4, fill: '#1ABC9C', stroke: '#282828', strokeWidth: 2 }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
});
