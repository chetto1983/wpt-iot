'use client';

import { useTranslations } from 'next-intl';
import type { IActiveAlarm } from '@wpt/types';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useDashboardFormatters } from '@/lib/dashboard/formatters';

interface ActiveAlarmsPanelProps {
  alarms: IActiveAlarm[];
}

export function ActiveAlarmsPanel({ alarms }: ActiveAlarmsPanelProps) {
  const t = useTranslations('dashboard');
  const formatters = useDashboardFormatters();

  const sorted = [...alarms].sort(
    (a, b) => new Date(b.activatedAt).getTime() - new Date(a.activatedAt).getTime(),
  );

  return (
    <Card className="bg-[#383838] border-0 text-white rounded-xl shadow-lg shadow-black/20">
      <CardHeader>
        <div className="flex items-center gap-3">
          <h3 className="text-lg font-semibold text-white">{t('sections.alarms')}</h3>
          {alarms.length > 0 && (
            <Badge variant="destructive">{alarms.length}</Badge>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {alarms.length === 0 ? (
          <div className="py-8 text-center">
            <p className="text-sm font-semibold text-white/60">{t('empty.alarmsTitle')}</p>
            <p className="text-xs text-white/40 mt-1">{t('empty.alarmsBody')}</p>
          </div>
        ) : (
          <div className="max-h-[320px] overflow-y-auto space-y-1">
            {sorted.map((alarm) => (
              <div
                key={`${alarm.wordIndex}-${alarm.bitIndex}`}
                className="flex items-center gap-3 py-3 px-2 border-b border-white/5 last:border-0 hover:bg-white/[0.03] transition-colors duration-100"
              >
                <span className="text-xs font-mono text-[#dc3545] font-semibold min-w-[56px]">
                  A{String(alarm.alarmIndex + 1).padStart(4, '0')}
                </span>
                <span className="text-sm text-white/80 flex-1">
                  {formatters.alarmDescription(alarm)}
                </span>
                <span className="text-xs text-white/30 shrink-0">
                  {new Date(alarm.activatedAt).toLocaleTimeString()}
                </span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
