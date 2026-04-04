'use client';

import { memo } from 'react';
import { useTranslations } from 'next-intl';
import type { IActiveAlarm } from '@wpt/types';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useDashboardFormatters } from '@/lib/dashboard/formatters';

interface ActiveAlarmsPanelProps {
  alarms: IActiveAlarm[];
}

export const ActiveAlarmsPanel = memo(function ActiveAlarmsPanel({ alarms }: ActiveAlarmsPanelProps) {
  const t = useTranslations('dashboard');
  const formatters = useDashboardFormatters();

  const sorted = [...alarms].sort(
    (a, b) => new Date(b.activatedAt).getTime() - new Date(a.activatedAt).getTime(),
  );

  return (
    <Card className="border-0 rounded-xl shadow-lg shadow-black/20">
      <CardHeader>
        <div className="flex items-center gap-3">
          <h3 className="text-xl font-semibold text-foreground">{t('sections.alarms')}</h3>
          {alarms.length > 0 && (
            <Badge variant="destructive">{alarms.length}</Badge>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {alarms.length === 0 ? (
          <div className="py-8 text-center">
            <p className="text-sm font-semibold text-muted-foreground">{t('empty.alarmsTitle')}</p>
            <p className="text-xs text-muted-foreground/60 mt-1">{t('empty.alarmsBody')}</p>
          </div>
        ) : (
          <div className="max-h-[320px] overflow-y-auto space-y-1">
            {sorted.map((alarm) => (
              <div
                key={`${alarm.wordIndex}-${alarm.bitIndex}`}
                className="flex items-center gap-3 py-3 px-2 border-b border-border last:border-0 hover:bg-muted/50 transition-colors duration-100"
              >
                <span className="text-xs font-mono text-wpt-red font-semibold min-w-[56px]">
                  A{String(alarm.alarmIndex + 1).padStart(4, '0')}
                </span>
                <span className="text-sm text-foreground/80 flex-1">
                  {formatters.alarmDescription(alarm)}
                </span>
                <span className="text-xs text-muted-foreground/60 shrink-0">
                  {new Date(alarm.activatedAt).toLocaleTimeString()}
                </span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
});
