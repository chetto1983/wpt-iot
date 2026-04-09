'use client';

import { useState, useEffect, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';

import { apiFetch } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { PlcConfigForm, type PlcConfig } from '@/components/plc-config-form';

export default function PlcPage() {
  const t = useTranslations('plc');
  const { user } = useAuth();
  const router = useRouter();

  const [config, setConfig] = useState<PlcConfig | null>(null);

  // Guard: SUPER_ADMIN only
  useEffect(() => {
    if (user && user.role !== 'SUPER_ADMIN') {
      router.replace('/dashboard');
    }
  }, [user, router]);

  const loadConfig = useCallback(async () => {
    try {
      const data = await apiFetch<PlcConfig>('/api/plc/config');
      setConfig(data);
    } catch {
      // config unavailable
    }
  }, []);

  useEffect(() => {
    if (user?.role === 'SUPER_ADMIN') {
      void loadConfig();
    }
  }, [user, loadConfig]);

  if (!user || user.role !== 'SUPER_ADMIN') return null;

  return (
    <div className="mx-auto w-full max-w-2xl space-y-6 p-4 sm:p-6">
      <h1 className="text-2xl font-semibold">{t('pageTitle')}</h1>

      {config ? (
        <PlcConfigForm config={config} onSaved={() => void loadConfig()} />
      ) : null}
    </div>
  );
}
