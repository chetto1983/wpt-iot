'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { Loader2 } from 'lucide-react';
import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar';
import { AppSidebar } from '@/components/app-sidebar';
import { WebSocketProvider } from '@/lib/ws-context';
import { AppHeader } from '@/components/app-header';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) {
      router.push('/');
    }
  }, [user, loading, router]);

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Loader2 className="size-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!user) {
    return null; // Redirecting
  }

  return (
    // h-svh (instead of the provider's default min-h-svh) pins the layout to
    // exactly the viewport height. Without this, the wrapper grows with its
    // content and the inner overflow-auto div has nothing to clip against —
    // so panels overflow the viewport and the dashboard has no scrollbar.
    // min-h-0 on SidebarInset is required so the flex column can shrink,
    // letting `<div className="flex-1 overflow-auto">` actually scroll.
    <SidebarProvider className="h-svh">
      <WebSocketProvider>
        <AppSidebar />
        <SidebarInset className="min-h-0">
          <AppHeader />
          <div className="min-h-0 flex-1 overflow-auto">
            {children}
          </div>
        </SidebarInset>
      </WebSocketProvider>
    </SidebarProvider>
  );
}
