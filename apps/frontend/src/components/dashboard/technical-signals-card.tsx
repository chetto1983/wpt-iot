'use client';

import { memo } from 'react';
import { useTranslations } from 'next-intl';
import type { IMachineSnapshot } from '@wpt/types';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { TECHNICAL_GROUPS } from '@/lib/dashboard/fields';
import { hasTechnicalSignals } from '@/lib/dashboard/selectors';

/** Fields stored as BYTE (0-255) that should display as integers, not decimals */
const BYTE_FIELDS = new Set<keyof IMachineSnapshot>([
  'thermoLeftLowSel',
  'thermoLeftMedSel',
  'thermoLeftHighSel',
  'thermoRightLowSel',
  'thermoRightMedSel',
  'thermoRightHighSel',
]);

interface TechnicalSignalsCardProps {
  machineData: Partial<IMachineSnapshot> | null;
}

export const TechnicalSignalsCard = memo(function TechnicalSignalsCard({ machineData }: TechnicalSignalsCardProps) {
  const t = useTranslations('dashboard');

  if (!hasTechnicalSignals(machineData)) {
    return null;
  }

  function formatFieldValue(field: keyof IMachineSnapshot): string {
    const val = machineData?.[field];
    if (val === undefined) return '';
    if (typeof val === 'number') {
      return BYTE_FIELDS.has(field) ? String(val) : val.toFixed(1);
    }
    return String(val);
  }

  return (
    <Card className="border-0 rounded-xl shadow-lg shadow-black/20">
      <CardHeader>
        <p className="text-[11px] font-semibold text-wpt-gold/60 uppercase tracking-wider">
          {t('sections.technical')}
        </p>
        <h3 className="text-xl font-semibold text-foreground">{t('sections.technical')}</h3>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          {TECHNICAL_GROUPS.map((group) => {
            const visibleFields = group.fields.filter(
              (field) => machineData?.[field] !== undefined,
            );
            if (visibleFields.length === 0) return null;

            return (
              <div key={group.groupKey}>
                <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                  {t(`technical.groups.${group.groupKey}`)}
                </h4>
                {visibleFields.map((field) => (
                  <div key={field} className="flex justify-between items-center py-1">
                    <span className="text-xs text-muted-foreground">
                      {t(`technical.fields.${field}`)}
                    </span>
                    <span className="text-sm text-foreground/80">
                      {formatFieldValue(field)}
                    </span>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
});
