'use client';

import { useMemo } from 'react';
import { format, type Locale } from 'date-fns';
import { it as itLocale } from 'date-fns/locale';
import { useAuth } from '@/lib/auth-context';

// ---------------------------------------------------------------------------
// Browser timezone detection (cached once per session)
// ---------------------------------------------------------------------------

let _cachedTz: string | undefined;

function getBrowserTimezone(): string {
  if (!_cachedTz) {
    try {
      _cachedTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch {
      _cachedTz = 'Europe/Rome'; // safe default for WPT deployments
    }
  }
  return _cachedTz;
}

// ---------------------------------------------------------------------------
// Locale value type
// ---------------------------------------------------------------------------

interface AppLocale {
  /** 'it' or 'en' — from user DB setting, default 'it' */
  language: 'it' | 'en';
  /** IANA timezone string from browser, e.g. 'Europe/Rome' */
  timezone: string;
  /** BCP 47 locale tag for Intl APIs: 'it-IT' or 'en-GB' */
  bcp47: string;
  /** date-fns Locale object (Italian or undefined for English default) */
  dateFnsLocale: Locale | undefined;

  // ── Formatters ──────────────────────────────────────────────────────────
  /** Date for URL params: '2026-04-13' (local timezone, never UTC) */
  formatDateParam: (d: Date) => string;
  /** Display date: '13/04/2026' (it) or '13/04/2026' (en) */
  formatDate: (d: Date) => string;
  /** Display date+time: '13/04/2026 14:30:05' */
  formatDateTime: (d: Date) => string;
  /** Display time only: '14:30' */
  formatTime: (d: Date) => string;
  /** Display time with seconds: '14:30:05' */
  formatTimeFull: (d: Date) => string;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useAppLocale(): AppLocale {
  const { user } = useAuth();
  const language = (user?.language ?? 'it') as 'it' | 'en';

  return useMemo<AppLocale>(() => {
    const timezone = getBrowserTimezone();
    const dateFnsLocale = language === 'it' ? itLocale : undefined;
    const bcp47 = language === 'it' ? 'it-IT' : 'en-GB';

    // Reusable Intl formatters (cached by browser per locale+options)
    const dateFormatter = new Intl.DateTimeFormat(bcp47, {
      timeZone: timezone,
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });

    const dateTimeFormatter = new Intl.DateTimeFormat(bcp47, {
      timeZone: timezone,
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });

    const timeFormatter = new Intl.DateTimeFormat(bcp47, {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });

    const timeFullFormatter = new Intl.DateTimeFormat(bcp47, {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });

    return {
      language,
      timezone,
      bcp47,
      dateFnsLocale,
      formatDateParam: (d: Date) => format(d, 'yyyy-MM-dd'),
      formatDate: (d: Date) => dateFormatter.format(d),
      formatDateTime: (d: Date) => dateTimeFormatter.format(d),
      formatTime: (d: Date) => timeFormatter.format(d),
      formatTimeFull: (d: Date) => timeFullFormatter.format(d),
    };
  }, [language]);
}
