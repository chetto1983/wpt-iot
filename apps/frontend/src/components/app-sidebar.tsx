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
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import { AvatarUploadDialog } from '@/components/avatar-upload-dialog';
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

const API_BASE = process.env.NEXT_PUBLIC_API_URL || '';

export function AppSidebar() {
  const t = useTranslations('common');
  const tAuth = useTranslations('auth');
  const { user, logout, refreshUser } = useAuth();
  const pathname = usePathname();
  const [changePasswordOpen, setChangePasswordOpen] = useState(false);
  const [avatarDialogOpen, setAvatarDialogOpen] = useState(false);

  if (!user) return null;

  const navItems: NavItem[] = [
    { label: t('nav.dashboard'), href: '/dashboard', icon: LayoutDashboard },
    { label: t('nav.rfid'), href: '/rfid', icon: Users },
    { label: t('nav.jobs'), href: '/jobs', icon: Briefcase },
  ];

  // Reports link visible to ALL authenticated roles
  const allRoleReportItems: NavItem[] = [
    { label: t('nav.reports'), href: '/reports', icon: FileText },
  ];

  // Alarms + Charts visible to WPT/SUPER_ADMIN only
  const wptOnlyReportItems: NavItem[] = [
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
              ? 'bg-muted text-foreground font-medium'
              : 'text-muted-foreground hover:bg-muted hover:text-foreground/80',
          )}
          render={<Link href={item.href} />}
        >
          <item.icon
            className={cn(
              '!size-5 shrink-0',
              isActive ? 'text-wpt-teal' : 'text-muted-foreground',
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
      className="border-r border-border"
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
            className="shrink-0 dark:brightness-0 dark:invert"
          />
          <span className="text-xs font-medium tracking-wider uppercase text-muted-foreground group-data-[collapsible=icon]:hidden">
            {t('brandSubtitle')}
          </span>
        </Link>
      </SidebarHeader>

      <SidebarContent className="px-3">
        {/* Main */}
        <SidebarGroup>
          <SidebarGroupLabel className="mb-2 px-2 text-[11px] uppercase tracking-wider text-muted-foreground/60 group-data-[collapsible=icon]:hidden">
            Menu
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu className="gap-0.5">
              {navItems.map(renderNavItem)}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {/* Reports - always visible */}
        <SidebarGroup className="mt-6">
          <SidebarGroupLabel className="mb-2 px-2 text-[11px] uppercase tracking-wider text-muted-foreground/60 group-data-[collapsible=icon]:hidden">
            {t('nav.reports')}
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu className="gap-0.5">
              {allRoleReportItems.map(renderNavItem)}
              {isWptOrAdmin ? wptOnlyReportItems.map(renderNavItem) : null}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {/* Admin */}
        {isSuperAdmin ? (
          <SidebarGroup className="mt-6">
            <SidebarGroupLabel className="mb-2 px-2 text-[11px] uppercase tracking-wider text-muted-foreground/60 group-data-[collapsible=icon]:hidden">
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
              className="h-10 text-muted-foreground hover:bg-muted hover:text-foreground/70"
              onClick={() => setChangePasswordOpen(true)}
            >
              <KeyRound className="!size-5 shrink-0" />
              <span className="text-sm">{tAuth('changePassword.title')}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton
              tooltip={t('signOut')}
              className="h-10 text-muted-foreground hover:bg-red-500/10 hover:text-red-400"
              onClick={logout}
            >
              <LogOut className="!size-5 shrink-0" />
              <span className="text-sm">{t('signOut')}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>

        {/* User */}
        <div className="mt-2 flex h-11 items-center gap-3 rounded-lg px-2 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0">
          <button
            type="button"
            className="group/avatar-btn relative shrink-0"
            onClick={() => setAvatarDialogOpen(true)}
            title={t('avatar.changeAvatar')}
          >
            <Avatar className="size-9">
              <AvatarImage
                src={user.avatar ? `${API_BASE}${user.avatar}` : '/logo.png'}
                alt={user.username}
              />
              <AvatarFallback className="bg-wpt-teal text-sm font-bold text-primary-foreground">
                {user.username.charAt(0).toUpperCase()}
              </AvatarFallback>
            </Avatar>
          </button>
          <div className="min-w-0 group-data-[collapsible=icon]:hidden">
            <div className="truncate text-sm font-medium text-foreground/80">
              {user.username}
            </div>
            <div className="text-[11px] text-muted-foreground/60">
              {user.role === 'SUPER_ADMIN' ? 'Admin' : user.role}
            </div>
          </div>
        </div>

        <ChangeOwnPasswordDialog
          open={changePasswordOpen}
          onOpenChange={setChangePasswordOpen}
        />
        <AvatarUploadDialog
          open={avatarDialogOpen}
          onOpenChange={setAvatarDialogOpen}
          userId={user.id}
          currentAvatar={user.avatar}
          onSuccess={refreshUser}
        />
      </SidebarFooter>
    </Sidebar>
  );
}
