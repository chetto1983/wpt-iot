'use client';

import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { isValidTimezone, type IApplicationConfig } from '@wpt/types';
import { getTimeZones } from '@vvo/tzdb';
import Select from 'react-select';
import { toast } from 'sonner';

import { apiFetch } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Label } from '@/components/ui/label';

interface TimezoneOption {
  value: string;
  label: string;
  offset: number;
}

function formatOffset(offsetInMinutes: number) {
  const sign = offsetInMinutes >= 0 ? '+' : '-';
  const absoluteOffset = Math.abs(offsetInMinutes);
  const hours = Math.floor(absoluteOffset / 60).toString().padStart(2, '0');
  const minutes = (absoluteOffset % 60).toString().padStart(2, '0');
  return `${sign}${hours}:${minutes}`;
}

const timezoneOptionsByName = new Map<string, TimezoneOption>();

for (const timezone of getTimeZones({ includeUtc: true })) {
  for (const name of new Set([timezone.name, ...timezone.group])) {
    if (!timezoneOptionsByName.has(name)) {
      timezoneOptionsByName.set(name, {
        value: name,
        label: `(UTC${formatOffset(timezone.currentTimeOffsetInMinutes)}) ${name}`,
        offset: timezone.currentTimeOffsetInMinutes,
      });
    }
  }
}

const IANA_TIMEZONE_OPTIONS = [...timezoneOptionsByName.values()].sort(
  (left, right) => left.offset - right.offset || left.value.localeCompare(right.value),
);

interface ApplicationConfigResponse extends Omit<IApplicationConfig, 'updatedAt'> {
  updatedAt: string;
}

export function ApplicationSettingsForm() {
  const t = useTranslations('applicationSettings');
  const { refreshUser } = useAuth();
  const [timezone, setTimezone] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [menuPortalTarget, setMenuPortalTarget] = useState<HTMLElement>();

  useEffect(() => {
    setMenuPortalTarget(document.body);
  }, []);

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
          <Select<TimezoneOption, false>
            inputId="application-timezone"
            value={IANA_TIMEZONE_OPTIONS.find((option) => option.value === timezone) ?? null}
            onChange={(option) => setTimezone(option?.value ?? '')}
            options={IANA_TIMEZONE_OPTIONS}
            isDisabled={loading || saving}
            isSearchable
            menuPortalTarget={menuPortalTarget}
            menuPosition="fixed"
            menuPlacement="auto"
            menuShouldScrollIntoView={false}
            placeholder={t('timezonePlaceholder')}
            noOptionsMessage={() => t('noTimezones')}
            aria-label={t('timezone')}
            aria-invalid={!loading && timezone.length > 0 && !valid}
            unstyled
            className="w-full"
            styles={{
              menuPortal: (base) => ({ ...base, zIndex: 100 }),
            }}
            classNames={{
              control: ({ isDisabled, isFocused }) => cn(
                'min-h-11 cursor-pointer rounded-lg border border-input bg-transparent text-sm transition-colors',
                isFocused && 'border-ring ring-3 ring-ring/50',
                isDisabled && 'pointer-events-none cursor-not-allowed bg-input/50 opacity-50',
              ),
              valueContainer: () => 'px-3 py-1',
              input: () => 'text-foreground',
              singleValue: () => 'text-foreground',
              placeholder: () => 'text-muted-foreground',
              indicatorsContainer: () => 'text-muted-foreground',
              dropdownIndicator: () => 'px-3',
              indicatorSeparator: () => 'hidden',
              menu: () =>
                'z-50 mt-1 overflow-hidden rounded-lg border border-border bg-popover text-popover-foreground shadow-md',
              menuList: () => 'max-h-72 p-1',
              option: ({ isFocused, isSelected }) => cn(
                'cursor-pointer rounded-md px-2.5 py-2 text-sm',
                isFocused && 'bg-accent text-accent-foreground',
                isSelected && 'bg-primary text-primary-foreground',
              ),
              noOptionsMessage: () => 'p-3 text-sm text-muted-foreground',
            }}
          />
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
