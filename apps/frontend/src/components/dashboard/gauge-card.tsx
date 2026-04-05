'use client';

import { memo } from 'react';
import dynamic from 'next/dynamic';
import { useTranslations } from 'next-intl';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import type { IGaugeSubArc } from '@/lib/dashboard/fields';

const GaugeComponent = dynamic(() => import('react-gauge-component'), {
  ssr: false,
  loading: () => <div className="h-[130px]" />,
});

interface GaugeCardProps {
  label: string;
  value: number | undefined;
  unit: string;
  min: number;
  max: number;
  subArcs: IGaugeSubArc[];
  className?: string;
}

export const GaugeCard = memo(function GaugeCard({ label, value, unit, min, max, subArcs, className }: GaugeCardProps) {
  const t = useTranslations('dashboard');

  return (
    <Card className={`border-0 rounded-xl shadow-lg shadow-black/20 min-h-[180px] xl:min-h-[220px] ${className ?? ''}`}>
      <CardHeader>
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          {label}
        </p>
      </CardHeader>
      <CardContent className="flex flex-col items-center gap-1">
        {value !== undefined ? (
          <>
            <GaugeComponent
              type="semicircle"
              value={value}
              minValue={min}
              maxValue={max}
              arc={{
                subArcs: subArcs.map((sa) => ({
                  limit: sa.limit,
                  color: sa.color,
                  showTick: true,
                })),
                padding: 0.02,
                width: 0.15,
                emptyColor: '#282828',
              }}
              pointer={{
                type: 'needle',
                color: '#a7cdc5',
                length: 0.7,
                width: 8,
                elastic: true,
              }}
              labels={{
                valueLabel: { hide: true },
                tickLabels: {
                  type: 'outer',
                  defaultTickValueConfig: {
                    style: { fontSize: '10px', fill: '#888' },
                  },
                },
              }}
              style={{ width: '100%', height: '130px' }}
            />
            <p className="text-lg font-semibold text-foreground tabular-nums -mt-1">
              {Math.round(value)} <span className="text-sm font-normal text-muted-foreground">{unit}</span>
            </p>
          </>
        ) : (
          <>
            <div className="flex items-center justify-center h-[130px]">
              <span className="text-2xl font-semibold text-muted-foreground/40 tabular-nums">
                {t('noData')}
              </span>
            </div>
            <p className="text-lg font-semibold text-muted-foreground/40 -mt-1">
              {t('noData')} <span className="text-sm font-normal text-muted-foreground/40">{unit}</span>
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
});
