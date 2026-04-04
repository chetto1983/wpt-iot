'use client';

import { useState, useEffect, useCallback } from 'react';
import type { DateRange } from 'react-day-picker';
import { format as formatDate } from 'date-fns';
import { useTranslations } from 'next-intl';
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

// Key columns for preview (subset — full export has 43)
const PREVIEW_FIELDS = [
  'timestamp',
  'garbageTemp',
  'chamberPressure',
  'mainMotorSpeed',
  'completedCycles',
  'machineStatus',
  'user',
] as const;

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

  const [dateRange, setDateRange] = useState<DateRange | undefined>();
  const [fromTime, setFromTime] = useState('00:00');
  const [toTime, setToTime] = useState('23:59');
  const [cycleNumber, setCycleNumber] = useState('');
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

    let cancelled = false;
    setLoading(true);

    const params = new URLSearchParams({
      from: buildDateTimeISO(dateRange.from, fromTime),
      to: buildDateTimeISO(dateRange.to, toTime),
      lang: locale,
    });
    if (cycleNumber.trim()) params.set('cycle', cycleNumber.trim());

    apiFetch<IMachinePreview>(`/reports/machine?${params.toString()}`)
      .then((data) => {
        if (!cancelled) setPreview(data);
      })
      .catch((err) => {
        if (!cancelled) {
          setPreview(null);
          toast.error(t('errorToast', { error: (err as Error).message }));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [dateRange, fromTime, toTime, cycleNumber, locale, t]);

  const downloadReport = useCallback(async () => {
    if (!dateRange?.from || !dateRange?.to) return;

    setDownloading(true);
    try {
      const params = new URLSearchParams({
        from: buildDateTimeISO(dateRange.from, fromTime),
        to: buildDateTimeISO(dateRange.to, toTime),
        lang: locale,
      });
      if (cycleNumber.trim()) params.set('cycle', cycleNumber.trim());

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
  }, [dateRange, fromTime, toTime, cycleNumber, exportFormat, locale, t]);

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
        fromTime={fromTime}
        toTime={toTime}
        onFromTimeChange={setFromTime}
        onToTimeChange={setToTime}
        format={exportFormat}
        onFormatChange={setExportFormat}
        onDownload={downloadReport}
        downloading={downloading}
        showCycleFilter
        cycleNumber={cycleNumber}
        onCycleNumberChange={setCycleNumber}
        translations={{
          dateRangeLabel: t('dateRangeLabel'),
          dateRangePlaceholder: t('dateRangePlaceholder'),
          fromTimeLabel: t('fromTimeLabel'),
          toTimeLabel: t('toTimeLabel'),
          cycleLabel: t('cycleLabel'),
          cyclePlaceholder: t('cyclePlaceholder'),
          downloadCsv: t('downloadCsv'),
          downloadPdf: t('downloadPdf'),
          downloading: t('downloading'),
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
                    {PREVIEW_FIELDS.map((f) => (
                      <TableHead key={f}>
                        {headerMap.get(f) ?? f}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {preview.rows.map((row, i) => (
                    <TableRow key={i} className="hover:bg-muted/50">
                      {PREVIEW_FIELDS.map((f) => (
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
