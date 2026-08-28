export const DEFAULT_TIMEZONE = 'Europe/Rome';

export interface IZonedDateTimeParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

export function isValidTimezone(value: string): boolean {
  if (!value.trim()) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

export function resolveTimezone(
  value: string | null | undefined,
  fallback = DEFAULT_TIMEZONE,
): string {
  return value && isValidTimezone(value) ? value : fallback;
}

export function getZonedDateTimeParts(
  date: Date,
  timezone: string,
): IZonedDateTimeParts {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: resolveTimezone(timezone),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const values: Record<string, string> = {};
  for (const part of formatter.formatToParts(date)) {
    if (part.type !== 'literal') values[part.type] = part.value;
  }

  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour) % 24,
    minute: Number(values.minute),
    second: Number(values.second),
  };
}

const pad2 = (value: number): string => String(value).padStart(2, '0');

export function formatZonedDate(date: Date, timezone: string): string {
  const parts = getZonedDateTimeParts(date, timezone);
  return `${pad2(parts.day)}/${pad2(parts.month)}/${parts.year}`;
}

export function formatZonedTime(
  date: Date,
  timezone: string,
  includeSeconds = false,
): string {
  const parts = getZonedDateTimeParts(date, timezone);
  const base = `${pad2(parts.hour)}:${pad2(parts.minute)}`;
  return includeSeconds ? `${base}:${pad2(parts.second)}` : base;
}

export function formatZonedDateTime(
  date: Date,
  timezone: string,
  includeSeconds = false,
): string {
  return `${formatZonedDate(date, timezone)} ${formatZonedTime(
    date,
    timezone,
    includeSeconds,
  )}`;
}

/**
 * Convert a wall-clock date/time in an IANA timezone to its UTC instant.
 * The iterative correction handles variable UTC offsets and daylight saving.
 */
export function zonedDateTimeToUtc(
  parts: Omit<IZonedDateTimeParts, 'second'> & { second?: number },
  timezone: string,
): Date {
  const resolvedTimezone = resolveTimezone(timezone);
  const wallClockUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second ?? 0,
    0,
  );
  let candidate = wallClockUtc;

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const rendered = getZonedDateTimeParts(new Date(candidate), resolvedTimezone);
    const renderedAsUtc = Date.UTC(
      rendered.year,
      rendered.month - 1,
      rendered.day,
      rendered.hour,
      rendered.minute,
      rendered.second,
      0,
    );
    const delta = renderedAsUtc - wallClockUtc;
    if (delta === 0) break;
    candidate -= delta;
  }

  return new Date(candidate);
}

export function getZonedMonthRange(
  year: number,
  month: number,
  timezone: string,
): { from: Date; to: Date } {
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  return {
    from: zonedDateTimeToUtc(
      { year, month, day: 1, hour: 0, minute: 0 },
      timezone,
    ),
    to: zonedDateTimeToUtc(
      { year: nextYear, month: nextMonth, day: 1, hour: 0, minute: 0 },
      timezone,
    ),
  };
}
