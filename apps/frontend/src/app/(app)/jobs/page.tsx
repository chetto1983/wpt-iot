'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Loader2, ArrowDownToLine } from 'lucide-react';
import type { IJobData } from '@wpt/types';
import {
  CycleType,
  RemoteJobEnable,
  MaintenanceRequest,
  RemoteCycleSelection,
} from '@wpt/types';
import { apiFetch } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { usePlcWriteLock } from '@/hooks/use-plc-write-lock';
import { PlcStatusBar } from '@/components/plc-status-bar';
import { PlcWriteConfirm } from '@/components/plc-write-confirm';
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
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

const emptyJob: IJobData = {
  supervisor: '',
  orderNumber: '',
  serialNumber: '',
  remoteJobEnable: RemoteJobEnable.NO_REQUEST,
  maintenanceRequest: MaintenanceRequest.NO_REQUEST,
  remoteCycleSelection: RemoteCycleSelection.NO_REQUEST,
  cycleType: CycleType.NO_CYCLE,
};

export default function JobsPage() {
  const { user } = useAuth();
  const t = useTranslations('jobs');
  const tDashboard = useTranslations('dashboard');
  const tAuth = useTranslations('auth');
  const tCommon = useTranslations('common');

  const [job, setJob] = useState<IJobData>(emptyJob);
  const [hasRead, setHasRead] = useState(false);
  const [isReading, setIsReading] = useState(false);
  const [isWriting, setIsWriting] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const lock = usePlcWriteLock();

  // Role gate: CLIENT cannot access this page
  if (user?.role === 'CLIENT') {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <p>{tAuth('unauthorized')}</p>
      </div>
    );
  }

  const handleRead = async () => {
    setIsReading(true);
    try {
      const data = await apiFetch<{ job: IJobData }>('/jobs/read', {
        method: 'POST',
      });
      setJob(data.job);
      lock.markReadSuccess();
      setHasRead(true);
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
      await apiFetch('/jobs/write', {
        method: 'POST',
        body: JSON.stringify({ job }),
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

  const updateTextField = (
    field: 'supervisor' | 'orderNumber' | 'serialNumber',
    value: string,
  ) => {
    const sanitized = value.replace(/[^\x20-\x7E]/g, '').slice(0, 20);
    setJob(prev => ({ ...prev, [field]: sanitized }));
  };

  return (
    <div className="space-y-6 p-6">
      <PlcStatusBar
        state={lock.state}
        remainingSeconds={lock.remainingSeconds}
        namespace="jobs"
      />

      {!hasRead && (
        <div className="rounded-lg border border-blue-500/30 bg-blue-500/10 p-6 text-center">
          <ArrowDownToLine className="mx-auto mb-3 h-10 w-10 text-blue-500" />
          <h2 className="text-lg font-semibold">{t('readFirst.title')}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {t('readFirst.subtitle')}
          </p>
          <Button
            size="lg"
            className="mt-4"
            onClick={handleRead}
            disabled={isReading}
          >
            {isReading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {isReading ? t('actions.reading') : t('actions.readFromPlc')}
          </Button>
        </div>
      )}

      {/* Card 1: Job Identity */}
      <Card>
        <CardHeader>
          <CardTitle>{t('identity')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="supervisor">{t('fields.supervisor')}</Label>
            <Input
              id="supervisor"
              value={job.supervisor}
              onChange={e => updateTextField('supervisor', e.target.value)}
              maxLength={20}
              placeholder="---"
              disabled={!hasRead}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="orderNumber">{t('fields.orderNumber')}</Label>
            <Input
              id="orderNumber"
              value={job.orderNumber}
              onChange={e => updateTextField('orderNumber', e.target.value)}
              maxLength={20}
              placeholder="---"
              disabled={!hasRead}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="serialNumber">{t('fields.serialNumber')}</Label>
            <Input
              id="serialNumber"
              value={job.serialNumber}
              onChange={e => updateTextField('serialNumber', e.target.value)}
              maxLength={20}
              placeholder="---"
              disabled={!hasRead}
            />
          </div>
        </CardContent>
      </Card>

      {/* Card 2: Machine Control */}
      <Card>
        <CardHeader>
          <CardTitle>{t('machineControl')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>{t('fields.remoteJobEnable')}</Label>
            <Select
              value={String(job.remoteJobEnable)}
              onValueChange={v =>
                setJob(prev => ({
                  ...prev,
                  remoteJobEnable: Number(v) as RemoteJobEnable,
                }))
              }
              disabled={!hasRead}
            >
              <SelectTrigger>
                <SelectValue>{t(`enums.remoteJobEnable.${job.remoteJobEnable}`)}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="0">
                  {t('enums.remoteJobEnable.0')}
                </SelectItem>
                <SelectItem value="1">
                  {t('enums.remoteJobEnable.1')}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>{t('fields.maintenanceRequest')}</Label>
            <Select
              value={String(job.maintenanceRequest)}
              onValueChange={v =>
                setJob(prev => ({
                  ...prev,
                  maintenanceRequest: Number(v) as MaintenanceRequest,
                }))
              }
              disabled={!hasRead}
            >
              <SelectTrigger>
                <SelectValue>{t(`enums.maintenanceRequest.${job.maintenanceRequest}`)}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="0">
                  {t('enums.maintenanceRequest.0')}
                </SelectItem>
                <SelectItem value="1">
                  {t('enums.maintenanceRequest.1')}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>{t('fields.remoteCycleSelection')}</Label>
            <Select
              value={String(job.remoteCycleSelection)}
              onValueChange={v =>
                setJob(prev => ({
                  ...prev,
                  remoteCycleSelection: Number(v) as RemoteCycleSelection,
                }))
              }
              disabled={!hasRead}
            >
              <SelectTrigger>
                <SelectValue>{t(`enums.remoteCycleSelection.${job.remoteCycleSelection}`)}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="0">
                  {t('enums.remoteCycleSelection.0')}
                </SelectItem>
                <SelectItem value="1">
                  {t('enums.remoteCycleSelection.1')}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>{t('fields.cycleType')}</Label>
            <Select
              value={String(job.cycleType)}
              onValueChange={v =>
                setJob(prev => ({
                  ...prev,
                  cycleType: Number(v) as CycleType,
                }))
              }
              disabled={!hasRead}
            >
              <SelectTrigger>
                <SelectValue>
                  {tDashboard(`cycleTypes.${CycleType[job.cycleType] ?? 'NO_CYCLE'}`)}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {Object.entries(CycleType)
                  .filter(([key]) => isNaN(Number(key)))
                  .map(([key, value]) => (
                    <SelectItem key={value} value={String(value)}>
                      {tDashboard(`cycleTypes.${key}`)}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Button row — visible only after first read */}
      {hasRead && (
        <div className="flex justify-end gap-4">
          <Button onClick={handleRead} disabled={isReading || isWriting}>
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
      )}

      <PlcWriteConfirm
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        onConfirm={handleWrite}
        loading={isWriting}
        namespace="jobs"
      />
    </div>
  );
}
