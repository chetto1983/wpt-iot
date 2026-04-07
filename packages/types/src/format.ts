/**
 * Italian-locale format helpers — EFMT-01 single source of truth.
 *
 * Consumed by:
 * - Backend /api/energy/aggregate response shape (Plan 19-10)
 * - Phase 21 frontend /energy page
 * - Phase 22 backend energyPdfService (ISO 50001 PDF)
 *
 * EFMT-02 rounding rules are baked in here — do NOT duplicate them at call sites.
 *
 * Determinism: every helper output is pinned by
 * `packages/types/src/__tests__/format.test.ts`. Any future refactor that changes
 * a single character of output will fail those tests — that is by design.
 */

/**
 * Format kWh for Italian locale.
 *
 * EFMT-02 rounding:
 * - |kWh| < 100 → 1 decimal place
 * - |kWh| >= 100 → 0 decimal places
 *
 * @param kwh   number of kilowatt-hours
 * @param opts.compact  when true, drops the trailing " kWh" unit suffix
 */
export function formatItKwh(kwh: number, opts?: { compact?: boolean }): string {
  const decimals = Math.abs(kwh) >= 100 ? 0 : 1;
  const formatted = new Intl.NumberFormat('it-IT', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
    // Force dot grouping at every thousand. Node 22 / CLDR 42+ defaults to
    // 'auto' which omits the group separator on 4-digit integer parts for
    // it-IT — Italian energy/finance conventions still expect '1.234,56' so
    // we override to 'always'. This is pinned by format.test.ts.
    useGrouping: 'always',
  }).format(kwh);
  return opts?.compact ? formatted : `${formatted} kWh`;
}

/**
 * Format Euro amount for Italian locale.
 *
 * EFMT-02 rounding: always 2 decimals. Currency suffix is `" €"` (space + symbol)
 * — Italian convention places the symbol AFTER the number.
 */
export function formatItEur(eur: number): string {
  const formatted = new Intl.NumberFormat('it-IT', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    useGrouping: 'always',
  }).format(eur);
  return `${formatted} €`;
}

/**
 * Format kgCO₂ for Italian locale.
 *
 * EFMT-02 rounding: always 0 decimals (CO₂ totals are reported as whole kilograms
 * for ISO 50001 PDFs and dashboard tiles).
 */
export function formatItKgCO2(kg: number): string {
  const formatted = new Intl.NumberFormat('it-IT', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
    useGrouping: 'always',
  }).format(kg);
  return `${formatted} kgCO₂`;
}

/**
 * Format a Date as `dd/mm/yyyy` in Europe/Rome timezone (Italian locale).
 *
 * Always uses Europe/Rome — Phase 19/21/22 surfaces are timezone-locked to Italy
 * regardless of the host timezone (RESEARCH.md Pitfall 11).
 */
