'use client';

import { useState, memo } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import type { IRfidUser } from '@wpt/types';
import { RfidUserGroup } from '@wpt/types';
import { apiFetch } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { usePlcWriteLock } from '@/hooks/use-plc-write-lock';
import { PlcStatusBar } from '@/components/plc-status-bar';
import { PlcWriteConfirm } from '@/components/plc-write-confirm';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Card, CardContent } from '@/components/ui/card';
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

interface RfidUserRowProps {
  user: IRfidUser;
  onUpdate: (tagId: number, field: keyof IRfidUser, value: unknown) => void;
  t: ReturnType<typeof useTranslations>;
}

const RfidUserRow = memo(function RfidUserRow({ user, onUpdate, t }: RfidUserRowProps) {
  return (
    <TableRow>
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
        />
      </TableCell>
      <TableCell className="py-2 px-4">
        <Select
          value={String(user.group)}
          onValueChange={(v) => onUpdate(user.tagId, 'group', Number(v))}
        >
          <SelectTrigger className="h-8">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="0">{t('groups.OPERATOR')}</SelectItem>
            <SelectItem value="1">{t('groups.MAINTENANCE')}</SelectItem>
            <SelectItem value="2">{t('groups.ADMIN')}</SelectItem>
          </SelectContent>
        </Select>
      </TableCell>
      <TableCell className="py-2 px-4">
        <Switch
          checked={user.enabled}
          onCheckedChange={(v) => onUpdate(user.tagId, 'enabled', v)}
        />
      </TableCell>
    </TableRow>
  );
});

export default function RfidPage() {
  const { user } = useAuth();
  const t = useTranslations('rfid');
  const tAuth = useTranslations('auth');
  const tCommon = useTranslations('common');

  const [users, setUsers] = useState<IRfidUser[]>(createEmptyUsers);
  const [isReading, setIsReading] = useState(false);
  const [isWriting, setIsWriting] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const lock = usePlcWriteLock();

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

  const handleRead = async () => {
    setIsReading(true);
    try {
      const data = await apiFetch<{ users: IRfidUser[] }>('/rfid/read', { method: 'POST' });
      setUsers(data.users);
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
      await apiFetch('/rfid/write', {
        method: 'POST',
        body: JSON.stringify({ users }),
      });
      lock.markWriteSuccess();
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

  return (
    <div className="space-y-4 p-6">
      <PlcStatusBar
        state={lock.state}
        remainingSeconds={lock.remainingSeconds}
        namespace="rfid"
      />

      <Card>
        <CardContent className="p-0">
          <div className="overflow-auto" style={{ maxHeight: 'calc(100vh - 280px)' }}>
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-card">
                <TableRow>
                  <TableHead className="w-16 py-2 px-4">{t('columns.tagId')}</TableHead>
                  <TableHead className="min-w-[200px] py-2 px-4">{t('columns.name')}</TableHead>
                  <TableHead className="w-40 py-2 px-4">{t('columns.group')}</TableHead>
                  <TableHead className="w-24 py-2 px-4">{t('columns.enabled')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.map(u => (
                  <RfidUserRow
                    key={u.tagId}
                    user={u}
                    onUpdate={updateUser}
                    t={t}
                  />
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end gap-4">
        <Button
          onClick={handleRead}
          disabled={isReading || isWriting}
        >
          {isReading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {isReading ? t('actions.reading') : t('actions.readFromPlc')}
        </Button>
        <Button
          variant={lock.canWrite ? 'default' : 'outline'}
          onClick={handleWriteClick}
          disabled={!lock.canWrite || isReading || isWriting}
        >
          {isWriting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {isWriting ? t('actions.writing') : t('actions.writeToPlc')}
        </Button>
      </div>

      <PlcWriteConfirm
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        onConfirm={handleWrite}
        loading={isWriting}
        namespace="rfid"
      />
    </div>
  );
}
