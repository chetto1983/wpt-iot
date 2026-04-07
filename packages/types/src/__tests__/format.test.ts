import { describe, it, expect } from 'vitest';
import {
  formatItKwh,
  formatItEur,
  formatItKgCO2,
  formatItDate,
  formatItDateTime,
  classifyTariffBand,
  italianEasterDate,
  italianHolidayCalendar,
} from '../format.js';

describe('formatItKwh', () => {
  it('renders 12.5 as "12,5 kWh"', () => {
    expect(formatItKwh(12.5)).toBe('12,5 kWh');
  });

  it('renders 99.9 as "99,9 kWh"', () => {
    expect(formatItKwh(99.9)).toBe('99,9 kWh');
  });

  it('renders 100 with zero decimals as "100 kWh"', () => {
    expect(formatItKwh(100)).toBe('100 kWh');
  });

  it('renders 1234.5 with thousand separator as "1.235 kWh"', () => {
    expect(formatItKwh(1234.5)).toBe('1.235 kWh');
  });

  it('compact option drops unit suffix', () => {
    expect(formatItKwh(12.5, { compact: true })).toBe('12,5');
  });
});

describe('formatItEur', () => {
  it('renders 0.25 as "0,25 €"', () => {
    expect(formatItEur(0.25)).toBe('0,25 €');
  });

  it('renders 1234.56 as "1.234,56 €"', () => {
    expect(formatItEur(1234.56)).toBe('1.234,56 €');
  });
});

describe('formatItKgCO2', () => {
  it('renders 0 as "0 kgCO₂"', () => {
    expect(formatItKgCO2(0)).toBe('0 kgCO₂');
  });

  it('renders 1234.5 as "1.235 kgCO₂"', () => {
    expect(formatItKgCO2(1234.5)).toBe('1.235 kgCO₂');
  });
});

describe('formatItDate / formatItDateTime', () => {
  it('formatItDate renders 2026-04-07T12:00:00Z as 07/04/2026 in Europe/Rome', () => {
    // 12:00 UTC on 2026-04-07 is 14:00 CEST — date is still 07/04/2026.
    expect(formatItDate(new Date('2026-04-07T12:00:00Z'))).toBe('07/04/2026');
  });

  it('formatItDateTime renders 2026-02-15T10:00:00Z as 15/02/2026, 11:00 in Europe/Rome', () => {
    // February is CET (+01:00), so 10:00 UTC = 11:00 local. Non-DST month avoids ambiguity.
    expect(formatItDateTime(new Date('2026-02-15T10:00:00Z'))).toBe('15/02/2026, 11:00');
  });
});

describe('italianEasterDate (Gauss computus)', () => {
  it('2024 Easter = March 31', () => {
    expect(italianEasterDate(2024).toISOString().slice(0, 10)).toBe('2024-03-31');
  });

  it('2025 Easter = April 20', () => {
    expect(italianEasterDate(2025).toISOString().slice(0, 10)).toBe('2025-04-20');
  });

  it('2026 Easter = April 5', () => {
    expect(italianEasterDate(2026).toISOString().slice(0, 10)).toBe('2026-04-05');
  });

  it('2027 Easter = March 28', () => {
    expect(italianEasterDate(2027).toISOString().slice(0, 10)).toBe('2027-03-28');
  });
});

describe('italianHolidayCalendar', () => {
  it('2026 contains 12 standard holidays including Pasqua and Pasquetta', () => {
    const cal = italianHolidayCalendar(2026);
    expect(cal.has('2026-01-01')).toBe(true); // Capodanno
    expect(cal.has('2026-01-06')).toBe(true); // Epifania
    expect(cal.has('2026-04-05')).toBe(true); // Pasqua
    expect(cal.has('2026-04-06')).toBe(true); // Pasquetta
    expect(cal.has('2026-04-25')).toBe(true); // Festa della Liberazione
    expect(cal.has('2026-05-01')).toBe(true); // Festa dei Lavoratori
    expect(cal.has('2026-06-02')).toBe(true); // Festa della Repubblica
    expect(cal.has('2026-08-15')).toBe(true); // Ferragosto
    expect(cal.has('2026-11-01')).toBe(true); // Tutti i Santi
    expect(cal.has('2026-12-08')).toBe(true); // Immacolata
    expect(cal.has('2026-12-25')).toBe(true); // Natale
    expect(cal.has('2026-12-26')).toBe(true); // Santo Stefano
    expect(cal.size).toBe(12);
  });
});

describe('classifyTariffBand', () => {
  const cal = italianHolidayCalendar(2026);

  it('Tuesday noon Europe/Rome = F1', () => {
    // 2026-04-07 is a Tuesday. April is CEST (+02:00). 10:00 UTC = 12:00 local.
    expect(classifyTariffBand(new Date('2026-04-07T10:00:00Z'), cal)).toBe('F1');
  });

  it('Saturday 22:00 Europe/Rome = F2', () => {
    // 2026-04-11 is Saturday. April is CEST (+02:00). 20:00 UTC = 22:00 local.
    expect(classifyTariffBand(new Date('2026-04-11T20:00:00Z'), cal)).toBe('F2');
  });

  it('Sunday early morning = F3', () => {
    // 2026-04-12 is Sunday. April is CEST (+02:00). 00:00 UTC = 02:00 local.
    expect(classifyTariffBand(new Date('2026-04-12T00:00:00Z'), cal)).toBe('F3');
  });

  it('Capodanno noon = F3 (holiday override)', () => {
    // 2026-01-01 is CET (+01:00). 11:00 UTC = 12:00 local. Holiday override → F3.
    expect(classifyTariffBand(new Date('2026-01-01T11:00:00Z'), cal)).toBe('F3');
  });

  it('Pasquetta 14:00 = F3 (holiday override)', () => {
    // 2026-04-06 is Pasquetta, CEST (+02:00). 12:00 UTC = 14:00 local. Holiday override → F3.
    expect(classifyTariffBand(new Date('2026-04-06T12:00:00Z'), cal)).toBe('F3');
  });
});
