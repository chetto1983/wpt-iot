import { describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';

vi.mock('next-intl', () => ({
  useLocale: () => 'it',
  useTranslations: () => (key: string) => key,
}));

import itMessages from '../../messages/it.json';
import { useDashboardFormatters } from '@/lib/dashboard/formatters';
import { PROCESS_FIELDS, TECHNICAL_GROUPS } from '@/lib/dashboard/fields';

describe('dashboard PLC mappings', () => {
  it('formats the live Raspberry values with their PLC labels', () => {
    const { result } = renderHook(() => useDashboardFormatters());

    expect(result.current.phaseLabel(4)).toBe('machinePhases.IN_ALARM');
    expect(result.current.statusLabel(1)).toBe('machineStatuses.SHREDDING');
    expect(result.current.cycleLabel(6)).toBe('cycleTypes.MILK');
  });

  it('uses the Italian labels from the approved mapping', () => {
    expect(itMessages.dashboard.machinePhases.IN_ALARM).toBe('In Allarme');
    expect(itMessages.dashboard.machineStatuses.SHREDDING).toBe('Triturazione');
    expect(itMessages.dashboard.cycleTypes.MILK).toBe('Latte');
    expect(PROCESS_FIELDS).not.toContain('cycleStatus');
  });

  it('shows thermal bands 01..03 and excludes constant/reserved signals', () => {
    const thermalFields = TECHNICAL_GROUPS.find(
      (group) => group.groupKey === 'thermalZones',
    )?.fields;

    expect(thermalFields).toContain('thermoLeftHighLower');
    expect(thermalFields).toContain('thermoLeftHighMedium');
    expect(thermalFields).toContain('thermoLeftHighUpper');
    expect(thermalFields).not.toContain('thermoRightHighLower');
    expect(TECHNICAL_GROUPS.map((group) => String(group.groupKey))).not.toContain(
      'reservedSignal',
    );
  });
});
