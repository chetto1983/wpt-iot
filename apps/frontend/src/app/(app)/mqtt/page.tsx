'use client';

import { useState, useEffect, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Wifi, WifiOff, RefreshCw, RotateCcw, Loader2 } from 'lucide-react';

import { apiFetch } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { useAppLocale } from '@/lib/locale';
import { MqttConfigForm, type MqttConfig } from '@/components/mqtt/mqtt-config-form';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

/** GET /api/mqtt/status — the Sparkplug uplink is the edge's only MQTT connection. */
interface MqttStatus {
  connected: boolean;
  enabled: boolean;
  brokerHost: string;
  brokerPort: number;
  sparkplugClientId: string | null;
  sparkplugEdgeNodeId: string | null;
  bdSeq: number;
  seq: number;
  alarmCatalogVersion: string;
}

interface MqttLogEvent {
  timestamp: string;
  type: 'connect' | 'disconnect' | 'publish' | 'error';
  detail: string;
}

const EVENT_BADGE_VARIANT: Record<MqttLogEvent['type'], 'default' | 'secondary' | 'outline' | 'destructive'> = {
  connect: 'default',
  disconnect: 'secondary',
  publish: 'outline',
  error: 'destructive',
};

const LOG_ROW_ACCENT: Record<MqttLogEvent['type'], string> = {
  connect: 'border-emerald-500/30 bg-emerald-500/5',
  disconnect: 'border-amber-500/30 bg-amber-500/5',
  publish: 'border-sky-500/30 bg-sky-500/5',
  error: 'border-destructive/30 bg-destructive/5',
};

function StatusTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-border/70 bg-background/70 p-4">
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
        {label}
      </p>
      <p className="mt-2 break-all font-mono text-sm text-foreground">{value}</p>
    </div>
  );
}

