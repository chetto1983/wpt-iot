'use client';

import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';

import { useAuth } from '@/lib/auth-context';

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
};

const IOS_TOAST_KEY = 'wpt:pwa-ios-tip-shown';
const INSTALL_TOAST_KEY = 'wpt:pwa-install-tip-shown';

function canUseServiceWorker() {
  if (typeof window === 'undefined') return false;
  const isLocalhost =
    window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1';
  return 'serviceWorker' in navigator && (window.isSecureContext || isLocalhost);
}

function isStandalone() {
  if (typeof window === 'undefined') return false;
  const nav = window.navigator as Navigator & { standalone?: boolean };
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    nav.standalone === true
  );
}

function isIosDevice() {
  if (typeof window === 'undefined') return false;
  return /iPad|iPhone|iPod/.test(window.navigator.userAgent);
}

export function PwaManager() {
  const t = useTranslations('pwa');
  const pathname = usePathname();
  const { user, loading } = useAuth();
  const installEventRef = useRef<BeforeInstallPromptEvent | null>(null);
  const updateToastShownRef = useRef(false);
  const reloadingRef = useRef(false);

  useEffect(() => {
    if (!canUseServiceWorker()) return;

    let active = true;

    const showUpdateToast = (registration: ServiceWorkerRegistration) => {
      if (updateToastShownRef.current) return;
      updateToastShownRef.current = true;
      toast.info(t('update.title'), {
        id: 'pwa-update-ready',
        description: t('update.body'),
        duration: Infinity,
        action: {
          label: t('update.action'),
          onClick: () => {
            registration.waiting?.postMessage({ type: 'SKIP_WAITING' });
          },
        },
      });
    };

    const register = async () => {
      try {
        const registration = await navigator.serviceWorker.register('/sw.js', {
          scope: '/',
          updateViaCache: 'none',
        });
        if (!active) return;

        if (registration.waiting) {
          showUpdateToast(registration);
        }

        registration.addEventListener('updatefound', () => {
          const worker = registration.installing;
          if (!worker) return;
          worker.addEventListener('statechange', () => {
            if (
              worker.state === 'installed' &&
              navigator.serviceWorker.controller
            ) {
              showUpdateToast(registration);
            }
          });
        });

        navigator.serviceWorker.addEventListener('controllerchange', () => {
          if (reloadingRef.current) return;
          reloadingRef.current = true;
          window.location.reload();
        });
      } catch {
        // Ignore registration failures on unsupported or misconfigured hosts.
      }
    };

    void register();

    return () => {
      active = false;
    };
  }, [t]);

  useEffect(() => {
    if (loading || !user || pathname === '/offline') return;
    if (isStandalone()) return;

    const onInstalled = () => {
      installEventRef.current = null;
      toast.success(t('installed'));
    };

    const onBeforeInstallPrompt = (event: Event) => {
      const installEvent = event as BeforeInstallPromptEvent;
      installEvent.preventDefault();
      installEventRef.current = installEvent;

      if (sessionStorage.getItem(INSTALL_TOAST_KEY)) return;
      sessionStorage.setItem(INSTALL_TOAST_KEY, '1');

      toast.info(t('install.title'), {
        id: 'pwa-install',
        description: t('install.body'),
        duration: 12000,
        action: {
          label: t('install.action'),
          onClick: async () => {
            const deferred = installEventRef.current;
            if (!deferred) return;
            await deferred.prompt();
            await deferred.userChoice.catch(() => undefined);
            installEventRef.current = null;
          },
        },
      });
    };

    window.addEventListener('appinstalled', onInstalled);
    window.addEventListener(
      'beforeinstallprompt',
      onBeforeInstallPrompt as EventListener,
    );

    if (
      canUseServiceWorker() &&
      isIosDevice() &&
      !sessionStorage.getItem(IOS_TOAST_KEY)
    ) {
      sessionStorage.setItem(IOS_TOAST_KEY, '1');
      toast.message(t('ios.title'), {
        id: 'pwa-ios-tip',
        description: t('ios.body'),
        duration: 12000,
      });
    }

    return () => {
      window.removeEventListener('appinstalled', onInstalled);
      window.removeEventListener(
        'beforeinstallprompt',
        onBeforeInstallPrompt as EventListener,
      );
    };
  }, [loading, pathname, t, user]);

  return null;
}
