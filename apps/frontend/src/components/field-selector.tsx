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
  weights: [
    'materialInputWeight',
    'materialOutputWeight',
    'energyConsumption',
    'waterConsumption',
    'spareReal01',
  ],
  timers: ['completedCycles'],
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
}

export function FieldSelector({
  role,
  selected,
  onChange,
  fieldLabels,
}: FieldSelectorProps) {
  const t = useTranslations('charts');

  const chartableSet = useMemo(() => {
    const fields = getChartableFields(role);
    return new Set(fields);
  }, [role]);

  const categories = useMemo(() => {
    const result: Array<{ key: string; fields: string[] }> = [];
    for (const [key, fields] of Object.entries(FIELD_CATEGORIES)) {
      const filtered = fields.filter((f) => chartableSet.has(f));
      if (filtered.length > 0) {
        result.push({ key, fields: filtered });
      }
    }
    return result;
  }, [chartableSet]);

  const atMax = selected.length >= MAX_FIELDS;

  function handleToggle(field: string, checked: boolean) {
    if (checked) {
      if (selected.length < MAX_FIELDS) {
        onChange([...selected, field]);
      }
    } else {
      onChange(selected.filter((f) => f !== field));
    }
  }

  return (
    <Card>
      <CardContent className="p-4">
        <h2 className="text-sm font-semibold mb-3">{t('selectFields')}</h2>

        {atMax && (
          <p className="text-xs text-wpt-gold px-3 py-1.5 mb-2 rounded-md bg-wpt-gold/10 sticky top-0 z-10">
            {t('fieldCountMax')}
          </p>
        )}

        {categories.map(({ key, fields }) => {
          const selectedInGroup = fields.filter((f) =>
            selected.includes(f),
          ).length;
          return (
            <Collapsible key={key} className="mb-2 last:mb-0">
              <CollapsibleTrigger className="flex w-full items-center gap-1.5 py-1.5 group cursor-pointer">
                <ChevronRight className="size-3.5 text-muted-foreground transition-transform duration-200 group-data-[panel-open]:rotate-90" />
                <span className="text-xs font-semibold text-muted-foreground">
                  {t(`categories.${key}`)}
                </span>
                {selectedInGroup > 0 && (
                  <span className="ml-auto text-[10px] font-medium text-primary bg-primary/10 px-1.5 py-0.5 rounded-full">
                    {selectedInGroup}
                  </span>
                )}
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2 pb-2 pt-1">
                  {fields.map((field) => {
                    const isSelected = selected.includes(field);
                    const isDisabled = atMax && !isSelected;
                    return (
                      <div key={field} className="flex items-center gap-2">
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

        <p className="text-xs text-muted-foreground mt-3">
          {selected.length === 0
            ? t('fieldCountNone')
            : selected.length === MAX_FIELDS
              ? t('fieldCountMax')
              : t('fieldCount', { count: selected.length })}
        </p>
      </CardContent>
    </Card>
  );
}
