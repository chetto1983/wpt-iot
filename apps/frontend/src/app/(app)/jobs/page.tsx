'use client';

import { useState, useEffect, useRef } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
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
import { clearSessionDraft, readSessionDraft, writeSessionDraft } from '@/lib/session-draft';
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
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

const emptyJob: IJobData = {
  supervisor: '',
  orderNumber: '',
  serialNumber: '',
  remoteJobEnable: RemoteJobEnable.NO_REQUEST,
  maintenanceRequest: MaintenanceRequest.NO_REQUEST,
  remoteCycleSelection: RemoteCycleSelection.NO_REQUEST,
  cycleType: CycleType.NO_CYCLE,
  spareInt02: 0,  // V03 (Phase 19.1 Wave 1) — bare int, no semantics yet
  spareInt03: 0,  // V03 (Phase 19.1 Wave 1) — bare int, no semantics yet
};

const JOBS_DRAFT_KEY = 'jobs-page';

interface JobsDraft {
  job: IJobData;
  hasRead: boolean;
  lockRemainingSeconds: number;
}

/**
 * Wraps a disabled form control with a tooltip explaining why it's disabled.
 * Uses render prop on TooltipTrigger so the span receives hover events
 * even when the inner control is disabled.
 */
function DisabledTooltip({
  disabled,
  tooltip,
  children,
}: {
  disabled: boolean;
  tooltip: string;
  children: React.ReactNode;
}) {
  if (!disabled) return <>{children}</>;

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger
          render={<span tabIndex={0} className="inline-block w-full cursor-not-allowed" />}
        >
          {children}
        </TooltipTrigger>
        <TooltipContent>
          <p>{tooltip}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

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
  const hydratedDraft = useRef(false);

  // Role gate: CLIENT cannot access this page
  if (user?.role === 'CLIENT') {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <p>{tAuth('unauthorized')}</p>
      </div>
    );
  }

  // Auto-read from PLC on page load (like the legacy system)
  const didAutoRead = useRef(false);
  useEffect(() => {
    if (hydratedDraft.current) return;
    hydratedDraft.current = true;

    const draft = readSessionDraft<JobsDraft>(JOBS_DRAFT_KEY);
    if (!draft) return;

    setJob(draft.job);
    setHasRead(draft.hasRead);
    didAutoRead.current = true;
    if (draft.lockRemainingSeconds > 0) {
      lock.restoreLoadedState(draft.lockRemainingSeconds);
    }
  }, [lock]);

  useEffect(() => {
    if (user?.role === 'CLIENT' || didAutoRead.current) return;
    didAutoRead.current = true;
    handleRead();
  }, []);

  useEffect(() => {
    if (!hasRead) {
      clearSessionDraft(JOBS_DRAFT_KEY);
      return;
    }

    writeSessionDraft(JOBS_DRAFT_KEY, {
      job,
      hasRead,
      lockRemainingSeconds: lock.canWrite ? lock.remainingSeconds : 0,
    });
  }, [job, hasRead, lock.canWrite, lock.remainingSeconds]);

  const handleRead = async () => {
    setIsReading(true);
    try {
      const data = await apiFetch<{ job: IJobData }>('/api/jobs/read', {
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
      await apiFetch('/api/jobs/write', {
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

  const disabled = !hasRead;
  const readFirstTooltip = t('tooltip.readFirst');

  return (
    <div className="space-y-6 p-6">
      <PlcStatusBar
        state={lock.state}
        remainingSeconds={lock.remainingSeconds}
        namespace="jobs"
      />

      {!hasRead && isReading && (
        <div className="rounded-lg border border-blue-500/30 bg-blue-500/10 p-6 text-center">
          <Loader2 className="mx-auto mb-3 h-10 w-10 animate-spin text-blue-500" />
          <p className="text-sm text-muted-foreground">
            {t('actions.reading')}
          </p>
        </div>
      )}

      {!hasRead && !isReading ? (
        <p className="rounded-lg border border-dashed px-4 py-3 text-sm text-muted-foreground">
          {readFirstTooltip}
        </p>
      ) : null}

      {/* Card 1: Job Identity */}
      <Card>
        <CardHeader>
          <CardTitle>{t('identity')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="supervisor">{t('fields.supervisor')}</Label>
            <DisabledTooltip disabled={disabled} tooltip={readFirstTooltip}>
              <Input
                id="supervisor"
                value={job.supervisor}
                onChange={e => updateTextField('supervisor', e.target.value)}
                maxLength={20}
                placeholder="---"
                disabled={disabled}
              />
            </DisabledTooltip>
          </div>
          <div className="space-y-2">
            <Label htmlFor="orderNumber">{t('fields.orderNumber')}</Label>
            <DisabledTooltip disabled={disabled} tooltip={readFirstTooltip}>
              <Input
                id="orderNumber"
                value={job.orderNumber}
                onChange={e => updateTextField('orderNumber', e.target.value)}
                maxLength={20}
                placeholder="---"
                disabled={disabled}
              />
            </DisabledTooltip>
          </div>
          <div className="space-y-2">
            <Label htmlFor="serialNumber">{t('fields.serialNumber')}</Label>
            <DisabledTooltip disabled={disabled} tooltip={readFirstTooltip}>
              <Input
                id="serialNumber"
                value={job.serialNumber}
                onChange={e => updateTextField('serialNumber', e.target.value)}
                maxLength={20}
                placeholder="---"
                disabled={disabled}
              />
            </DisabledTooltip>
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
            <DisabledTooltip disabled={disabled} tooltip={readFirstTooltip}>
              <Select
                value={String(job.remoteJobEnable)}
                onValueChange={v =>
                  setJob(prev => ({
                    ...prev,
                    remoteJobEnable: Number(v) as RemoteJobEnable,
                  }))
                }
                disabled={disabled}
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
            </DisabledTooltip>
          </div>

          <div className="space-y-2">
            <Label>{t('fields.maintenanceRequest')}</Label>
            <DisabledTooltip disabled={disabled} tooltip={readFirstTooltip}>
              <Select
                value={String(job.maintenanceRequest)}
                onValueChange={v =>
                  setJob(prev => ({
                    ...prev,
                    maintenanceRequest: Number(v) as MaintenanceRequest,
                  }))
                }
                disabled={disabled}
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
            </DisabledTooltip>
          </div>

          <div className="space-y-2">
            <Label>{t('fields.remoteCycleSelection')}</Label>
            <DisabledTooltip disabled={disabled} tooltip={readFirstTooltip}>
              <Select
                value={String(job.remoteCycleSelection)}
                onValueChange={v =>
                  setJob(prev => ({
                    ...prev,
                    remoteCycleSelection: Number(v) as RemoteCycleSelection,
                  }))
                }
                disabled={disabled}
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
            </DisabledTooltip>
          </div>

          <div className="space-y-2">
            <Label>{t('fields.cycleType')}</Label>
            <DisabledTooltip disabled={disabled} tooltip={readFirstTooltip}>
              <Select
                value={String(job.cycleType)}
                onValueChange={v =>
                  setJob(prev => ({
                    ...prev,
                    cycleType: Number(v) as CycleType,
                  }))
                }
                disabled={disabled}
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
            </DisabledTooltip>
          </div>
        </CardContent>
      </Card>

      {/* Button row */}
      <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">
        <Button
          onClick={handleRead}
          disabled={isReading || isWriting}
          className="w-full sm:w-auto"
        >
          {isReading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {isReading ? t('actions.reading') : t('actions.readFromPlc')}
        </Button>
        <DisabledTooltip disabled={!lock.canWrite && hasRead} tooltip={readFirstTooltip}>
          <Button
            variant={lock.canWrite ? 'default' : 'outline'}
            onClick={handleWriteClick}
            disabled={!lock.canWrite || isReading || isWriting}
            className="w-full sm:w-auto"
          >
            {isWriting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {isWriting ? t('actions.writing') : t('actions.writeToPlc')}
          </Button>
        </DisabledTooltip>
      </div>

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
