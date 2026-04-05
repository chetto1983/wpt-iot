'use client';

import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import type { DateRange } from 'react-day-picker';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  Brush,
  ReferenceArea,
} from 'recharts';
import { format } from 'date-fns';
import { useTranslations } from 'next-intl';
import { useQueryStates, parseAsString } from 'nuqs';
import { TrendingUp, CalendarDays, Loader2, Maximize2, Minimize2, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';

import { useAuth } from '@/lib/auth-context';
import { apiFetch } from '@/lib/api';
import { getFieldLabel } from '@/lib/field-labels';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { DateRangePicker } from '@/components/date-range-picker';
import { FieldSelector, getChartableFields } from '@/components/field-selector';

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

interface IChartResponse {
  resolution: 'raw' | '5min' | '1h';
  points: Array<Record<string, number>>;
}

function buildDateTimeISO(date: Date, time: string): string {
  const [h, m] = time.split(':').map(Number);
  const d = new Date(date);
  d.setHours(h ?? 0, m ?? 0, 0, 0);
  return d.toISOString();
}

function formatTick(epochMs: number, resolution: string): string {
  const d = new Date(epochMs);
  if (resolution === 'raw') return format(d, 'HH:mm:ss');
  if (resolution === '5min') return format(d, 'HH:mm');
  return format(d, 'dd/MM HH:mm');
}

export default function ChartsPage() {
  const t = useTranslations('charts');
  const { user } = useAuth();
  const locale = (user?.language ?? 'it') as 'it' | 'en';
  const role = user?.role ?? 'CLIENT';

  const [filters, setFilters] = useQueryStates({
    from: parseAsString,
    to: parseAsString,
    fromTime: parseAsString.withDefault('00:00'),
    toTime: parseAsString.withDefault('23:59'),
  });

  const dateRange: DateRange | undefined = filters.from && filters.to
    ? { from: new Date(filters.from), to: new Date(filters.to) }
    : undefined;

  const setDateRange = useCallback((range: DateRange | undefined) => {
    void setFilters({
      from: range?.from ? range.from.toISOString().split('T')[0] : null,
      to: range?.to ? range.to.toISOString().split('T')[0] : null,
    });
  }, [setFilters]);

  const setFromTime = useCallback((v: string) => { void setFilters({ fromTime: v }); }, [setFilters]);
  const setToTime = useCallback((v: string) => { void setFilters({ toTime: v }); }, [setFilters]);

  const [selectedFields, setSelectedFields] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [chartData, setChartData] = useState<IChartResponse | null>(null);
  const [fullscreen, setFullscreen] = useState(false);

  // AbortController ref for cancelling in-flight chart requests
  const abortRef = useRef<AbortController | null>(null);

  // Cleanup on unmount
  useEffect(() => {
    return () => { abortRef.current?.abort(); };
  }, []);

  // Zoom state (Grafana-style click+drag to zoom)
  const [zoomLeft, setZoomLeft] = useState<number | null>(null);
  const [zoomRight, setZoomRight] = useState<number | null>(null);
  const [xDomain, setXDomain] = useState<[number, number] | null>(null);

  // Escape key exits fullscreen
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && fullscreen) setFullscreen(false);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [fullscreen]);

  const resetZoom = useCallback(() => {
    setXDomain(null);
    setZoomLeft(null);
    setZoomRight(null);
  }, []);

  const handleMouseDown = useCallback(
    (e: { activeLabel?: string | number }) => {
      if (e?.activeLabel != null) setZoomLeft(Number(e.activeLabel));
    },
    [],
  );

  const handleMouseMove = useCallback(
    (e: { activeLabel?: string | number }) => {
      if (zoomLeft != null && e?.activeLabel != null)
        setZoomRight(Number(e.activeLabel));
    },
    [zoomLeft],
  );

  const handleMouseUp = useCallback(() => {
    if (zoomLeft != null && zoomRight != null && zoomLeft !== zoomRight) {
      const left = Math.min(zoomLeft, zoomRight);
      const right = Math.max(zoomLeft, zoomRight);
      setXDomain([left, right]);
    }
    setZoomLeft(null);
    setZoomRight(null);
  }, [zoomLeft, zoomRight]);

  const fieldLabels = useMemo(() => {
    const fields = getChartableFields(role);
    const labels: Record<string, string> = {};
    for (const f of fields) {
      labels[f] = getFieldLabel(f, locale);
    }
    return labels;
  }, [role, locale]);

  const generateChart = useCallback(async () => {
    if (!dateRange?.from || !dateRange?.to || selectedFields.length === 0) return;

    // Abort any previous in-flight request
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    setChartData(null);

    try {
      const params = new URLSearchParams({
        from: buildDateTimeISO(dateRange.from, filters.fromTime),
        to: buildDateTimeISO(dateRange.to, filters.toTime),
        fields: selectedFields.join(','),
      });

      const data = await apiFetch<IChartResponse>(
        `/charts/data?${params.toString()}`,
        { signal: controller.signal },
      );
      if (!controller.signal.aborted) {
        setChartData(data);
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') return;
      toast.error(t('errorToast', { error: (err as Error).message }));
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [dateRange, filters.fromTime, filters.toTime, selectedFields, t]);

  const canGenerate =
    Boolean(dateRange?.from && dateRange?.to) &&
    selectedFields.length > 0 &&
    !loading;

  return (
    <div className="space-y-6 p-6">
      <h1 className="text-xl font-semibold">{t('title')}</h1>

      {/* Filter Bar Card */}
      <Card>
        <CardContent className="flex flex-wrap items-end gap-4 p-4">
          <div className="space-y-1">
            <Label className="text-xs">{t('dateRangeLabel')}</Label>
            <DateRangePicker
              value={dateRange}
              onChange={setDateRange}
              placeholder={t('dateRangePlaceholder')}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">{t('fromTimeLabel')}</Label>
            <Input
              type="time"
              value={filters.fromTime}
              onChange={(e) => setFromTime(e.target.value)}
              className="w-[120px]"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">{t('toTimeLabel')}</Label>
            <Input
              type="time"
              value={filters.toTime}
              onChange={(e) => setToTime(e.target.value)}
              className="w-[120px]"
            />
          </div>
          <Button
            onClick={generateChart}
            disabled={!canGenerate}
            className="bg-primary text-primary-foreground"
          >
            {loading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {t('loading')}
              </>
            ) : (
              t('generateChart')
            )}
          </Button>
        </CardContent>
      </Card>

      {/* Field Selector */}
      <FieldSelector
        role={role}
        selected={selectedFields}
        onChange={setSelectedFields}
        fieldLabels={fieldLabels}
      />

      {/* Chart Area Card */}
      <Card
        className={
          fullscreen
            ? 'fixed inset-0 z-50 flex flex-col overflow-auto rounded-none border-0 bg-background'
            : ''
        }
      >
        {loading ? (
          <CardContent className="p-4">
            <Skeleton className="h-[300px] w-full sm:h-[400px]" />
          </CardContent>
        ) : chartData && chartData.points.length > 0 ? (
          <>
            <div className="flex items-center justify-between px-4 pt-3">
              <div className="flex items-center gap-2">
                <Badge variant="secondary" className="text-xs">
                  {t('resolution', {
                    resolution:
                      chartData.resolution === 'raw'
                        ? '15s'
                        : chartData.resolution,
                  })}
                </Badge>
                {xDomain && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={resetZoom}
                    className="h-6 gap-1 px-2 text-xs"
                  >
                    <RotateCcw className="h-3 w-3" />
                    {t('resetZoom')}
                  </Button>
                )}
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setFullscreen((f) => !f)}
                className="h-7 w-7"
                title={fullscreen ? t('exitFullscreen') : t('fullscreen')}
              >
                {fullscreen ? (
                  <Minimize2 className="h-4 w-4" />
                ) : (
                  <Maximize2 className="h-4 w-4" />
                )}
              </Button>
            </div>
            <CardContent className="flex-1 p-4">
              <div
                className={
                  fullscreen
                    ? 'h-[calc(100vh-80px)]'
                    : 'h-[300px] sm:h-[400px]'
                }
              >
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart
                    data={chartData.points}
                    margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
                    onMouseDown={handleMouseDown}
                    onMouseMove={handleMouseMove}
                    onMouseUp={handleMouseUp}
                  >
                    <CartesianGrid
                      strokeDasharray="3 3"
                      className="stroke-border"
                    />
                    <XAxis
                      dataKey="timestamp"
                      type="number"
                      domain={xDomain ?? ['dataMin', 'dataMax']}
                      tickFormatter={(v: number) =>
                        formatTick(v, chartData.resolution)
                      }
                      tick={{
                        fill: 'var(--color-muted-foreground)',
                        fontSize: 12,
                      }}
                      allowDataOverflow={!!xDomain}
                    />
                    <YAxis
                      tick={{
                        fill: 'var(--color-muted-foreground)',
                        fontSize: 12,
                      }}
                      domain={xDomain ? ['auto', 'auto'] : undefined}
                    />
                    <Tooltip
                      labelFormatter={(v) =>
                        formatTick(v as number, chartData.resolution)
                      }
                      formatter={(value) =>
                        typeof value === 'number'
                          ? String(Math.round(value * 100) / 100)
                          : String(value ?? '')
                      }
                      contentStyle={{
                        backgroundColor: 'var(--color-card)',
                        border: '1px solid var(--color-border)',
                        color: 'var(--color-foreground)',
                        borderRadius: '8px',
                      }}
                    />
                    <Legend />
                    {selectedFields.map((field, i) => (
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
                    {zoomLeft != null && zoomRight != null && (
                      <ReferenceArea
                        x1={zoomLeft}
                        x2={zoomRight}
                        strokeOpacity={0.3}
                        fill="var(--color-primary)"
                        fillOpacity={0.1}
                      />
                    )}
                    <Brush
                      dataKey="timestamp"
                      height={30}
                      stroke="var(--color-primary)"
                      tickFormatter={(v: number) =>
                        formatTick(v, chartData.resolution)
                      }
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </>
        ) : chartData && chartData.points.length === 0 ? (
          <CardContent className="flex min-h-[400px] flex-col items-center justify-center py-12">
            <CalendarDays className="mb-4 h-12 w-12 text-muted-foreground/40" />
            <p className="text-sm font-medium">{t('emptyHeading')}</p>
            <p className="text-sm text-muted-foreground">{t('emptyBody')}</p>
          </CardContent>
        ) : (
          <CardContent className="flex min-h-[400px] flex-col items-center justify-center py-12">
            <TrendingUp className="mb-4 h-12 w-12 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">{t('initialBody')}</p>
          </CardContent>
        )}
      </Card>
    </div>
  );
}
