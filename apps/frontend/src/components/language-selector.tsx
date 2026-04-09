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
    <div className="flex items-center overflow-hidden rounded-md border border-border text-xs">
      <button
        onClick={() => switchLocale('it')}
        className={cn(
          'min-h-11 min-w-11 rounded-l-md px-3 py-2 transition-colors sm:min-h-8 sm:min-w-0 sm:px-2 sm:py-1',
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
          'min-h-11 min-w-11 rounded-r-md px-3 py-2 transition-colors sm:min-h-8 sm:min-w-0 sm:px-2 sm:py-1',
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
