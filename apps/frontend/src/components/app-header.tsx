'use client';

import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useWsData } from '@/lib/ws-context';
import { useAuth } from '@/lib/auth-context';
import { SidebarTrigger } from '@/components/ui/sidebar';
import { Badge } from '@/components/ui/badge';
import { ModeToggle } from '@/components/mode-toggle';
import { LanguageSelector } from '@/components/language-selector';
import { cn } from '@/lib/utils';

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

function formatLastUpdate(date: Date | null): string {
  if (!date) return '\u2014';
  return date.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export function AppHeader() {
  const pathname = usePathname();
  const t = useTranslations('common');
  const { connected, lastUpdate } = useWsData();
  const { user } = useAuth();

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
          <span className="text-xs text-muted-foreground">
            {formatLastUpdate(lastUpdate)}
          </span>
        </div>

        <LanguageSelector />
        <ModeToggle />

        {/* User avatar */}
        {user && (
          <div className="flex size-8 items-center justify-center rounded-full bg-wpt-teal text-xs font-bold text-primary-foreground">
            {user.username.charAt(0).toUpperCase()}
          </div>
        )}
      </div>
    </header>
  );
}
