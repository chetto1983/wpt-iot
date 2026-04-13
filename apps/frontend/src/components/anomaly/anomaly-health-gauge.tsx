'use client';

import { memo } from 'react';
import dynamic from 'next/dynamic';
import { useTranslations } from 'next-intl';
import type { IAnomalyLiveResponse } from '@wpt/types';

const GaugeComponent = dynamic(() => import('react-gauge-component'), {
  ssr: false,
  loading: () => <div className="h-[140px]" />,
});

interface AnomalyHealthGaugeProps {
  live: IAnomalyLiveResponse | null;
}

/**
 * Converts composite anomaly score (0–10+) to a 0–100 health score.
 * High anomaly score → low health. Clamped to [0, 100].
 */
function scoreToHealth(score: number | undefined): number {
  if (score === undefined) return 100;
  // Map: 0 → 100 (perfect), criticalThreshold(3.5) → 30, 7+ → 0
  const health = Math.max(0, Math.min(100, 100 - score * 14.3));
  return Math.round(health);
}

export const AnomalyHealthGauge = memo(function AnomalyHealthGauge({
  live,
}: AnomalyHealthGaugeProps) {
  const t = useTranslations('dashboard');
  const health = scoreToHealth(live?.latest?.score);
  const level = live?.latest?.level ?? 'normal';

  const levelColor =
    level === 'critical' ? '#dc3545' :
    level === 'warning' ? '#f59e0b' :
    '#1ABC9C';

  return (
    <div className="flex flex-col items-center gap-2">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {t('anomaly.healthGauge')}
      </p>
      <GaugeComponent
        type="semicircle"
        value={health}
        minValue={0}
        maxValue={100}
        arc={{
          subArcs: [
            { limit: 30, color: '#dc3545', showTick: true },
            { limit: 60, color: '#f59e0b', showTick: true },
            { limit: 100, color: '#1ABC9C', showTick: true },
          ],
          padding: 0.02,
          width: 0.15,
          emptyColor: '#282828',
        }}
        pointer={{
          type: 'arrow',
          color: '#a7cdc5',
          length: 0.7,
          width: 12,
        }}
        labels={{
          valueLabel: {
            formatTextValue: (v: number) => `${v}`,
            style: {
              fontSize: '36px',
              fill: levelColor,
              textShadow: 'none',
            },
          },
          tickLabels: { hideMinMax: true },
        }}
      />
      <p className="text-xs font-semibold" style={{ color: levelColor }}>
        {t(`anomaly.state.${level === 'critical' ? 'flagged' : level === 'warning' ? 'flagged' : 'normal'}`)}
      </p>
    </div>
  );
});
