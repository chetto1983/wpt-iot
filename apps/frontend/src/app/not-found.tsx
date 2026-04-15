import { getTranslations } from 'next-intl/server';
import Image from 'next/image';
import Link from 'next/link';

export default async function NotFound() {
  const t = await getTranslations('notFound');

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="max-w-md w-full rounded-xl border-0 shadow-lg shadow-black/20 p-8 text-center bg-card">
        <Image
          src="/logo.png"
          alt="WPT"
          width={48}
          height={48}
          className="mx-auto h-12 w-auto mb-6"
        />
        <p className="text-2xl font-semibold text-muted-foreground mb-2">404</p>
        <h1 className="text-xl font-semibold text-foreground mb-2">{t('title')}</h1>
        <p className="text-sm text-muted-foreground mb-6">{t('description')}</p>
        <Link
          href="/dashboard"
          className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-xs hover:bg-primary/90"
        >
          {t('goToDashboard')}
        </Link>
      </div>
    </div>
  );
}
