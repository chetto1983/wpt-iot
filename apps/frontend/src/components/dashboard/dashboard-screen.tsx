'use client';

import { format } from 'date-fns';
import { AlertTriangle } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useWsData } from '@/lib/ws-context';
import { GAUGE_DEFS } from '@/lib/dashboard/fields';
import { getConnectionState } from '@/lib/dashboard/selectors';
import { DashboardSkeleton } from './dashboard-skeleton';
import { GaugeCard } from './gauge-card';
import { ProcessSnapshotCard } from './process-snapshot-card';
import { JobSnapshotCard } from './job-snapshot-card';
import { TechnicalSignalsCard } from './technical-signals-card';
import { ActiveAlarmsPanel } from './active-alarms-panel';

export function DashboardScreen() {
  const { machineData, alarms, connected, plcConnected, plcLastPacketAt } = useWsData();
  const t = useTranslations('dashboard');
  const connectionState = getConnectionState(machineData, connected, plcConnected);

  if (connectionState === 'plc-offline') {
    const lastSeen = plcLastPacketAt
      ? format(new Date(plcLastPacketAt), 'dd/MM/yyyy HH:mm:ss')
      : null;
    return (
      <div className="flex min-h-full items-center justify-center p-6">
        <div className="w-full max-w-md rounded-xl border border-wpt-gold/20 bg-[#383838] p-8 text-center shadow-lg shadow-black/20">
          <div className="mb-4 inline-flex size-14 items-center justify-center rounded-full border border-wpt-gold/30 bg-[#282828]">
            <AlertTriangle className="size-7 text-wpt-gold" strokeWidth={1.5} />
          </div>
          <h2 className="mb-2 text-lg font-semibold text-[#F5F5F5]">
            {t('states.plcOfflineTitle')}
          </h2>
          <p className="text-sm text-[#a7cdc5]">{t('states.plcOfflineHint')}</p>
          {lastSeen && (
            <p className="mt-3 text-xs text-[#8a8a8a]">
              {t('states.plcOfflineLastSeen', { timestamp: lastSeen })}
            </p>
          )}
        </div>
      </div>
    );
  }

  if (connectionState === 'waiting' || connectionState === 'offline') {
    return <DashboardSkeleton />;
  }

  return (
    <div className="min-h-full bg-gradient-to-b from-background to-background/80 p-6 xl:p-8 space-y-6">
      {connectionState === 'reconnecting' && (
        <div className="rounded-lg border border-wpt-gold/20 bg-wpt-gold/10 px-4 py-3 text-sm text-wpt-gold">
          {t('states.reconnectingBanner')}
        </div>
      )}

      {/* Gauge Grid */}
      <section
        className="opacity-0 animate-[fadeSlideIn_200ms_ease-out_forwards] grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-4"
        style={{ animationDelay: '0ms' }}
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
        style={{ animationDelay: '60ms' }}
      >
        <ProcessSnapshotCard machineData={machineData} />
        <JobSnapshotCard machineData={machineData} />
      </section>

      {/* Technical Signals (WPT-only, presence-gated) */}
      <section
        className="opacity-0 animate-[fadeSlideIn_200ms_ease-out_forwards]"
        style={{ animationDelay: '120ms' }}
      >
        <TechnicalSignalsCard machineData={machineData} />
      </section>

      {/* Active Alarms */}
      <section
        className="opacity-0 animate-[fadeSlideIn_200ms_ease-out_forwards]"
        style={{ animationDelay: '180ms' }}
      >
        <ActiveAlarmsPanel alarms={alarms} />
      </section>
    </div>
  );
}
