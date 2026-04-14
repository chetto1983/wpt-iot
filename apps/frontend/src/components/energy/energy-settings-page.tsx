'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { TriangleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { type IEnergyAdminConfigResponse, type IEnergyConfigUpdateRequest } from '@wpt/types';
import { toast } from 'sonner';

import { apiFetch } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { BaselineLockDialog } from '@/components/energy/baseline-lock-dialog';
import { EnergySettingsForm } from '@/components/energy/energy-settings-form';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || '';

function buildFormValue(configResponse: IEnergyAdminConfigResponse): Partial<IEnergyConfigUpdateRequest> {
  return {
    customerName: configResponse.config.customerName,
    machineSerial: configResponse.config.machineSerial,
    machineModel: configResponse.config.machineModel,
    installSite: configResponse.config.installSite,
    cosphi: configResponse.config.cosphi,
    shiftStartHour: configResponse.config.shiftStartHour,
    effectiveFrom: String(configResponse.activePeriod.validFrom),
    emissionFactorKgPerKwh: configResponse.activePeriod.emissionFactorKgPerKwh,
    emissionFactorYear: configResponse.activePeriod.emissionFactorYear,
    emissionFactorSource: configResponse.activePeriod.emissionFactorSource,
    tariffMode: configResponse.activePeriod.tariffMode,
    tariffSingleEurPerKwh: configResponse.activePeriod.tariffSingleEurPerKwh,
    tariffBandsJson: configResponse.activePeriod.tariffBandsJson,
  };
}

export function EnergySettingsPage() {
  const t = useTranslations('energySettings');
  const tAuth = useTranslations('auth');
  const { user } = useAuth();
  const [config, setConfig] = useState<IEnergyAdminConfigResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [sampleReportPending, setSampleReportPending] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [baselineDialogOpen, setBaselineDialogOpen] = useState(false);

  const loadConfig = useCallback(async () => {
    if (user?.role !== 'SUPER_ADMIN') return;
    setLoading(true);
    try {
      const data = await apiFetch<IEnergyAdminConfigResponse>('/api/energy/config');
      setConfig(data);
      setLoadError(null);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : t('errors.loadConfig'));
    } finally {
      setLoading(false);
    }
  }, [t, user?.role]);

  useEffect(() => {
    void loadConfig();
  }, [loadConfig]);

  if (!user) {
    return (
      <div className="mx-auto w-full max-w-5xl space-y-6 p-4 sm:p-6">
        <header className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
          <p className="max-w-3xl text-sm text-muted-foreground">{t('subtitle')}</p>
        </header>

        <Card>
          <CardHeader>
            <CardTitle>{t('states.loading')}</CardTitle>
            <CardDescription>{t('subtitle')}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
          </CardContent>
        </Card>
      </div>
    );
  }

  if (user.role !== 'SUPER_ADMIN') {
    return (
      <div className="mx-auto w-full max-w-3xl space-y-6 p-4 sm:p-6">
        <header className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
          <p className="max-w-3xl text-sm text-muted-foreground">{t('subtitle')}</p>
        </header>

        <Card className="border border-destructive/20 bg-destructive/5">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-destructive">
              <TriangleAlert className="size-5" />
              {t('states.unauthorized')}
            </CardTitle>
            <CardDescription className="text-destructive/80">
              {tAuth('unauthorized')}
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  const formValue = config ? buildFormValue(config) : undefined;
  const baselineWindow = useMemo(() => {
    const to = new Date();
    return {
      from: new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000),
      to,
    };
  }, []);
  const missingConfig = !config
    || !config.config.customerName.trim()
    || !config.config.machineSerial.trim()
    || !config.activePeriod.emissionFactorSource.trim();

  async function handleSave(value: IEnergyConfigUpdateRequest) {
    setSaving(true);
    try {
      const updated = await apiFetch<IEnergyAdminConfigResponse>('/api/energy/config', {
        method: 'PUT',
        body: JSON.stringify(value),
      });
      setConfig(updated);
      setLoadError(null);
    } finally {
      setSaving(false);
    }
  }

  async function handleSampleReport() {
    setSampleReportPending(true);
    try {
      const to = new Date();
      to.setUTCMinutes(0, 0, 0);
      const from = new Date(to.getTime() - 24 * 60 * 60 * 1000);
      const lang = user?.language === 'en' ? 'en' : 'it';
      const params = new URLSearchParams({
        from: from.toISOString(),
        to: to.toISOString(),
        lang,
      });
      const response = await fetch(`${API_BASE}/api/energy/reports/iso50001/pdf?${params.toString()}`, {
        method: 'POST',
        credentials: 'include',
      });

      if (!response.ok) {
        const body: unknown = await response.json().catch(() => ({}));
        const message =
          typeof (body as { error?: unknown }).error === 'string'
            ? (body as { error: string }).error
            : typeof (body as { error?: { message?: unknown } }).error?.message === 'string'
              ? (body as { error: { message: string } }).error.message
              : t('errors.sampleReport');
        throw new Error(message);
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `energy-settings-sample-${from.toISOString().slice(0, 10)}-${to.toISOString().slice(0, 10)}-${lang}.pdf`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      toast.success(t('toast.sampleReportReady'));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('errors.sampleReport'));
    } finally {
      setSampleReportPending(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 p-4 sm:p-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
        <p className="max-w-3xl text-sm text-muted-foreground">{t('subtitle')}</p>
      </header>

      <Card className="border border-amber-500/30 bg-amber-500/10">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-amber-100">
            <TriangleAlert className="size-5 text-amber-300" />
            {t('banner.missingConfig')}
          </CardTitle>
          <CardDescription className="text-amber-50/80">
            {missingConfig ? t('banner.pending') : t('banner.ready')}
          </CardDescription>
        </CardHeader>
      </Card>

      {loadError ? (
        <Card className="border border-destructive/20 bg-destructive/5">
          <CardHeader>
            <CardTitle className="text-destructive">{t('errors.loadConfig')}</CardTitle>
            <CardDescription className="text-destructive/80">{loadError}</CardDescription>
          </CardHeader>
        </Card>
      ) : null}

      {loading ? (
        <Card>
          <CardHeader>
            <CardTitle>{t('states.loading')}</CardTitle>
            <CardDescription>{t('subtitle')}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
          </CardContent>
        </Card>
      ) : (
        <EnergySettingsForm
          initialValue={formValue}
          pending={saving}
          submitLabel={t('actions.saveSettings')}
          successMessage={t('toast.saved')}
          onSubmit={handleSave}
        />
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t('sections.baseline')}</CardTitle>
            <CardDescription>{t('descriptions.baseline')}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            <p className="text-sm text-muted-foreground">{t('placeholders.baseline')}</p>
            <Button onClick={() => setBaselineDialogOpen(true)} disabled={loading}>
              {t('actions.openBaseline')}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('sections.sampleReport')}</CardTitle>
            <CardDescription>{t('descriptions.sampleReport')}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            <p className="text-sm text-muted-foreground">{t('placeholders.sampleReport')}</p>
            <Button onClick={() => void handleSampleReport()} disabled={sampleReportPending || loading}>
              {t('actions.generateSampleReport')}
            </Button>
          </CardContent>
        </Card>
      </div>

      <BaselineLockDialog
        open={baselineDialogOpen}
        onOpenChange={setBaselineDialogOpen}
        suggestedFrom={baselineWindow.from}
        suggestedTo={baselineWindow.to}
        onLocked={() => {
          void loadConfig();
        }}
      />
    </div>
  );
}
