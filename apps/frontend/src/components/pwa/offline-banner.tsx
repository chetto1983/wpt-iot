'use client';

import { WifiOff } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import { useConnectionStatus } from '@/hooks/useConnectionStatus';

/**
 * Full-width stale-data warning banner.
 *
 * Renders when any offline signal is active:
 * - WebSocket to backend disconnected
 * - browser reports navigator.onLine === false
 * - SW served a cached API response (cache fallback postMessage from sw.ts)
 *
 * Layout analog: plc-status-bar.tsx — left-border status strip with icon + text.
 * Placement: mounted in (app)/layout.tsx between <AppHeader> and {children}.
 * NOT rendered on /offline page (which has its own full-page layout).
 */
export function OfflineBanner() {
  const { isOffline } = useConnectionStatus();
  const t = useTranslations('pwa');

  if (!isOffline) return null;

  return (
    <div
      role="alert"
      aria-live="polite"
      className={cn(
        'flex w-full items-center gap-3 border-l-[3px] py-2 px-4',
        'border-[#dc3545] bg-[#dc3545]/10',
      )}
    >
      <WifiOff className="size-5 shrink-0 text-[#dc3545]" aria-hidden="true" />
      <span className="text-sm font-medium text-[#dc3545]">
        {t('staleBanner.title')}
      </span>
      <span className="text-sm text-muted-foreground">
        {t('staleBanner.body')}
      </span>
    </div>
  );
}
