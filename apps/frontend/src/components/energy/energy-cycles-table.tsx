'use client';

import { useTranslations } from 'next-intl';
import { formatItKwh, type IEnergyCyclesResponse } from '@wpt/types';
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
          <Table>
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
                  <TableCell className="font-medium">{row.cycleLabel.split('_').join(' ')}</TableCell>
                  <TableCell className="text-right">{row.cycleCount}</TableCell>
                  <TableCell className="text-right">{formatItKwh(row.totalKwh)}</TableCell>
                  <TableCell className="text-right">{row.totalKg.toFixed(0)} kg</TableCell>
                  <TableCell className="text-right">
                    {row.avgKwhPerKg == null ? '—' : row.avgKwhPerKg.toFixed(2)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
