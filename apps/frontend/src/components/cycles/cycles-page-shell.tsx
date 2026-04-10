'use client';

import { useState, useEffect, useMemo } from 'react';
import { RotateCcw, Wifi, WifiOff, FileSpreadsheet, FileText } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { startOfMonth, endOfMonth } from 'date-fns';

import { apiFetch } from '@/lib/api';
import { useWsData } from '@/lib/ws-context';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

import { MonthPicker } from './month-picker';
import { ViewToggle } from './view-toggle';
import { CyclesTable } from './cycles-table';
import { ExportDialog } from './export-dialog';

import type { ICycleRecordResponse, ICyclesPagination, ICyclesResponse } from '@/lib/api/cycles';

type ViewMode = 'register' | 'detail';
type SortOrder = 'asc' | 'desc';

export function CyclesPageShell() {
  const t = useTranslations('cycles');
  const { connected } = useWsData();

  const now = new Date();
  const [selectedMonth, setSelectedMonth] = useState({ year: now.getFullYear(), month: now.getMonth() + 1 });
  const [viewMode, setViewMode] = useState<ViewMode>('register');
  const [sortColumn, setSortColumn] = useState('cycleNumber');
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc');
  const [page, setPage] = useState(1);

  const [cycles, setCycles] = useState<ICycleRecordResponse[]>([]);
  const [pagination, setPagination] = useState<ICyclesPagination | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [isExporting, setIsExporting] = useState<'csv' | 'pdf' | null>(null);

  const fromDate = useMemo(() => startOfMonth(new Date(selectedMonth.year, selectedMonth.month - 1, 1)), [selectedMonth]);
  const toDate = useMemo(() => endOfMonth(new Date(selectedMonth.year, selectedMonth.month - 1, 1)), [selectedMonth]);

  useEffect(() => {
    const controller = new AbortController();

    async function fetchCycles() {
      setIsLoading(true);
      setError(null);

      try {
        const queryParams = new URLSearchParams({
          from: fromDate.toISOString(),
          to: toDate.toISOString(),
          page: String(page),
          limit: '25',
          sort: sortColumn,
          order: sortOrder,
        });

        const data = await apiFetch<ICyclesResponse>(`/api/cycles?${queryParams.toString()}`, {
          signal: controller.signal,
        });

        if (!controller.signal.aborted) {
          setCycles(data.cycles);
          setPagination(data.pagination);
        }
      } catch (err) {
        if (!controller.signal.aborted) {
          setError(t('error'));
          console.error('Failed to fetch cycles:', err);
        }
      } finally {
        if (!controller.signal.aborted) {
          setIsLoading(false);
        }
      }
    }

    fetchCycles();

    return () => controller.abort();
  }, [fromDate, toDate, page, sortColumn, sortOrder, t]);

  function handleSort(column: string) {
    if (sortColumn === column) {
      setSortOrder((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortColumn(column);
      setSortOrder('asc');
    }
    setPage(1);
  }

  async function handleQuickExport(format: 'csv' | 'pdf') {
    setIsExporting(format);
    try {
      const API_BASE = process.env.NEXT_PUBLIC_API_URL || '';
      const queryParams = new URLSearchParams({
        format,
        from: fromDate.toISOString(),
        to: toDate.toISOString(),
      });

      const res = await fetch(`${API_BASE}/api/cycles/export?${queryParams.toString()}`, {
        method: 'GET',
        credentials: 'include',
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        const errorMessage =
          typeof (body as { error?: unknown }).error === 'string'
            ? (body as { error: string }).error
            : `Export failed: ${res.status}`;
        throw new Error(errorMessage);
      }

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      const ext = format === 'csv' ? 'csv' : 'pdf';
      link.download = `cycles-${selectedMonth.year}-${String(selectedMonth.month).padStart(2, '0')}.${ext}`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);

      toast.success(t('export.success'));
    } catch (err) {
      toast.error(t('export.error'));
      console.error('Export failed:', err);
    } finally {
      setIsExporting(null);
    }
  }

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="gap-1">
              <RotateCcw className="size-3.5" />
              Registro Cicli
            </Badge>
            <Badge variant={connected ? 'secondary' : 'outline'} className="gap-1">
              {connected ? <Wifi className="size-3.5" /> : <WifiOff className="size-3.5" />}
              {connected ? 'Live' : 'Offline'}
            </Badge>
          </div>
          <h1 className="text-xl font-semibold tracking-tight">{t('title')}</h1>
          <p className="max-w-3xl text-sm text-muted-foreground">{t('subtitle')}</p>
        </div>
      </header>

      {/* Controls bar */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-4">
          <MonthPicker value={selectedMonth} onChange={setSelectedMonth} />
          <ViewToggle value={viewMode} onChange={setViewMode} />
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleQuickExport('csv')}
            disabled={isLoading || isExporting === 'csv'}
          >
            {isExporting === 'csv' ? (
              <span className="animate-spin mr-2">⟳</span>
            ) : (
              <FileSpreadsheet className="mr-2 size-4" />
            )}
            {t('export.csv')}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleQuickExport('pdf')}
            disabled={isLoading || isExporting === 'pdf'}
          >
            {isExporting === 'pdf' ? (
              <span className="animate-spin mr-2">⟳</span>
            ) : (
              <FileText className="mr-2 size-4" />
            )}
            {t('export.pdf')}
          </Button>
        </div>
      </div>

      {/* Error state */}
      {error && (
        <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-4 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* Table */}
      <CyclesTable
        cycles={cycles}
        viewMode={viewMode}
        sortColumn={sortColumn}
        sortOrder={sortOrder}
        onSort={handleSort}
        pagination={pagination || undefined}
        onPageChange={setPage}
        isLoading={isLoading}
      />

      {/* Export Dialog */}
      <ExportDialog
        from={fromDate}
        to={toDate}
        open={exportDialogOpen}
        onOpenChange={setExportDialogOpen}
      />
    </div>
  );
}
