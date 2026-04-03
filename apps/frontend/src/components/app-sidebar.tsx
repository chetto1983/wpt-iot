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
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
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

function roleBadgeClass(role: string): string {
  switch (role) {
    case 'SUPER_ADMIN':
      return 'bg-primary/20 text-primary border-primary/30';
    case 'WPT':
      return 'bg-accent/20 text-accent border-accent/30';
    default:
      return 'bg-muted/20 text-sidebar-foreground/60 border-muted/30';
  }
}

function roleLabel(role: string): string {
  switch (role) {
    case 'SUPER_ADMIN':
      return 'Admin';
    case 'WPT':
      return 'WPT';
    default:
      return 'Client';
  }
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
              'h-10 rounded-lg transition-colors',
              isActive
                ? 'bg-sidebar-primary/15 text-sidebar-primary font-medium'
                : 'text-sidebar-foreground/70 hover:bg-sidebar-foreground/5 hover:text-sidebar-foreground',
            )}
            render={<Link href={item.href} />}
          >
            <item.icon className="size-[18px]" />
            <span>{item.label}</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
      );
    });

  return (
    <Sidebar collapsible="icon">
      {/* ── Brand ── */}
      <SidebarHeader className="px-4 py-4">
        <div className="flex items-center gap-3 group-data-[collapsible=icon]:justify-center">
          <Image
            src="/logo.png"
            alt="WPT"
            width={32}
            height={15}
            className="shrink-0"
          />
          <span className="text-sm font-semibold tracking-wide text-sidebar-foreground group-data-[collapsible=icon]:hidden">
            Sistema IoT
          </span>
        </div>
      </SidebarHeader>

      <Separator className="bg-sidebar-border" />

      <SidebarContent className="px-2 py-2">
        {/* Main nav */}
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu className="gap-0.5">
              {renderNavItems(navItems)}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {/* Reports — WPT + SuperAdmin */}
        {isWptOrAdmin ? (
          <>
            <Separator className="my-2 bg-sidebar-border" />
            <SidebarGroup>
              <SidebarGroupContent>
                <SidebarMenu className="gap-0.5">
                  {renderNavItems(reportItems)}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          </>
        ) : null}

        {/* Admin — SuperAdmin only */}
        {isSuperAdmin ? (
          <>
            <Separator className="my-2 bg-sidebar-border" />
            <SidebarGroup>
              <SidebarGroupContent>
                <SidebarMenu className="gap-0.5">
                  {renderNavItems(adminItems)}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          </>
        ) : null}
      </SidebarContent>

      <Separator className="bg-sidebar-border" />

      {/* ── Footer ── */}
      <SidebarFooter className="px-3 py-3 space-y-2">
        {/* User identity */}
        <div className="flex items-center gap-3 px-1">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-sidebar-primary text-xs font-bold text-sidebar-primary-foreground">
            {user.username.charAt(0).toUpperCase()}
          </div>
          <div className="flex min-w-0 flex-col group-data-[collapsible=icon]:hidden">
            <span className="truncate text-sm font-medium text-sidebar-foreground">
              {user.username}
            </span>
            <Badge
              variant="outline"
              className={cn(
                'mt-0.5 w-fit border text-[10px] leading-tight px-1.5 py-0',
                roleBadgeClass(user.role),
              )}
            >
              {roleLabel(user.role)}
            </Badge>
          </div>
        </div>

        {/* Actions */}
        <div className="flex flex-col gap-0.5">
          <Button
            variant="ghost"
            size="sm"
            className="h-9 w-full justify-start gap-2 text-sidebar-foreground/70 hover:bg-sidebar-foreground/5 hover:text-sidebar-foreground group-data-[collapsible=icon]:justify-center"
            onClick={() => setChangePasswordOpen(true)}
          >
            <KeyRound className="size-4" />
            <span className="group-data-[collapsible=icon]:hidden">
              {tAuth('changePassword.title')}
            </span>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-9 w-full justify-start gap-2 text-destructive/70 hover:bg-destructive/10 hover:text-destructive group-data-[collapsible=icon]:justify-center"
            onClick={logout}
          >
            <LogOut className="size-4" />
            <span className="group-data-[collapsible=icon]:hidden">
              {t('signOut')}
            </span>
          </Button>
        </div>

        <ChangeOwnPasswordDialog
          open={changePasswordOpen}
          onOpenChange={setChangePasswordOpen}
        />
      </SidebarFooter>
    </Sidebar>
  );
}
