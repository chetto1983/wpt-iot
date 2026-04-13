'use client';

import { memo } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Activity, AlertTriangle, Brain, Clock, Layers } from 'lucide-react';
import type { IAnomalyLiveResponse } from '@wpt/types';
import { Badge } from '@/components/ui/badge';

interface AnomalyModelHealthProps {
  live: IAnomalyLiveResponse | null;
}

function formatUptime(ms: number): string {
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export const AnomalyModelHealth = memo(function AnomalyModelHealth({
  live,
}: AnomalyModelHealthProps) {
  const t = useTranslations('dashboard');
  const locale = useLocale();
  const metrics = live?.tracking.detectorMetrics;
  const latest = live?.latest;

  const rows = [
    {
      icon: Activity,
      label: t('anomaly.observations'),
      value: metrics
        ? new Intl.NumberFormat(locale).format(metrics.totalObservations)
        : '—',
    },
    {
      icon: Layers,
      label: t('anomaly.modelHealth.modes'),
      value: metrics ? `${metrics.warmModes}/${metrics.modesTracked}` : '—',
    },
    {
      icon: Clock,
      label: t('anomaly.modelHealth.uptime'),
      value: metrics ? formatUptime(metrics.uptimeMs) : '—',
    },
    {
      icon: AlertTriangle,
      label: t('anomaly.modelHealth.flagged'),
      value: metrics ? String(metrics.totalFlagged) : '0',
    },
    {
      icon: Brain,
      label: t('anomaly.modelHealth.confidence'),
      value: latest?.confidence !== undefined
        ? `${(latest.confidence * 100).toFixed(0)}%`
        : '—',
    },
  ];

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {t('anomaly.modelHealth.title')}
        </p>
        {live?.tracking.persistsAcrossRestart && (
          <Badge variant="outline" className="text-[10px]">
            {t('anomaly.modelHealth.persistent')}
          </Badge>
        )}
      </div>
      <div className="space-y-2">
        {rows.map((row) => (
          <div key={row.label} className="flex items-center justify-between gap-3 text-sm">
            <div className="flex items-center gap-2 text-muted-foreground">
              <row.icon className="size-3.5" />
              <span>{row.label}</span>
            </div>
            <span className="font-semibold tabular-nums">{row.value}</span>
          </div>
        ))}
      </div>
      {latest?.driftDetected && (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
          {t('anomaly.modelHealth.driftWarning')}
        </div>
      )}
    </div>
  );
});
