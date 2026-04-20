'use client';

import { memo, useCallback, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Check, Loader2, Trash2, X } from 'lucide-react';
import type { IMachineAnomalyEvent } from '@wpt/types';
import { apiFetch } from '@/lib/api';
import { useAppLocale } from '@/lib/locale';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

interface AnomalyEventTableProps {
  events: IMachineAnomalyEvent[];
  onRefresh: () => void;
}

function statusVariant(status: string): { variant?: 'outline' | 'default' | 'secondary'; severity?: 'high' } {
  switch (status) {
    case 'OPEN':         return { severity: 'high' };
    case 'ACKNOWLEDGED': return { variant: 'outline' };
    case 'CONFIRMED':    return { variant: 'default' };
    default:             return { variant: 'secondary' };
  }
}

export const AnomalyEventTable = memo(function AnomalyEventTable({
  events,
  onRefresh,
}: AnomalyEventTableProps) {
  const t = useTranslations('dashboard');
  const { formatDateTime } = useAppLocale();
  const [busy, setBusy] = useState<number | null>(null);

  const handleAck = useCallback(async (id: number) => {
    setBusy(id);
    try {
      await apiFetch(`/api/anomaly/events/${id}/acknowledge`, { method: 'PATCH' });
      onRefresh();
    } finally { setBusy(null); }
  }, [onRefresh]);

  const handleResolve = useCallback(async (id: number, status: 'CONFIRMED' | 'DISMISSED') => {
    setBusy(id);
    try {
      await apiFetch(`/api/anomaly/events/${id}/resolve`, {
        method: 'PATCH',
        body: JSON.stringify({
          status,
          category: status === 'CONFIRMED' ? 'TRUE_POSITIVE' : 'FALSE_POSITIVE',
        }),
      });
      onRefresh();
    } finally { setBusy(null); }
  }, [onRefresh]);

  const handleDelete = useCallback(async (id: number) => {
    if (!confirm(t('anomaly.actions.confirmDelete'))) return;
    setBusy(id);
    try {
      await apiFetch(`/api/anomaly/events/${id}`, { method: 'DELETE' });
      onRefresh();
    } finally { setBusy(null); }
  }, [onRefresh, t]);

  if (events.length === 0) {
    return (
      <div className="rounded-lg border border-border/60 bg-background/40 px-4 py-6 text-center">
        <p className="text-sm font-semibold text-muted-foreground">{t('anomaly.noEventsTitle')}</p>
        <p className="mt-1 text-xs text-muted-foreground/70">{t('anomaly.noEventsBody')}</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {events.map((ev) => {
        const isOpen = ev.status === 'OPEN';
        const isAcked = ev.status === 'ACKNOWLEDGED';
        const loading = busy === ev.id;

        return (
          <div key={ev.id} className="rounded-lg border border-border/60 bg-background/40 px-4 py-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Badge {...statusVariant(ev.status)}>
                  {t(`anomaly.status.${ev.status}`)}
                </Badge>
                <span className="text-sm font-semibold tabular-nums">
                  {t('anomaly.scoreLabel', { score: ev.score.toFixed(2) })}
                </span>
              </div>
              <span className="text-xs text-muted-foreground">
                {formatDateTime(new Date(ev.observedAt))}
              </span>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <span>{t('anomaly.modeLabel', { mode: ev.modeKey })}</span>
              <span className="inline-flex items-center gap-1.5">
                {t('anomaly.driverLabel', { driver: ev.topContributors[0]?.feature ?? '—' })}
                {/* Phase 40 D-14/D-15: inline attribution — present when detector populated contribution/direction. */}
                {ev.topContributors[0]?.contribution !== undefined && (
                  <span className="tabular-nums text-muted-foreground/80">
                    · {Math.round((ev.topContributors[0].contribution ?? 0) * 100)}%
                  </span>
                )}
                {ev.topContributors[0]?.direction === 'HIGH' && (
                  <Badge severity="high" className="h-4 gap-0.5 px-1.5 text-[10px]">
                    ↑ {t('anomaly.direction.high')}
                  </Badge>
                )}
                {ev.topContributors[0]?.direction === 'LOW' && (
                  <Badge severity="low" className="h-4 gap-0.5 px-1.5 text-[10px]">
                    ↓ {t('anomaly.direction.low')}
                  </Badge>
                )}
              </span>
              {ev.resolvedBy && <span>{t('anomaly.resolvedBy', { user: ev.resolvedBy })}</span>}
            </div>
            {(isOpen || isAcked) && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {isOpen && (
                  <Button type="button" size="sm" variant="outline" className="h-7 text-xs" disabled={loading}
                    onClick={() => void handleAck(ev.id)}>
                    {loading ? <Loader2 className="mr-1 size-3 animate-spin" /> : <Check className="mr-1 size-3" />}
                    {t('anomaly.actions.acknowledge')}
                  </Button>
                )}
                <Button type="button" size="sm" variant="outline" className="h-7 text-xs text-green-700 dark:text-green-400" disabled={loading}
                  onClick={() => void handleResolve(ev.id, 'CONFIRMED')}>
                  <Check className="mr-1 size-3" />{t('anomaly.actions.confirm')}
                </Button>
                <Button type="button" size="sm" variant="outline" className="h-7 text-xs text-wpt-gold-accessible" disabled={loading}
                  onClick={() => void handleResolve(ev.id, 'DISMISSED')}>
                  <X className="mr-1 size-3" />{t('anomaly.actions.dismiss')}
                </Button>
                <Button type="button" size="sm" variant="ghost" className="h-7 text-xs text-destructive dark:text-red-400" disabled={loading}
                  onClick={() => void handleDelete(ev.id)}>
                  <Trash2 className="mr-1 size-3" />{t('anomaly.actions.delete')}
                </Button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
});
