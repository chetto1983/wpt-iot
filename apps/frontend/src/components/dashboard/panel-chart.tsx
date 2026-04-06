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
import {
  aggregateField,
  fieldsShareUnit,
  formatValue,
  getFieldUnit,
} from '@/lib/field-units';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { AlertTriangle } from 'lucide-react';

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

/* ----- Pie Chart -------------------------------------------------------
 * Pie charts only make sense when all selected fields share a unit
 * (e.g., 3 phase currents in Amperes, 4 thermos in °C). Otherwise we
 * refuse to render and show a warning instead — the previous version
 * silently averaged kWh + L + °C, producing meaningless slices.
 *
 * Aggregation per field comes from field-units.ts:
 *   - Counters (energy, water): last - first  → "consumed during window"
 *   - Instantaneous readings:   average       → "typical value"
 *   - Sums:                     total         → "total over window"
 *
 * Slices with value <= 0 are skipped (recharts can't render zero arcs).
 * --------------------------------------------------------------------- */
function PieChartRenderer({
  config,
  data,
  locale,
}: {
  config: IPanelConfig;
  data: Array<Record<string, number | string>>;
  locale: 'it' | 'en';
}) {
  const t = useTranslations('dashboards');
  const sharedUnit = fieldsShareUnit(config.fields);
  const unitLabel = config.fields[0] ? getFieldUnit(config.fields[0]).unit : '';

  const pieData = useMemo(() => {
    if (!sharedUnit) return [];
    return config.fields
      .map((field, i) => ({
        field,
        name: getFieldLabel(field, locale),
        value: aggregateField(field, data),
        color: CHART_COLORS[i % CHART_COLORS.length]!,
      }))
      .filter((d) => d.value > 0);
  }, [config.fields, data, locale, sharedUnit]);

  if (!sharedUnit) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-2 px-4 text-center">
        <AlertTriangle className="size-6 text-wpt-gold" />
        <p className="text-sm font-medium">{t('pieMixedUnitsTitle')}</p>
        <p className="text-xs text-muted-foreground">
          {t('pieMixedUnitsHint')}
        </p>
      </div>
    );
  }

  if (pieData.length === 0) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <p className="text-xs text-muted-foreground">No data</p>
      </div>
    );
  }

  const total = pieData.reduce((a, b) => a + b.value, 0);

  return (
    <ResponsiveContainer width="100%" height="100%">
      <PieChart margin={{ top: 4, right: 4, left: 4, bottom: 4 }}>
        <Pie
          data={pieData}
          dataKey="value"
          nameKey="name"
          cx="50%"
          cy="50%"
          innerRadius="40%"
          outerRadius="72%"
          paddingAngle={1}
          stroke="var(--color-card)"
          strokeWidth={2}
          isAnimationActive={false}
          label={({ value }: { value: number }) => {
            const pct = total > 0 ? Math.round((value / total) * 100) : 0;
            return pct >= 5 ? `${pct}%` : '';
          }}
          labelLine={false}
        >
          {pieData.map((entry) => (
            <Cell key={entry.field} fill={entry.color} />
          ))}
        </Pie>
        <Tooltip
          contentStyle={TOOLTIP_STYLE}
          itemStyle={TOOLTIP_ITEM_STYLE}
          labelStyle={TOOLTIP_LABEL_STYLE}
          formatter={(value: unknown, _name: unknown, entry: unknown): [string, string] => {
            const num = typeof value === 'number' ? value : Number(value);
            const fld =
              ((entry as { payload?: { field?: string } } | undefined)?.payload?.field) ?? '';
            const pct = total > 0 ? ((num / total) * 100).toFixed(1) : '0';
            return [`${formatValue(num, fld)} (${pct}%)`, getFieldLabel(fld, locale)];
          }}
        />
        {config.showLegend && (
          <Legend
            wrapperStyle={LEGEND_STYLE}
            iconSize={8}
            iconType="circle"
            formatter={(value) => `${value}${unitLabel ? ` (${unitLabel})` : ''}`}
          />
        )}
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

  // Y-axis unit suffix only when ALL selected fields share the same unit.
  // Mixed units fall back to no suffix (we don't pretend the axis means a
  // single thing). The tooltip still shows per-series units.
  const sharedUnit = fieldsShareUnit(config.fields);
  const yUnit = sharedUnit && config.fields[0] ? getFieldUnit(config.fields[0]).unit : '';
  const yTickFormatter = (v: number): string => {
    if (!Number.isFinite(v)) return '';
    // Compact large numbers (>1000 → "1.2k", >1e6 → "1.2M") to keep axis tight
    const abs = Math.abs(v);
    let label: string;
    if (abs >= 1e6) label = (v / 1e6).toFixed(1) + 'M';
    else if (abs >= 1000) label = (v / 1000).toFixed(1) + 'k';
    else label = Number.isInteger(v) ? String(v) : v.toFixed(1);
    return yUnit ? `${label} ${yUnit}` : label;
  };

  const tooltipFormatter = (
    value: unknown,
    name: unknown,
    entry: unknown,
  ): [string, string] => {
    const field = String(
      (entry as { dataKey?: string | number } | undefined)?.dataKey ?? '',
    );
    const num = typeof value === 'number' ? value : Number(value);
    return [formatValue(num, field), String(name ?? field)];
  };

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
        tickFormatter={yTickFormatter}
        width={yUnit ? 56 : 44}
      />
      <Tooltip
        labelFormatter={(v) => formatTooltipLabel(v as number, resolution)}
        formatter={tooltipFormatter}
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
