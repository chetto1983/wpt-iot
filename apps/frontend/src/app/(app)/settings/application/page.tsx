'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';

import { useAuth } from '@/lib/auth-context';
import { ApplicationSettingsForm } from '@/components/settings/application-settings-form';

export default function ApplicationSettingsPage() {
  const t = useTranslations('applicationSettings');
  const { user } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (user && user.role !== 'SUPER_ADMIN') router.replace('/dashboard');
  }, [router, user]);

  if (!user || user.role !== 'SUPER_ADMIN') return null;

  return (
    <div className="mx-auto w-full max-w-2xl space-y-6 p-4 sm:p-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">{t('pageTitle')}</h1>
        <p className="text-sm text-muted-foreground">{t('pageDescription')}</p>
      </div>
      <ApplicationSettingsForm />
    </div>
  );
}
