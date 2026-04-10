'use client';

import { startTransition, useDeferredValue, useEffect, useRef, useState } from 'react';
import { Bolt, Wifi, WifiOff } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import {
  type EnergyMetric,
  type IEnergyAggregateResponse,
  type IEnergyCyclesResponse,
  type IEnergyDashboardSummary,
  type IEnergyReconciliationResponse,
} from '@wpt/types';
import { apiFetch } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { useWsData } from '@/lib/ws-context';
import { Badge } from '@/components/ui/badge';
import { BaselineLockDialog } from './baseline-lock-dialog';
import { EnergyCyclesTable, buildEnergyCyclesPath } from './energy-cycles-table';
import { EnergyKpiGrid } from './energy-kpi-grid';
import { EnergyRangeControls } from './energy-range-controls';
import { EnergyReconciliationWidget, buildEnergyReconciliationPath } from './energy-reconciliation-widget';
import { EnergySavingsWidget } from './energy-savings-widget';
import { EnergyTrendCard, buildEnergyAggregatePath } from './energy-trend-card';

type EnergyPreset = 'last7d' | 'last30d' | 'last12mo' | 'custom';
const MIN_BASELINE_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;
const API_BASE = process.env.NEXT_PUBLIC_API_URL || '';

function getDefaultRange(): { from: Date; to: Date } {
  const to = new Date();
  const from = new Date(to.getTime() - 7 * 24 * 60 * 60 * 1000);
  return { from, to };
}

function getSuggestedBaselineWindow(from: Date, to: Date): { from: Date; to: Date } {
  const now = new Date();
  const safeTo = to.getTime() > now.getTime() ? now : to;
  if (safeTo.getTime() - from.getTime() >= MIN_BASELINE_WINDOW_MS && from.getTime() < now.getTime()) {
    return { from, to: safeTo };
  }

  return {
    from: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000),
    to: now,
  };
}

function buildEnergyDashboardPath(from: Date, to: Date): string {
  const params = new URLSearchParams({
    from: from.toISOString(),
    to: to.toISOString(),
  });
  return `/api/energy/dashboard?${params.toString()}`;
}

