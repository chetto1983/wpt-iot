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

  const renderNavItems = (items: NavItem[]) =>
    items.map((item) => {
      const isActive = pathname === item.href;
      return (
        <SidebarMenuItem key={item.href}>
          <SidebarMenuButton
            isActive={isActive}
            tooltip={item.label}
            className={cn(
              'h-10 rounded-lg transition-all duration-150',
              'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/30',
              isActive
                ? 'bg-white/[0.08] text-white font-medium shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]'
                : 'text-white/60 hover:bg-white/[0.04] hover:text-white/90',
            )}
            render={<Link href={item.href} />}
          >
            <item.icon className={cn('size-[18px]', isActive && 'text-[#1ABC9C]')} />
            <span>{item.label}</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
      );
    });

  return (
    <Sidebar collapsible="icon">
      {/* ── Brand ── */}
      <SidebarHeader className="px-4 py-5">
        <Link
          href="/dashboard"
          className="flex items-center gap-3 group-data-[collapsible=icon]:justify-center"
        >
          <Image
            src="/logo.png"
            alt="WPT"
            width={36}
            height={17}
            className="shrink-0"
          />
          <span className="text-[13px] font-semibold tracking-widest uppercase text-white/50 group-data-[collapsible=icon]:hidden">
            Sistema IoT
          </span>
        </Link>
      </SidebarHeader>

      {/* Thin rule — white/8% per gallery best practice */}
      <div className="mx-3 h-px bg-white/[0.08]" />

      <SidebarContent className="px-2 pt-3 pb-2">
        {/* Main nav */}
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu className="gap-1">
              {renderNavItems(navItems)}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {/* Reports — WPT + SuperAdmin */}
        {isWptOrAdmin ? (
          <>
            <div className="mx-3 my-3 h-px bg-white/[0.06]" />
            <SidebarGroup>
              <SidebarGroupContent>
                <SidebarMenu className="gap-1">
                  {renderNavItems(reportItems)}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          </>
        ) : null}

        {/* Admin — SuperAdmin only */}
        {isSuperAdmin ? (
          <>
            <div className="mx-3 my-3 h-px bg-white/[0.06]" />
            <SidebarGroup>
              <SidebarGroupContent>
                <SidebarMenu className="gap-1">
                  {renderNavItems(adminItems)}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          </>
        ) : null}
      </SidebarContent>

      {/* ── Footer ── */}
      <div className="mx-3 h-px bg-white/[0.08]" />

      <SidebarFooter className="px-3 py-3">
        {/* User card */}
        <div className="flex items-center gap-3 rounded-lg bg-white/[0.04] px-3 py-2.5">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#1ABC9C] text-xs font-bold text-white">
            {user.username.charAt(0).toUpperCase()}
          </div>
          <div className="flex min-w-0 flex-col group-data-[collapsible=icon]:hidden">
            <span className="truncate text-sm font-medium text-white">
              {user.username}
            </span>
            <span className="text-[11px] text-white/40">
              {user.role === 'SUPER_ADMIN' ? 'Admin' : user.role}
            </span>
          </div>
        </div>

        {/* Actions */}
        <div className="mt-1.5 flex flex-col gap-0.5">
          <button
            type="button"
            onClick={() => setChangePasswordOpen(true)}
            className="flex h-9 items-center gap-2.5 rounded-lg px-3 text-[13px] text-white/50 transition-colors hover:bg-white/[0.04] hover:text-white/80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/30 group-data-[collapsible=icon]:justify-center"
          >
            <KeyRound className="size-4 shrink-0" />
            <span className="group-data-[collapsible=icon]:hidden">
              {tAuth('changePassword.title')}
            </span>
          </button>
          <button
            type="button"
            onClick={logout}
            className="flex h-9 items-center gap-2.5 rounded-lg px-3 text-[13px] text-white/50 transition-colors hover:bg-red-500/10 hover:text-red-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/30 group-data-[collapsible=icon]:justify-center"
          >
            <LogOut className="size-4 shrink-0" />
            <span className="group-data-[collapsible=icon]:hidden">
              {t('signOut')}
            </span>
          </button>
        </div>

        <ChangeOwnPasswordDialog
          open={changePasswordOpen}
          onOpenChange={setChangePasswordOpen}
        />
      </SidebarFooter>
    </Sidebar>
  );
}
