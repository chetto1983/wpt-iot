'use client';

import { useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  LayoutDashboard,
  Users,
  UserCog,
  Briefcase,
  FileText,
  AlertTriangle,
  BarChart3,
  LogOut,
  KeyRound,
} from 'lucide-react';

import { useAuth } from '@/lib/auth-context';
import { cn } from '@/lib/utils';
import { ChangeOwnPasswordDialog } from '@/components/change-own-password-dialog';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@/components/ui/sidebar';

interface NavItem {
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
}

export function AppSidebar() {
  const t = useTranslations('common');
  const tAuth = useTranslations('auth');
  const { user, logout } = useAuth();
  const pathname = usePathname();
  const [changePasswordOpen, setChangePasswordOpen] = useState(false);

  if (!user) return null;

  const navItems: NavItem[] = [
    { label: t('nav.dashboard'), href: '/dashboard', icon: LayoutDashboard },
    { label: t('nav.rfid'), href: '/rfid', icon: Users },
    { label: t('nav.jobs'), href: '/jobs', icon: Briefcase },
  ];

  const reportItems: NavItem[] = [
    { label: t('nav.reports'), href: '/reports', icon: FileText },
    { label: t('nav.alarms'), href: '/alarms', icon: AlertTriangle },
    { label: t('nav.charts'), href: '/charts', icon: BarChart3 },
  ];

  const adminItems: NavItem[] = [
    { label: t('nav.users'), href: '/users', icon: UserCog },
  ];

  const isWptOrAdmin = user.role === 'SUPER_ADMIN' || user.role === 'WPT';
  const isSuperAdmin = user.role === 'SUPER_ADMIN';

  const renderNavItem = (item: NavItem) => {
    const isActive = pathname === item.href;
    return (
      <SidebarMenuItem key={item.href}>
        <SidebarMenuButton
          isActive={isActive}
          tooltip={item.label}
          className={cn(
            'h-10 rounded-lg transition-colors duration-100',
            isActive
              ? 'bg-white/[0.08] text-white font-medium'
              : 'text-white/50 hover:bg-white/[0.05] hover:text-white/80',
          )}
          render={<Link href={item.href} />}
        >
          <item.icon
            className={cn(
              '!size-5 shrink-0',
              isActive ? 'text-[#1ABC9C]' : 'text-white/40',
            )}
          />
          <span className="text-sm">{item.label}</span>
        </SidebarMenuButton>
      </SidebarMenuItem>
    );
  };

  return (
    <Sidebar
      collapsible="icon"
      className="border-r border-white/[0.06]"
      style={{
        // Override shadcn sidebar-accent (gold #bfae82) for nav active state.
        // We want translucent white, not gold, for active backgrounds.
        '--sidebar-accent': 'rgba(255,255,255,0.08)',
        '--sidebar-accent-foreground': '#ffffff',
      } as React.CSSProperties}
    >
      {/* ── Brand ── */}
      <SidebarHeader className="px-4 py-4">
        <Link
          href="/dashboard"
          className="flex h-10 items-center gap-3 group-data-[collapsible=icon]:justify-center"
        >
          <Image
            src="/logo.png"
            alt="WPT"
            width={40}
            height={19}
            className="shrink-0 brightness-0 invert"
          />
          <span className="text-xs font-medium tracking-wider uppercase text-white/40 group-data-[collapsible=icon]:hidden">
            Sistema IoT
          </span>
        </Link>
      </SidebarHeader>

      <SidebarContent className="px-3">
        {/* Main */}
        <SidebarGroup>
          <SidebarGroupLabel className="mb-2 px-2 text-[11px] uppercase tracking-wider text-white/25 group-data-[collapsible=icon]:hidden">
            Menu
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu className="gap-0.5">
              {navItems.map(renderNavItem)}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {/* Reports */}
        {isWptOrAdmin ? (
          <SidebarGroup className="mt-6">
            <SidebarGroupLabel className="mb-2 px-2 text-[11px] uppercase tracking-wider text-white/25 group-data-[collapsible=icon]:hidden">
              {t('nav.reports')}
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu className="gap-0.5">
                {reportItems.map(renderNavItem)}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ) : null}

        {/* Admin */}
        {isSuperAdmin ? (
          <SidebarGroup className="mt-6">
            <SidebarGroupLabel className="mb-2 px-2 text-[11px] uppercase tracking-wider text-white/25 group-data-[collapsible=icon]:hidden">
              Admin
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu className="gap-0.5">
                {adminItems.map(renderNavItem)}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ) : null}
      </SidebarContent>

      {/* ── Footer ── */}
      <SidebarFooter className="px-3 pb-4">
        <SidebarMenu className="gap-0.5">
          <SidebarMenuItem>
            <SidebarMenuButton
              tooltip={tAuth('changePassword.title')}
              className="h-10 text-white/40 hover:bg-white/[0.05] hover:text-white/70"
              onClick={() => setChangePasswordOpen(true)}
            >
              <KeyRound className="!size-5 shrink-0" />
              <span className="text-sm">{tAuth('changePassword.title')}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton
              tooltip={t('signOut')}
              className="h-10 text-white/40 hover:bg-red-500/10 hover:text-red-400"
              onClick={logout}
            >
              <LogOut className="!size-5 shrink-0" />
              <span className="text-sm">{t('signOut')}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>

        {/* User */}
        <div className="mt-2 flex h-11 items-center gap-3 rounded-lg px-2 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#1ABC9C] text-sm font-bold text-white">
            {user.username.charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0 group-data-[collapsible=icon]:hidden">
            <div className="truncate text-sm font-medium text-white/80">
              {user.username}
            </div>
            <div className="text-[11px] text-white/30">
              {user.role === 'SUPER_ADMIN' ? 'Admin' : user.role}
            </div>
          </div>
        </div>

        <ChangeOwnPasswordDialog
          open={changePasswordOpen}
          onOpenChange={setChangePasswordOpen}
        />
      </SidebarFooter>
    </Sidebar>
  );
}
