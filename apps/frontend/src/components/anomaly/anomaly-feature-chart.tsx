'use client';

import { memo, useMemo } from 'react';
import { useTranslations } from 'next-intl';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  Cell,
} from 'recharts';
import type { IAnomalyLiveResponse } from '@wpt/types';

interface AnomalyFeatureChartProps {
  live: IAnomalyLiveResponse | null;
}

function featureLabel(key: string): string {
  const labels: Record<string, string> = {
    garbageTemp: 'Temperature',
    chamberPressure: 'Pressure',
    mainMotorSpeed: 'Motor Speed',
    mainMotorCurrent: 'Motor Current',
    mainMotorTorque: 'Motor Torque',
    vacuumPumpSpeed01: 'Vacuum Pump',
    energyConsumption: 'Energy',
    rmsCurrL1: 'RMS Curr L1',
    rmsCurrL2: 'RMS Curr L2',
    rmsCurrL3: 'RMS Curr L3',
    materialInputWeight: 'Input Weight',
    materialOutputWeight: 'Output Weight',
  };
  return labels[key] ?? key;
}

function barColor(z: number): string {
  if (z >= 3.5) return '#dc3545';
  if (z >= 2.5) return '#f59e0b';
  return '#1ABC9C';
}

export const AnomalyFeatureChart = memo(function AnomalyFeatureChart({
  live,
}: AnomalyFeatureChartProps) {
  const t = useTranslations('dashboard');

  const data = useMemo(() => {
    const contributors = live?.latest?.topContributors ?? [];
    return contributors.map((c) => ({
      name: featureLabel(c.feature),
      zScore: Number(c.zScore.toFixed(2)),
    }));
  }, [live]);

  if (data.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        {t('anomaly.featureChart.noData')}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {t('anomaly.featureChart.title')}
      </p>
      <ResponsiveContainer width="100%" height={140}>
        <BarChart data={data} layout="vertical" margin={{ left: 0, right: 8, top: 4, bottom: 4 }}>
          <XAxis
            type="number"
            domain={[0, 'auto']}
            tick={{ fontSize: 10, fill: '#888' }}
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            type="category"
            dataKey="name"
            tick={{ fontSize: 11, fill: '#aaa' }}
            tickLine={false}
            axisLine={false}
            width={95}
          />
          <Tooltip
            contentStyle={{
              background: 'hsl(var(--card))',
              border: '1px solid hsl(var(--border))',
              borderRadius: 8,
              fontSize: 12,
            }}
            formatter={(value) => [`z = ${Number(value).toFixed(2)}`, 'Z-Score']}
          />
          <ReferenceLine x={2.5} stroke="#f59e0b" strokeDasharray="3 3" strokeOpacity={0.5} />
          <ReferenceLine x={3.5} stroke="#dc3545" strokeDasharray="3 3" strokeOpacity={0.5} />
          <Bar dataKey="zScore" radius={[0, 4, 4, 0]} maxBarSize={20}>
            {data.map((entry, i) => (
              <Cell key={i} fill={barColor(entry.zScore)} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
});
