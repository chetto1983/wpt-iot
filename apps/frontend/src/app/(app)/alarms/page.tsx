'use client';

import { useState, useEffect, useCallback } from 'react';
import type { DateRange } from 'react-day-picker';
import { format as formatDate } from 'date-fns';
import { useTranslations } from 'next-intl';
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
import { ReportFilters } from '@/components/report-filters';

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

  // CLIENT role gate (ALM-05)
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

  const [dateRange, setDateRange] = useState<DateRange | undefined>();
  const [status, setStatus] = useState<'all' | 'active' | 'resolved'>('all');
  const [exportFormat, setExportFormat] = useState<'csv' | 'pdf'>('csv');
  const [downloading, setDownloading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [events, setEvents] = useState<IAlarmEvent[]>([]);
  const [summary, setSummary] = useState({ total: 0, active: 0, resolved: 0 });

  // Load alarm events when filters change
  useEffect(() => {
    if (!dateRange?.from || !dateRange?.to) {
      setEvents([]);
      setSummary({ total: 0, active: 0, resolved: 0 });
      return;
    }

    let cancelled = false;
    setLoading(true);

    const params = new URLSearchParams({
      from: dateRange.from.toISOString(),
      to: dateRange.to.toISOString(),
      status,
      lang: locale,
    });

    apiFetch<IAlarmResponse>(`/reports/alarms?${params.toString()}`)
      .then((data) => {
        if (cancelled) return;
        setEvents(data.events);
        setSummary({
          total: data.total,
          active: data.active,
          resolved: data.resolved,
        });
      })
      .catch((err) => {
        if (cancelled) return;
        toast.error(t('errorToast', { error: (err as Error).message }));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [dateRange, status, locale, t]);

  const downloadAlarmReport = useCallback(async () => {
    if (!dateRange?.from || !dateRange?.to) return;

    setDownloading(true);
    try {
      const params = new URLSearchParams({
        from: dateRange.from.toISOString(),
        to: dateRange.to.toISOString(),
        status,
        lang: locale,
      });

      const res = await fetch(
        `${API_BASE}/reports/alarms/${exportFormat}?${params.toString()}`,
        { credentials: 'include' },
      );

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
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
  }, [dateRange, status, exportFormat, locale, t]);

  const hasDateRange = Boolean(dateRange?.from && dateRange?.to);

  return (
    <div className="space-y-4 p-6">
      <h1 className="text-xl font-semibold">{t('title')}</h1>

      {/* Filter Bar — reuses ReportFilters, passes status filter as children */}
      <ReportFilters
        dateRange={dateRange}
        onDateRangeChange={setDateRange}
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
          cycleLabel: '',
          cyclePlaceholder: '',
          downloadCsv: t('downloadCsv'),
          downloadPdf: t('downloadPdf'),
          downloading: t('downloading'),
        }}
      >
        {/* Status filter passed as children slot */}
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs font-medium text-muted-foreground">
            {t('statusLabel')}
          </Label>
          <Select
            value={status}
            onValueChange={(v) =>
              setStatus(v as 'all' | 'active' | 'resolved')
            }
          >
            <SelectTrigger className="w-[160px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('statusAll')}</SelectItem>
              <SelectItem value="active">{t('statusActive')}</SelectItem>
              <SelectItem value="resolved">{t('statusResolved')}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </ReportFilters>

      {/* Summary Badges */}
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

      {/* Alarm Table */}
      <Card>
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
                <p className="text-sm text-muted-foreground">
                  {t('emptyBody')}
                </p>
              </>
            ) : (
              <>
                <CalendarDays className="mb-4 h-12 w-12 text-muted-foreground/40" />
                <p className="text-sm text-muted-foreground">
                  {t('initialBody')}
                </p>
              </>
            )}
          </CardContent>
        ) : (
          <Table>
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
                  <TableCell className="font-mono text-xs">
                    {event.alarmCode}
                  </TableCell>
                  <TableCell className="text-sm">
                    {event.description}
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {event.activatedAt}
                  </TableCell>
                  <TableCell>
                    {event.isActive ? (
                      <Badge className="bg-wpt-gold/15 text-wpt-gold">
                        {t('activeBadge')}
                      </Badge>
                    ) : (
                      <span className="font-mono text-xs">
                        {event.resetAt}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-sm">{event.duration}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </div>
  );
}
