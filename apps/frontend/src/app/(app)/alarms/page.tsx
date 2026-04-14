'use client';

import { useState, useEffect, useCallback } from 'react';
import type { DateRange } from 'react-day-picker';
import { format as formatDate } from 'date-fns';
import { useTranslations } from 'next-intl';
import { useQueryStates, parseAsString, parseAsStringEnum } from 'nuqs';
import { AlertTriangle, CalendarDays } from 'lucide-react';
import { toast } from 'sonner';

import { useAuth } from '@/lib/auth-context';
import { apiFetch } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { ReportFilters } from '@/components/shared/report-filters';
import { useIsMobile } from '@/hooks/use-mobile';
import { buildDateTimeISO } from '@/lib/date-utils';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || '';

interface IAlarmEvent {
  alarmCode: string;
  description: string;
  activatedAt: string;
  resetAt: string;
  duration: string;
  isActive: boolean;
}

interface IAlarmResponse {
  events: IAlarmEvent[];
  total: number;
  active: number;
  resolved: number;
}

export default function AlarmsPage() {
  const t = useTranslations('alarms');
  const { user } = useAuth();
  const locale = user?.language ?? 'it';

  if (user?.role === 'CLIENT') {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <p>{t('unauthorized')}</p>
      </div>
    );
  }

  return <AlarmsContent locale={locale} />;
}

