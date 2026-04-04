'use client';

import { useState, useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useWsData } from '@/lib/ws-context';
import { useAuth } from '@/lib/auth-context';
import { SidebarTrigger } from '@/components/ui/sidebar';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import { ModeToggle } from '@/components/mode-toggle';
import { LanguageSelector } from '@/components/language-selector';
import { cn } from '@/lib/utils';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || '';

function getPageTitleKey(path: string): string {
  if (path === '/dashboard') return 'nav.dashboard';
  if (path === '/users') return 'nav.users';
  if (path === '/rfid') return 'nav.rfid';
  if (path === '/jobs') return 'nav.jobs';
  if (path === '/reports') return 'nav.reports';
  if (path === '/alarms') return 'nav.alarms';
  if (path === '/charts') return 'nav.charts';
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
  const { connected } = useWsData();
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

  return (
    <header className="flex h-14 items-center gap-4 border-b border-border px-4">
      {/* Left: sidebar trigger + page title */}
      <div className="flex items-center gap-3">
        <SidebarTrigger />
        <h1 className="text-sm font-semibold">{t(getPageTitleKey(pathname))}</h1>
      </div>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Right: connection status, language, theme, user */}
      <div className="flex items-center gap-3">
        {/* Connection badge + last update timer */}
        <div className="flex items-center gap-2">
          <Badge
            className={cn(
              'text-xs px-2 py-0.5 rounded-full font-medium',
              connected
                ? 'border-transparent bg-wpt-teal/15 text-wpt-teal'
                : 'border-transparent bg-wpt-gold/15 text-wpt-gold',
            )}
          >
            {connected ? t('header.online') : t('header.offline')}
          </Badge>
          <span className="text-xs text-muted-foreground tabular-nums">
            {timeStr}
          </span>
          <span className="text-xs text-muted-foreground">
            {dateStr}
          </span>
        </div>

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
    </header>
  );
}
