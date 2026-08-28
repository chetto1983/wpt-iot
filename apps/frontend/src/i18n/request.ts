import { cookies } from 'next/headers';
import { getRequestConfig } from 'next-intl/server';
import { resolveTimezone } from '@wpt/types';

export default getRequestConfig(async () => {
  const store = await cookies();
  const locale = store.get('NEXT_LOCALE')?.value || 'it';
  const timezoneCookie = store.get('APP_TIMEZONE')?.value;
  let decodedTimezone = timezoneCookie;
  if (timezoneCookie) {
    try {
      decodedTimezone = decodeURIComponent(timezoneCookie);
    } catch {
      // Invalid cookie encoding is handled by resolveTimezone's safe fallback.
    }
  }
  const timezone = resolveTimezone(decodedTimezone);
  return {
    locale,
    timeZone: timezone,
    messages: ((await import(`../../messages/${locale}.json`)) as { default: Record<string, unknown> }).default,
  };
});