export default function MqttPage() {
  const t = useTranslations('mqtt');
  const { user } = useAuth();
  const router = useRouter();
  const { formatTimeFull } = useAppLocale();

  const [status, setStatus] = useState<MqttStatus | null>(null);
  const [config, setConfig] = useState<MqttConfig | null>(null);
  const [testing, setTesting] = useState(false);
  const [rebirthing, setRebirthing] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [logEvents, setLogEvents] = useState<MqttLogEvent[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (user && user.role !== 'SUPER_ADMIN') {
      router.replace('/dashboard');
    }
  }, [user, router]);

  const loadStatus = useCallback(async () => {
    try {
      const data = await apiFetch<MqttStatus>('/api/mqtt/status');
      setStatus(data);
      setLoadError(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to load status';
      setLoadError(msg);
    }
  }, []);

  const loadConfig = useCallback(async () => {
    try {
      const data = await apiFetch<MqttConfig>('/api/mqtt/config');
      setConfig(data);
      setLoadError(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to load config';
      setLoadError(msg);
    }
  }, []);

  const loadLog = useCallback(async () => {
    try {
      const data = await apiFetch<MqttLogEvent[]>('/api/mqtt/log');
      setLogEvents(data);
    } catch {
      // log unavailable
    }
  }, []);

  useEffect(() => {
    if (user?.role === 'SUPER_ADMIN') {
      void loadStatus();
      void loadConfig();
      void loadLog();
    }
  }, [user, loadStatus, loadConfig, loadLog]);

  useEffect(() => {
    if (user?.role !== 'SUPER_ADMIN') return;
    const interval = setInterval(() => {
      void loadLog();
      void loadStatus();
    }, 5000);
    return () => clearInterval(interval);
  }, [user, loadLog, loadStatus]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadStatus();
    setRefreshing(false);
  }, [loadStatus]);

  const handleTestConnection = useCallback(async () => {
    setTesting(true);
    try {
      const result = await apiFetch<{ success: boolean; message: string }>(
        '/api/mqtt/test',
        { method: 'POST' },
      );
      if (result.success) {
        toast.success(t('status.testSuccess'));
      } else {
        toast.error(t('status.testFailed'));
      }
    } catch {
      toast.error(t('status.testFailed'));
    } finally {
      setTesting(false);
    }
  }, [t]);

  const handleRebirth = useCallback(async () => {
    setRebirthing(true);
    try {
      await apiFetch('/api/mqtt/rebirth', { method: 'POST' });
      toast.success(t('status.rebirthSuccess'));
    } catch (err) {
      const msg = err instanceof Error ? err.message : t('status.rebirthFailed');
      toast.error(msg);
    } finally {
      setRebirthing(false);
    }
  }, [t]);

  if (!user || user.role !== 'SUPER_ADMIN') return null;

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 p-4 sm:p-6">
      <section className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">{t('title')}</h1>
        <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
          {t('subtitle')}
        </p>
      </section>

      <div className="space-y-6">
        <Card className={status?.connected ? 'border-emerald-500/20 bg-emerald-500/[0.03]' : 'border-border/70'}>
          <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-1">
              <CardTitle>{t('status.title')}</CardTitle>
              <CardDescription>{t('status.subtitle')}</CardDescription>
            </div>
            <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
              <Button
                variant="outline"
                size="sm"
                onClick={handleTestConnection}
                disabled={testing}
                className="w-full sm:w-auto"
              >
                {testing ? <Loader2 className="mr-1 size-4 animate-spin" /> : null}
                {t('status.testConnection')}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleRebirth}
                disabled={rebirthing || !status?.connected}
                className="w-full sm:w-auto"
                title={status?.connected ? undefined : t('status.rebirthDisabledTitle')}
              >
                {rebirthing ? (
                  <Loader2 className="mr-1 size-4 animate-spin" />
                ) : (
                  <RotateCcw className="mr-1 size-4" />
                )}
                {t('status.forceRebirth')}
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={handleRefresh}
                disabled={refreshing}
                className="self-end sm:self-auto"
                aria-label={t('status.refreshStatus')}
              >
                <RefreshCw className={`size-4 ${refreshing ? 'animate-spin' : ''}`} />
              </Button>
            </div>
          </CardHeader>
          <CardContent className="grid gap-4">
            {loadError ? (
              <div className="rounded-2xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                {t('status.loadError', { error: loadError })}
              </div>
            ) : null}
            {status ? (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  {status.connected ? (
                    <Wifi className="size-5 text-emerald-600" />
                  ) : (
                    <WifiOff className="size-5 text-destructive" />
                  )}
                  <Badge
                    variant={status.connected ? 'default' : undefined}
                    severity={!status.connected ? 'high' : undefined}
                    className="rounded-full"
                  >
                    {t('status.sparkplugUplink')}: {status.connected ? t('status.connected') : t('status.disconnected')}
                  </Badge>
                  <Badge variant={status.enabled ? 'default' : 'secondary'} className="rounded-full">
                    {status.enabled ? t('status.enabled') : t('status.disabled')}
                  </Badge>
                </div>
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  <StatusTile
                    label={t('status.brokerHost')}
                    value={`${status.brokerHost}:${String(status.brokerPort)}`}
                  />
                  <StatusTile
                    label={t('status.sparkplugClientId')}
                    value={status.sparkplugClientId ?? t('status.notYetAssigned')}
                  />
                  <StatusTile label="bdSeq / seq" value={`${status.bdSeq} / ${status.seq}`} />
                  <StatusTile label={t('status.alarmCatalog')} value={`v${status.alarmCatalogVersion}`} />
                </div>
              </>
            ) : (
              <div className="text-sm text-muted-foreground">
                {loadError ? null : t('status.loading')}
              </div>
            )}
          </CardContent>
        </Card>

        {config ? (
          <MqttConfigForm
            config={config}
            onSaved={() => {
              void loadConfig();
              void loadStatus();
            }}
          />
        ) : null}
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div className="space-y-1">
            <CardTitle>{t('activityLog.title')}</CardTitle>
            <CardDescription>{t('activityLog.subtitle')}</CardDescription>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => void loadLog()}
            aria-label={t('activityLog.refresh')}
          >
            <RefreshCw className="size-4" />
          </Button>
        </CardHeader>
        <CardContent>
          {logEvents.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('activityLog.empty')}</p>
          ) : (
            <div className="max-h-96 space-y-2 overflow-y-auto" tabIndex={0}>
              {[...logEvents].reverse().map((event, i) => {
                const time = formatTimeFull(new Date(event.timestamp));
                return (
                  <div
                    key={`${event.timestamp}-${event.type}-${i}`}
                    className={`flex items-center gap-3 rounded-2xl border px-3 py-2 ${LOG_ROW_ACCENT[event.type]}`}
                  >
                    <span className="shrink-0 rounded-full bg-background/80 px-2 py-1 font-mono text-[11px] text-muted-foreground">
                      {time}
                    </span>
                    <Badge
                      variant={EVENT_BADGE_VARIANT[event.type] ?? 'secondary'}
                      className="shrink-0"
                    >
                      {t(`activityLog.${event.type}`)}
                    </Badge>
                    <span className="truncate font-mono text-sm" title={event.detail}>
                      {event.detail}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
