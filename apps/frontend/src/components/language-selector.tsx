'use client';

import { useLocale } from 'next-intl';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';

export function LanguageSelector() {
  const locale = useLocale();
  const router = useRouter();

  function switchLocale(lang: string) {
    document.cookie = `NEXT_LOCALE=${lang};path=/;max-age=31536000`;
    router.refresh();
  }

  return (
    <div className="flex items-center rounded-md border border-border text-xs">
      <button
        onClick={() => switchLocale('it')}
        className={cn(
          'px-2 py-1 rounded-l-md transition-colors',
          locale === 'it'
            ? 'bg-primary text-primary-foreground'
            : 'text-muted-foreground hover:text-foreground',
        )}
      >
        IT
      </button>
      <button
        onClick={() => switchLocale('en')}
        className={cn(
          'px-2 py-1 rounded-r-md transition-colors',
          locale === 'en'
            ? 'bg-primary text-primary-foreground'
            : 'text-muted-foreground hover:text-foreground',
        )}
      >
        EN
      </button>
    </div>
  );
}
