'use client';

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

export function DashboardHeaderRail({
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
        <h1 className="text-xl font-semibold text-white">{t('title')}</h1>
        <p className="text-sm text-white/60">{t('subtitle')}</p>
      </div>

      {/* Status cluster */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Connection badge */}
        <Badge
          className={
            isLive
              ? 'border-transparent bg-[#1ABC9C]/15 text-[#1ABC9C]'
              : 'border-transparent bg-[#bfae82]/15 text-[#bfae82]'
          }
        >
          {t(`connection.${connectionState}`)}
        </Badge>

        {/* Machine status badge */}
        <Badge
          className={
            isAlarmOrEmergency
              ? 'border-transparent bg-[#dc3545]/15 text-[#dc3545]'
              : 'border-transparent bg-[#1ABC9C]/15 text-[#1ABC9C]'
          }
        >
          {fmt.statusLabel(statusValue)}
        </Badge>

        {/* Cycle pill */}
        <span className="flex items-center gap-1.5">
          <span className="text-xs text-white/40">{t('fields.selectedCycle')}</span>
          <span className="text-sm text-white/80">
            {fmt.cycleLabel(machineData?.selectedCycle)}
          </span>
        </span>

        {/* Phase pill */}
        <span className="flex items-center gap-1.5">
          <span className="text-xs text-white/40">{t('fields.currentPhase')}</span>
          <span className="text-sm text-white/80">
            {fmt.phaseLabel(machineData?.currentPhase)}
          </span>
        </span>
      </div>
    </div>
  );
}
