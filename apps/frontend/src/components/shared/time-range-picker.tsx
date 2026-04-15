'use client';

import { useRef, useState } from 'react';
import { format, endOfDay } from 'date-fns';
import { useTranslations } from 'next-intl';
import { Clock, RefreshCw, Loader2 } from 'lucide-react';

import { REFRESH_INTERVALS, computePresetRange } from '@/lib/chart-colors';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface TimeRangePickerProps {
  /** Current from date */
  from: Date;
  /** Current to date */
  to: Date;
  /** Called when time range changes (from preset or custom) */
  onRangeChange: (from: Date, to: Date) => void;
  /** Active preset label or null for custom */
  activePreset: string | null;
  /** Called with preset label when a preset is selected */
  onPresetChange: (preset: string | null) => void;
  /** Auto-refresh interval in ms, 0 = off */
  refreshInterval: number;
  /** Called when refresh interval changes */
  onRefreshIntervalChange: (ms: number) => void;
  /** Timestamp of last data update, shown as "Updated HH:mm:ss" */
  lastUpdated: Date | null;
  /** Is data currently loading? Disables refresh */
  loading?: boolean;
}

const PRESET_GROUPS = [
  { heading: 'Real-time', presets: ['last15min', 'last1h', 'last6h'] },
  { heading: 'Shift review', presets: ['last12h', 'last24h', 'todaySoFar'] },
  { heading: 'Trend analysis', presets: ['last7d', 'last30d', 'custom'] },
] as const;

