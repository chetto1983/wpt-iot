'use client';

import { useEffect, useRef, useState, memo } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import type { IRfidUser } from '@wpt/types';
import { RfidUserGroup } from '@wpt/types';
import { apiFetch } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useAuth } from '@/lib/auth-context';
import { usePlcWriteLock } from '@/hooks/use-plc-write-lock';
import { clearSessionDraft, readSessionDraft, writeSessionDraft } from '@/lib/session-draft';
import { PlcStatusBar } from '@/components/plc/plc-status-bar';
import { RfidWriteConfirm } from '@/components/rfid/rfid-write-confirm';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Card, CardContent } from '@/components/ui/card';
import { DisabledTooltip } from '@/components/ui/disabled-tooltip';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

function createEmptyUsers(): IRfidUser[] {
  return Array.from({ length: 48 }, (_, i) => ({
    tagId: i + 1,
    name: '',
    group: RfidUserGroup.OPERATOR,
    enabled: false,
  }));
}

const RFID_DRAFT_KEY = 'rfid-page';

interface RfidDraft {
  users: IRfidUser[];
  lockRemainingSeconds: number;
  hasRead: boolean;
  readSnapshot: IRfidUser[] | null;
}

interface RfidUserRowProps {
  user: IRfidUser;
  onUpdate: (tagId: number, field: keyof IRfidUser, value: unknown) => void;
  t: ReturnType<typeof useTranslations>;
  disabled: boolean;
}

const GROUP_KEYS: Record<number, string> = {
  [RfidUserGroup.OPERATOR]: 'OPERATOR',
  [RfidUserGroup.MAINTENANCE]: 'MAINTENANCE',
  [RfidUserGroup.ADMIN]: 'ADMIN',
};

const RfidUserRow = memo(function RfidUserRow({ user, onUpdate, t, disabled }: RfidUserRowProps) {
  const rowErr = user.enabled && user.name.trim().length === 0;
  return (
    <TableRow className={rowErr ? 'bg-destructive/10' : undefined}>
      <TableCell className="py-2 px-4 text-xs text-muted-foreground font-mono">
        {user.tagId}
      </TableCell>
      <TableCell className="py-2 px-4">
        <Input
          value={user.name}
          onChange={(e) => {
            const sanitized = e.target.value.replace(/[^\x20-\x7E]/g, '').slice(0, 20);
            onUpdate(user.tagId, 'name', sanitized);
          }}
          placeholder="---"
          className="h-8 text-sm placeholder:italic placeholder:text-muted-foreground placeholder:text-xs"
          maxLength={20}
          disabled={disabled}
        />
        {rowErr && (
          <p className="mt-1 text-xs text-destructive">{t('rowError.enabledBlankName')}</p>
        )}
      </TableCell>
      <TableCell className="py-2 px-4">
        <ToggleGroup
          value={String(user.group)}
          onValueChange={(v) => onUpdate(user.tagId, 'group', Number(v))}
          disabled={disabled}
          aria-label={`${t('columns.group')} ${user.tagId}`}
        >
          <ToggleGroupItem size="sm" value="0" aria-label={t('groups.OPERATOR')}>
            {t('groups.OPERATOR')}
          </ToggleGroupItem>
          <ToggleGroupItem size="sm" value="1" aria-label={t('groups.MAINTENANCE')}>
            {t('groups.MAINTENANCE')}
          </ToggleGroupItem>
          <ToggleGroupItem size="sm" value="2" aria-label={t('groups.ADMIN')}>
            {t('groups.ADMIN')}
          </ToggleGroupItem>
        </ToggleGroup>
      </TableCell>
      <TableCell className="py-2 px-4">
        <Switch
          checked={user.enabled}
          onCheckedChange={(v) => onUpdate(user.tagId, 'enabled', v)}
          aria-label={`${t('columns.enabled')} ${user.tagId}`}
          disabled={disabled}
        />
      </TableCell>
    </TableRow>
  );
});

