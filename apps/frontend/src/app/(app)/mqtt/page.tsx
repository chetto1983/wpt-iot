'use client';

import { useState, useEffect, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  Wifi,
  WifiOff,
  Plus,
  Pencil,
  Trash2,
  RefreshCw,
  RotateCcw,
  Loader2,
} from 'lucide-react';

import { apiFetch } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { MqttConfigForm } from '@/components/mqtt/mqtt-config-form';
import { MqttUserDialog } from '@/components/mqtt/mqtt-user-dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface MqttStatus {
  connected: boolean;
  enabled: boolean;
  brokerHost: string;
  brokerPort: number;
  clientId: string;
  sparkplugConnected: boolean;
  sparkplugClientId: string | null;
  sparkplugEdgeNodeId: string | null;
  bdSeq: number;
  seq: number;
  alarmCatalogVersion: string;
}

interface MqttConfig {
  id: number;
  enabled: boolean;
  brokerHost: string;
  brokerPort: number;
  username: string;
  passwordSet: boolean;
  siteId: string;
  machineId: string;
  publishMachine: boolean;
  publishAlarms: boolean;
  publishRfid: boolean;
  publishJobs: boolean;
  useTls: boolean;
  caCert: string | null;
  sparkplugGroupId: string;
  sparkplugEdgeNodeId: string;
  publishCycleRecords: boolean;
  telemetryIntervalSeconds: number;
  updatedAt: string;
}

interface MqttUser {
  username: string;
  textName?: string;
  roles: string[];
  disabled?: boolean;
}

interface MqttLogEvent {
  timestamp: string;
  type: 'connect' | 'disconnect' | 'publish' | 'subscribe' | 'error';
  detail: string;
}

const EVENT_BADGE_VARIANT: Record<string, 'default' | 'secondary' | 'outline' | 'destructive'> = {
  connect: 'default',
  disconnect: 'secondary',
  publish: 'outline',
  subscribe: 'default',
  error: 'destructive',
};

const ROLE_BADGE_VARIANT: Record<string, 'secondary' | 'outline' | 'destructive'> = {
  'mqtt-reader': 'secondary',
  'mqtt-operator': 'outline',
  'mqtt-admin': 'destructive',
};

const LOG_ROW_ACCENT: Record<MqttLogEvent['type'], string> = {
  connect: 'border-emerald-500/30 bg-emerald-500/5',
  disconnect: 'border-amber-500/30 bg-amber-500/5',
  publish: 'border-sky-500/30 bg-sky-500/5',
  subscribe: 'border-violet-500/30 bg-violet-500/5',
  error: 'border-destructive/30 bg-destructive/5',
};