export function TimeRangePicker({
  from,
  to,
  onRangeChange,
  activePreset,
  onPresetChange,
  refreshInterval,
  onRefreshIntervalChange,
  lastUpdated,
  loading = false,
}: TimeRangePickerProps) {
  const t = useTranslations('dashboards');
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [showCustom, setShowCustom] = useState(!activePreset);
  const [customFrom, setCustomFrom] = useState<Date>(from);
  const [customTo, setCustomTo] = useState<Date>(to);
  const [customFromTime, setCustomFromTime] = useState(format(from, 'HH:mm'));
  const [customToTime, setCustomToTime] = useState(format(to, 'HH:mm'));
  const actionsRef = useRef<{ unmount: () => void; close: () => void } | null>(null);

  // Compute display text for the trigger button
  const triggerText = activePreset
    ? t(`timeRange.${activePreset}`)
    : `${format(from, 'dd/MM HH:mm')} - ${format(to, 'dd/MM HH:mm')}`;

  function handlePresetClick(presetLabel: string) {
    if (presetLabel === 'custom') {
      setShowCustom(true);
      setCustomFrom(from);
      setCustomTo(to);
      setCustomFromTime(format(from, 'HH:mm'));
      setCustomToTime(format(to, 'HH:mm'));
      return;
    }

    const range = computePresetRange(presetLabel);
    if (!range) return;
    onPresetChange(presetLabel);
    onRangeChange(range.from, range.to);
    setShowCustom(false);
    actionsRef.current?.close();
  }

  function handleApplyCustom() {
    const [fh, fm] = customFromTime.split(':').map(Number);
    const [th, tm] = customToTime.split(':').map(Number);

    const finalFrom = new Date(customFrom);
    finalFrom.setHours(fh ?? 0, fm ?? 0, 0, 0);

    const finalTo = new Date(customTo);
    finalTo.setHours(th ?? 0, tm ?? 0, 59, 999);

    onPresetChange(null);
    onRangeChange(finalFrom, finalTo);
    actionsRef.current?.close();
  }

  const activeRefreshLabel =
    REFRESH_INTERVALS.find((r) => r.ms === refreshInterval)?.label ?? 'off';

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* Time range button + popover */}
      <Popover
        open={popoverOpen}
        onOpenChange={(open) => setPopoverOpen(open)}
        actionsRef={actionsRef}
      >
        <PopoverTrigger
          render={
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 text-sm font-normal"
            />
          }
        >
          <Clock className="size-4 text-muted-foreground" />
          {triggerText}
        </PopoverTrigger>

        <PopoverContent
          className={cn(
            'flex max-w-none flex-col p-0 sm:flex-row',
            showCustom
              ? 'w-[min(calc(100vw-2rem),22rem)] sm:w-auto sm:min-w-[600px]'
              : 'w-[min(calc(100vw-2rem),18rem)] sm:w-auto sm:min-w-[200px]',
          )}
          align="start"
          side="bottom"
        >
          {/* Left column: presets */}
          <div className="w-full border-b border-border p-2 sm:w-48 sm:border-r sm:border-b-0">
            {PRESET_GROUPS.map((group) => (
              <div key={group.heading} className="mb-2">
                <div className="px-2 py-1 text-[11px] uppercase tracking-wider text-muted-foreground">
                  {group.heading}
                </div>
                {group.presets.map((presetLabel) => (
                  <button
                    key={presetLabel}
                    type="button"
                    className={cn(
                      'min-h-11 w-full rounded-md px-3 py-2 text-left text-sm transition-colors sm:min-h-0 sm:px-2 sm:py-1.5',
                      activePreset === presetLabel
                        ? 'bg-accent text-accent-foreground font-medium'
                        : 'hover:bg-muted text-foreground/80',
                    )}
                    onClick={() => handlePresetClick(presetLabel)}
                  >
                    {t(`timeRange.${presetLabel}`)}
                  </button>
                ))}
              </div>
            ))}
          </div>

          {/* Right column: custom calendar (only when custom mode) */}
          {showCustom ? (
            <div className="flex flex-col gap-3 p-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="flex flex-col gap-1">
                  <Label className="text-xs text-muted-foreground">
                    {t('timeRange.from')}
                  </Label>
                  <Calendar
                    mode="single"
                    selected={customFrom}
                    onSelect={(d) => d && setCustomFrom(d)}
                    disabled={{ after: endOfDay(new Date()) }}
                  />
                  <Input
                    type="time"
                    value={customFromTime}
                    onChange={(e) => setCustomFromTime(e.target.value)}
                    className="w-full text-xs"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <Label className="text-xs text-muted-foreground">
                    {t('timeRange.to')}
                  </Label>
                  <Calendar
                    mode="single"
                    selected={customTo}
                    onSelect={(d) => d && setCustomTo(d)}
                    disabled={{ after: endOfDay(new Date()) }}
                  />
                  <Input
                    type="time"
                    value={customToTime}
                    onChange={(e) => setCustomToTime(e.target.value)}
                    className="w-full text-xs"
                  />
                </div>
              </div>
              {/* Apply button */}
              <div className="flex justify-stretch sm:justify-end">
                <Button size="sm" onClick={handleApplyCustom} className="w-full sm:w-auto">
                  {t('timeRange.apply')}
                </Button>
              </div>
            </div>
          ) : null}
        </PopoverContent>
      </Popover>

      {/* Auto-refresh dropdown */}
      <Select
        value={activeRefreshLabel}
        onValueChange={(val) => {
          const interval = REFRESH_INTERVALS.find((r) => r.label === val);
          if (interval) onRefreshIntervalChange(interval.ms);
        }}
      >
        <SelectTrigger size="sm" className="gap-1.5">
          {loading ? (
            <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
          ) : (
            <RefreshCw className="size-3.5 text-muted-foreground" />
          )}
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {REFRESH_INTERVALS.map((interval) => (
            <SelectItem key={interval.label} value={interval.label}>
              {interval.label === 'off'
                ? t('autoRefresh') + ': Off'
                : interval.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Last updated badge */}
      {lastUpdated ? (
        <span className="text-xs text-muted-foreground">
          {t('lastUpdated', { time: format(lastUpdated, 'HH:mm:ss') })}
        </span>
      ) : null}
    </div>
  );
}
