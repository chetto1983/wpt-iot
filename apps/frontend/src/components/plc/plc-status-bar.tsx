'use client';

import { useTranslations } from 'next-intl';
import { CircleSlash, CircleCheck, CircleAlert } from 'lucide-react';
import { cn } from '@/lib/utils';

interface PlcStatusBarProps {
  state: 'idle' | 'loaded' | 'expired';
  remainingSeconds: number;
  namespace: string; // 'rfid' or 'jobs'
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * Visual status bar for PLC read/write lock state.
 * Three states: idle (no data), loaded (countdown), expired (must re-read).
 */
export function PlcStatusBar({ state, remainingSeconds, namespace }: PlcStatusBarProps) {
  const t = useTranslations(namespace);

  if (state === 'idle') {
    return (
      <div
        className={cn(
          'flex w-full items-center gap-3 rounded-lg border-l-[3px] py-2 px-4',
          'border-muted-foreground bg-muted',
        )}
      >
        <CircleSlash className="size-5 shrink-0 text-muted-foreground" />
        <span className="text-sm text-muted-foreground">{t('status.noData')}</span>
      </div>
    );
  }

  if (state === 'loaded') {
    const formatted = formatTime(remainingSeconds);
    return (
      <div
        className={cn(
          'flex w-full items-center gap-3 rounded-lg border-l-[3px] py-2 px-4',
          'border-primary bg-primary/10',
        )}
      >
        <CircleCheck className="size-5 shrink-0 text-primary" />
        <span className="text-sm text-primary">
          {t('status.loaded', { remaining: formatted })}
        </span>
        <span className="ml-auto font-mono text-sm font-medium text-primary">
          {formatted}
        </span>
      </div>
    );
  }

  // expired
  return (
    <div
      className={cn(
        'flex w-full items-center gap-3 rounded-lg border-l-[3px] py-2 px-4',
        'border-[oklch(0.756_0.068_88.5)] bg-[oklch(0.756_0.068_88.5)]/10',
      )}
    >
      <CircleAlert className="size-5 shrink-0 text-[oklch(0.756_0.068_88.5)]" />
      <span className="text-sm text-[oklch(0.756_0.068_88.5)]">{t('status.expired')}</span>
    </div>
  );
}
