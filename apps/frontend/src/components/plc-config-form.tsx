'use client';

import { useCallback, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { apiFetch } from '@/lib/api';
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

export function PlcConfigForm({ config, onSaved }: PlcConfigFormProps) {
  const t = useTranslations('plc');
  const tCommon = useTranslations('common');

  const [targetHost, setTargetHost] = useState(config.targetHost);
  const [saving, setSaving] = useState(false);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      await apiFetch('/api/plc/config', {
        method: 'PUT',
        body: JSON.stringify({ targetHost }),
      });
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
