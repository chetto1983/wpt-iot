'use client';

import { memo } from 'react';
import { useTranslations } from 'next-intl';
import type { IMachineSnapshot } from '@wpt/types';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { JOB_FIELDS } from '@/lib/dashboard/fields';
import { useDashboardFormatters } from '@/lib/dashboard/formatters';
import { MetricRow } from './metric-row';

interface JobSnapshotCardProps {
  machineData: Partial<IMachineSnapshot> | null;
}

export const JobSnapshotCard = memo(function JobSnapshotCard({ machineData }: JobSnapshotCardProps) {
  const t = useTranslations('dashboard');
  const formatters = useDashboardFormatters();

  return (
    <Card className="border-0 rounded-xl shadow-lg shadow-black/20">
      <CardHeader>
        <h3 className="text-xl font-semibold text-foreground">{t('sections.job')}</h3>
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
});
