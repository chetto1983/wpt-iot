'use client';

import { useState, useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useWsData } from '@/lib/ws-context';
import { useAuth } from '@/lib/auth-context';
import { Wifi, WifiOff } from 'lucide-react';
import { SidebarTrigger } from '@/components/ui/sidebar';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import { ModeToggle } from '@/components/shared/mode-toggle';
import { LanguageSelector } from '@/components/shared/language-selector';
import { cn } from '@/lib/utils';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || '';

function getPageTitleKey(path: string): string {
  if (path.startsWith('/settings/energy')) return 'nav.energySettings';
  if (path.startsWith('/dashboards/')) return 'nav.dashboards';
  if (path === '/dashboards') return 'nav.dashboards';
  if (path === '/dashboard') return 'nav.dashboard';
  if (path === '/users') return 'nav.users';
  if (path === '/rfid') return 'nav.rfid';
  if (path === '/jobs') return 'nav.jobs';
  if (path === '/reports') return 'nav.reports';
  if (path === '/energy') return 'nav.energy';
  if (path === '/cycles') return 'nav.cycles';
  if (path === '/anomaly') return 'nav.anomaly';
  if (path === '/alarms') return 'nav.alarms';
  if (path === '/charts') return 'nav.charts';
  if (path === '/mqtt') return 'nav.mqtt';
  if (path === '/plc') return 'nav.plc';
  return 'nav.dashboard';
}

function useClock() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

export function AppHeader() {
  const pathname = usePathname();
  const t = useTranslations('common');
  const tDash = useTranslations('dashboard');
  const { connected, lastUpdate } = useWsData();
  const { user } = useAuth();
  const now = useClock();

  const timeStr = now.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const dateStr = now.toLocaleDateString([], {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
  const pageTitle = t(getPageTitleKey(pathname));

  useEffect(() => {
    document.title = `${pageTitle} | WPT IoT`;
  }, [pageTitle]);

  return (
    <header className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2 sm:h-14 sm:flex-nowrap sm:gap-4 sm:py-0">
      {/* Left: sidebar trigger + page title */}
      <div className="flex min-w-0 items-center gap-2 sm:gap-3">
        <SidebarTrigger className="size-11 sm:size-7" />
        <h1 className="text-sm font-semibold">{pageTitle}</h1>
      </div>

      {/* Spacer */}
      <div className="hidden flex-1 sm:block" />

      {/* Right: connection status, language, theme, user */}
      <div className="flex w-full items-center justify-between gap-2 sm:w-auto sm:justify-start sm:gap-3">
        {/* Connection badge + last update timer */}
        <div className="flex min-w-0 items-center gap-2">
          <Badge
            className={cn(
              'text-xs px-2 py-0.5 rounded-full font-medium flex items-center gap-1',
              connected
                ? 'border-transparent bg-wpt-teal/15 text-wpt-teal-accessible'
                : 'border-transparent bg-wpt-gold/15 text-wpt-gold-accessible',
            )}
          >
            {connected ? <Wifi className="size-3" /> : <WifiOff className="size-3" />}
            {connected ? t('header.online') : t('header.offline')}
          </Badge>
          {!connected && lastUpdate && (() => {
            const ageSeconds = Math.round((now.getTime() - lastUpdate.getTime()) / 1000);
            const isStale = ageSeconds > 30;
            return (
              <span className={cn('hidden text-xs tabular-nums md:inline', isStale ? 'text-wpt-gold' : 'text-muted-foreground')}>
                {tDash('staleData', { seconds: ageSeconds })}
              </span>
            );
          })()}
          <span className="text-xs text-muted-foreground tabular-nums">
            {timeStr}
          </span>
          <span className="hidden text-xs text-muted-foreground sm:inline">
            {dateStr}
          </span>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <LanguageSelector />
          <ModeToggle />

          {/* User avatar */}
          {user && (
            <Avatar className="size-8">
              <AvatarImage
                src={user.avatar ? `${API_BASE}${user.avatar}` : '/logo.png'}
                alt={user.username}
              />
              <AvatarFallback className="bg-wpt-teal text-xs font-bold text-primary-foreground">
                {user.username.charAt(0).toUpperCase()}
              </AvatarFallback>
            </Avatar>
          )}
        </div>
      </div>
    </header>
  );
}
