'use client';

import { startTransition } from 'react';
import { Download, Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { zonedDateTimeToUtc } from '@wpt/types';
import { computePresetRange } from '@/lib/chart-colors';
import { toZonedCalendarDate } from '@/lib/date-utils';
import { useAppLocale } from '@/lib/locale';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { TimeRangePicker } from '@/components/shared/time-range-picker';

interface EnergyRangeControlsProps {
  from: Date;
  to: Date;
  preset: 'last7d' | 'last30d' | 'last12mo' | 'custom';
  refreshInterval: number;
  lastUpdated: Date | null;
  loading: boolean;
  exportingPdf: boolean;
  onRangeChange: (from: Date, to: Date) => void;
  onPresetChange: (preset: 'last7d' | 'last30d' | 'last12mo' | 'custom') => void;
  onRefreshIntervalChange: (ms: number) => void;
  onExportPdf: () => void;
}

function getLast12MonthsRange(timezone: string): { from: Date; to: Date } {
  const to = new Date();
  const wallClockFrom = toZonedCalendarDate(to, timezone);
  wallClockFrom.setMonth(wallClockFrom.getMonth() - 12);
  const from = zonedDateTimeToUtc(
    {
      year: wallClockFrom.getFullYear(),
      month: wallClockFrom.getMonth() + 1,
      day: wallClockFrom.getDate(),
      hour: wallClockFrom.getHours(),
      minute: wallClockFrom.getMinutes(),
      second: wallClockFrom.getSeconds(),
    },
    timezone,
  );
  return { from, to };
}

export function EnergyRangeControls({
  from,
  to,
  preset,
  refreshInterval,
  lastUpdated,
  loading,
  exportingPdf,
  onRangeChange,
  onPresetChange,
  onRefreshIntervalChange,
  onExportPdf,
}: EnergyRangeControlsProps) {
  const t = useTranslations('energy');
  const { timezone } = useAppLocale();

  function applyPreset(nextPreset: 'last7d' | 'last30d' | 'last12mo') {
    const range =
      nextPreset === 'last12mo'
        ? getLast12MonthsRange(timezone)
        : computePresetRange(nextPreset, timezone);
    if (!range) return;
    startTransition(() => {
      onPresetChange(nextPreset);
      onRangeChange(range.from, range.to);
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {(['last7d', 'last30d', 'last12mo'] as const).map((quickPreset) => (
          <Button
            key={quickPreset}
            type="button"
            variant={preset === quickPreset ? 'default' : 'outline'}
            size="sm"
            className={cn('min-w-16', preset === quickPreset ? 'shadow-sm' : undefined)}
            onClick={() => applyPreset(quickPreset)}
          >
            {quickPreset === 'last12mo' ? '12mo' : t(`range.${quickPreset}`)}
          </Button>
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <TimeRangePicker
          from={from}
          to={to}
          onRangeChange={(nextFrom, nextTo) => {
            startTransition(() => {
              onPresetChange('custom');
              onRangeChange(nextFrom, nextTo);
            });
          }}
          activePreset={preset === 'last12mo' ? null : preset === 'custom' ? null : preset}
          onPresetChange={(nextPreset) => {
            if (nextPreset === 'last7d' || nextPreset === 'last30d') {
              onPresetChange(nextPreset);
            } else if (nextPreset == null) {
              onPresetChange('custom');
            }
          }}
          refreshInterval={refreshInterval}
          onRefreshIntervalChange={onRefreshIntervalChange}
          lastUpdated={lastUpdated}
          loading={loading}
        />

        <Button
          type="button"
          size="sm"
          variant="outline"
          className="gap-2"
          disabled={exportingPdf}
          onClick={onExportPdf}
        >
          {exportingPdf ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Download className="size-3.5" />
          )}
          {exportingPdf ? t('export.downloading') : t('export.action')}
        </Button>
      </div>
    </div>
  );
}
