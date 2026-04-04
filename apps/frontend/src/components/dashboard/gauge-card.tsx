'use client';

import { RadialBarChart, RadialBar, PolarAngleAxis, ResponsiveContainer } from 'recharts';
import { Card, CardContent, CardHeader } from '@/components/ui/card';

interface GaugeCardProps {
  label: string;
  value: number | undefined;
  className?: string;
}

export function GaugeCard({ label, value, className }: GaugeCardProps) {
  const displayValue = value !== undefined ? value : 0;
  const clampedValue = Math.min(displayValue, 100);
  const data = [{ value: clampedValue, fill: '#1ABC9C' }];

  return (
    <Card className={`bg-[#383838] border-0 text-white rounded-xl shadow-lg shadow-black/20 min-h-[180px] xl:min-h-[220px] ${className ?? ''}`}>
      <CardHeader>
        <p className="text-xs font-semibold text-white/40 uppercase tracking-wider">
          {label}
        </p>
      </CardHeader>
      <CardContent className="flex flex-col items-center gap-2">
        <ResponsiveContainer width="100%" height={120}>
          <RadialBarChart
            cx="50%"
            cy="70%"
            innerRadius="70%"
            outerRadius="100%"
            startAngle={180}
            endAngle={0}
            data={data}
            barSize={10}
          >
            <PolarAngleAxis
              type="number"
              domain={[0, 100]}
              angleAxisId={0}
              tick={false}
            />
            <RadialBar
              background={{ fill: '#282828' }}
              dataKey="value"
              cornerRadius={4}
            />
          </RadialBarChart>
        </ResponsiveContainer>
        <p className="text-2xl font-semibold text-white text-center">
          {value !== undefined ? value : '\u2014'}
        </p>
      </CardContent>
    </Card>
  );
}
