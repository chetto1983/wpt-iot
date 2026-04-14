'use client';

import { useTranslations } from 'next-intl';
import { formatItKwh, type IEnergyCyclesResponse } from '@wpt/types';

import { useIsMobile } from '@/hooks/use-mobile';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

export function buildEnergyCyclesPath(from: Date, to: Date, limit = 10): string {
  const params = new URLSearchParams({
    from: from.toISOString(),
    to: to.toISOString(),
    limit: String(limit),
  });
  return `/api/energy/cycles?${params.toString()}`;
}

interface EnergyCyclesTableProps {
  data: IEnergyCyclesResponse | null;
  loading: boolean;
  error: string | null;
}

export function EnergyCyclesTable({
  data,
  loading,
  error,
}: EnergyCyclesTableProps) {
  const t = useTranslations('energy');
  const isMobile = useIsMobile();

  return (
    <Card className="border border-border/70">
      <CardHeader>
        <CardDescription>{t('cycles.kicker')}</CardDescription>
        <CardTitle>{t('cycles.title')}</CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, index) => (
              <Skeleton key={index} className="h-10 w-full" />
            ))}
          </div>
        ) : error ? (
          <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-4 text-sm text-destructive">
            {error}
          </div>
        ) : !data || data.rows.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border/70 p-6 text-sm text-muted-foreground">
            {t('cycles.empty')}
          </div>
        ) : (
          <>
            {isMobile ? (
            <div className="grid gap-3">
              {data.rows.map((row) => (
                <div
                  key={row.cycleLabelKey}
                  className="rounded-2xl border border-border/70 bg-background/80 p-4 shadow-sm"
                >
                  <p className="text-sm font-semibold">
                    {row.cycleLabel.split('_').join(' ')}
                  </p>
                  <dl className="mt-4 grid gap-3 sm:grid-cols-2">
                    <div className="rounded-xl bg-muted/30 p-3">
                      <dt className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                        {t('cycles.count')}
                      </dt>
                      <dd className="mt-1 text-sm font-medium">{row.cycleCount}</dd>
                    </div>
                    <div className="rounded-xl bg-muted/30 p-3">
                      <dt className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                        {t('cycles.totalKwh')}
                      </dt>
                      <dd className="mt-1 text-sm font-medium">{formatItKwh(row.totalKwh)}</dd>
                    </div>
                    <div className="rounded-xl bg-muted/30 p-3">
                      <dt className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                        {t('cycles.totalKg')}
                      </dt>
                      <dd className="mt-1 text-sm font-medium">{row.totalKg.toFixed(0)} kg</dd>
                    </div>
                    <div className="rounded-xl bg-muted/30 p-3">
                      <dt className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                        {t('cycles.avgKwhPerKg')}
                      </dt>
                      <dd className="mt-1 text-sm font-medium">
                        {row.avgKwhPerKg == null ? '-' : row.avgKwhPerKg.toFixed(2)}
                      </dd>
                    </div>
                  </dl>
                </div>
              ))}
            </div>
            ) : (
              <Table className="min-w-[640px]">
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('cycles.cycle')}</TableHead>
                    <TableHead className="text-right">{t('cycles.count')}</TableHead>
                    <TableHead className="text-right">{t('cycles.totalKwh')}</TableHead>
                    <TableHead className="text-right">{t('cycles.totalKg')}</TableHead>
                    <TableHead className="text-right">{t('cycles.avgKwhPerKg')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.rows.map((row) => (
                    <TableRow key={row.cycleLabelKey}>
                      <TableCell className="font-medium">
                        {row.cycleLabel.split('_').join(' ')}
                      </TableCell>
                      <TableCell className="text-right whitespace-nowrap">
                        {row.cycleCount}
                      </TableCell>
                      <TableCell className="text-right whitespace-nowrap">
                        {formatItKwh(row.totalKwh)}
                      </TableCell>
                      <TableCell className="text-right whitespace-nowrap">
                        {row.totalKg.toFixed(0)} kg
                      </TableCell>
                      <TableCell className="text-right whitespace-nowrap">
                        {row.avgKwhPerKg == null ? '-' : row.avgKwhPerKg.toFixed(2)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