const RfidUserCard = memo(function RfidUserCard({ user, onUpdate, t, disabled }: RfidUserRowProps) {
  const rowErr = user.enabled && user.name.trim().length === 0;
  return (
    <div className={cn('rounded-lg border bg-card p-4', rowErr && 'border-destructive bg-destructive/5')}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {t('columns.tagId')}
          </p>
          <p className="font-mono text-sm">{user.tagId}</p>
        </div>
        <div className="flex items-center gap-2">
          <Label className="text-xs text-muted-foreground">
            {t('columns.enabled')}
          </Label>
          <Switch
            checked={user.enabled}
            onCheckedChange={(v) => onUpdate(user.tagId, 'enabled', v)}
            aria-label={`${t('columns.enabled')} ${user.tagId}`}
            disabled={disabled}
          />
        </div>
      </div>

      <div className="grid gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor={`rfid-name-${user.tagId}`}>{t('columns.name')}</Label>
          <Input
            id={`rfid-name-${user.tagId}`}
            value={user.name}
            onChange={(e) => {
              const sanitized = e.target.value.replace(/[^\x20-\x7E]/g, '').slice(0, 20);
              onUpdate(user.tagId, 'name', sanitized);
            }}
            placeholder="---"
            maxLength={20}
            disabled={disabled}
          />
          {rowErr && (
            <p className="text-xs text-destructive">{t('rowError.enabledBlankName')}</p>
          )}
        </div>

        <div className="grid gap-1.5">
          <Label>{t('columns.group')}</Label>
          <Select
            value={String(user.group)}
            onValueChange={(v) => onUpdate(user.tagId, 'group', Number(v))}
            disabled={disabled}
          >
            <SelectTrigger className="w-full" aria-label={`${t('columns.group')} ${user.tagId}`}>
              <SelectValue placeholder={t(`groups.${GROUP_KEYS[user.group] ?? 'OPERATOR'}`)}>
                {t(`groups.${GROUP_KEYS[user.group] ?? 'OPERATOR'}`)}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="0">{t('groups.OPERATOR')}</SelectItem>
              <SelectItem value="1">{t('groups.MAINTENANCE')}</SelectItem>
              <SelectItem value="2">{t('groups.ADMIN')}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>
  );
});

