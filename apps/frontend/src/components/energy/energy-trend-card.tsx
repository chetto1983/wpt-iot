'use client';

import { useEffect, useState } from 'react';
import { format } from 'date-fns';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useTranslations } from 'next-intl';
import { CHART_COLORS } from '@/lib/chart-colors';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import type { EnergyMetric, EnergyBucket, IEnergyAggregateResponse } from '@wpt/types';

export function selectEnergyBucket(
  from: Date,
  to: Date,
  preset: 'last7d' | 'last30d' | 'last12mo' | 'custom',
): EnergyBucket {
  if (preset === 'last12mo') return 'day';
  const spanMs = to.getTime() - from.getTime();
  const threeDaysMs = 3 * 24 * 60 * 60 * 1000;
  const fortyFiveDaysMs = 45 * 24 * 60 * 60 * 1000;
  if (spanMs <= threeDaysMs) return '5min';
  if (spanMs <= fortyFiveDaysMs) return 'hour';
  return 'day';
}

export function buildEnergyAggregatePath(
  from: Date,
  to: Date,
  preset: 'last7d' | 'last30d' | 'last12mo' | 'custom',
): string {
  const params = new URLSearchParams({
    bucket: selectEnergyBucket(from, to, preset),
    from: from.toISOString(),
    to: to.toISOString(),
  });
  return `/api/energy/aggregate?${params.toString()}`;
}

interface EnergyTrendCardProps {
  aggregate: IEnergyAggregateResponse | null;
  metric: EnergyMetric;
  loading: boolean;
  error: string | null;
  onMetricChange: (metric: EnergyMetric) => void;
}

export function EnergyTrendCard({
  aggregate,
  metric,
  loading,
  error,
  onMetricChange,
}: EnergyTrendCardProps) {
  const t = useTranslations('energy');
  const [chartReady, setChartReady] = useState(false);

  useEffect(() => {
    setChartReady(true);
  }, []);

  const rows =
    aggregate?.rows.map((row) => {
      const bucketDate = new Date(row.bucket);
      return {
      timestamp: bucketDate.getTime(),
      label:
        aggregate.bucket === 'day'
          ? format(bucketDate, 'dd/MM')
          : aggregate.bucket === 'hour'
            ? format(bucketDate, 'dd/MM HH:mm')
            : format(bucketDate, 'HH:mm'),
      kwh: row.kwhDelta,
      eur: row.costEur,
      kgco2: row.co2Kg,
    };
    }) ?? [];

  const metricLabel = t(`trend.metrics.${metric}`);

  return (
    <Card className="min-w-0 border border-border/70">
      <CardHeader className="gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <CardDescription>{t('trend.kicker')}</CardDescription>
            <CardTitle>{t('trend.title')}</CardTitle>
          </div>
          <div className="flex flex-wrap gap-2">
            {(['kwh', 'eur', 'kgco2'] as const).map((nextMetric) => (
              <Button
                key={nextMetric}
                type="button"
                size="sm"
                variant={metric === nextMetric ? 'default' : 'outline'}
                onClick={() => onMetricChange(nextMetric)}
              >
                {t(`trend.metrics.${nextMetric}`)}
              </Button>
            ))}
          </div>
        </div>
        <CardDescription>
          {aggregate
            ? t('trend.summary', {
                count: aggregate.rows.length,
                bucket: aggregate.bucket,
                metric: metricLabel,
              })
            : t('trend.description')}
        </CardDescription>
      </CardHeader>
      <CardContent className="min-w-0 space-y-4">
        {loading || !chartReady ? (
          <Skeleton className="h-[280px] w-full" />
        ) : error ? (
          <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-4 text-sm text-destructive">
            {error}
          </div>
        ) : rows.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border/70 p-6 text-sm text-muted-foreground">
            {t('trend.empty')}
          </div>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">{metricLabel}</p>
            <div className="min-w-0 h-[280px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={rows} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis
                    dataKey="timestamp"
                    type="number"
                    domain={['dataMin', 'dataMax']}
                    tickFormatter={(value: number) => {
                      const point = rows.find((row) => row.timestamp === value);
                      return point?.label ?? '';
                    }}
                    tick={{ fill: 'var(--color-muted-foreground)', fontSize: 12 }}
                  />
                  <YAxis
                    tick={{ fill: 'var(--color-muted-foreground)', fontSize: 12 }}
                    width={56}
                  />
                  <Tooltip
                    labelFormatter={(value) => {
                      const point = rows.find((row) => row.timestamp === value);
                      return point?.label ?? String(value);
                    }}
                    formatter={(value) => [String(Number(value).toFixed(metric === 'eur' ? 2 : 1)), metricLabel]}
                    contentStyle={{
                      backgroundColor: 'var(--color-card)',
                      border: '1px solid var(--color-border)',
                      borderRadius: '12px',
                    }}
                  />
                  <Line
                    type="monotone"
                    dataKey={metric}
                    stroke={CHART_COLORS[0]}
                    strokeWidth={2.5}
                    dot={false}
                    isAnimationActive={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
