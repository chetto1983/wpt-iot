'use client';

import { useTranslations } from 'next-intl';
import type { IMachineSnapshot } from '@wpt/types';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { PROCESS_FIELDS } from '@/lib/dashboard/fields';
import { useDashboardFormatters } from '@/lib/dashboard/formatters';
import { MetricRow } from './metric-row';

interface ProcessSnapshotCardProps {
  machineData: Partial<IMachineSnapshot> | null;
}

export function ProcessSnapshotCard({ machineData }: ProcessSnapshotCardProps) {
  const t = useTranslations('dashboard');
  const formatters = useDashboardFormatters();

  function getFormattedValue(field: (typeof PROCESS_FIELDS)[number]): string {
    switch (field) {
      case 'selectedCycle':
        return formatters.cycleLabel(machineData?.selectedCycle);
      case 'currentPhase':
        return formatters.phaseLabel(machineData?.currentPhase);
      case 'machineStatus':
        return formatters.statusLabel(machineData?.machineStatus);
      default:
        return formatters.fieldValue(machineData?.[field]);
    }
  }

  return (
    <Card className="border-0 rounded-xl shadow-lg shadow-black/20">
      <CardHeader>
        <h3 className="text-xl font-semibold text-foreground">{t('sections.process')}</h3>
      </CardHeader>
      <CardContent>
        {PROCESS_FIELDS.map((field) => (
          <MetricRow
            key={field}
            label={t(`fields.${field}`)}
            value={getFormattedValue(field)}
          />
        ))}
      </CardContent>
    </Card>
  );
}
