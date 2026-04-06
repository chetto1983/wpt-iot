'use client';

import React, { useMemo } from 'react';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  BarChart,
  Bar,
  AreaChart,
  Area,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from 'recharts';
import { format } from 'date-fns';
import { ErrorBoundary } from 'react-error-boundary';
import { useTranslations } from 'next-intl';
import { AlertCircle } from 'lucide-react';
import type { ChartType, IPanelConfig } from '@wpt/types';
import { CHART_COLORS } from '@/lib/chart-colors';
import { getFieldLabel } from '@/lib/field-labels';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';

/* ========================================================================
 * Grafana-style chart constants
 * Tuned to match Grafana's default time series panel:
 *  - 11px tabular numerics for axis ticks (Grafana uses 11)
 *  - 2px stroke for series, no dots, monotone interpolation
 *  - Legend at bottom, 12px max height when single row
 *  - Subtle horizontal-only grid lines (no vertical) like Grafana default
 *  - Tooltip uses card bg with 1px border, 6px radius
 * ====================================================================== */

const AXIS_TICK = {
  fill: 'var(--color-muted-foreground)',
  fontSize: 11,
  fontVariantNumeric: 'tabular-nums' as const,
};

const TOOLTIP_STYLE = {
  backgroundColor: 'var(--color-popover)',
  border: '1px solid var(--color-border)',
  borderRadius: 6,
  padding: '6px 10px',
  fontSize: 12,
  boxShadow: '0 6px 24px -6px rgba(0,0,0,0.45)',
};

const TOOLTIP_LABEL_STYLE = {
  color: 'var(--color-muted-foreground)',
  fontSize: 11,
  marginBottom: 4,
  fontWeight: 500,
};

const TOOLTIP_ITEM_STYLE = {
  fontSize: 12,
  padding: '2px 0',
};

const LEGEND_STYLE = {
  fontSize: 11,
  paddingTop: 4,
};

const CHART_MARGIN = { top: 8, right: 12, left: 4, bottom: 0 };

function PanelErrorFallback({ resetErrorBoundary }: { resetErrorBoundary: () => void }) {
  const t = useTranslations('dashboards');
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-4">
      <AlertCircle className="size-6 text-destructive" />
      <p className="text-sm text-destructive">{t('panelError')}</p>
      <Button variant="outline" size="sm" onClick={resetErrorBoundary}>
        {t('retryPanel')}
      </Button>
    </div>
  );
}

function formatTick(epochMs: number, resolution: string): string {
  const d = new Date(epochMs);
  if (resolution === 'raw') return format(d, 'HH:mm:ss');
  if (resolution === '5min') return format(d, 'HH:mm');
  return format(d, 'dd/MM HH:mm');
}

function formatTooltipLabel(epochMs: number, resolution: string): string {
  const d = new Date(epochMs);
  if (resolution === 'raw') return format(d, 'dd/MM HH:mm:ss');
  if (resolution === '5min') return format(d, 'dd/MM HH:mm');
  return format(d, 'dd/MM/yyyy HH:mm');
}

interface PanelChartProps {
  chartType: ChartType;
  config: IPanelConfig;
  data: Array<Record<string, number | string>>;
  resolution: 'raw' | '5min' | '1h';
  locale: 'it' | 'en';
  loading?: boolean;
}

export const PanelChart = React.memo(function PanelChart({
  chartType,
  config,
  data,
  resolution,
  locale,
  loading,
}: PanelChartProps) {
  if (loading) {
    return <Skeleton className="h-full w-full" />;
  }

  if (data.length === 0) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <p className="text-xs text-muted-foreground">No data</p>
      </div>
    );
  }

  return (
    <ErrorBoundary FallbackComponent={PanelErrorFallback}>
      {chartType === 'pie' ? (
        <PieChartRenderer config={config} data={data} locale={locale} />
      ) : (
        <TimeSeriesRenderer
          chartType={chartType}
          config={config}
          data={data}
          resolution={resolution}
          locale={locale}
        />
      )}
    </ErrorBoundary>
  );
});

/* ----- Pie Chart (aggregated averages) ----- */

