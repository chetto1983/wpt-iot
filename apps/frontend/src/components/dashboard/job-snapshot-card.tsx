'use client';

import { useTranslations } from 'next-intl';
import type { IMachineSnapshot } from '@wpt/types';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { JOB_FIELDS } from '@/lib/dashboard/fields';
import { useDashboardFormatters } from '@/lib/dashboard/formatters';
import { MetricRow } from './metric-row';

interface JobSnapshotCardProps {
  machineData: Partial<IMachineSnapshot> | null;
}

export function JobSnapshotCard({ machineData }: JobSnapshotCardProps) {
  const t = useTranslations('dashboard');
  const formatters = useDashboardFormatters();

  return (
    <Card className="bg-[#383838] border-0 text-white rounded-xl shadow-lg shadow-black/20">
      <CardHeader>
        <h3 className="text-lg font-semibold text-white">{t('sections.job')}</h3>
      </CardHeader>
      <CardContent>
        {JOB_FIELDS.map((field) => (
          <MetricRow
            key={field}
            label={t(`fields.${field}`)}
            value={formatters.fieldValue(machineData?.[field])}
          />
        ))}
      </CardContent>
    </Card>
  );
}
