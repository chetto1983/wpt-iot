'use client';

import { useTranslations } from 'next-intl';
import { useWsData } from '@/lib/ws-context';
import { GAUGE_DEFS } from '@/lib/dashboard/fields';
import { getConnectionState } from '@/lib/dashboard/selectors';
import { DashboardSkeleton } from './dashboard-skeleton';
import { DashboardHeaderRail } from './dashboard-header-rail';
import { GaugeCard } from './gauge-card';
import { ProcessSnapshotCard } from './process-snapshot-card';
import { JobSnapshotCard } from './job-snapshot-card';
import { TechnicalSignalsCard } from './technical-signals-card';
import { ActiveAlarmsPanel } from './active-alarms-panel';

export function DashboardScreen() {
  const { machineData, alarms, connected } = useWsData();
  const t = useTranslations('dashboard');
  const connectionState = getConnectionState(machineData, connected);

  if (connectionState === 'waiting' || connectionState === 'offline') {
    return <DashboardSkeleton />;
  }

  return (
    <div className="min-h-full bg-[#282828] p-6 xl:p-8">
      <DashboardHeaderRail
        connectionState={connectionState}
        machineData={machineData}
      />

      {connectionState === 'reconnecting' && (
        <div className="mt-6 rounded-lg border border-[#bfae82]/20 bg-[#bfae82]/10 px-4 py-3 text-sm text-[#bfae82]">
          {t('states.reconnectingBanner')}
        </div>
      )}

      {/* Gauge Grid */}
      <section className="mt-6 grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-4">
        {GAUGE_DEFS.map((gauge) => (
          <GaugeCard
            key={gauge.key}
            label={t(`gauges.${gauge.tKey}`)}
            value={machineData?.[gauge.key] as number | undefined}
          />
        ))}
      </section>

      {/* Detail Cards */}
      <section className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <ProcessSnapshotCard machineData={machineData} />
        <JobSnapshotCard machineData={machineData} />
      </section>

      {/* Technical Signals (WPT-only, presence-gated) */}
      <section className="mt-6">
        <TechnicalSignalsCard machineData={machineData} />
      </section>

      {/* Active Alarms */}
      <section className="mt-6">
        <ActiveAlarmsPanel alarms={alarms} />
      </section>
    </div>
  );
}
