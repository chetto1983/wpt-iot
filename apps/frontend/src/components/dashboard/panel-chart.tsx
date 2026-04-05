'use client';

import { useMemo } from 'react';
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
import type { ChartType, IPanelConfig } from '@wpt/types';
import { getFieldLabel } from '@/lib/field-labels';
import { Skeleton } from '@/components/ui/skeleton';

const CHART_COLORS = [
  'var(--color-chart-1)',
  'var(--color-chart-2)',
  'var(--color-chart-3)',
  '#3498db',
  '#9b59b6',
  '#f39c12',
  '#2ecc71',
  '#e67e22',
];

function formatTick(epochMs: number, resolution: string): string {
  const d = new Date(epochMs);
  if (resolution === 'raw') return format(d, 'HH:mm:ss');
  if (resolution === '5min') return format(d, 'HH:mm');
  return format(d, 'dd/MM HH:mm');
}

interface PanelChartProps {
  chartType: ChartType;
  config: IPanelConfig;
  data: Array<Record<string, number | string>>;
  resolution: 'raw' | '5min' | '1h';
  locale: 'it' | 'en';
  loading?: boolean;
}

export function PanelChart({
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
        <p className="text-sm text-muted-foreground">No data</p>
      </div>
    );
  }

  if (chartType === 'pie') {
    return (
      <PieChartRenderer
        config={config}
        data={data}
        locale={locale}
      />
    );
  }

  return (
    <TimeSeriesRenderer
      chartType={chartType}
      config={config}
      data={data}
      resolution={resolution}
      locale={locale}
    />
  );
}

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
      <PieChart>
        <Pie
          data={pieData}
          dataKey="value"
          nameKey="name"
          cx="50%"
          cy="50%"
          outerRadius="70%"
        >
          {pieData.map((entry, i) => (
            <Cell key={i} fill={entry.color} />
          ))}
        </Pie>
        <Tooltip />
        {config.showLegend && <Legend />}
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
  const tooltipStyle = {
    backgroundColor: 'var(--color-card)',
    border: '1px solid var(--color-border)',
    color: 'var(--color-foreground)',
    borderRadius: '8px',
  };

  const tickStyle = {
    fill: 'var(--color-muted-foreground)',
    fontSize: 11,
  };

  const yDomain: [number | string, number | string] = config.yAxisRange
    ? [config.yAxisRange.min, config.yAxisRange.max]
    : ['auto', 'auto'];

  const sharedChildren = (
    <>
      {config.showGrid && (
        <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
      )}
      <XAxis
        dataKey="timestamp"
        type="number"
        domain={['dataMin', 'dataMax']}
        tickFormatter={(v: number) => formatTick(v, resolution)}
        tick={tickStyle}
      />
      <YAxis domain={yDomain} tick={tickStyle} />
      <Tooltip
        labelFormatter={(v) => formatTick(v as number, resolution)}
        contentStyle={tooltipStyle}
      />
      {config.showLegend && <Legend />}
    </>
  );

  if (chartType === 'line') {
    return (
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data}>
          {sharedChildren}
          {config.fields.map((field, i) => (
            <Line
              key={field}
              type="monotone"
              dataKey={field}
              stroke={CHART_COLORS[i % CHART_COLORS.length]}
              dot={false}
              strokeWidth={2}
              name={getFieldLabel(field, locale)}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    );
  }

  if (chartType === 'bar') {
    return (
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data}>
          {sharedChildren}
          {config.fields.map((field, i) => (
            <Bar
              key={field}
              dataKey={field}
              fill={CHART_COLORS[i % CHART_COLORS.length]}
              name={getFieldLabel(field, locale)}
              stackId={config.stacked ? 'stack' : undefined}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    );
  }

  // area
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data}>
        {sharedChildren}
        {config.fields.map((field, i) => (
          <Area
            key={field}
            type="monotone"
            dataKey={field}
            stroke={CHART_COLORS[i % CHART_COLORS.length]}
            fill={CHART_COLORS[i % CHART_COLORS.length]}
            fillOpacity={0.3}
            name={getFieldLabel(field, locale)}
            stackId={config.stacked ? 'stack' : undefined}
          />
        ))}
      </AreaChart>
    </ResponsiveContainer>
  );
}
