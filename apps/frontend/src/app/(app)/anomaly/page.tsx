'use client';

import { useTranslations } from 'next-intl';
import { AnomalyDashboard } from '@/components/anomaly/anomaly-dashboard';

export default function AnomalyPage() {
  const t = useTranslations('anomalyPage');

  return (
    <div className="space-y-6 p-6 xl:p-8">
      <div className="space-y-2">
        <h1 className="text-xl font-semibold">{t('title')}</h1>
        <p className="max-w-3xl text-sm text-muted-foreground">
          {t('subtitle')}
        </p>
      </div>

      <AnomalyDashboard />
    </div>
  );
}
