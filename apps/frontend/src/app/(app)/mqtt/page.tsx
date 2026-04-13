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
  Loader2,
} from 'lucide-react';

import { apiFetch } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { MqttConfigForm } from '@/components/mqtt-config-form';
import { MqttUserDialog } from '@/components/mqtt-user-dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
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
}

interface MqttConfig {
  id: number;
  enabled: boolean;
  brokerHost: string;
  brokerPort: number;
  username: string;
  // GET responses never include the broker password — only `passwordSet`
  // tells the form whether the input is required or can be left blank.
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
  const [refreshing, setRefreshing] = useState(false);
  const [logEvents, setLogEvents] = useState<MqttLogEvent[]>([]);

  // Guard: SUPER_ADMIN only
  useEffect(() => {
    if (user && user.role !== 'SUPER_ADMIN') {
      router.replace('/dashboard');
    }
  }, [user, router]);

  const loadStatus = useCallback(async () => {
    try {
      const data = await apiFetch<MqttStatus>('/api/mqtt/status');
      setStatus(data);
    } catch {
      // status unavailable
    }
  }, []);

  const loadConfig = useCallback(async () => {
    try {
      const data = await apiFetch<MqttConfig>('/api/mqtt/config');
      setConfig(data);
    } catch {
      // config unavailable
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

  // Auto-refresh activity log every 5 seconds
  useEffect(() => {
    if (user?.role !== 'SUPER_ADMIN') return;
    const interval = setInterval(() => { void loadLog(); }, 5000);
    return () => clearInterval(interval);
  }, [user, loadLog]);

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

  const primaryRole = (u: MqttUser): string => {
    // Find first wpt-specific role (skip generic Mosquitto roles)
    return u.roles.find((r) => r.startsWith('mqtt-')) ?? u.roles[0] ?? '';
  };

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 p-4 sm:p-6">
      <h1 className="text-2xl font-semibold">{t('title')}</h1>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Left Column */}
        <div className="space-y-6">
          {/* Broker Status */}
          <Card>
            <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <CardTitle>{t('status.title')}</CardTitle>
              <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleTestConnection}
                  disabled={testing}
                  className="w-full sm:w-auto"
                >
                  {testing ? (
                    <Loader2 className="mr-1 size-4 animate-spin" />
                  ) : null}
                  {t('status.testConnection')}
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={handleRefresh}
                  disabled={refreshing}
                  className="self-end sm:self-auto"
                >
                  <RefreshCw
                    className={`size-4 ${refreshing ? 'animate-spin' : ''}`}
                  />
                </Button>
              </div>
            </CardHeader>
            <CardContent className="grid gap-3">
              {status ? (
                <>
                  <div className="flex items-center gap-2">
                    {status.connected ? (
                      <Wifi className="size-5 text-green-500" />
                    ) : (
                      <WifiOff className="size-5 text-red-500" />
                    )}
                    <Badge
                      variant={status.connected ? 'default' : 'destructive'}
                    >
                      {status.connected
                        ? t('status.connected')
                        : t('status.disconnected')}
                    </Badge>
                    <Badge variant={status.enabled ? 'default' : 'secondary'}>
                      {status.enabled
                        ? t('status.enabled')
                        : t('status.disabled')}
                    </Badge>
                  </div>
                  <div className="grid gap-1 text-sm text-muted-foreground">
                    <div>
                      <span className="font-medium text-foreground">
                        {t('status.brokerHost')}:
                      </span>{' '}
                      {status.brokerHost}:{String(status.brokerPort)}
                    </div>
                    <div>
                      <span className="font-medium text-foreground">
                        {t('status.clientId')}:
                      </span>{' '}
                      {status.clientId}
                    </div>
                  </div>
                </>
              ) : (
                <div className="text-sm text-muted-foreground">
                  {t('status.disconnected')}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Configuration */}
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

        {/* Right Column - Users */}
        <div className="space-y-6">
          <Card>
            <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <CardTitle>{t('users.title')}</CardTitle>
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
                <p className="text-sm text-muted-foreground">
                  {t('users.noUsers')}
                </p>
              ) : (
                <>
                  <div className="grid gap-3 md:hidden">
                    {users.map((u) => {
                      const role = primaryRole(u);
                      const isSystem = u.username === 'wpt-backend';
                      return (
                        <div key={u.username} className="rounded-lg border p-4">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="font-medium">{u.username}</p>
                              {isSystem ? (
                                <Badge
                                  variant="outline"
                                  className="mt-2 text-xs"
                                >
                                  {t('users.systemAccount')}
                                </Badge>
                              ) : null}
                            </div>
                            <Badge
                              variant={
                                ROLE_BADGE_VARIANT[role] ?? 'secondary'
                              }
                            >
                              {role}
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
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>{t('users.username')}</TableHead>
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
                                  <Badge
                                    variant="outline"
                                    className="ml-2 text-xs"
                                  >
                                    {t('users.systemAccount')}
                                  </Badge>
                                ) : null}
                              </TableCell>
                              <TableCell>
                                <Badge
                                  variant={
                                    ROLE_BADGE_VARIANT[role] ?? 'secondary'
                                  }
                                >
                                  {role}
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
                                    >
                                      <Pencil className="size-4" />
                                    </Button>
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      onClick={() => setDeleteTarget(u.username)}
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
      </div>

      {/* Activity Log — full width below the 2-column grid */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>{t('activityLog.title')}</CardTitle>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => void loadLog()}
          >
            <RefreshCw className="size-4" />
          </Button>
        </CardHeader>
        <CardContent>
          {logEvents.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t('activityLog.empty')}
            </p>
          ) : (
            <div className="max-h-80 space-y-2 overflow-y-auto">
              {[...logEvents].reverse().map((event, i) => {
                const time = event.timestamp.slice(11, 19);
                return (
                  <div key={i} className="flex items-center gap-2">
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {time}
                    </span>
                    <Badge
                      variant={
                        EVENT_BADGE_VARIANT[event.type] ?? 'secondary'
                      }
                      className="shrink-0"
                    >
                      {t(`activityLog.${event.type}`)}
                    </Badge>
                    <span
                      className="truncate text-sm"
                      title={event.detail}
                    >
                      {event.detail}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Dialogs */}
      <MqttUserDialog
        open={userDialogOpen}
        onOpenChange={(open) => {
          setUserDialogOpen(open);
          if (!open) setEditTarget(null);
        }}
        onSaved={() => void loadUsers()}
        editUser={editTarget}
      />

      {/* Delete Confirmation */}
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
                ? t('users.deleteConfirm', { username: deleteTarget })
                : ''}
            </DialogDescription>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {t('users.deleteDescription')}
          </p>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeleteTarget(null)}
              disabled={deleting}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDeleteUser}
              disabled={deleting}
            >
              {deleting ? (
                <Loader2 className="mr-2 size-4 animate-spin" />
              ) : null}
              {t('users.delete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
