'use client';

import { useTranslations } from 'next-intl';
import { formatItEur, formatItKgCO2, formatItKwh, type IEnergyDashboardSummary } from '@wpt/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

interface EnergySavingsWidgetProps {
  summary: IEnergyDashboardSummary | null;
  loading: boolean;
  canManageBaseline?: boolean;
  onCreateBaseline?: () => void;
}

function formatDeltaPct(value: number): string {
  return `${Math.abs(value).toFixed(1)}%`;
}

export function EnergySavingsWidget({
  summary,
  loading,
  canManageBaseline = false,
  onCreateBaseline,
}: EnergySavingsWidgetProps) {
  const t = useTranslations('energy');
  const savings = summary?.savings ?? null;
  const showCreateBaseline = summary?.savingsUnavailableReason === 'NO_ACTIVE_BASELINE' && canManageBaseline && onCreateBaseline;
  const status =
    savings == null
      ? 'empty'
      : savings.deltaPct < 0
        ? 'below'
        : savings.deltaPct > 0
          ? 'above'
          : 'flat';

  return (
    <Card className="border border-border/70">
      <CardHeader>
        <CardDescription>{t('savings.kicker')}</CardDescription>
        <CardTitle>{t('savings.title')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <div className="space-y-3">
            <Skeleton className="h-8 w-32" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        ) : savings == null ? (
          <div className="space-y-3">
            <Badge variant="outline">{t('savings.noBaselineBadge')}</Badge>
            <p className="text-sm text-muted-foreground">
              {summary?.savingsUnavailableReason === 'NO_ACTIVE_BASELINE'
                ? t('savings.noBaseline')
                : t('savings.unavailable')}
            </p>
            {showCreateBaseline ? (
              <Button type="button" variant="outline" onClick={onCreateBaseline} className="w-full sm:w-auto">
                {t('savings.createAction')}
              </Button>
            ) : null}
          </div>
        ) : (
          <>
            <div className="flex items-end justify-between gap-3">
              <div>
                <p className="text-3xl font-semibold tracking-tight">
                  {formatDeltaPct(savings.deltaPct)}
                </p>
                <p className="text-sm text-muted-foreground">
                  {status === 'below'
                    ? t('savings.below')
                    : status === 'above'
                      ? t('savings.above')
                      : t('savings.flat')}
                </p>
              </div>
              <Badge
                variant={
                  status === 'below'
                    ? 'secondary'
                    : status === 'above'
                      ? 'destructive'
                      : 'outline'
                }
              >
                {status === 'below'
                  ? t('savings.good')
                  : status === 'above'
                    ? t('savings.warning')
                    : t('savings.neutral')}
              </Badge>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-lg border border-border/60 bg-muted/30 p-3">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  {t('savings.impactKwh')}
                </p>
                <p className="mt-2 font-medium">
                  {formatItKwh(Math.abs(savings.deltaKwh))}
                </p>
              </div>
              <div className="rounded-lg border border-border/60 bg-muted/30 p-3">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  {t('savings.impactEur')}
                </p>
                <p className="mt-2 font-medium">
                  {formatItEur(Math.abs(savings.deltaEur))}
                </p>
              </div>
              <div className="rounded-lg border border-border/60 bg-muted/30 p-3">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  {t('savings.impactCo2')}
                </p>
                <p className="mt-2 font-medium">
                  {formatItKgCO2(Math.abs(savings.deltaKgco2))}
                </p>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
