'use client';

import { useEffect, useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import {
  ENERGY_TARIFF_BAND_KEYS,
  EnergyConfigUpdateSchema,
  type EnergyTariffBandKey,
  type IEnergyConfigUpdateRequest,
} from '@wpt/types';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

type TariffMode = IEnergyConfigUpdateRequest['tariffMode'];
type TariffBandFieldName = 'tariffBandF1' | 'tariffBandF2' | 'tariffBandF3';

type FieldErrors = Partial<Record<string, string>>;

interface EnergySettingsFormProps {
  initialValue?: Partial<IEnergyConfigUpdateRequest>;
  pending?: boolean;
  onSubmit?: (value: IEnergyConfigUpdateRequest) => Promise<void> | void;
  submitLabel?: string;
  successMessage?: string;
}

interface EnergySettingsDraft {
  customerName: string;
  machineSerial: string;
  machineModel: string;
  installSite: string;
  cosphi: string;
  shiftStartHour: string;
  effectiveFrom: string;
  emissionFactorKgPerKwh: string;
  emissionFactorYear: string;
  emissionFactorSource: string;
  tariffMode: TariffMode;
  tariffSingleEurPerKwh: string;
  tariffBandF1: string;
  tariffBandF2: string;
  tariffBandF3: string;
}

type NumericFieldName =
  | 'cosphi'
  | 'emissionFactorKgPerKwh'
  | 'tariffSingleEurPerKwh'
  | 'tariffBandF1'
  | 'tariffBandF2'
  | 'tariffBandF3';

const TARIFF_BAND_FIELD_MAP: Record<EnergyTariffBandKey, TariffBandFieldName> = {
  f1: 'tariffBandF1',
  f2: 'tariffBandF2',
  f3: 'tariffBandF3',
};

function toLocalDateTimeInput(value?: string): string {
  const date = value ? new Date(value) : new Date();
  const safe = Number.isFinite(date.getTime()) ? date : new Date();
  return new Date(safe.getTime() - safe.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 16);
}

function toLocalizedNumberInput(value: number | undefined, locale: string, fallback: string): string {
  if (value == null || Number.isNaN(value)) return fallback;
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 3,
    useGrouping: false,
  }).format(value);
}

function parseLocalizedNumber(raw: string): number {
  const normalized = raw.replace(/\s/g, '').replace(',', '.');
  if (!normalized) return Number.NaN;
  return Number(normalized);
}

function formatLocalizedPreview(raw: string, locale: string, digits = 3): string | null {
  const parsed = parseLocalizedNumber(raw);
  if (!Number.isFinite(parsed)) return null;
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
    useGrouping: true,
  }).format(parsed);
}

function buildInitialDraft(
  initialValue: Partial<IEnergyConfigUpdateRequest> | undefined,
  locale: string,
): EnergySettingsDraft {
  return {
    customerName: initialValue?.customerName ?? '',
    machineSerial: initialValue?.machineSerial ?? '',
    machineModel: initialValue?.machineModel ?? '',
    installSite: initialValue?.installSite ?? '',
    cosphi: toLocalizedNumberInput(initialValue?.cosphi, locale, '0,85'),
    shiftStartHour: initialValue?.shiftStartHour != null ? String(initialValue.shiftStartHour) : '6',
    effectiveFrom: toLocalDateTimeInput(initialValue?.effectiveFrom),
    emissionFactorKgPerKwh: toLocalizedNumberInput(
      initialValue?.emissionFactorKgPerKwh,
      locale,
      '0,279',
    ),
    emissionFactorYear:
      initialValue?.emissionFactorYear != null
        ? String(initialValue.emissionFactorYear)
        : String(new Date().getFullYear()),
    emissionFactorSource: initialValue?.emissionFactorSource ?? 'ISPRA',
    tariffMode: initialValue?.tariffMode ?? 'single',
    tariffSingleEurPerKwh: toLocalizedNumberInput(
      initialValue?.tariffSingleEurPerKwh,
      locale,
      '0,250',
    ),
    tariffBandF1: toLocalizedNumberInput(
      initialValue?.tariffBandsJson?.f1?.eurPerKwh,
      locale,
      '0,300',
    ),
    tariffBandF2: toLocalizedNumberInput(
      initialValue?.tariffBandsJson?.f2?.eurPerKwh,
      locale,
      '0,240',
    ),
    tariffBandF3: toLocalizedNumberInput(
      initialValue?.tariffBandsJson?.f3?.eurPerKwh,
      locale,
      '0,180',
    ),
  };
}

