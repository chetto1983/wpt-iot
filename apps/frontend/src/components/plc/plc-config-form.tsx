'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { apiFetch } from '@/lib/api';
import { clearSessionDraft, readSessionDraft, writeSessionDraft } from '@/lib/session-draft';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

export interface PlcConfig {
  id: number;
  targetHost: string | null;
  updatedAt: string;
}

interface PlcConfigFormProps {
  config: PlcConfig;
  onSaved: () => void;
}

const PLC_CONFIG_DRAFT_KEY = 'plc-config-form';

export function PlcConfigForm({ config, onSaved }: PlcConfigFormProps) {
  const t = useTranslations('plc');
  const tCommon = useTranslations('common');

  const [targetHost, setTargetHost] = useState(config.targetHost ?? '');
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [lastTestResult, setLastTestResult] = useState<{
    ok: boolean;
    time: string;
    durationMs?: number;
    error?: string;
  } | null>(null);
  const restoredDraftRef = useRef(false);

  useEffect(() => {
    const draft = readSessionDraft<{ targetHost: string }>(PLC_CONFIG_DRAFT_KEY);
    if (!draft?.targetHost) return;

    restoredDraftRef.current = true;
    setTargetHost(draft.targetHost);
  }, []);

  useEffect(() => {
    if (!restoredDraftRef.current) {
      setTargetHost(config.targetHost ?? '');
    }
  }, [config.targetHost]);

  useEffect(() => {
    if (targetHost.trim() === (config.targetHost?.trim() ?? '')) {
      clearSessionDraft(PLC_CONFIG_DRAFT_KEY);
      return;
    }

    writeSessionDraft(PLC_CONFIG_DRAFT_KEY, { targetHost });
  }, [config.targetHost, targetHost]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      await apiFetch('/api/plc/config', {
        method: 'PUT',
        body: JSON.stringify({ targetHost }),
      });
      restoredDraftRef.current = false;
      clearSessionDraft(PLC_CONFIG_DRAFT_KEY);
      toast.success(t('saved'));
      onSaved();
    } catch (err) {
      const msg = err instanceof Error ? err.message : tCommon('error');
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  }, [targetHost, onSaved, t, tCommon]);

  const handleTestConnection = useCallback(async () => {
    setTesting(true);
    try {
      const result = await apiFetch<{ ok: boolean; durationMs: number; error?: string }>(
        '/api/plc/test-connection',
        { method: 'POST' },
      );
      const time = new Date().toLocaleTimeString();
      if (result.ok) {
        toast.success(t('testSuccess', { durationMs: result.durationMs }));
        setLastTestResult({ ok: true, time, durationMs: result.durationMs });
      } else {
        const errorMsg = result.error ?? '';
        const displayMsg = errorMsg.includes('Handshake in progress')
          ? t('testBusy')
          : t('testFailed', { error: errorMsg });
        toast.error(displayMsg);
        setLastTestResult({ ok: false, time, error: errorMsg });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : tCommon('error');
      toast.error(msg);
      setLastTestResult({ ok: false, time: new Date().toLocaleTimeString(), error: msg });
    } finally {
      setTesting(false);
    }
  }, [t, tCommon]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-6">
        {config.targetHost === null && (
          <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-700 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-300">
            {t('notConfigured')}
          </p>
        )}

        <div className="grid gap-2">
          <Label htmlFor="plc-target-host">{t('targetHost')}</Label>
          <Input
            id="plc-target-host"
            value={targetHost}
            onChange={(e) => setTargetHost(e.target.value)}
            placeholder="192.168.101.145"
          />
          <p className="text-xs text-muted-foreground">{t('targetHostHelp')}</p>
        </div>

        <div className="flex items-center justify-between gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleTestConnection}
            disabled={saving || testing}
            title={t('testTooltip')}
          >
            {testing ? <Loader2 className="mr-1 size-4 animate-spin" /> : null}
            {t('testConnection')}
          </Button>
          {lastTestResult && (
            <span className={`text-xs ${lastTestResult.ok ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
              {lastTestResult.ok
                ? t('testLastOk', { time: lastTestResult.time })
                : t('testLastFail', { time: lastTestResult.time, error: lastTestResult.error ?? '' })}
            </span>
          )}
        </div>

        <Button onClick={handleSave} disabled={saving || testing || !targetHost} className="w-full">
          {saving ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
          {t('save')}
        </Button>
      </CardContent>
    </Card>
  );
}
