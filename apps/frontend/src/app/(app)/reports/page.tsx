'use client';

import { useState, useCallback } from 'react';
import type { DateRange } from 'react-day-picker';
import { format as formatDate } from 'date-fns';
import { useTranslations } from 'next-intl';
import { CalendarDays } from 'lucide-react';
import { toast } from 'sonner';

import { useAuth } from '@/lib/auth-context';
import { Card, CardContent } from '@/components/ui/card';
import { ReportFilters } from '@/components/report-filters';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || '';

export default function ReportsPage() {
  const t = useTranslations('reports');
  const { user } = useAuth();
  const locale = user?.language ?? 'it';

  const [dateRange, setDateRange] = useState<DateRange | undefined>();
  const [cycleNumber, setCycleNumber] = useState('');
  const [exportFormat, setExportFormat] = useState<'csv' | 'pdf'>('csv');
  const [downloading, setDownloading] = useState(false);

  const downloadReport = useCallback(async () => {
    if (!dateRange?.from || !dateRange?.to) return;

    setDownloading(true);
    try {
      const params = new URLSearchParams({
        from: dateRange.from.toISOString(),
        to: dateRange.to.toISOString(),
        lang: locale,
      });
      if (cycleNumber.trim()) {
        params.set('cycle', cycleNumber.trim());
      }

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
  }, [dateRange, cycleNumber, exportFormat, locale, t]);

  return (
    <div className="space-y-6 p-6">
      <h1 className="text-xl font-semibold">{t('title')}</h1>

      <ReportFilters
        dateRange={dateRange}
        onDateRangeChange={setDateRange}
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
          cycleLabel: t('cycleLabel'),
          cyclePlaceholder: t('cyclePlaceholder'),
          downloadCsv: t('downloadCsv'),
          downloadPdf: t('downloadPdf'),
          downloading: t('downloading'),
        }}
      />

      <Card>
        <CardContent className="flex min-h-[200px] flex-col items-center justify-center py-12">
          <CalendarDays className="mb-4 h-12 w-12 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">{t('initialBody')}</p>
        </CardContent>
      </Card>
    </div>
  );
}
