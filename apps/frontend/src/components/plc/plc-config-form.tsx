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
  targetHost: string;
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

  const [targetHost, setTargetHost] = useState(config.targetHost);
  const [saving, setSaving] = useState(false);
  const restoredDraftRef = useRef(false);

  useEffect(() => {
    const draft = readSessionDraft<{ targetHost: string }>(PLC_CONFIG_DRAFT_KEY);
    if (!draft?.targetHost) return;

    restoredDraftRef.current = true;
    setTargetHost(draft.targetHost);
  }, []);

  useEffect(() => {
    if (!restoredDraftRef.current) {
      setTargetHost(config.targetHost);
    }
  }, [config.targetHost]);

  useEffect(() => {
    if (targetHost.trim() === config.targetHost.trim()) {
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

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-6">
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

        <Button onClick={handleSave} disabled={saving || !targetHost} className="w-full">
          {saving ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
          {t('save')}
        </Button>
      </CardContent>
    </Card>
  );
}
