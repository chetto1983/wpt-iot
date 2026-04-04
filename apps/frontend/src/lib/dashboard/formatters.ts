'use client';

import { useLocale, useTranslations } from 'next-intl';
import { CycleType, MachinePhase, MachineStatus } from '@wpt/types';
import type { IActiveAlarm } from '@wpt/types';

/**
 * Reverse-map a numeric enum value to its string key name.
 * TypeScript numeric enums produce both key->value and value->key entries.
 */
function enumKeyName(enumObj: Record<string, string | number>, value: number): string | null {
  const key = enumObj[value];
  return typeof key === 'string' ? key : null;
}

export function useDashboardFormatters() {
  const t = useTranslations('dashboard');
  const locale = useLocale();

  return {
    cycleLabel: (value?: number): string => {
      if (value === undefined) return t('states.notAvailable');
      const key = enumKeyName(CycleType as unknown as Record<string, string | number>, value);
      return key ? t(`cycleTypes.${key}`) : t('states.notAvailable');
    },

    phaseLabel: (value?: number): string => {
      if (value === undefined) return t('states.notAvailable');
      const key = enumKeyName(MachinePhase as unknown as Record<string, string | number>, value);
      return key ? t(`machinePhases.${key}`) : t('states.notAvailable');
    },

    statusLabel: (value?: number): string => {
      if (value === undefined) return t('states.notAvailable');
      const key = enumKeyName(MachineStatus as unknown as Record<string, string | number>, value);
      return key ? t(`machineStatuses.${key}`) : t('states.notAvailable');
    },

    alarmDescription: (alarm: IActiveAlarm): string => {
      return locale === 'it' ? alarm.descriptionIt : alarm.descriptionEn;
    },

    fieldValue: (value: string | number | undefined): string => {
      if (value === undefined || value === '') return t('states.notAvailable');
      return String(value);
    },
  };
}
