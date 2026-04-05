'use client';

import { useState, useEffect, useCallback } from 'react';
import type { DateRange } from 'react-day-picker';
import { format as formatDate } from 'date-fns';
import { useTranslations } from 'next-intl';
import { useQueryStates, parseAsString } from 'nuqs';
import { CalendarDays } from 'lucide-react';
import { toast } from 'sonner';

import { useAuth } from '@/lib/auth-context';
import { apiFetch } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
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

interface IMachinePreview {
  rows: Record<string, unknown>[];
  total: number;
  fields: string[];
  headers: string[];
}

function buildDateTimeISO(date: Date, time: string): string {
  const [h, m] = time.split(':').map(Number);
  const d = new Date(date);
  d.setHours(h ?? 0, m ?? 0, 0, 0);
  return d.toISOString();
}

export default function ReportsPage() {
  const t = useTranslations('reports');
  const { user } = useAuth();
  const locale = user?.language ?? 'it';

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

  const [exportFormat, setExportFormat] = useState<'csv' | 'pdf'>('csv');
  const [downloading, setDownloading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState<IMachinePreview | null>(null);

  // Load preview when filters change
  useEffect(() => {
    if (!dateRange?.from || !dateRange?.to) {
      setPreview(null);
      return;
    }

    const controller = new AbortController();
    setLoading(true);

    const params = new URLSearchParams({
      from: buildDateTimeISO(dateRange.from, filters.fromTime),
      to: buildDateTimeISO(dateRange.to, filters.toTime),
      lang: locale,
    });

    apiFetch<IMachinePreview>(`/reports/machine?${params.toString()}`, { signal: controller.signal })
      .then((data) => {
        if (!controller.signal.aborted) setPreview(data);
      })
      .catch((err: unknown) => {
        if (err instanceof Error && err.name === 'AbortError') return;
        setPreview(null);
        toast.error(t('errorToast', { error: (err as Error).message }));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [dateRange?.from, dateRange?.to, filters.fromTime, filters.toTime, locale, t]);

  const downloadReport = useCallback(async () => {
    if (!dateRange?.from || !dateRange?.to) return;

    setDownloading(true);
    try {
      const params = new URLSearchParams({
        from: buildDateTimeISO(dateRange.from, filters.fromTime),
        to: buildDateTimeISO(dateRange.to, filters.toTime),
        lang: locale,
      });

      const res = await fetch(
        `${API_BASE}/reports/machine/${exportFormat}?${params.toString()}`,
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
      a.download = `machine-report-${formatDate(dateRange.from, 'yyyy-MM-dd')}-${formatDate(dateRange.to, 'yyyy-MM-dd')}.${exportFormat}`;
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
  }, [dateRange, filters.fromTime, filters.toTime, exportFormat, locale, t]);

  const hasDateRange = Boolean(dateRange?.from && dateRange?.to);

  // Build preview header map: field -> translated label
  const headerMap = new Map<string, string>();
  if (preview) {
    preview.fields.forEach((f, i) => headerMap.set(f, preview.headers[i] ?? f));
  }

  return (
    <div className="space-y-6 p-6">
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
        onDownload={downloadReport}
        downloading={downloading}
        translations={{
          dateRangeLabel: t('dateRangeLabel'),
          dateRangePlaceholder: t('dateRangePlaceholder'),
          fromTimeLabel: t('fromTimeLabel'),
          toTimeLabel: t('toTimeLabel'),
          downloadCsv: t('downloadCsv'),
          downloadPdf: t('downloadPdf'),
          downloading: t('downloading'),
          disabledTooltip: t('tooltip.selectDateRange'),
        }}
      />

      <Card>
        {loading ? (
          <CardContent className="p-4">
            <div className="space-y-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="flex gap-4">
                  <Skeleton className="h-4 w-[140px]" />
                  <Skeleton className="h-4 w-[80px]" />
                  <Skeleton className="h-4 w-[80px]" />
                  <Skeleton className="h-4 w-[80px]" />
                  <Skeleton className="h-4 w-[60px]" />
                </div>
              ))}
            </div>
          </CardContent>
        ) : preview && preview.rows.length > 0 ? (
          <>
            <div className="flex items-center gap-3 px-4 pt-4">
              <Badge variant="secondary">
                {t('rowCount', { count: preview.total })}
              </Badge>
              {preview.total > 100 && (
                <span className="text-xs text-muted-foreground">
                  {t('previewNote', { total: preview.total })}
                </span>
              )}
            </div>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    {preview.fields.map((f) => (
                      <TableHead key={f}>
                        {headerMap.get(f) ?? f}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {preview.rows.map((row, i) => (
                    <TableRow key={i} className="hover:bg-muted/50">
                      {preview.fields.map((f) => (
                        <TableCell
                          key={f}
                          className={
                            f === 'timestamp'
                              ? 'font-mono text-xs whitespace-nowrap'
                              : 'text-sm'
                          }
                        >
                          {f === 'timestamp'
                            ? formatTimestamp(row[f] as string)
                            : String(row[f] ?? '')}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </>
        ) : (
          <CardContent className="flex min-h-[200px] flex-col items-center justify-center py-12">
            {hasDateRange ? (
              <>
                <CalendarDays className="mb-4 h-12 w-12 text-muted-foreground/40" />
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
        )}
      </Card>
    </div>
  );
}

function formatTimestamp(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.toLocaleDateString('it-IT')} ${d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;
}