export default function MqttPage() {
  const t = useTranslations('mqtt');
  const { user } = useAuth();
  const router = useRouter();

  const [status, setStatus] = useState<MqttStatus | null>(null);
  const [config, setConfig] = useState<MqttConfig | null>(null);
  const [users, setUsers] = useState<MqttUser[]>([]);
  const [userDialogOpen, setUserDialogOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<MqttUser | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
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

  const loadUsers = useCallback(async () => {
    try {
      const data = await apiFetch<MqttUser[]>('/api/mqtt/users');
      setUsers(data);
    } catch {
      // users unavailable
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
      void loadUsers();
      void loadLog();
    }
  }, [user, loadStatus, loadConfig, loadUsers, loadLog]);

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

  const handleDeleteUser = useCallback(async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await apiFetch(`/api/mqtt/users/${encodeURIComponent(deleteTarget)}`, {
        method: 'DELETE',
      });
      toast.success(t('users.deleted'));
      setDeleteTarget(null);
      void loadUsers();
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      toast.error(msg);
    } finally {
      setDeleting(false);
    }
  }, [deleteTarget, t, loadUsers]);

  if (!user || user.role !== 'SUPER_ADMIN') return null;

  const primaryRole = (u: MqttUser): string =>
    u.roles.find((r) => r.startsWith('mqtt-')) ?? u.roles[0] ?? '';

  const roleLabel = (role: string): string => {
    if (role === 'mqtt-reader') return t('users.roleReader');
    if (role === 'mqtt-operator') return t('users.roleOperator');
    if (role === 'mqtt-admin') return t('users.roleAdmin');
    return role;
  };

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
                  disabled={rebirthing || !status?.sparkplugConnected}
                  className="w-full sm:w-auto"
                  title={
                    status?.sparkplugConnected
                      ? undefined
                      : t('status.rebirthDisabledTitle')
                  }
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
                      {t('status.localBroker')}: {status.connected ? t('status.connected') : t('status.disconnected')}
                    </Badge>
                    <Badge variant={status.sparkplugConnected ? 'default' : 'secondary'} className="rounded-full">
                      {t('status.sparkplugUplink')}: {status.sparkplugConnected ? t('status.connected') : t('status.disconnected')}
                    </Badge>
                    <Badge variant={status.enabled ? 'default' : 'secondary'} className="rounded-full">
                      {status.enabled ? t('status.enabled') : t('status.disabled')}
                    </Badge>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                    <div className="rounded-2xl border border-border/70 bg-background/70 p-4">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                        {t('status.brokerHost')}
                      </p>
                      <p className="mt-2 break-all font-mono text-sm text-foreground">
                        {status.brokerHost}:{String(status.brokerPort)}
                      </p>
                    </div>
                    <div className="rounded-2xl border border-border/70 bg-background/70 p-4">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                        {t('status.sparkplugClientId')}
                      </p>
                      <p className="mt-2 break-all font-mono text-sm text-foreground">
                        {status.sparkplugClientId ?? t('status.notYetAssigned')}
                      </p>
                    </div>
                    <div className="rounded-2xl border border-border/70 bg-background/70 p-4">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                        {t('status.localClientId')}
                      </p>
                      <p className="mt-2 break-all font-mono text-sm text-foreground">
                        {status.clientId}
                      </p>
                    </div>
                    <div className="rounded-2xl border border-border/70 bg-background/70 p-4">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                        bdSeq / seq
                      </p>
                      <p className="mt-2 font-mono text-sm text-foreground">
                        {status.bdSeq} / {status.seq}
                      </p>
                    </div>
                    <div className="rounded-2xl border border-border/70 bg-background/70 p-4">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                        {t('status.alarmCatalog')}
                      </p>
                      <p className="mt-2 font-mono text-sm text-foreground">
                        v{status.alarmCatalogVersion}
                      </p>
                    </div>
                    <div className="rounded-2xl border border-border/70 bg-background/70 p-4">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                        {t('hero.cards.users')}
                      </p>
                      <p className="mt-2 text-sm text-foreground">
                        {t('hero.cards.usersValue', { count: users.length })}
                      </p>
                    </div>
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

        <Card>
            <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="space-y-1">
                <CardTitle>{t('users.title')}</CardTitle>
                <CardDescription>{t('users.subtitle')}</CardDescription>
              </div>
              <Button
                size="sm"
                className="w-full sm:w-auto"
                onClick={() => {
                  setEditTarget(null);
                  setUserDialogOpen(true);
                }}
              >
                <Plus className="mr-1 size-4" />
                {t('users.create')}
              </Button>
            </CardHeader>
            <CardContent>
              {users.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('users.noUsers')}</p>
              ) : (
                <>
                  <div className="grid gap-3 md:hidden">
                    {users.map((u) => {
                      const role = primaryRole(u);
                      const isSystem = u.username === 'wpt-backend';
                      return (
                        <div key={u.username} className="rounded-2xl border border-border/70 bg-background/70 p-4 shadow-sm">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="font-medium">{u.username}</p>
                              {u.textName ? (
                                <p className="mt-1 text-sm text-muted-foreground">{u.textName}</p>
                              ) : null}
                              {isSystem ? (
                                <Badge variant="outline" className="mt-2 text-xs">
                                  {t('users.systemAccount')}
                                </Badge>
                              ) : null}
                            </div>
                            <Badge variant={ROLE_BADGE_VARIANT[role] ?? 'secondary'}>
                              {roleLabel(role)}
                            </Badge>
                          </div>
                          {!isSystem ? (
                            <div className="mt-4 flex flex-wrap gap-2">
                              <Button
                                variant="outline"
                                size="sm"
                                className="flex-1"
                                onClick={() => {
                                  setEditTarget(u);
                                  setUserDialogOpen(true);
                                }}
                              >
                                <Pencil className="size-4" />
                                {t('users.edit')}
                              </Button>
                              <Button
                                variant="destructive"
                                size="sm"
                                className="flex-1"
                                onClick={() => setDeleteTarget(u.username)}
                              >
                                <Trash2 className="size-4" />
                                {t('users.delete')}
                              </Button>
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>

                  <div className="hidden md:block">
                    <Table className="min-w-[720px]">
                      <TableHeader>
                        <TableRow>
                          <TableHead>{t('users.username')}</TableHead>
                          <TableHead>{t('users.textName')}</TableHead>
                          <TableHead>{t('users.role')}</TableHead>
                          <TableHead className="w-16" />
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {users.map((u) => {
                          const role = primaryRole(u);
                          const isSystem = u.username === 'wpt-backend';
                          return (
                            <TableRow key={u.username}>
                              <TableCell className="font-medium">
                                {u.username}
                                {isSystem ? (
                                  <Badge variant="outline" className="ml-2 text-xs">
                                    {t('users.systemAccount')}
                                  </Badge>
                                ) : null}
                              </TableCell>
                              <TableCell className="text-muted-foreground">
                                {u.textName || '—'}
                              </TableCell>
                              <TableCell>
                                <Badge variant={ROLE_BADGE_VARIANT[role] ?? 'secondary'}>
                                  {roleLabel(role)}
                                </Badge>
                              </TableCell>
                              <TableCell>
                                {!isSystem ? (
                                  <div className="flex items-center gap-1">
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      onClick={() => {
                                        setEditTarget(u);
                                        setUserDialogOpen(true);
                                      }}
                                      aria-label={t('users.editUserLabel', { username: u.username })}
                                    >
                                      <Pencil className="size-4" />
                                    </Button>
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      onClick={() => setDeleteTarget(u.username)}
                                      aria-label={t('users.deleteUserLabel', { username: u.username })}
                                    >
                                      <Trash2 className="size-4 text-red-500" />
                                    </Button>
                                  </div>
                                ) : null}
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
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
                const time = new Date(event.timestamp).toLocaleTimeString();
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

      <MqttUserDialog
        open={userDialogOpen}
        onOpenChange={(open) => {
          setUserDialogOpen(open);
          if (!open) setEditTarget(null);
        }}
        onSaved={() => void loadUsers()}
        editUser={editTarget}
      />

      <Dialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('users.delete')}</DialogTitle>
            <DialogDescription>
              {deleteTarget
                ? `${t('users.deleteConfirm', { username: deleteTarget })} ${t('users.deleteDescription')}`
                : ''}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeleteTarget(null)}
              disabled={deleting}
            >
              {t('users.cancel')}
            </Button>
            <Button
              variant="destructive"
              onClick={handleDeleteUser}
              disabled={deleting}
            >
              {deleting ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
              {t('users.delete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
