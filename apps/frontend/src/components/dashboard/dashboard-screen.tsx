'use client';

import { useTranslations } from 'next-intl';
import { useWsData } from '@/lib/ws-context';
import { getConnectionState } from '@/lib/dashboard/selectors';
import { DashboardSkeleton } from './dashboard-skeleton';
import { DashboardHeaderRail } from './dashboard-header-rail';

export function DashboardScreen() {
  const { machineData, alarms: _alarms, connected } = useWsData();
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

      {/* Gauge Grid -- Plan 02 */}
      <section className="mt-6 grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-4">
        {/* GaugeCard x4 will go here */}
      </section>

      {/* Detail Cards -- Plan 02 */}
      <section className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* ProcessSnapshotCard and JobSnapshotCard will go here */}
      </section>

      {/* Technical Signals -- Plan 02 */}

      {/* ActiveAlarmsPanel -- Plan 02 */}
    </div>
  );
}
