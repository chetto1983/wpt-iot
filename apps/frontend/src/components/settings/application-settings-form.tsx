'use client';

import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { isValidTimezone, type IApplicationConfig } from '@wpt/types';
import { toast } from 'sonner';

import { apiFetch } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const TIMEZONE_SUGGESTIONS = [
  'UTC',
  'Europe/Rome',
  'Europe/Berlin',
  'Europe/London',
  'America/New_York',
  'America/Los_Angeles',
  'Asia/Dubai',
  'Asia/Tokyo',
] as const;

interface ApplicationConfigResponse extends Omit<IApplicationConfig, 'updatedAt'> {
  updatedAt: string;
}

export function ApplicationSettingsForm() {
  const t = useTranslations('applicationSettings');
  const { refreshUser } = useAuth();
  const [timezone, setTimezone] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    apiFetch<ApplicationConfigResponse>('/api/application/config')
      .then((config) => {
        if (!cancelled) setTimezone(config.timezone);
      })
      .catch(() => {
        if (!cancelled) {
          toast.error(t('loadError'));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [t]);

  const normalizedTimezone = timezone.trim();
  const valid = isValidTimezone(normalizedTimezone);

  async function handleSave() {
    if (!valid) return;
    setSaving(true);
    try {
      const config = await apiFetch<ApplicationConfigResponse>(
        '/api/application/config',
        {
          method: 'PUT',
          body: JSON.stringify({ timezone: normalizedTimezone }),
        },
      );
      setTimezone(config.timezone);
      await refreshUser();
      toast.success(t('saved'));
    } catch {
      toast.error(t('saveError'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
        <CardDescription>{t('description')}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="grid gap-2">
          <Label htmlFor="application-timezone">{t('timezone')}</Label>
          <Input
            id="application-timezone"
            list="application-timezones"
            value={timezone}
            onChange={(event) => setTimezone(event.target.value)}
            disabled={loading || saving}
            placeholder="Europe/Rome"
            aria-invalid={!loading && timezone.length > 0 && !valid}
          />
          <datalist id="application-timezones">
            {TIMEZONE_SUGGESTIONS.map((value) => (
              <option key={value} value={value} />
            ))}
          </datalist>
          <p className="text-xs text-muted-foreground">{t('timezoneHelp')}</p>
          {!loading && timezone.length > 0 && !valid ? (
            <p className="text-xs text-destructive">{t('invalidTimezone')}</p>
          ) : null}
        </div>

        <Button
          type="button"
          onClick={() => void handleSave()}
          disabled={loading || saving || !valid}
        >
          {saving ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
          {t('save')}
        </Button>
      </CardContent>
    </Card>
  );
}
