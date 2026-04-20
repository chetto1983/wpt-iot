'use client';

import { useTranslations } from 'next-intl';
import { CircleSlash, CircleCheck, CircleAlert, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface PlcStatusBarProps {
  state: 'idle' | 'loaded' | 'expired';
  remainingSeconds: number;
  namespace: string; // 'rfid' or 'jobs'
  loading?: boolean;
}

type LoadedTier = 'normal' | 'warning' | 'critical';

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function getTier(remainingSeconds: number): LoadedTier {
  if (remainingSeconds <= 10) return 'critical';
  if (remainingSeconds <= 60) return 'warning';
  return 'normal';
}

/**
 * Visual status bar for PLC read/write lock state.
 * Three states: idle (no data), loaded (countdown), expired (must re-read).
 *
 * a11y: outer div is role="status" + aria-live="polite" so screen readers
 * announce state-label transitions (idle → loaded → expired) but NOT the
 * per-second countdown pill, which carries aria-hidden.
 */
export function PlcStatusBar({
  state,
  remainingSeconds,
  namespace,
  loading = false,
}: PlcStatusBarProps) {
  const t = useTranslations(namespace);

  if (state === 'idle') {
    return (
      <div
        role="status"
        aria-live="polite"
        className={cn(
          'flex w-full items-center gap-3 rounded-lg border-l-[3px] py-2 px-4',
          'border-muted-foreground bg-muted',
        )}
      >
        {loading ? (
          <Loader2 className="size-5 shrink-0 animate-spin text-muted-foreground" />
        ) : (
          <CircleSlash className="size-5 shrink-0 text-muted-foreground" />
        )}
        <span className="text-sm text-muted-foreground">{t('status.noData')}</span>
      </div>
    );
  }

  if (state === 'loaded') {
    const tier = getTier(remainingSeconds);
    const formatted = formatTime(remainingSeconds);
    const isCritical = tier === 'critical';

    return (
      <div
        role="status"
        aria-live="polite"
        className={cn(
          'flex w-full items-center gap-3 rounded-lg border-l-[3px] py-2 px-4',
          tier === 'normal' && 'border-primary bg-background',
          tier === 'warning' && 'border-wpt-gold bg-wpt-gold/10',
          tier === 'critical' && 'border-destructive bg-destructive/10',
        )}
      >
        {isCritical ? (
          <CircleAlert className="size-5 shrink-0 text-destructive" />
        ) : (
          <CircleCheck
            className={cn(
              'size-5 shrink-0',
              tier === 'normal' && 'text-primary dark:text-wpt-teal-accessible',
              tier === 'warning' && 'text-wpt-gold-accessible',
            )}
          />
        )}
        <span
          className={cn(
            'text-sm',
            tier === 'normal' && 'text-primary dark:text-wpt-teal-accessible',
            tier === 'warning' && 'text-wpt-gold-accessible',
            tier === 'critical' && 'text-destructive',
          )}
        >
          {t('status.loaded')}
        </span>
        <span
          aria-hidden="true"
          className={cn(
            'ml-auto font-mono text-sm font-medium',
            tier === 'normal' && 'text-primary dark:text-wpt-teal-accessible',
            tier === 'warning' && 'text-wpt-gold-accessible',
            tier === 'critical' && 'text-destructive',
          )}
        >
          {formatted}
        </span>
      </div>
    );
  }

  // expired
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        'flex w-full items-center gap-3 rounded-lg border-l-[3px] py-2 px-4',
        'border-wpt-gold bg-wpt-gold/10',
      )}
    >
      <CircleAlert className="size-5 shrink-0 text-wpt-gold-accessible" />
      <span className="text-sm text-wpt-gold-accessible">{t('status.expired')}</span>
    </div>
  );
}
