'use client';

import { useTranslations } from 'next-intl';
import { type IEnergyReconciliationResponse } from '@wpt/types';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

export function buildEnergyReconciliationPath(from: Date, to: Date): string {
  const params = new URLSearchParams({
    from: from.toISOString(),
    to: to.toISOString(),
  });
  return `/api/energy/reconciliation?${params.toString()}`;
}

interface EnergyReconciliationWidgetProps {
  data: IEnergyReconciliationResponse | null;
  loading: boolean;
  error: string | null;
}

const SEGMENTS = [
  { key: 'cycles', tone: 'bg-[color:var(--chart-1,#1ABC9C)]/80' },
  { key: 'idle', tone: 'bg-muted-foreground/50' },
  { key: 'unknown', tone: 'bg-wpt-gold/80' },
] as const;

export function EnergyReconciliationWidget({
  data,
  loading,
  error,
}: EnergyReconciliationWidgetProps) {
  const t = useTranslations('energy');

  return (
    <Card className="border border-border/70">
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <div>
            <CardDescription>{t('reconciliation.kicker')}</CardDescription>
            <CardTitle>{t('reconciliation.title')}</CardTitle>
          </div>
          {data ? (
            <Badge variant={data.warning ? 'outline' : 'secondary'}>
              {data.warning ? t('reconciliation.warning') : t('reconciliation.healthy')}
            </Badge>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <div className="space-y-3">
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        ) : error ? (
          <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-4 text-sm text-destructive">
            {error}
          </div>
        ) : !data ? (
          <div className="rounded-lg border border-dashed border-border/70 p-6 text-sm text-muted-foreground">
            {t('reconciliation.empty')}
          </div>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              {t('reconciliation.subtitle')}
            </p>
            <div className="flex h-3 overflow-hidden rounded-full bg-muted/40">
              {SEGMENTS.map((segment) => (
                <div
                  key={segment.key}
                  className={segment.tone}
                  style={{
                    width: `${data[`${segment.key}Pct` as 'cyclesPct' | 'idlePct' | 'unknownPct']}%`,
                  }}
                />
              ))}
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              {SEGMENTS.map((segment) => {
                const pct = data[`${segment.key}Pct` as 'cyclesPct' | 'idlePct' | 'unknownPct'];
                const kwh = data[`${segment.key}Kwh` as 'cyclesKwh' | 'idleKwh' | 'unknownKwh'];
                return (
                  <div key={segment.key} className="rounded-lg border border-border/60 bg-muted/20 p-3">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">
                      {t(`reconciliation.${segment.key}`)}
                    </p>
                    <p className="mt-2 text-lg font-semibold">{pct.toFixed(1)}%</p>
                    <p className="text-xs text-muted-foreground">{kwh.toFixed(1)} kWh</p>
                  </div>
                );
              })}
            </div>
            <p className="text-xs text-muted-foreground">
              {t('reconciliation.equation')}
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
