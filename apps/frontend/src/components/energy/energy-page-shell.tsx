'use client';

import { startTransition, useDeferredValue, useEffect, useRef, useState } from 'react';
import { Bolt, Wifi, WifiOff } from 'lucide-react';
import { useTranslations } from 'next-intl';
import {
  type EnergyMetric,
  type IEnergyAggregateResponse,
  type IEnergyCyclesResponse,
  type IEnergyDashboardSummary,
  type IEnergyReconciliationResponse,
} from '@wpt/types';
import { apiFetch } from '@/lib/api';
import { useWsData } from '@/lib/ws-context';
import { Badge } from '@/components/ui/badge';
import { EnergyCyclesTable, buildEnergyCyclesPath } from './energy-cycles-table';
import { EnergyKpiGrid } from './energy-kpi-grid';
import { EnergyRangeControls } from './energy-range-controls';
import { EnergyReconciliationWidget, buildEnergyReconciliationPath } from './energy-reconciliation-widget';
import { EnergySavingsWidget } from './energy-savings-widget';
import { EnergyTrendCard, buildEnergyAggregatePath } from './energy-trend-card';

type EnergyPreset = 'last7d' | 'last30d' | 'last12mo' | 'custom';

function getDefaultRange(): { from: Date; to: Date } {
  const to = new Date();
  const from = new Date(to.getTime() - 7 * 24 * 60 * 60 * 1000);
  return { from, to };
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
  const summaryAbortRef = useRef<AbortController | null>(null);
  const widgetsAbortRef = useRef<AbortController | null>(null);
  const showSummaryLoading = summaryLoading && summary == null;
  const showAggregateLoading = aggregateLoading && aggregate == null;
  const showCyclesLoading = cyclesLoading && cycles == null;
  const showReconciliationLoading = reconciliationLoading && reconciliation == null;

  const liveSignal = `${connected}:${lastUpdate?.getTime() ?? 0}:${machineData?.energyConsumption ?? 0}:${machineData?.completedCycles ?? 0}`;
  const deferredLiveSignal = useDeferredValue(liveSignal);

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
        onRangeChange={(nextFrom, nextTo) => {
          startTransition(() => {
            setFrom(nextFrom);
            setTo(nextTo);
          });
        }}
        onPresetChange={setPreset}
        onRefreshIntervalChange={setRefreshInterval}
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

      <EnergySavingsWidget summary={summary} loading={showSummaryLoading} />

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
    </div>
  );
}