function PieChartRenderer({
  config,
  data,
  locale,
}: {
  config: IPanelConfig;
  data: Array<Record<string, number | string>>;
  locale: 'it' | 'en';
}) {
  const pieData = useMemo(() => {
    return config.fields.map((field, i) => {
      let sum = 0;
      let count = 0;
      for (const row of data) {
        const val = row[field];
        if (typeof val === 'number') {
          sum += val;
          count++;
        }
      }
      return {
        name: getFieldLabel(field, locale),
        value: count > 0 ? Math.round((sum / count) * 100) / 100 : 0,
        color: CHART_COLORS[i % CHART_COLORS.length]!,
      };
    });
  }, [config.fields, data, locale]);

  return (
    <ResponsiveContainer width="100%" height="100%">
      <PieChart margin={{ top: 4, right: 4, left: 4, bottom: 4 }}>
        <Pie
          data={pieData}
          dataKey="value"
          nameKey="name"
          cx="50%"
          cy="50%"
          outerRadius="72%"
          stroke="var(--color-card)"
          strokeWidth={2}
        >
          {pieData.map((entry, i) => (
            <Cell key={i} fill={entry.color} />
          ))}
        </Pie>
        <Tooltip
          contentStyle={TOOLTIP_STYLE}
          itemStyle={TOOLTIP_ITEM_STYLE}
          labelStyle={TOOLTIP_LABEL_STYLE}
        />
        {config.showLegend && <Legend wrapperStyle={LEGEND_STYLE} iconSize={8} iconType="circle" />}
      </PieChart>
    </ResponsiveContainer>
  );
}

/* ----- Time-series charts (Line / Bar / Area) ----- */

function TimeSeriesRenderer({
  chartType,
  config,
  data,
  resolution,
  locale,
}: {
  chartType: 'line' | 'bar' | 'area';
  config: IPanelConfig;
  data: Array<Record<string, number | string>>;
  resolution: string;
  locale: 'it' | 'en';
}) {
  const yDomain: [number | string, number | string] = config.yAxisRange
    ? [config.yAxisRange.min, config.yAxisRange.max]
    : ['auto', 'auto'];

  // Sort data ascending by timestamp — defensive against backend ordering bugs.
  const sortedData = useMemo(() => {
    return [...data].sort(
      (a, b) => Number(a['timestamp']) - Number(b['timestamp']),
    );
  }, [data]);

  const sharedAxes = (
    <>
      {config.showGrid && (
        <CartesianGrid
          strokeDasharray="2 4"
          stroke="var(--color-border)"
          vertical={false}
        />
      )}
      <XAxis
        dataKey="timestamp"
        type="number"
        scale="time"
        domain={['dataMin', 'dataMax']}
        tickFormatter={(v: number) => formatTick(v, resolution)}
        tick={AXIS_TICK}
        tickLine={{ stroke: 'var(--color-border)' }}
        axisLine={{ stroke: 'var(--color-border)' }}
        minTickGap={48}
        height={20}
      />
      <YAxis
        domain={yDomain}
        tick={AXIS_TICK}
        tickLine={false}
        axisLine={false}
        width={36}
      />
      <Tooltip
        labelFormatter={(v) => formatTooltipLabel(v as number, resolution)}
        contentStyle={TOOLTIP_STYLE}
        itemStyle={TOOLTIP_ITEM_STYLE}
        labelStyle={TOOLTIP_LABEL_STYLE}
        cursor={{ stroke: 'var(--color-border)', strokeWidth: 1, strokeDasharray: '3 3' }}
      />
      {config.showLegend && (
        <Legend
          wrapperStyle={LEGEND_STYLE}
          iconSize={8}
          iconType="circle"
          height={20}
        />
      )}
    </>
  );

  if (chartType === 'line') {
    return (
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={sortedData} margin={CHART_MARGIN}>
          {sharedAxes}
          {config.fields.map((field, i) => (
            <Line
              key={field}
              type="monotone"
              dataKey={field}
              stroke={CHART_COLORS[i % CHART_COLORS.length]}
              dot={false}
              activeDot={{ r: 4, strokeWidth: 0 }}
              strokeWidth={2}
              name={getFieldLabel(field, locale)}
              isAnimationActive={false}
              connectNulls
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    );
  }

  if (chartType === 'bar') {
    return (
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={sortedData} margin={CHART_MARGIN}>
          {sharedAxes}
          {config.fields.map((field, i) => (
            <Bar
              key={field}
              dataKey={field}
              fill={CHART_COLORS[i % CHART_COLORS.length]}
              name={getFieldLabel(field, locale)}
              stackId={config.stacked ? 'stack' : undefined}
              isAnimationActive={false}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    );
  }

  // area
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={sortedData} margin={CHART_MARGIN}>
        {sharedAxes}
        {config.fields.map((field, i) => (
          <Area
            key={field}
            type="monotone"
            dataKey={field}
            stroke={CHART_COLORS[i % CHART_COLORS.length]}
            fill={CHART_COLORS[i % CHART_COLORS.length]}
            fillOpacity={0.18}
            strokeWidth={2}
            name={getFieldLabel(field, locale)}
            stackId={config.stacked ? 'stack' : undefined}
            isAnimationActive={false}
            connectNulls
          />
        ))}
      </AreaChart>
    </ResponsiveContainer>
  );
}
