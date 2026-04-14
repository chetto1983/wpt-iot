'use client';

import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
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
import { useTranslations } from 'next-intl';
import { useQueryStates, parseAsString, parseAsInteger } from 'nuqs';
import { TrendingUp, CalendarDays, Loader2, Maximize2, Minimize2, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';

import { getFieldLabel } from '@wpt/types';
import { useAuth } from '@/lib/auth-context';
import { apiFetch } from '@/lib/api';
import { CHART_COLORS } from '@/lib/chart-colors';
import { formatTick } from '@/lib/chart-format';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { TimeRangePicker } from '@/components/shared/time-range-picker';
import { FieldSelector, getChartableFields } from '@/components/shared/field-selector';

interface IChartResponse {
  resolution: 'raw' | '5min' | '1h';
  points: Array<Record<string, number>>;
}

export default function ChartsPage() {
  const t = useTranslations('charts');
  const { user } = useAuth();
  const locale = (user?.language ?? 'it') as 'it' | 'en';
  const role = user?.role ?? 'CLIENT';

  // Time range state synced to URL via nuqs.
  // The default ISO strings are computed ONCE at mount via useMemo with empty
  // deps. Computing them inline (`new Date().toISOString()`) every render
  // creates a fresh string per render — once any state bumps, an effect
  // reading these would fire every render → fetch storm. Pinning the defaults
  // at mount fixes the root loop cause.
  const queryParsers = useMemo(
    () => ({
      from: parseAsString.withDefault(
        new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString(),
      ),
      to: parseAsString.withDefault(new Date().toISOString()),
      preset: parseAsString.withDefault('last6h'),
      refresh: parseAsInteger.withDefault(0), // default OFF on /charts (single-shot generation, not streaming)
    }),
    [],
  );
  const [dateFilters, setDateFilters] = useQueryStates(queryParsers);

  // rangeFrom/rangeTo are useMemo'd so identity is stable across renders
  // when the underlying ISO strings don't change. Required for any effect
  // or memoised child reading these as deps.
  const rangeFrom = useMemo(() => new Date(dateFilters.from), [dateFilters.from]);
  const rangeTo = useMemo(() => new Date(dateFilters.to), [dateFilters.to]);
  const activePreset = dateFilters.preset;
  const refreshInterval = dateFilters.refresh;
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const handleRangeChange = useCallback((f: Date, tDate: Date) => {
    void setDateFilters({ from: f.toISOString(), to: tDate.toISOString() });
  }, [setDateFilters]);
  const handlePresetChange = useCallback((preset: string | null) => {
    void setDateFilters({ preset: preset ?? null });
  }, [setDateFilters]);
  const handleRefreshIntervalChange = useCallback((ms: number) => {
    void setDateFilters({ refresh: ms });
  }, [setDateFilters]);

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
    if (selectedFields.length === 0) return;

    // Abort any previous in-flight request
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    setChartData(null);

    try {
      const params = new URLSearchParams({
        from: rangeFrom.toISOString(),
        to: rangeTo.toISOString(),
        fields: selectedFields.join(','),
      });

      const data = await apiFetch<IChartResponse>(
        `/api/charts/data?${params.toString()}`,
        { signal: controller.signal },
      );
      if (!controller.signal.aborted) {
        setChartData(data);
        setLastUpdated(new Date());
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') return;
      toast.error(t('errorToast', { error: (err as Error).message }));
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [rangeFrom, rangeTo, selectedFields, t]);

  const canGenerate = selectedFields.length > 0 && !loading;

  // Auto-refresh tick. NOTE: We deliberately do NOT slide the window for
  // relative presets on /charts (unlike dashboards/[id] which calls
  // computePresetRange each tick to keep the window flush with "now").
  // /charts is a single-shot generator by design — the user clicks Generate,
  // gets a chart for the currently-selected window, and that's it. For live
  // sliding windows, use /dashboards/[id]. See 17-01-PLAN rationale.
  useEffect(() => {
    if (refreshInterval === 0 || selectedFields.length === 0) return;
    const timer = setInterval(() => {
      void generateChart();
    }, refreshInterval);
    return () => clearInterval(timer);
  }, [refreshInterval, selectedFields, generateChart]);

  return (
    <div className="space-y-6 p-6">
      <h1 className="text-xl font-semibold">{t('title')}</h1>

      {/* Filter Bar Card */}
      <Card>
        <CardContent className="flex flex-wrap items-center gap-4 p-4">
          <TimeRangePicker
            from={rangeFrom}
            to={rangeTo}
            onRangeChange={handleRangeChange}
            activePreset={activePreset}
            onPresetChange={handlePresetChange}
            refreshInterval={refreshInterval}
            onRefreshIntervalChange={handleRefreshIntervalChange}
            lastUpdated={lastUpdated}
            loading={loading}
          />
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
