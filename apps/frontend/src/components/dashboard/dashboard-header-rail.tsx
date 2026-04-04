'use client';

import { memo } from 'react';
import { useTranslations } from 'next-intl';
import type { IMachineSnapshot } from '@wpt/types';
import { MachineStatus } from '@wpt/types';
import { Badge } from '@/components/ui/badge';
import { useDashboardFormatters } from '@/lib/dashboard/formatters';
import type { DashboardConnectionState } from '@/lib/dashboard/selectors';

interface DashboardHeaderRailProps {
  connectionState: DashboardConnectionState;
  machineData: Partial<IMachineSnapshot> | null;
}

export const DashboardHeaderRail = memo(function DashboardHeaderRail({
  connectionState,
  machineData,
}: DashboardHeaderRailProps) {
  const t = useTranslations('dashboard');
  const fmt = useDashboardFormatters();

  const isLive = connectionState === 'live';
  const statusValue = machineData?.machineStatus;
  const isAlarmOrEmergency =
    statusValue === MachineStatus.ALARM || statusValue === MachineStatus.EMERGENCY;

  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      {/* Title block */}
      <div>
        <h1 className="text-xl font-semibold text-foreground">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
      </div>

      {/* Status cluster */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Connection badge */}
        <Badge
          className={`text-xs px-2.5 py-0.5 rounded-full font-medium ${
            isLive
              ? 'border-transparent bg-wpt-teal/15 text-wpt-teal'
              : 'border-transparent bg-wpt-gold/15 text-wpt-gold'
          }`}
        >
          {t(`connection.${connectionState}`)}
        </Badge>

        {/* Machine status badge */}
        <Badge
          className={`text-xs px-2.5 py-0.5 rounded-full font-medium ${
            isAlarmOrEmergency
              ? 'border-transparent bg-wpt-red/15 text-wpt-red'
              : 'border-transparent bg-wpt-teal/15 text-wpt-teal'
          }`}
        >
          {fmt.statusLabel(statusValue)}
        </Badge>

        {/* Cycle pill */}
        <span className="flex items-center gap-1.5">
          <span className="text-xs text-muted-foreground">{t('fields.selectedCycle')}</span>
          <span className="text-sm text-foreground/80">
            {fmt.cycleLabel(machineData?.selectedCycle)}
          </span>
        </span>

        {/* Phase pill */}
        <span className="flex items-center gap-1.5">
          <span className="text-xs text-muted-foreground">{t('fields.currentPhase')}</span>
          <span className="text-sm text-foreground/80">
            {fmt.phaseLabel(machineData?.currentPhase)}
          </span>
        </span>
      </div>
    </div>
  );
});
