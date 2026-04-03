'use client';

import { useState } from 'react';
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
  SidebarSeparator,
} from '@/components/ui/sidebar';

interface NavItem {
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
}

function roleBadgeClass(role: string): string {
  switch (role) {
    case 'SUPER_ADMIN':
      return 'bg-primary text-primary-foreground';
    case 'WPT':
      return 'bg-accent text-accent-foreground';
    default:
      return 'bg-muted text-muted-foreground';
  }
}

export function AppSidebar() {
  const t = useTranslations('common');
  const tAuth = useTranslations('auth');
  const { user, logout } = useAuth();
  const pathname = usePathname();
  const [changePasswordOpen, setChangePasswordOpen] = useState(false);

  if (!user) return null;

  const mainItems: NavItem[] = [
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

  const isWptOrAdmin =
    user.role === 'SUPER_ADMIN' || user.role === 'WPT';
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
              'h-11',
              isActive &&
                'border-l-2 border-accent text-sidebar-primary rounded-none',
            )}
            render={<Link href={item.href} />}
          >
            <item.icon className="size-4" />
            <span>{item.label}</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
      );
    });

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="px-4 py-3">
        <span className="text-lg font-bold text-sidebar-primary">
          WPT IoT
        </span>
      </SidebarHeader>

      <SidebarSeparator />

      <SidebarContent>
        {/* Main group — always visible */}
        <SidebarGroup>
          <SidebarGroupLabel>Main</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>{renderNavItems(mainItems)}</SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {/* Reports group — WPT and SuperAdmin only */}
        {isWptOrAdmin ? (
          <SidebarGroup>
            <SidebarGroupLabel>Reports</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>{renderNavItems(reportItems)}</SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ) : null}

        {/* Admin group — SuperAdmin only */}
        {isSuperAdmin ? (
          <SidebarGroup>
            <SidebarGroupLabel>Admin</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>{renderNavItems(adminItems)}</SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ) : null}
      </SidebarContent>

      <SidebarSeparator />

      <SidebarFooter className="px-3 py-3">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-sidebar-primary text-sm font-semibold text-sidebar-primary-foreground">
            {user.username.charAt(0).toUpperCase()}
          </div>
          <div className="flex min-w-0 flex-1 flex-col group-data-[collapsible=icon]:hidden">
            <span className="truncate text-sm font-medium text-sidebar-foreground">
              {user.username}
            </span>
            <Badge
              className={cn('mt-0.5 w-fit text-[10px]', roleBadgeClass(user.role))}
            >
              {user.role}
            </Badge>
          </div>
        </div>
        <Button
          variant="ghost"
          className="h-11 w-full justify-start gap-2 text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground group-data-[collapsible=icon]:justify-center"
          onClick={() => setChangePasswordOpen(true)}
        >
          <KeyRound className="size-4" />
          <span className="group-data-[collapsible=icon]:hidden">
            {tAuth('changePassword.title')}
          </span>
        </Button>
        <Button
          variant="ghost"
          className="h-11 w-full justify-start gap-2 text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground group-data-[collapsible=icon]:justify-center"
          onClick={logout}
        >
          <LogOut className="size-4" />
          <span className="group-data-[collapsible=icon]:hidden">
            {t('signOut')}
          </span>
        </Button>
        <ChangeOwnPasswordDialog
          open={changePasswordOpen}
          onOpenChange={setChangePasswordOpen}
        />
      </SidebarFooter>
    </Sidebar>
  );
}
