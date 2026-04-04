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
    <div className="min-h-full bg-gradient-to-b from-[#282828] via-[#282828] to-[#1e1e1e] p-6 xl:p-8 space-y-6">
      {/* Header Rail */}
      <div
        className="opacity-0 animate-[fadeSlideIn_200ms_ease-out_forwards]"
        style={{ animationDelay: '0ms' }}
      >
        <DashboardHeaderRail
          connectionState={connectionState}
          machineData={machineData}
        />
      </div>

      {connectionState === 'reconnecting' && (
        <div className="rounded-lg border border-[#bfae82]/20 bg-[#bfae82]/10 px-4 py-3 text-sm text-[#bfae82]">
          {t('states.reconnectingBanner')}
        </div>
      )}

      {/* Gauge Grid */}
      <section
        className="opacity-0 animate-[fadeSlideIn_200ms_ease-out_forwards] grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-4"
        style={{ animationDelay: '60ms' }}
      >
        {GAUGE_DEFS.map((gauge) => (
          <GaugeCard
            key={gauge.key}
            label={t(`gauges.${gauge.tKey}`)}
            value={machineData?.[gauge.key] as number | undefined}
            unit={gauge.unit}
            min={gauge.min}
            max={gauge.max}
            subArcs={gauge.subArcs}
          />
        ))}
      </section>

      {/* Detail Cards */}
      <section
        className="opacity-0 animate-[fadeSlideIn_200ms_ease-out_forwards] grid grid-cols-1 gap-6 lg:grid-cols-2"
        style={{ animationDelay: '120ms' }}
      >
        <ProcessSnapshotCard machineData={machineData} />
        <JobSnapshotCard machineData={machineData} />
      </section>

      {/* Technical Signals (WPT-only, presence-gated) */}
      <section
        className="opacity-0 animate-[fadeSlideIn_200ms_ease-out_forwards]"
        style={{ animationDelay: '180ms' }}
      >
        <TechnicalSignalsCard machineData={machineData} />
      </section>

      {/* Active Alarms */}
      <section
        className="opacity-0 animate-[fadeSlideIn_200ms_ease-out_forwards]"
        style={{ animationDelay: '240ms' }}
      >
        <ActiveAlarmsPanel alarms={alarms} />
      </section>
    </div>
  );
}
