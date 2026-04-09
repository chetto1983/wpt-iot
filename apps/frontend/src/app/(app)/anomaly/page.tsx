'use client';

import { useTranslations } from 'next-intl';

import { MachineAnomalyCard } from '@/components/dashboard/machine-anomaly-card';

export default function AnomalyPage() {
  const t = useTranslations('anomalyPage');

  return (
    <div className="space-y-6 p-6">
      <div className="space-y-2">
        <h1 className="text-xl font-semibold">{t('title')}</h1>
        <p className="max-w-3xl text-sm text-muted-foreground">
          {t('subtitle')}
        </p>
      </div>

      <MachineAnomalyCard eventLimit={10} />
    </div>
  );
}
