'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, FileCheck2, Gauge, TriangleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import {
  EnergyConfigUpdateSchema,
  type IEnergyAdminConfigResponse,
  type IEnergyConfigUpdateRequest,
} from '@wpt/types';
import { toast } from 'sonner';

import { apiFetch } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { BaselineLockDialog } from '@/components/energy/baseline-lock-dialog';
import { EnergySettingsForm } from '@/components/energy/energy-settings-form';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

function getApiBase() {
  // Default to same-origin (empty string = relative URLs via nginx / dev rewrite).
  return process.env.NEXT_PUBLIC_API_URL ?? '';
}

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
  const [isDirty, setIsDirty] = useState(false);

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
  const configValidation = config ? EnergyConfigUpdateSchema.safeParse(buildFormValue(config)) : null;
  const missingConfig = !configValidation?.success;

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
      const apiBase = getApiBase();
      const to = new Date();
      to.setUTCMinutes(0, 0, 0);
      const from = new Date(to.getTime() - 24 * 60 * 60 * 1000);
      const lang = user?.language === 'en' ? 'en' : 'it';
      const params = new URLSearchParams({
        from: from.toISOString(),
        to: to.toISOString(),
        lang,
      });
      const response = await fetch(`${apiBase}/api/energy/reports/iso50001/pdf?${params.toString()}`, {
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
    <div className="mx-auto w-full max-w-6xl space-y-6 p-4 sm:p-6">
      <header className="space-y-3">
        <Badge variant={missingConfig ? 'outline' : 'secondary'} className="px-2.5 py-1">
          {missingConfig ? t('status.incomplete') : t('status.ready')}
        </Badge>
        <div className="space-y-2">
          <h1 className="max-w-3xl text-3xl font-semibold tracking-tight text-balance">
            {t('title')}
          </h1>
          <p className="max-w-3xl text-sm text-muted-foreground md:text-base md:text-pretty">
            {t('subtitle')}
          </p>
        </div>
      </header>

      <Alert className="rounded-2xl border-amber-400/40 bg-amber-500/10 px-4 py-4 text-amber-50">
        <TriangleAlert className="size-5 text-amber-300" />
        <AlertTitle className="text-amber-50">
          {missingConfig ? t('banner.missingConfig') : t('banner.readyTitle')}
        </AlertTitle>
        <AlertDescription className="text-amber-100/85">
          {missingConfig ? t('banner.pending') : t('banner.ready')}
        </AlertDescription>
      </Alert>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="space-y-6">
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
              onDirtyChange={setIsDirty}
              submitLabel={t('actions.saveSettings')}
              successMessage={t('toast.saved')}
              onSubmit={handleSave}
            />
          )}
        </div>

        <aside className="space-y-4 xl:sticky xl:top-20 xl:self-start">
          <Card size="sm" className="border-border/70 bg-card/95">
            <CardHeader>
              <CardTitle>{t('sections.workspace')}</CardTitle>
              <CardDescription>{t('descriptions.workspace')}</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3">
              <div className="rounded-xl border border-border/60 bg-background/60 p-3">
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 rounded-full bg-primary/10 p-2 text-primary">
                    <Gauge className="size-4" />
                  </div>
                  <div className="space-y-1">
                    <p className="text-sm font-medium">{t('status.configuration')}</p>
                    <p className="text-xs text-muted-foreground">
                      {missingConfig ? t('status.configurationMissing') : t('status.configurationReady')}
                    </p>
                  </div>
                </div>
              </div>

              <div className="rounded-xl border border-border/60 bg-background/60 p-3">
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 rounded-full bg-primary/10 p-2 text-primary">
                    {isDirty ? <TriangleAlert className="size-4" /> : <CheckCircle2 className="size-4" />}
                  </div>
                  <div className="space-y-1">
                    <p className="text-sm font-medium">{t('status.saveState')}</p>
                    <p className="text-xs text-muted-foreground">
                      {isDirty ? t('status.unsavedHint') : t('status.savedHint')}
                    </p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card size="sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CheckCircle2 className="size-4 text-primary" />
                {t('sections.baseline')}
              </CardTitle>
              <CardDescription>{t('descriptions.baseline')}</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3">
              <p className="text-sm text-muted-foreground">{t('placeholders.baseline')}</p>
              <Button onClick={() => setBaselineDialogOpen(true)} disabled={loading} variant="outline">
                {t('actions.openBaseline')}
              </Button>
            </CardContent>
          </Card>

          <Card size="sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileCheck2 className="size-4 text-primary" />
                {t('sections.sampleReport')}
              </CardTitle>
              <CardDescription>{t('descriptions.sampleReport')}</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3">
              <p className="text-sm text-muted-foreground">{t('placeholders.sampleReport')}</p>
              <Button
                onClick={() => void handleSampleReport()}
                disabled={sampleReportPending || loading}
                variant="outline"
              >
                {t('actions.generateSampleReport')}
              </Button>
            </CardContent>
          </Card>
        </aside>
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
