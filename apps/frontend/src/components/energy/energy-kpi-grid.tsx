'use client';

import { formatDistanceToNowStrict } from 'date-fns';
import { useTranslations } from 'next-intl';
import { formatItEur, formatItKgCO2, formatItKwh, type IEnergyDashboardSummary } from '@wpt/types';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

interface EnergyKpiGridProps {
  summary: IEnergyDashboardSummary | null;
  loading: boolean;
  connected: boolean;
  lastUpdate: Date | null;
}

const KPI_KEYS = [
  'currentPower',
  'dayKwh',
  'dayEur',
  'dayCo2',
  'cyclesToday',
] as const;

function formatValue(
  key: (typeof KPI_KEYS)[number],
  summary: IEnergyDashboardSummary | null,
): string {
  if (!summary) return '—';
  switch (key) {
    case 'currentPower':
      return summary.currentPowerKw == null ? '—' : `${summary.currentPowerKw.toFixed(1)} kW`;
    case 'dayKwh':
      return formatItKwh(summary.dayToDateKwh);
    case 'dayEur':
      return formatItEur(summary.dayToDateEur);
    case 'dayCo2':
      return formatItKgCO2(summary.dayToDateKgCo2);
    case 'cyclesToday':
      return `${summary.cyclesToday}`;
  }
}

export function EnergyKpiGrid({
  summary,
  loading,
  connected,
  lastUpdate,
}: EnergyKpiGridProps) {
  const t = useTranslations('energy');

  return (
    <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
      {KPI_KEYS.map((key) => (
        <Card key={key} className="border border-border/70">
          <CardHeader className="gap-2">
            <div className="flex items-center justify-between gap-3">
              <CardDescription>{t(`kpis.${key}`)}</CardDescription>
              {key === 'currentPower' ? (
                <Badge variant={connected ? 'secondary' : 'outline'}>
                  {connected ? t('states.live') : t('states.offline')}
                </Badge>
              ) : null}
            </div>
            <CardTitle className="text-2xl font-semibold tracking-tight">
              {loading ? <Skeleton className="h-8 w-28" /> : formatValue(key, summary)}
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            {loading ? (
              <Skeleton className="h-4 w-24" />
            ) : key === 'currentPower' && lastUpdate ? (
              <p className="text-xs text-muted-foreground">
                {t('states.updated', {
                  time: formatDistanceToNowStrict(lastUpdate, { addSuffix: true }),
                })}
              </p>
            ) : key === 'dayKwh' && summary?.wptDetails?.peakPowerKw != null ? (
              <p className="text-xs text-muted-foreground">
                {t('kpis.peakPowerValue', { value: summary.wptDetails.peakPowerKw.toFixed(1) })}
              </p>
            ) : key === 'dayEur' && summary?.wptDetails?.baselineEnpi != null ? (
              <p className="text-xs text-muted-foreground">
                {t('kpis.baselineEnpiValue', {
                  value: summary.wptDetails.baselineEnpi.toFixed(2),
                })}
              </p>
            ) : key === 'dayCo2' && summary?.wptDetails?.rmsCurrentAvg ? (
              <p className="text-xs text-muted-foreground">
                {t('kpis.rmsAverageValue', {
                  l1: summary.wptDetails.rmsCurrentAvg.l1?.toFixed(1) ?? '—',
                  l2: summary.wptDetails.rmsCurrentAvg.l2?.toFixed(1) ?? '—',
                  l3: summary.wptDetails.rmsCurrentAvg.l3?.toFixed(1) ?? '—',
                })}
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">{t('states.steady')}</p>
            )}
          </CardContent>
        </Card>
      ))}
    </section>
  );
}
