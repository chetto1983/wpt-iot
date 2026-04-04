'use client';

import dynamic from 'next/dynamic';
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

export function GaugeCard({ label, value, unit, min, max, subArcs, className }: GaugeCardProps) {
  const displayValue = value !== undefined ? value : min;

  return (
    <Card className={`bg-[#383838] border-0 text-white rounded-xl shadow-lg shadow-black/20 min-h-[180px] xl:min-h-[220px] ${className ?? ''}`}>
      <CardHeader>
        <p className="text-xs font-semibold text-white/40 uppercase tracking-wider">
          {label}
        </p>
      </CardHeader>
      <CardContent className="flex flex-col items-center gap-1">
        <GaugeComponent
          type="semicircle"
          value={displayValue}
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
            valueLabel: {
              formatTextValue: (val: number) => `${Math.round(val)} ${unit}`,
              style: {
                fontSize: '22px',
                fill: '#F5F5F5',
                textShadow: 'none',
              },
            },
            tickLabels: {
              type: 'outer',
              defaultTickValueConfig: {
                style: { fontSize: '10px', fill: '#888' },
              },
            },
          }}
          style={{ width: '100%', height: '130px' }}
        />
      </CardContent>
    </Card>
  );
}
