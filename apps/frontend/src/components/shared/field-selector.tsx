'use client';

import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { ChevronRight } from 'lucide-react';
import { CLIENT_VISIBLE_FIELDS, WPT_VISIBLE_FIELDS } from '@wpt/types';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';

const NON_CHARTABLE = new Set([
  'user',
  'supervisor',
  'orderNumber',
  'serialNumber',
  'spareString01',
  'selectedCycle',
  'currentPhase',
  'machineStatus',
  // V03 — state-like INTs, not meaningful as time-series numbers
  'cycleStatus',
  'container',
]);

const FIELD_CATEGORIES: Record<string, string[]> = {
  temperatures: [
    'garbageTemp',
    'thermoLeftLower',
    'thermoLeftMedium',
    'thermoLeftUpper',
    'thermoRightLower',
    'thermoRightMedium',
    'thermoRightUpper',
    'thermoLeftHighLower',
    'thermoLeftHighMedium',
    'thermoLeftHighUpper',
    'thermoRightHighLower',
    'holdingTempSetpoint',
  ],
  pressures: ['chamberPressure'],
  motors: [
    'mainMotorSpeed',
    'mainMotorCurrent',
    'mainMotorTorque',
    'vacuumPumpSpeed01',
    'vacuumPumpSpeed02',
  ],
  electrical: ['rmsCurrL1', 'rmsCurrL2', 'rmsCurrL3', 'rmsCurrN'],
  // V03 — three-phase line voltages + power factor
  lineVoltages: [
    'lineVoltL1L2', 'lineVoltL2L3', 'lineVoltL3L1',
    'lineNeutralVoltL1', 'lineNeutralVoltL2', 'lineNeutralVoltL3',
    'pfTotal',
  ],
  weights: [
    'materialInputWeight',
    'materialOutputWeight',
    'energyConsumption',
    'waterConsumption',
    'spareReal01',
    'spareReal02',
  ],
  timers: ['completedCycles'],
};

/** Report-mode categories — all meaningful fields (no spareIntNN). */
export const REPORT_FIELD_CATEGORIES: Record<string, string[]> = {
  general: ['user', 'supervisor', 'orderNumber', 'serialNumber'],
  status: ['selectedCycle', 'currentPhase', 'machineStatus', 'cycleStatus', 'container'],
  ...FIELD_CATEGORIES,
  thermoSelection: [
    'thermoLeftLowSel', 'thermoLeftMedSel', 'thermoLeftHighSel',
    'thermoRightLowSel', 'thermoRightMedSel', 'thermoRightHighSel',
  ],
};

const MAX_FIELDS = 8;

export function getChartableFields(role: string): string[] {
  const baseFields: readonly string[] =
    role === 'CLIENT' ? CLIENT_VISIBLE_FIELDS : WPT_VISIBLE_FIELDS;
  return baseFields.filter((f) => !NON_CHARTABLE.has(f));
}

interface FieldSelectorProps {
  role: string;
  selected: string[];
  onChange: (fields: string[]) => void;
  fieldLabels: Record<string, string>;
  /** Override max selectable fields (0 = no limit). Default: 8 */
  maxFields?: number;
  /** Override available fields instead of computing from role + NON_CHARTABLE */
  availableFields?: string[];
  /** Override field categories. Default: FIELD_CATEGORIES (chart mode) */
  fieldCategories?: Record<string, string[]>;
  /** i18n namespace for translations. Default: 'charts' */
  translationNamespace?: string;
}

export function FieldSelector({
  role,
  selected,
  onChange,
  fieldLabels,
  maxFields: maxFieldsProp,
  availableFields,
  fieldCategories = FIELD_CATEGORIES,
  translationNamespace = 'charts',
}: FieldSelectorProps) {
  const t = useTranslations(translationNamespace);
  const effectiveMax = maxFieldsProp ?? MAX_FIELDS;

  const fieldSet = useMemo(() => {
    if (availableFields) return new Set(availableFields);
    return new Set(getChartableFields(role));
  }, [role, availableFields]);

  const categories = useMemo(() => {
    const result: Array<{ key: string; fields: string[] }> = [];
    for (const [key, fields] of Object.entries(fieldCategories)) {
      const filtered = fields.filter((f) => fieldSet.has(f));
      if (filtered.length > 0) {
        result.push({ key, fields: filtered });
      }
    }
    return result;
  }, [fieldSet, fieldCategories]);

  const atMax = effectiveMax > 0 && selected.length >= effectiveMax;

  function handleToggle(field: string, checked: boolean) {
    if (checked) {
      if (effectiveMax === 0 || selected.length < effectiveMax) {
        onChange([...selected, field]);
      }
    } else {
      onChange(selected.filter((f) => f !== field));
    }
  }

  return (
    <Card>
      <CardContent className="p-4">
        <h2 className="mb-3 text-sm font-semibold">{t('selectFields')}</h2>

        {atMax && (
          <p className="sticky top-0 z-10 mb-2 rounded-md bg-wpt-gold/10 px-3 py-2 text-xs text-wpt-gold">
            {t('fieldCountMax')}
          </p>
        )}

        {categories.map(({ key, fields }) => {
          const selectedInGroup = fields.filter((f) =>
            selected.includes(f),
          ).length;
            return (
              <Collapsible key={key} className="mb-2 last:mb-0">
              <CollapsibleTrigger className="group flex min-h-11 w-full items-center gap-1.5 py-2.5 sm:min-h-0 sm:py-1.5">
                <ChevronRight className="size-4 text-muted-foreground transition-transform duration-200 group-data-[panel-open]:rotate-90 sm:size-3.5" />
                <span className="text-sm font-semibold text-muted-foreground sm:text-xs">
                  {t(`categories.${key}`)}
                </span>
                {selectedInGroup > 0 && (
                  <span className="ml-auto rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary dark:bg-wpt-teal-accessible/10 dark:text-wpt-teal-accessible sm:text-[10px]">
                    {selectedInGroup}
                  </span>
                )}
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="grid grid-cols-1 gap-3 pb-2 pt-1 sm:grid-cols-2 lg:grid-cols-4">
                  {fields.map((field) => {
                    const isSelected = selected.includes(field);
                    const isDisabled = atMax && !isSelected;
                    return (
                      <div key={field} className="flex items-center gap-3 rounded-md border border-transparent px-1 py-1 sm:gap-2 sm:px-0 sm:py-0">
                        <Checkbox
                          id={`field-${field}`}
                          checked={isSelected}
                          onCheckedChange={(checked: boolean) =>
                            handleToggle(field, checked)
                          }
                          disabled={isDisabled}
                        />
                        <Label
                          htmlFor={`field-${field}`}
                          className={`text-sm font-normal ${isDisabled ? 'opacity-50' : ''}`}
                        >
                          {fieldLabels[field] ?? field}
                        </Label>
                      </div>
                    );
                  })}
                </div>
              </CollapsibleContent>
            </Collapsible>
          );
        })}

        <p className="mt-3 text-xs text-muted-foreground">
          {selected.length === 0
            ? t('fieldCountNone')
            : effectiveMax > 0 && selected.length === effectiveMax
              ? t('fieldCountMax')
              : t('fieldCount', { count: selected.length })}
        </p>
      </CardContent>
    </Card>
  );
}