export function formatItDate(d: Date): string {
  return new Intl.DateTimeFormat('it-IT', {
    timeZone: 'Europe/Rome',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(d);
}

/**
 * Format a Date as `dd/mm/yyyy, HH:MM` in Europe/Rome timezone (Italian locale,
 * 24-hour clock).
 *
 * Always uses Europe/Rome (see formatItDate).
 */
export function formatItDateTime(d: Date): string {
  return new Intl.DateTimeFormat('it-IT', {
    timeZone: 'Europe/Rome',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(d);
}

/**
 * Gauss Easter computus — accurate 1583-2099. Returns Easter Sunday as a UTC Date.
 *
 * Pinned values (see format.test.ts):
 *   2024 → 2024-03-31
 *   2025 → 2025-04-20
 *   2026 → 2026-04-05
 *   2027 → 2027-03-28
 */
export function italianEasterDate(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day));
}

/**
 * Italian national holiday calendar for a given year.
 *
 * Returns a Set of `YYYY-MM-DD` ISO date strings containing the 12 official
 * Italian public holidays:
 *
 *  - Capodanno (01-01)
 *  - Epifania (01-06)
 *  - Pasqua (Gauss computus)
 *  - Pasquetta (day after Pasqua)
 *  - Festa della Liberazione (04-25)
 *  - Festa dei Lavoratori (05-01)
 *  - Festa della Repubblica (06-02)
 *  - Ferragosto (08-15)
 *  - Tutti i Santi (11-01)
 *  - Immacolata (12-08)
 *  - Natale (12-25)
 *  - Santo Stefano (12-26)
 */
export function italianHolidayCalendar(year: number): Set<string> {
  const easter = italianEasterDate(year);
  const pasquetta = new Date(
    Date.UTC(easter.getUTCFullYear(), easter.getUTCMonth(), easter.getUTCDate() + 1),
  );
  const iso = (d: Date): string => d.toISOString().slice(0, 10);
  const pad = (n: number): string => String(n).padStart(2, '0');
  const ymd = (y: number, m: number, d: number): string => `${y}-${pad(m)}-${pad(d)}`;
  return new Set([
    ymd(year, 1, 1),    // Capodanno
    ymd(year, 1, 6),    // Epifania
    iso(easter),        // Pasqua
    iso(pasquetta),     // Pasquetta
    ymd(year, 4, 25),   // Festa della Liberazione
    ymd(year, 5, 1),    // Festa dei Lavoratori
    ymd(year, 6, 2),    // Festa della Repubblica
    ymd(year, 8, 15),   // Ferragosto
    ymd(year, 11, 1),   // Tutti i Santi
    ymd(year, 12, 8),   // Immacolata
    ymd(year, 12, 25),  // Natale
    ymd(year, 12, 26),  // Santo Stefano
  ]);
}

/**
 * ARERA tariff-band classifier (F1 / F2 / F3).
 *
 * Bands defined in **Europe/Rome local wall-clock time**:
 *
 *   F1 = Mon-Fri 08:00-19:00, non-holiday
 *   F2 = Mon-Fri 07:00-08:00, Mon-Fri 19:00-23:00, Saturday 07:00-23:00
 *   F3 = everything else: Mon-Fri 00:00-07:00 + 23:00-24:00,
 *        Saturday 00:00-07:00 + 23:00-24:00, all of Sunday, all holidays.
 *
 * Hour comparisons are inclusive on the lower bound and exclusive on the upper
 * bound (so 19:00 sharp is F2, not F1; 23:00 sharp is F3, not F2).
 *
 * Holiday override always wins, even on a weekday at noon.
 *
 * @param at        instant to classify (any timezone — converted to Europe/Rome)
 * @param holidays  output of `italianHolidayCalendar(year)` for the relevant year
 */
export function classifyTariffBand(at: Date, holidays: Set<string>): 'F1' | 'F2' | 'F3' {
  // Convert `at` to Europe/Rome wall-clock parts.
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Rome',
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hour12: false,
  }).formatToParts(at);

  const lookup: Record<string, string> = {};
  for (const p of parts) {
    if (p.type !== 'literal') lookup[p.type] = p.value;
  }

  const weekday = lookup.weekday ?? 'Mon'; // 'Mon' | 'Tue' | 'Wed' | ... | 'Sun'
  const year = lookup.year ?? '';
  const month = lookup.month ?? '';
  const day = lookup.day ?? '';
  // Some Node ICU builds emit '24' for midnight under hour12:false — normalize to '00'.
  const hourStr = lookup.hour === '24' ? '00' : (lookup.hour ?? '00');
  const hour = parseInt(hourStr, 10);
  const isoDate = `${year}-${month}-${day}`;

  // Holiday override — always F3.
  if (holidays.has(isoDate)) return 'F3';

  // Sunday — always F3.
  if (weekday === 'Sun') return 'F3';

  // Saturday — F2 from 07:00 inclusive to 23:00 exclusive, F3 otherwise.
  if (weekday === 'Sat') {
    if (hour >= 7 && hour < 23) return 'F2';
    return 'F3';
  }

  // Mon-Fri.
  if (hour >= 8 && hour < 19) return 'F1';
  if ((hour >= 7 && hour < 8) || (hour >= 19 && hour < 23)) return 'F2';
  return 'F3';
}
