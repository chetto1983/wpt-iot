'use client';

import { useLocale, useTranslations } from 'next-intl';
import { CycleType, MachinePhase, MachineStatus, decodeCycleStatus, CycleStatusVerdict } from '@wpt/types';
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

    /**
     * V03 Cycle_Status verdict label (S1_I_DATO_71). Decodes 0..4 to known
     * verdicts; 5+ surfaces as "Reserved (N)" with the raw value substituted.
     */
    cycleStatusLabel: (value?: number): string => {
      if (value === undefined) return t('states.notAvailable');
      try {
        const { verdict, raw } = decodeCycleStatus(value);
        if (verdict === CycleStatusVerdict.RESERVED) {
          return t('cycleStatus.reserved', { value: raw });
        }
        return t(`cycleStatus.${verdict}`);
      } catch {
        return t('states.notAvailable');
      }
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