export default function RfidPage() {
  const { user } = useAuth();
  const t = useTranslations('rfid');
  const tAuth = useTranslations('auth');
  const tCommon = useTranslations('common');

  const [users, setUsers] = useState<IRfidUser[]>(createEmptyUsers);
  const [hasRead, setHasRead] = useState(false);
  const [readSnapshot, setReadSnapshot] = useState<IRfidUser[] | null>(null);
  const [isReading, setIsReading] = useState(false);
  const [isWriting, setIsWriting] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const lock = usePlcWriteLock();
  const hydratedDraft = useRef(false);

  // Role gate: CLIENT cannot access this page
  if (user?.role === 'CLIENT') {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-muted-foreground">{tAuth('unauthorized')}</p>
      </div>
    );
  }

  const updateUser = (tagId: number, field: keyof IRfidUser, value: unknown) => {
    setUsers(prev => prev.map(u => u.tagId === tagId ? { ...u, [field]: value } : u));
  };

  useEffect(() => {
    if (hydratedDraft.current) return;
    hydratedDraft.current = true;

    const draft = readSessionDraft<RfidDraft>(RFID_DRAFT_KEY);
    if (!draft) return;

    setUsers(draft.users);
    setHasRead(draft.hasRead);
    setReadSnapshot(draft.readSnapshot ?? null);
    if (draft.lockRemainingSeconds > 0) {
      lock.restoreLoadedState(draft.lockRemainingSeconds);
    }
  }, [lock]);

  useEffect(() => {
    if (!hasRead) {
      clearSessionDraft(RFID_DRAFT_KEY);
      return;
    }

    writeSessionDraft(RFID_DRAFT_KEY, {
      users,
      lockRemainingSeconds: lock.canWrite ? lock.remainingSeconds : 0,
      hasRead,
      readSnapshot,
    });
  }, [users, hasRead, readSnapshot, lock.canWrite, lock.remainingSeconds]);

  const handleRead = async () => {
    setIsReading(true);
    try {
      const data = await apiFetch<{ users: IRfidUser[] }>('/api/rfid/read', { method: 'POST' });
      setUsers(data.users);
      setReadSnapshot(structuredClone(data.users));
      setHasRead(true);
      lock.markReadSuccess();
      toast.success(t('toast.readSuccess'));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('Handshake in progress')) {
        toast.error(tCommon('plcBusy'));
      } else {
        toast.error(t('toast.readError', { error: msg }));
      }
    } finally {
      setIsReading(false);
    }
  };

  const handleWrite = async () => {
    setIsWriting(true);
    try {
      await apiFetch('/api/rfid/write', {
        method: 'POST',
        body: JSON.stringify({ users }),
      });
      lock.markWriteSuccess();
      setReadSnapshot(structuredClone(users));
      toast.success(t('toast.writeSuccess'));
      setConfirmOpen(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('Handshake in progress')) {
        toast.error(tCommon('plcBusy'));
      } else {
        toast.error(t('toast.writeError', { error: msg }));
      }
    } finally {
      setIsWriting(false);
    }
  };

  const handleWriteClick = () => {
    if (!lock.canWrite) {
      toast.warning(t('toast.writeNotAllowed'));
      return;
    }
    setConfirmOpen(true);
  };

  const fieldsLocked = !hasRead || lock.state === 'expired';
  const enabledBlankCount = users.filter((u) => u.enabled && u.name.trim().length === 0).length;
  const hasEnabledBlank = enabledBlankCount > 0;
  const writeDisabled = !lock.canWrite || !hasRead || hasEnabledBlank || isReading || isWriting;
  // Precedence: in-flight states (writing > reading) shadow configuration states
  // (readFirst > enabledBlankName > lockExpired). Matches /jobs tooltip precedence intent.
  const writeDisabledTooltip = isWriting
    ? t('tooltip.writeDisabled.writeInProgress')
    : isReading
      ? t('tooltip.writeDisabled.readInProgress')
      : !hasRead
        ? t('tooltip.writeDisabled.readFirst')
        : hasEnabledBlank
          ? t('tooltip.writeDisabled.enabledBlankName', { count: enabledBlankCount })
          : !lock.canWrite
            ? t('tooltip.writeDisabled.lockExpired')
            : '';

  return (
    <div className="space-y-4 p-6">
      <PlcStatusBar
        state={lock.state}
        remainingSeconds={lock.remainingSeconds}
        namespace="rfid"
        loading={isReading}
      />

      {!hasRead && !isReading ? (
        <p className="rounded-lg border border-dashed px-4 py-3 text-sm text-muted-foreground">
          {t('readFirst')}
        </p>
      ) : null}

      <Card>
        <CardContent className="p-0">
          <div className="grid gap-3 p-4 md:hidden">
            {users.map(u => (
              <RfidUserCard
                key={u.tagId}
                user={u}
                onUpdate={updateUser}
                t={t}
                disabled={fieldsLocked}
              />
            ))}
          </div>
          <div className="hidden md:block overflow-auto md:max-h-[calc(100dvh-280px)]">
            <Table className="min-w-[640px]">
              <TableHeader className="sticky top-0 z-10 bg-card">
                <TableRow>
                  <TableHead className="w-16 px-4 py-2">{t('columns.tagId')}</TableHead>
                  <TableHead className="min-w-[200px] px-4 py-2">{t('columns.name')}</TableHead>
                  {/* Widened from w-40 (160px) to min-w-[280px] — the 3-button ToggleGroup (sm size, "Manutentore" IT label) overflows w-40. */}
                  <TableHead className="min-w-[280px] px-4 py-2">{t('columns.group')}</TableHead>
                  <TableHead className="w-24 px-4 py-2">{t('columns.enabled')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.map(u => (
                  <RfidUserRow
                    key={u.tagId}
                    user={u}
                    onUpdate={updateUser}
                    t={t}
                    disabled={fieldsLocked}
                  />
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-col gap-3 sm:flex-row sm:justify-between sm:gap-6">
        <Button
          onClick={handleRead}
          disabled={isReading || isWriting}
          className="w-full sm:w-auto"
        >
          {isReading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {isReading ? t('actions.reading') : t('actions.readFromPlc')}
        </Button>
        <DisabledTooltip disabled={writeDisabled} tooltip={writeDisabledTooltip}>
          <Button
            variant={lock.canWrite ? 'destructive' : 'outline'}
            onClick={handleWriteClick}
            disabled={writeDisabled}
            className="w-full sm:w-auto"
          >
            {isWriting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {isWriting ? t('actions.writing') : t('actions.writeToPlc')}
          </Button>
        </DisabledTooltip>
      </div>

      <RfidWriteConfirm
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        onConfirm={handleWrite}
        loading={isWriting}
        previousUsers={readSnapshot}
        currentUsers={users}
      />
    </div>
  );
}