export function EnergyPageShell() {
  const t = useTranslations('energy');
  const { user } = useAuth();
  const { machineData, connected, lastUpdate } = useWsData();
  const initialRange = getDefaultRange();
  const [from, setFrom] = useState(initialRange.from);
  const [to, setTo] = useState(initialRange.to);
  const [preset, setPreset] = useState<EnergyPreset>('last7d');
  const [metric, setMetric] = useState<EnergyMetric>('kwh');
  const [refreshInterval, setRefreshInterval] = useState(0);
  const [summary, setSummary] = useState<IEnergyDashboardSummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [aggregate, setAggregate] = useState<IEnergyAggregateResponse | null>(null);
  const [aggregateLoading, setAggregateLoading] = useState(true);
  const [aggregateError, setAggregateError] = useState<string | null>(null);
  const [cycles, setCycles] = useState<IEnergyCyclesResponse | null>(null);
  const [cyclesLoading, setCyclesLoading] = useState(true);
  const [cyclesError, setCyclesError] = useState<string | null>(null);
  const [reconciliation, setReconciliation] = useState<IEnergyReconciliationResponse | null>(null);
  const [reconciliationLoading, setReconciliationLoading] = useState(true);
  const [reconciliationError, setReconciliationError] = useState<string | null>(null);
  const [lastFetchedAt, setLastFetchedAt] = useState<Date | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);
  const [baselineDialogOpen, setBaselineDialogOpen] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [pendingPdfExport, setPendingPdfExport] = useState(false);
  const summaryAbortRef = useRef<AbortController | null>(null);
  const widgetsAbortRef = useRef<AbortController | null>(null);
  const showSummaryLoading = summaryLoading && summary == null;
  const showAggregateLoading = aggregateLoading && aggregate == null;
  const showCyclesLoading = cyclesLoading && cycles == null;
  const showReconciliationLoading = reconciliationLoading && reconciliation == null;

  const liveSignal = `${connected}:${lastUpdate?.getTime() ?? 0}:${machineData?.energyConsumption ?? 0}:${machineData?.completedCycles ?? 0}`;
  const deferredLiveSignal = useDeferredValue(liveSignal);
  const canManageBaseline = user?.role === 'SUPER_ADMIN';
  const baselineWindow = getSuggestedBaselineWindow(from, to);
  const pdfLang = user?.language === 'en' ? 'en' : 'it';
  const activeBaselineId = summary?.savings?.baselineId ?? null;

  useEffect(() => {
    if (refreshInterval === 0) return;
    const timer = window.setInterval(() => {
      setRefreshTick((value) => value + 1);
    }, refreshInterval);
    return () => window.clearInterval(timer);
  }, [refreshInterval]);

  useEffect(() => {
    summaryAbortRef.current?.abort();
    const controller = new AbortController();
    summaryAbortRef.current = controller;
    setSummaryLoading(true);

    apiFetch<IEnergyDashboardSummary>(buildEnergyDashboardPath(from, to), {
      signal: controller.signal,
    })
      .then((data) => {
        if (controller.signal.aborted) return;
        setSummary(data);
        setSummaryError(null);
        setLastFetchedAt(new Date());
      })
      .catch((error: unknown) => {
        if (error instanceof Error && error.name === 'AbortError') return;
        if (controller.signal.aborted) return;
        setSummaryError(t('errors.summary'));
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setSummaryLoading(false);
        }
      });

    return () => controller.abort();
  }, [from, to, deferredLiveSignal, refreshTick, t]);

  useEffect(() => {
    widgetsAbortRef.current?.abort();
    const controller = new AbortController();
    widgetsAbortRef.current = controller;
    setAggregateLoading(true);
    setCyclesLoading(true);
    setReconciliationLoading(true);

    const aggregatePath = buildEnergyAggregatePath(from, to, preset);
    const cyclesPath = buildEnergyCyclesPath(from, to, 10);
    const reconciliationPath = buildEnergyReconciliationPath(from, to);

    void Promise.allSettled([
      apiFetch<IEnergyAggregateResponse>(aggregatePath, { signal: controller.signal })
        .then((data) => {
          if (!controller.signal.aborted) {
            setAggregate(data);
            setAggregateError(null);
          }
        })
        .catch((error: unknown) => {
          if (error instanceof Error && error.name === 'AbortError') return;
          if (!controller.signal.aborted) setAggregateError(t('errors.trend'));
        })
        .finally(() => {
          if (!controller.signal.aborted) setAggregateLoading(false);
        }),
      apiFetch<IEnergyCyclesResponse>(cyclesPath, { signal: controller.signal })
        .then((data) => {
          if (!controller.signal.aborted) {
            setCycles(data);
            setCyclesError(null);
          }
        })
        .catch((error: unknown) => {
          if (error instanceof Error && error.name === 'AbortError') return;
          if (!controller.signal.aborted) setCyclesError(t('errors.cycles'));
        })
        .finally(() => {
          if (!controller.signal.aborted) setCyclesLoading(false);
        }),
      apiFetch<IEnergyReconciliationResponse>(reconciliationPath, { signal: controller.signal })
        .then((data) => {
          if (!controller.signal.aborted) {
            setReconciliation(data);
            setReconciliationError(null);
          }
        })
        .catch((error: unknown) => {
          if (error instanceof Error && error.name === 'AbortError') return;
          if (!controller.signal.aborted) setReconciliationError(t('errors.reconciliation'));
        })
        .finally(() => {
          if (!controller.signal.aborted) setReconciliationLoading(false);
        }),
    ]).then(() => {
      if (!controller.signal.aborted) {
        setLastFetchedAt(new Date());
      }
    });

    return () => controller.abort();
  }, [from, to, preset, refreshTick, t]);

  async function exportPdf(baselineId: number) {
    setExportingPdf(true);
    try {
      const params = new URLSearchParams({
        from: from.toISOString(),
        to: to.toISOString(),
        lang: pdfLang,
        baseline_id: String(baselineId),
      });

      const res = await fetch(`${API_BASE}/energy/reports/iso50001/pdf?${params.toString()}`, {
        method: 'POST',
        credentials: 'include',
      });

      if (res.status === 204) {
        toast.error(t('export.noBaseline'));
        return;
      }

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(
          typeof (body as { error?: unknown }).error === 'string'
            ? (body as { error: string }).error
            : `Request failed: ${res.status}`,
        );
      }

      const blob = await res.blob();
      const anchor = document.createElement('a');
      anchor.href = URL.createObjectURL(blob);
      anchor.download = `energy-iso50001-${from.toISOString().slice(0, 10)}-${to.toISOString().slice(0, 10)}.pdf`;
      document.body.appendChild(anchor);
      anchor.click();
      URL.revokeObjectURL(anchor.href);
      anchor.remove();

      toast.success(t('export.success'));
    } catch (error) {
      toast.error(t('export.error', { error: error instanceof Error ? error.message : t('errors.trend') }));
    } finally {
      setExportingPdf(false);
    }
  }

  async function handleExportPdf() {
    if (activeBaselineId != null) {
      setPendingPdfExport(false);
      await exportPdf(activeBaselineId);
      return;
    }

    if (canManageBaseline) {
      setPendingPdfExport(true);
      setBaselineDialogOpen(true);
      return;
    }

    toast.error(t('export.noBaseline'));
  }

  return (
    <div className="space-y-6 p-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="gap-1">
              <Bolt className="size-3.5" />
              {t('header.eyebrow')}
            </Badge>
            <Badge variant={connected ? 'secondary' : 'outline'} className="gap-1">
              {connected ? <Wifi className="size-3.5" /> : <WifiOff className="size-3.5" />}
              {connected ? t('states.live') : t('states.offline')}
            </Badge>
          </div>
          <h1 className="text-xl font-semibold tracking-tight">{t('title')}</h1>
          <p className="max-w-3xl text-sm text-muted-foreground">{t('subtitle')}</p>
        </div>
      </header>

      <EnergyRangeControls
        from={from}
        to={to}
        preset={preset}
        refreshInterval={refreshInterval}
        lastUpdated={lastFetchedAt}
        loading={showSummaryLoading || showAggregateLoading}
        exportingPdf={exportingPdf}
        hasActiveBaseline={activeBaselineId != null}
        canManageBaseline={canManageBaseline}
        onRangeChange={(nextFrom, nextTo) => {
          startTransition(() => {
            setFrom(nextFrom);
            setTo(nextTo);
          });
        }}
        onPresetChange={setPreset}
        onRefreshIntervalChange={setRefreshInterval}
        onExportPdf={handleExportPdf}
      />

      {summaryError ? (
        <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-4 text-sm text-destructive">
          {summaryError}
        </div>
      ) : null}

      <EnergyKpiGrid
        summary={summary}
        loading={showSummaryLoading}
        connected={connected}
        lastUpdate={lastUpdate}
      />

      <EnergySavingsWidget
        summary={summary}
        loading={showSummaryLoading}
        canManageBaseline={canManageBaseline}
        onCreateBaseline={() => setBaselineDialogOpen(true)}
      />

      <EnergyTrendCard
        aggregate={aggregate}
        metric={metric}
        loading={showAggregateLoading}
        error={aggregateError}
        onMetricChange={setMetric}
      />

      <EnergyReconciliationWidget
        data={reconciliation}
        loading={showReconciliationLoading}
        error={reconciliationError}
      />

      <EnergyCyclesTable
        data={cycles}
        loading={showCyclesLoading}
        error={cyclesError}
      />

      <BaselineLockDialog
        open={baselineDialogOpen}
        onOpenChange={setBaselineDialogOpen}
        suggestedFrom={baselineWindow.from}
        suggestedTo={baselineWindow.to}
        onLocked={(result) => {
          setRefreshTick((value) => value + 1);
          if (pendingPdfExport) {
            setPendingPdfExport(false);
            void exportPdf(result.baseline.baselineId);
          }
        }}
      />
    </div>
  );
}
