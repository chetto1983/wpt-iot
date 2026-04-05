'use client';

import { useEffect, useRef } from 'react';
import { useTranslations } from 'next-intl';
import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations('error');
  const buttonRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { buttonRef.current?.focus(); }, []);

  return (
    <div className="flex min-h-[400px] flex-col items-center justify-center gap-4 p-6">
      <AlertTriangle className="size-10 text-destructive" />
      <h2 className="text-xl font-semibold text-foreground">{t('title')}</h2>
      <p className="text-sm text-muted-foreground max-w-md text-center">{t('description')}</p>
      {error.digest && (
        <p className="text-xs text-muted-foreground/60">{error.digest}</p>
      )}
      <Button ref={buttonRef} onClick={reset}>{t('retry')}</Button>
    </div>
  );
}
