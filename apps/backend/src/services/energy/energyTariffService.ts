import type { IEnergyConfigPeriod } from '@wpt/types';
import { classifyTariffBand, italianHolidayCalendar } from '@wpt/types';
import { EnergyConfigService } from './energyConfigService.js';

/**
 * EnergyTariffService — pure-ish service for tariff / emission calculations.
 *
 * "Pure-ish" means: every method takes the bucket timestamp `at` as an
 * explicit input parameter and returns a result derived from the active
 * `energy_config_periods` row that covers `at`. NEVER reads the ambient
 * wall clock internally — the instant is always provided by the caller.
 * This is the
 * ECFG-03 / ECFG-04 reproducibility contract: two invocations with the
 * same (kwh, at) arguments against an unchanged DB return byte-identical
 * results, so re-running a historical bucket aggregation cannot silently
 * drift the cost or CO₂ column.
 *
 * Consumed by Plan 19-10's `energyAggregateService` to compute cost and
 * CO₂ AT AGGREGATION TIME (freezing the value into the continuous
 * aggregate), NOT at query time. Phase 23 `/settings/energy` edits flow
 * through `EnergyConfigService.insertNewPeriod()` which back-closes the
 * previous period — historical buckets therefore always reference the
 * period whose interval contained their timestamp, and a retroactive
 * tariff change cannot re-price old buckets (T-19-08 tampering mitigation).
 */
export class EnergyTariffService {
  /**
   * Compute cost in € for `kwh` consumed at bucket timestamp `at`, using
   * the active tariff period that covers `at`.
   *
   *   - `tariffMode === 'single'` → cost = kwh × tariff_single_eur_per_kwh.
   *   - `tariffMode === 'tou3'`   → cost = kwh × bands[classifyTariffBand(at)].eurPerKwh.
   *
   * If the period row claims `tou3` but its `tariffBandsJson` is missing
   * an entry for the classified band, we fall back to the single-rate
   * column rather than throwing — the aggregation job cannot crash on a
   * partially-migrated config row.
   */
  static async computeCost(kwh: number, at: Date): Promise<number> {
    const period = await EnergyConfigService.getActivePeriod(at);
    return EnergyTariffService.computeCostFromPeriod(kwh, at, period);
  }

  /**
   * Pure helper: given an already-fetched period row and (kwh, at),
   * compute the cost. Kept separate from `computeCost` so the aggregate
   * service can fetch the period once per bucket-window batch and invoke
   * this for each sub-bucket without hitting the DB repeatedly.
   */
  static computeCostFromPeriod(
    kwh: number,
    at: Date,
    period: IEnergyConfigPeriod,
  ): number {
    if (period.tariffMode === 'single') {
      return kwh * period.tariffSingleEurPerKwh;
    }
    // 'tou3' — classify into F1/F2/F3 using the Europe/Rome local wall clock.
    const year = EnergyTariffService.italianLocalYear(at);
    const holidays = EnergyTariffService.getHolidayCalendar(
      year,
      period.customHolidays,
    );
    const band = classifyTariffBand(at, holidays);
    const bandKey = band.toLowerCase() as 'f1' | 'f2' | 'f3';
    const bandEntry = period.tariffBandsJson?.[bandKey];
    if (!bandEntry) {
      // Fallback: partially-populated tou3 row — use single-rate column.
      return kwh * period.tariffSingleEurPerKwh;
    }
    return kwh * bandEntry.eurPerKwh;
  }

  /**
   * Compute CO₂ in kg for `kwh` at bucket timestamp `at`. Uses the
   * `emission_factor_kg_per_kwh` from the active period.
   */
  static async computeCo2(kwh: number, at: Date): Promise<number> {
    const period = await EnergyConfigService.getActivePeriod(at);
    return EnergyTariffService.computeCo2FromPeriod(kwh, period);
  }

  /** Pure helper: given an already-fetched period row, compute CO₂. */
  static computeCo2FromPeriod(kwh: number, period: IEnergyConfigPeriod): number {
    return kwh * period.emissionFactorKgPerKwh;
  }

  /**
   * Return the merged holiday calendar for a given year: the 12 Italian
   * national holidays from `italianHolidayCalendar(year)` plus any custom
   * customer-shutdown days from the period's `customHolidays` array
   * (ECFG-06). The original Italian calendar Set is copied so callers
   * cannot pollute the Easter computus cache across calls.
   */
  static getHolidayCalendar(
    year: number,
    customHolidays: string[] = [],
  ): Set<string> {
    const base = italianHolidayCalendar(year);
    const merged = new Set(base);
    for (const iso of customHolidays) {
      merged.add(iso);
    }
    return merged;
  }

  /**
   * Return the Europe/Rome local calendar year for an instant. Used
   * internally by `computeCostFromPeriod` so the holiday calendar lookup
   * picks the right year at year boundaries (e.g. 2024-12-31 23:30 UTC
   * is 2025 local Italian time).
   *
   * Pure — uses Intl with an explicit IANA zone. No ambient clock reads.
   */
  private static italianLocalYear(at: Date): number {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Europe/Rome',
      year: 'numeric',
    }).formatToParts(at);
    const yearPart = parts.find((p) => p.type === 'year');
    return yearPart ? parseInt(yearPart.value, 10) : at.getUTCFullYear();
  }
}
