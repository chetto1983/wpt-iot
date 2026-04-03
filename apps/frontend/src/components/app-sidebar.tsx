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
            'h-9 transition-colors duration-100',
            isActive
              ? 'bg-white/[0.08] text-white font-medium'
              : 'text-white/50 hover:bg-white/[0.05] hover:text-white/80',
          )}
          render={<Link href={item.href} />}
        >
          <item.icon
            className={cn(
              'size-[18px] shrink-0',
              isActive ? 'text-[#1ABC9C]' : 'text-white/40',
            )}
          />
          <span>{item.label}</span>
        </SidebarMenuButton>
      </SidebarMenuItem>
    );
  };

  return (
    <Sidebar collapsible="icon" className="border-r-0">
      {/* ── Brand ── */}
      <SidebarHeader className="p-3">
        <Link
          href="/dashboard"
          className="flex h-9 items-center gap-2.5 rounded-md px-2 hover:bg-white/[0.04] transition-colors group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0"
        >
          <Image
            src="/logo.png"
            alt="WPT"
            width={32}
            height={15}
            className="shrink-0"
          />
          <span className="text-xs font-medium tracking-wider uppercase text-white/40 group-data-[collapsible=icon]:hidden">
            Sistema IoT
          </span>
        </Link>
      </SidebarHeader>

      <SidebarContent className="px-2">
        {/* Main */}
        <SidebarGroup>
          <SidebarGroupLabel className="text-[10px] uppercase tracking-wider text-white/25 px-2 mb-1">
            Menu
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu className="gap-px">
              {navItems.map(renderNavItem)}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {/* Reports */}
        {isWptOrAdmin ? (
          <SidebarGroup>
            <SidebarGroupLabel className="text-[10px] uppercase tracking-wider text-white/25 px-2 mb-1">
              {t('nav.reports')}
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu className="gap-px">
                {reportItems.map(renderNavItem)}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ) : null}

        {/* Admin */}
        {isSuperAdmin ? (
          <SidebarGroup>
            <SidebarGroupLabel className="text-[10px] uppercase tracking-wider text-white/25 px-2 mb-1">
              Admin
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu className="gap-px">
                {adminItems.map(renderNavItem)}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ) : null}
      </SidebarContent>

      {/* ── Footer ── */}
      <SidebarFooter className="p-2">
        <SidebarMenu className="gap-px">
          {/* Change password */}
          <SidebarMenuItem>
            <SidebarMenuButton
              tooltip={tAuth('changePassword.title')}
              className="h-9 text-white/40 hover:bg-white/[0.05] hover:text-white/70"
              onClick={() => setChangePasswordOpen(true)}
            >
              <KeyRound className="size-[18px] shrink-0" />
              <span>{tAuth('changePassword.title')}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>

          {/* Logout */}
          <SidebarMenuItem>
            <SidebarMenuButton
              tooltip={t('signOut')}
              className="h-9 text-white/40 hover:bg-red-500/10 hover:text-red-400"
              onClick={logout}
            >
              <LogOut className="size-[18px] shrink-0" />
              <span>{t('signOut')}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>

        {/* User — always at the very bottom */}
        <div className="mt-1 flex h-10 items-center gap-2.5 rounded-md px-2 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#1ABC9C] text-xs font-bold text-white">
            {user.username.charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0 group-data-[collapsible=icon]:hidden">
            <div className="truncate text-xs font-medium text-white/70">
              {user.username}
            </div>
            <div className="text-[10px] text-white/30">
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
