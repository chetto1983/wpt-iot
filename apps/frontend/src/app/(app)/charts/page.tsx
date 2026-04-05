'use client';

import { useState, useCallback, useMemo } from 'react';
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
} from 'recharts';
import { format } from 'date-fns';
import { useTranslations } from 'next-intl';
import { TrendingUp, CalendarDays, Loader2 } from 'lucide-react';
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

  const [dateRange, setDateRange] = useState<DateRange | undefined>();
  const [fromTime, setFromTime] = useState('00:00');
  const [toTime, setToTime] = useState('23:59');
  const [selectedFields, setSelectedFields] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [chartData, setChartData] = useState<IChartResponse | null>(null);

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

    setLoading(true);
    setChartData(null);

    try {
      const params = new URLSearchParams({
        from: buildDateTimeISO(dateRange.from, fromTime),
        to: buildDateTimeISO(dateRange.to, toTime),
        fields: selectedFields.join(','),
      });

      const data = await apiFetch<IChartResponse>(
        `/charts/data?${params.toString()}`,
      );
      setChartData(data);
    } catch (err) {
      toast.error(t('errorToast', { error: (err as Error).message }));
    } finally {
      setLoading(false);
    }
  }, [dateRange, fromTime, toTime, selectedFields, t]);

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
              value={fromTime}
              onChange={(e) => setFromTime(e.target.value)}
              className="w-[120px]"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">{t('toTimeLabel')}</Label>
            <Input
              type="time"
              value={toTime}
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
      <Card>
        {loading ? (
          <CardContent className="p-4">
            <Skeleton className="h-[300px] w-full sm:h-[400px]" />
          </CardContent>
        ) : chartData && chartData.points.length > 0 ? (
          <>
            <div className="flex items-center justify-end px-4 pt-3">
              <Badge variant="secondary" className="text-xs">
                {t('resolution', {
                  resolution:
                    chartData.resolution === 'raw'
                      ? '15s'
                      : chartData.resolution,
                })}
              </Badge>
            </div>
            <CardContent className="p-4">
              <div className="h-[300px] sm:h-[400px]">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart
                    data={chartData.points}
                    margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
                  >
                    <CartesianGrid
                      strokeDasharray="3 3"
                      className="stroke-border"
                    />
                    <XAxis
                      dataKey="timestamp"
                      type="number"
                      domain={['dataMin', 'dataMax']}
                      tickFormatter={(v: number) =>
                        formatTick(v, chartData.resolution)
                      }
                      tick={{
                        fill: 'var(--color-muted-foreground)',
                        fontSize: 12,
                      }}
                    />
                    <YAxis
                      tick={{
                        fill: 'var(--color-muted-foreground)',
                        fontSize: 12,
                      }}
                    />
                    <Tooltip
                      labelFormatter={(v) =>
                        formatTick(v as number, chartData.resolution)
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
