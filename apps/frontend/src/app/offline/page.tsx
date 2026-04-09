import Link from 'next/link';
import { WifiOff, RefreshCw } from 'lucide-react';
import { getTranslations } from 'next-intl/server';

export default async function OfflinePage() {
  const t = await getTranslations('pwa.offline');

  return (
    <main className="flex min-h-dvh items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-md rounded-2xl border border-border/70 bg-card p-6 shadow-sm">
        <div className="mb-5 inline-flex size-12 items-center justify-center rounded-xl bg-muted text-muted-foreground">
          <WifiOff className="size-6" />
        </div>
        <h1 className="text-xl font-semibold">{t('title')}</h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          {t('body')}
        </p>
        <p className="mt-3 text-sm text-muted-foreground">
          {t('hint')}
        </p>
        <div className="mt-6 flex flex-col gap-3 sm:flex-row">
          <Link
            href="/dashboard"
            className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            <RefreshCw className="mr-2 size-4" />
            {t('retry')}
          </Link>
          <Link
            href="/"
            className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-border bg-background px-3 text-sm font-medium text-foreground transition-colors hover:bg-muted"
          >
            {t('login')}
          </Link>
        </div>
      </div>
    </main>
  );
}