export function EnergySettingsForm({
  initialValue,
  pending = false,
  onSubmit,
  submitLabel,
  successMessage,
}: EnergySettingsFormProps) {
  const locale = useLocale();
  const t = useTranslations('energySettings');
  const tCommon = useTranslations('common');
  const [draft, setDraft] = useState<EnergySettingsDraft>(() => buildInitialDraft(initialValue, locale));
  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    setDraft(buildInitialDraft(initialValue, locale));
    setErrors({});
  }, [initialValue, locale]);

  const decimalPreview = useMemo(
    () => ({
      cosphi: formatLocalizedPreview(draft.cosphi, locale, 3),
      emissionFactorKgPerKwh: formatLocalizedPreview(draft.emissionFactorKgPerKwh, locale),
      tariffSingleEurPerKwh: formatLocalizedPreview(draft.tariffSingleEurPerKwh, locale),
      tariffBandF1: formatLocalizedPreview(draft.tariffBandF1, locale),
      tariffBandF2: formatLocalizedPreview(draft.tariffBandF2, locale),
      tariffBandF3: formatLocalizedPreview(draft.tariffBandF3, locale),
    }),
    [draft, locale],
  );

  function setField<K extends keyof EnergySettingsDraft>(field: K, value: EnergySettingsDraft[K]) {
    setDraft((current) => ({ ...current, [field]: value }));
    setErrors((current) => {
      if (!current[field as string]) return current;
      const next = { ...current };
      delete next[field as string];
      return next;
    });
  }

  function getNumericError(field: NumericFieldName) {
    return errors[field] ?? (decimalPreview[field] ? null : t('validation.invalidNumber'));
  }

  function describedBy(...ids: Array<string | null | undefined>) {
    const value = ids.filter(Boolean).join(' ');
    return value || undefined;
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();

    const nextErrors: FieldErrors = {};
    const emissionFactorKgPerKwh = parseLocalizedNumber(draft.emissionFactorKgPerKwh);
    const tariffSingleEurPerKwh = parseLocalizedNumber(draft.tariffSingleEurPerKwh);
    const year = draft.emissionFactorYear.trim() === '' ? Number.NaN : Number(draft.emissionFactorYear);
    const cosphi = parseLocalizedNumber(draft.cosphi);
    const shiftStartHour = draft.shiftStartHour.trim() === ''
      ? Number.NaN
      : Number(draft.shiftStartHour);
    const effectiveFrom = draft.effectiveFrom.trim();
    const effectiveFromDate = effectiveFrom ? new Date(effectiveFrom) : null;

    if (!effectiveFromDate || !Number.isFinite(effectiveFromDate.getTime())) {
      nextErrors.effectiveFrom = t('validation.invalidDate');
    }

    const tariffBandsJson: IEnergyConfigUpdateRequest['tariffBandsJson'] = {};
    for (const key of ENERGY_TARIFF_BAND_KEYS) {
      const fieldName = TARIFF_BAND_FIELD_MAP[key];
      const parsed = parseLocalizedNumber(draft[fieldName]);
      if (draft.tariffMode === 'tou3') {
        if (!Number.isFinite(parsed)) {
          nextErrors[fieldName] = t('validation.invalidNumber');
          continue;
        }
        if (parsed < 0.001 || parsed > 2.0) {
          nextErrors[fieldName] = t('validation.tariffRange');
          continue;
        }
        tariffBandsJson[key] = { eurPerKwh: parsed };
      }
    }

    if (!draft.emissionFactorSource.trim()) {
      nextErrors.emissionFactorSource = t('validation.sourceRequired');
    }
    if (!Number.isFinite(cosphi)) {
      nextErrors.cosphi = t('validation.invalidNumber');
    }
    if (!Number.isFinite(year)) {
      nextErrors.emissionFactorYear = t('validation.yearNumeric');
    }
    if (!Number.isFinite(shiftStartHour)) {
      nextErrors.shiftStartHour = t('validation.shiftStartHourRange');
    }

    const payload = {
      customerName: draft.customerName.trim(),
      machineSerial: draft.machineSerial.trim(),
      machineModel: draft.machineModel.trim(),
      installSite: draft.installSite.trim(),
      cosphi,
      shiftStartHour,
      effectiveFrom: effectiveFromDate?.toISOString() ?? '',
      emissionFactorKgPerKwh,
      emissionFactorYear: year,
      emissionFactorSource: draft.emissionFactorSource.trim(),
      tariffMode: draft.tariffMode,
      tariffSingleEurPerKwh,
      tariffBandsJson,
    };

    const parsed = EnergyConfigUpdateSchema.safeParse(payload);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const field = issue.path[0];
        if (typeof field !== 'string' || nextErrors[field]) continue;
        if (field === 'emissionFactorKgPerKwh') {
          nextErrors[field] = t('validation.emissionFactorRange');
        } else if (field === 'cosphi') {
          nextErrors[field] = t('validation.cosphiRange');
        } else if (field === 'shiftStartHour') {
          nextErrors[field] = t('validation.shiftStartHourRange');
        } else if (field === 'tariffSingleEurPerKwh') {
          nextErrors[field] = t('validation.tariffRange');
        } else if (field === 'emissionFactorYear') {
          nextErrors[field] = t('validation.yearNumeric');
        } else if (field === 'effectiveFrom') {
          nextErrors[field] = t('validation.invalidDate');
        } else if (field === 'emissionFactorSource') {
          nextErrors[field] = t('validation.sourceRequired');
        } else {
          nextErrors[field] = t('validation.required');
        }
      }
    }

    if (draft.tariffMode === 'tou3' && Object.keys(tariffBandsJson).length !== ENERGY_TARIFF_BAND_KEYS.length) {
      nextErrors.tariffBandsJson = t('validation.tariffBandsRequired');
    }

    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      toast.error(tCommon('error'));
      return;
    }

    try {
      setSubmitting(true);
      await onSubmit?.(parsed.success ? parsed.data : payload);
      toast.success(successMessage ?? t('toast.draftValidated'));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : tCommon('error'));
    } finally {
      setSubmitting(false);
    }
  }

  const busy = pending || submitting;

  return (
    <form className="grid gap-6" onSubmit={handleSubmit}>
      <Card>
        <CardHeader>
          <CardTitle>{t('sections.customer')}</CardTitle>
          <CardDescription>{t('descriptions.customer')}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <div className="grid gap-2">
            <Label htmlFor="energy-settings-customer-name">{t('fields.customerName')}</Label>
            <Input
              id="energy-settings-customer-name"
              value={draft.customerName}
              onChange={(event) => setField('customerName', event.target.value)}
            />
            {errors.customerName ? <p className="text-xs text-destructive">{errors.customerName}</p> : null}
          </div>
          <div className="grid gap-2">
            <Label htmlFor="energy-settings-machine-serial">{t('fields.machineSerial')}</Label>
            <Input
              id="energy-settings-machine-serial"
              value={draft.machineSerial}
              onChange={(event) => setField('machineSerial', event.target.value)}
            />
            {errors.machineSerial ? <p className="text-xs text-destructive">{errors.machineSerial}</p> : null}
          </div>
          <div className="grid gap-2">
            <Label htmlFor="energy-settings-machine-model">{t('fields.machineModel')}</Label>
            <Input
              id="energy-settings-machine-model"
              value={draft.machineModel}
              onChange={(event) => setField('machineModel', event.target.value)}
            />
            {errors.machineModel ? <p className="text-xs text-destructive">{errors.machineModel}</p> : null}
          </div>
          <div className="grid gap-2">
            <Label htmlFor="energy-settings-install-site">{t('fields.installSite')}</Label>
            <Input
              id="energy-settings-install-site"
              value={draft.installSite}
              onChange={(event) => setField('installSite', event.target.value)}
            />
            {errors.installSite ? <p className="text-xs text-destructive">{errors.installSite}</p> : null}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('sections.tariff')}</CardTitle>
          <CardDescription>{t('descriptions.tariff')}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="energy-settings-cosphi">{t('fields.cosphi')}</Label>
              <Input
                id="energy-settings-cosphi"
                inputMode="decimal"
                value={draft.cosphi}
                onChange={(event) => setField('cosphi', event.target.value)}
                aria-invalid={Boolean(getNumericError('cosphi'))}
                aria-describedby={describedBy(
                  'energy-settings-cosphi-preview',
                  getNumericError('cosphi') ? 'energy-settings-cosphi-error' : null,
                )}
              />
              <p id="energy-settings-cosphi-preview" className="text-xs text-muted-foreground">
                {t('helpers.decimalPreview', {
                  value: decimalPreview.cosphi ?? t('helpers.invalidPreview'),
                })}
              </p>
              {getNumericError('cosphi') ? (
                <p id="energy-settings-cosphi-error" className="text-xs text-destructive">
                  {getNumericError('cosphi')}
                </p>
              ) : null}
            </div>
            <div className="grid gap-2">
              <Label htmlFor="energy-settings-shift-start-hour">{t('fields.shiftStartHour')}</Label>
              <Input
                id="energy-settings-shift-start-hour"
                inputMode="numeric"
                value={draft.shiftStartHour}
                onChange={(event) => setField('shiftStartHour', event.target.value)}
                aria-invalid={Boolean(errors.shiftStartHour)}
                aria-describedby={describedBy(
                  'energy-settings-shift-start-hour-help',
                  errors.shiftStartHour ? 'energy-settings-shift-start-hour-error' : null,
                )}
              />
              <p id="energy-settings-shift-start-hour-help" className="text-xs text-muted-foreground">
                {t('helpers.shiftStartHour')}
              </p>
              {errors.shiftStartHour ? (
                <p id="energy-settings-shift-start-hour-error" className="text-xs text-destructive">
                  {errors.shiftStartHour}
                </p>
              ) : null}
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <div className="grid gap-2">
              <Label htmlFor="energy-settings-effective-from">{t('fields.effectiveFrom')}</Label>
              <Input
                id="energy-settings-effective-from"
                type="datetime-local"
                value={draft.effectiveFrom}
                onChange={(event) => setField('effectiveFrom', event.target.value)}
                aria-invalid={Boolean(errors.effectiveFrom)}
                aria-describedby={errors.effectiveFrom ? 'energy-settings-effective-from-error' : undefined}
              />
              {errors.effectiveFrom ? (
                <p id="energy-settings-effective-from-error" className="text-xs text-destructive">
                  {errors.effectiveFrom}
                </p>
              ) : (
                <p className="min-h-4 text-xs text-transparent" aria-hidden="true">.</p>
              )}
            </div>
            <div className="grid gap-2">
              <Label htmlFor="energy-settings-emission-factor">{t('fields.emissionFactorKgPerKwh')}</Label>
              <Input
                id="energy-settings-emission-factor"
                inputMode="decimal"
                value={draft.emissionFactorKgPerKwh}
                onChange={(event) => setField('emissionFactorKgPerKwh', event.target.value)}
                aria-invalid={Boolean(getNumericError('emissionFactorKgPerKwh'))}
                aria-describedby={describedBy(
                  'energy-settings-emission-factor-preview',
                  getNumericError('emissionFactorKgPerKwh') ? 'energy-settings-emission-factor-error' : null,
                )}
              />
              <p id="energy-settings-emission-factor-preview" className="text-xs text-muted-foreground">
                {t('helpers.decimalPreview', {
                  value: decimalPreview.emissionFactorKgPerKwh ?? t('helpers.invalidPreview'),
                })}
              </p>
              {getNumericError('emissionFactorKgPerKwh') ? (
                <p id="energy-settings-emission-factor-error" className="text-xs text-destructive">
                  {getNumericError('emissionFactorKgPerKwh')}
                </p>
              ) : null}
            </div>
            <div className="grid gap-2">
              <Label htmlFor="energy-settings-emission-year">{t('fields.emissionFactorYear')}</Label>
              <Input
                id="energy-settings-emission-year"
                inputMode="numeric"
                value={draft.emissionFactorYear}
                onChange={(event) => setField('emissionFactorYear', event.target.value)}
                aria-invalid={Boolean(errors.emissionFactorYear)}
                aria-describedby={errors.emissionFactorYear ? 'energy-settings-emission-year-error' : undefined}
              />
              {errors.emissionFactorYear ? (
                <p id="energy-settings-emission-year-error" className="text-xs text-destructive">
                  {errors.emissionFactorYear}
                </p>
              ) : (
                <p className="min-h-4 text-xs text-transparent" aria-hidden="true">.</p>
              )}
            </div>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="energy-settings-emission-source">{t('fields.emissionFactorSource')}</Label>
            <Input
              id="energy-settings-emission-source"
              value={draft.emissionFactorSource}
              onChange={(event) => setField('emissionFactorSource', event.target.value)}
              aria-invalid={Boolean(errors.emissionFactorSource)}
              aria-describedby={errors.emissionFactorSource ? 'energy-settings-emission-source-error' : undefined}
            />
            {errors.emissionFactorSource ? (
              <p id="energy-settings-emission-source-error" className="text-xs text-destructive">
                {errors.emissionFactorSource}
              </p>
            ) : null}
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="energy-settings-tariff-mode">{t('fields.tariffMode')}</Label>
              <Select
                value={draft.tariffMode}
                onValueChange={(value) => {
                  if (value === 'single' || value === 'tou3') {
                    setField('tariffMode', value);
                  }
                }}
              >
                <SelectTrigger id="energy-settings-tariff-mode" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="single">{t('tariffModes.single')}</SelectItem>
                  <SelectItem value="tou3">{t('tariffModes.tou3')}</SelectItem>
                </SelectContent>
              </Select>
              <p className="min-h-4 text-xs text-transparent" aria-hidden="true">.</p>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="energy-settings-single-rate">{t('fields.tariffSingleEurPerKwh')}</Label>
              <Input
                id="energy-settings-single-rate"
                inputMode="decimal"
                value={draft.tariffSingleEurPerKwh}
                onChange={(event) => setField('tariffSingleEurPerKwh', event.target.value)}
                aria-invalid={Boolean(getNumericError('tariffSingleEurPerKwh'))}
                aria-describedby={describedBy(
                  'energy-settings-single-rate-preview',
                  getNumericError('tariffSingleEurPerKwh') ? 'energy-settings-single-rate-error' : null,
                )}
              />
              <p id="energy-settings-single-rate-preview" className="text-xs text-muted-foreground">
                {t('helpers.decimalPreview', {
                  value: decimalPreview.tariffSingleEurPerKwh ?? t('helpers.invalidPreview'),
                })}
              </p>
              {getNumericError('tariffSingleEurPerKwh') ? (
                <p id="energy-settings-single-rate-error" className="text-xs text-destructive">
                  {getNumericError('tariffSingleEurPerKwh')}
                </p>
              ) : null}
            </div>
          </div>

          {draft.tariffMode === 'tou3' ? (
            <div className="grid gap-4 md:grid-cols-3">
              {([
                'tariffBandF1',
                'tariffBandF2',
                'tariffBandF3',
              ] as const).map((field) => (
                <div key={field} className="grid gap-2">
                  <Label htmlFor={`energy-settings-${field}`}>{t(`fields.${field}`)}</Label>
                  <Input
                    id={`energy-settings-${field}`}
                    inputMode="decimal"
                    value={draft[field]}
                    onChange={(event) => setField(field, event.target.value)}
                    aria-invalid={Boolean(getNumericError(field))}
                    aria-describedby={describedBy(
                      `energy-settings-${field}-preview`,
                      getNumericError(field) ? `energy-settings-${field}-error` : null,
                    )}
                  />
                  <p id={`energy-settings-${field}-preview`} className="text-xs text-muted-foreground">
                    {t('helpers.decimalPreview', {
                      value: decimalPreview[field] ?? t('helpers.invalidPreview'),
                    })}
                  </p>
                  {getNumericError(field) ? (
                    <p id={`energy-settings-${field}-error`} className="text-xs text-destructive">
                      {getNumericError(field)}
                    </p>
                  ) : null}
                </div>
              ))}
              {errors.tariffBandsJson ? (
                <p className="md:col-span-3 text-xs text-destructive">{errors.tariffBandsJson}</p>
              ) : null}
            </div>
          ) : null}
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">{t('helpers.submitHint')}</p>
        <Button type="submit" disabled={busy}>
          {busy ? t('states.loading') : (submitLabel ?? t('actions.saveDraft'))}
        </Button>
      </div>
    </form>
  );
}
