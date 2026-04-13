import { cookies } from 'next/headers';
import { getRequestConfig } from 'next-intl/server';

export default getRequestConfig(async () => {
  const store = await cookies();
  const locale = store.get('NEXT_LOCALE')?.value || 'it';
  return {
    locale,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'Europe/Rome',
    messages: (await import(`../../messages/${locale}.json`)).default,
  };
});