function AlarmsContent({ locale }: { locale: string }) {
  const t = useTranslations('alarms');
  const isMobile = useIsMobile();

  const [filters, setFilters] = useQueryStates({
    from: parseAsString,
    to: parseAsString,
    fromTime: parseAsString.withDefault('00:00'),
    toTime: parseAsString.withDefault('23:59'),
    status: parseAsStringEnum(['all', 'active', 'resolved'] as const).withDefault('all'),
  });

  const dateRange: DateRange | undefined = filters.from && filters.to
    ? { from: new Date(filters.from), to: new Date(filters.to) }
    : undefined;

  const setDateRange = useCallback((range: DateRange | undefined) => {
    void setFilters({
      from: range?.from ? formatDate(range.from, 'yyyy-MM-dd') : null,
      to: range?.to ? formatDate(range.to, 'yyyy-MM-dd') : null,
    });
  }, [setFilters]);

  const setFromTime = useCallback((v: string) => { void setFilters({ fromTime: v }); }, [setFilters]);
  const setToTime = useCallback((v: string) => { void setFilters({ toTime: v }); }, [setFilters]);
  const setStatus = useCallback((v: 'all' | 'active' | 'resolved') => { void setFilters({ status: v }); }, [setFilters]);

  const [exportFormat, setExportFormat] = useState<'csv' | 'pdf'>('csv');
  const [downloading, setDownloading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [events, setEvents] = useState<IAlarmEvent[]>([]);
  const [summary, setSummary] = useState({ total: 0, active: 0, resolved: 0 });

  // Deps must be the stable string values from nuqs, NOT dateRange.from/to:
  // those are fresh Date instances on every render and would cause an infinite loop.
  useEffect(() => {
    if (!filters.from || !filters.to) {
      setEvents([]);
      setSummary({ total: 0, active: 0, resolved: 0 });
      return;
    }

    const controller = new AbortController();
    setLoading(true);

    const params = new URLSearchParams({
      from: buildDateTimeISO(new Date(filters.from), filters.fromTime),
      to: buildDateTimeISO(new Date(filters.to), filters.toTime),
      status: filters.status,
      lang: locale,
    });

    apiFetch<IAlarmResponse>(`/api/reports/alarms?${params.toString()}`, { signal: controller.signal })
      .then((data) => {
        if (!controller.signal.aborted) {
          setEvents(data.events);
          setSummary({
            total: data.total,
            active: data.active,
            resolved: data.resolved,
          });
        }
      })
      .catch((err: unknown) => {
        if (err instanceof Error && err.name === 'AbortError') return;
        toast.error(t('errorToast', { error: (err as Error).message }));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [filters.from, filters.to, filters.fromTime, filters.toTime, filters.status, locale, t]);

  const downloadAlarmReport = useCallback(async () => {
    if (!dateRange?.from || !dateRange?.to) return;

    setDownloading(true);
    try {
      const params = new URLSearchParams({
        from: buildDateTimeISO(dateRange.from, filters.fromTime),
        to: buildDateTimeISO(dateRange.to, filters.toTime),
        status: filters.status,
        lang: locale,
      });

      const res = await fetch(
        `${API_BASE}/api/reports/alarms/${exportFormat}?${params.toString()}`,
        { credentials: 'include' },
      );

      if (!res.ok) {
        const body: unknown = await res.json().catch(() => ({}));
        throw new Error(
          (body as Record<string, string>).error ?? `Request failed: ${res.status}`,
        );
      }

      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `alarm-report-${formatDate(dateRange.from, 'yyyy-MM-dd')}-${formatDate(dateRange.to, 'yyyy-MM-dd')}.${exportFormat}`;
      document.body.appendChild(a);
      a.click();
      URL.revokeObjectURL(a.href);
      a.remove();

      toast.success(t('successToast'));
    } catch (err) {
      toast.error(t('errorToast', { error: (err as Error).message }));
    } finally {
      setDownloading(false);
    }
  }, [dateRange, filters.fromTime, filters.toTime, filters.status, exportFormat, locale, t]);

  const hasDateRange = Boolean(dateRange?.from && dateRange?.to);

  return (
    <div className="space-y-4 p-6">
      <h1 className="text-xl font-semibold">{t('title')}</h1>

      <ReportFilters
        dateRange={dateRange}
        onDateRangeChange={setDateRange}
        fromTime={filters.fromTime}
        toTime={filters.toTime}
        onFromTimeChange={setFromTime}
        onToTimeChange={setToTime}
        format={exportFormat}
        onFormatChange={setExportFormat}
        onDownload={downloadAlarmReport}
        downloading={downloading}
        showCycleFilter={false}
        cycleNumber=""
        onCycleNumberChange={() => {}}
        translations={{
          dateRangeLabel: t('dateRangeLabel'),
          dateRangePlaceholder: t('dateRangePlaceholder'),
          fromTimeLabel: t('fromTimeLabel'),
          toTimeLabel: t('toTimeLabel'),
          cycleLabel: '',
          cyclePlaceholder: '',
          downloadCsv: t('downloadCsv'),
          downloadPdf: t('downloadPdf'),
          downloading: t('downloading'),
          disabledTooltip: t('tooltip.selectDateRange'),
        }}
      >
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs font-medium text-muted-foreground">
            {t('statusLabel')}
          </Label>
          <Select
            value={filters.status}
            onValueChange={(v) =>
              setStatus(v as 'all' | 'active' | 'resolved')
            }
          >
            <SelectTrigger className="w-[160px]">
              <SelectValue>
                {filters.status === 'all'
                  ? t('statusAll')
                  : filters.status === 'active'
                    ? t('statusActive')
                    : t('statusResolved')}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('statusAll')}</SelectItem>
              <SelectItem value="active">{t('statusActive')}</SelectItem>
              <SelectItem value="resolved">{t('statusResolved')}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </ReportFilters>

      {events.length > 0 && (
        <div className="flex items-center gap-3">
          <Badge variant="secondary">
            {t('summaryTotal', { count: summary.total })}
          </Badge>
          <Badge className="bg-wpt-gold/15 text-wpt-gold">
            {t('summaryActive', { count: summary.active })}
          </Badge>
          <Badge className="bg-wpt-teal/15 text-wpt-teal">
            {t('summaryResolved', { count: summary.resolved })}
          </Badge>
        </div>
      )}

      <Card className="min-h-[400px]">
        {loading ? (
          <CardContent className="p-4">
            <div className="space-y-3">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="flex gap-4">
                  <Skeleton className="h-4 w-[80px]" />
                  <Skeleton className="h-4 w-[200px]" />
                  <Skeleton className="h-4 w-[120px]" />
                  <Skeleton className="h-4 w-[120px]" />
                  <Skeleton className="h-4 w-[60px]" />
                </div>
              ))}
            </div>
          </CardContent>
        ) : events.length === 0 ? (
          <CardContent className="flex min-h-[200px] flex-col items-center justify-center py-12">
            {hasDateRange ? (
              <>
                <AlertTriangle className="mb-4 h-12 w-12 text-muted-foreground/40" />
                <p className="text-sm font-medium">{t('emptyHeading')}</p>
                <p className="text-sm text-muted-foreground">{t('emptyBody')}</p>
              </>
            ) : (
              <>
                <CalendarDays className="mb-4 h-12 w-12 text-muted-foreground/40" />
                <p className="text-sm text-muted-foreground">{t('initialBody')}</p>
              </>
            )}
          </CardContent>
        ) : (
          <>
            {isMobile ? (
            <div className="grid gap-3 p-4">
              {events.map((event, i) => (
                <div key={i} className="rounded-2xl border border-border/70 bg-card p-4 shadow-sm">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-mono text-xs text-muted-foreground">{event.alarmCode}</p>
                      <p className="mt-1 text-sm font-medium">{event.description}</p>
                    </div>
                    {event.isActive ? (
                      <Badge className="bg-wpt-gold/15 text-wpt-gold">
                        {t('activeBadge')}
                      </Badge>
                    ) : null}
                  </div>
                  <dl className="mt-4 grid gap-3 sm:grid-cols-2">
                    <div className="rounded-xl bg-muted/30 p-3">
                      <dt className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                        {t('columnActivated')}
                      </dt>
                      <dd className="mt-1 font-mono text-xs">{event.activatedAt}</dd>
                    </div>
                    <div className="rounded-xl bg-muted/30 p-3">
                      <dt className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                        {t('columnReset')}
                      </dt>
                      <dd className="mt-1 font-mono text-xs">
                        {event.isActive ? t('activeBadge') : event.resetAt}
                      </dd>
                    </div>
                    <div className="rounded-xl bg-muted/30 p-3 sm:col-span-2">
                      <dt className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                        {t('columnDuration')}
                      </dt>
                      <dd className="mt-1 text-sm">{event.duration}</dd>
                    </div>
                  </dl>
                </div>
              ))}
            </div>
            ) : (
              <Table className="min-w-[760px]">
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('columnCode')}</TableHead>
                    <TableHead>{t('columnDescription')}</TableHead>
                    <TableHead>{t('columnActivated')}</TableHead>
                    <TableHead>{t('columnReset')}</TableHead>
                    <TableHead>{t('columnDuration')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {events.map((event, i) => (
                    <TableRow key={i} className="hover:bg-muted/50">
                      <TableCell className="font-mono text-xs whitespace-nowrap">
                        {event.alarmCode}
                      </TableCell>
                      <TableCell className="max-w-[28rem] text-sm">{event.description}</TableCell>
                      <TableCell className="font-mono text-xs whitespace-nowrap">
                        {event.activatedAt}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        {event.isActive ? (
                          <Badge className="bg-wpt-gold/15 text-wpt-gold">
                            {t('activeBadge')}
                          </Badge>
                        ) : (
                          <span className="font-mono text-xs">{event.resetAt}</span>
                        )}
                      </TableCell>
                      <TableCell className="text-sm whitespace-nowrap">{event.duration}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </>
        )}
      </Card>
    </div>
  );
}
