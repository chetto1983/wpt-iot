import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { EnergyAggregateService } from './energyAggregateService.js';
import {
  BaselineOverlapError,
  BaselinePredatesDataError,
  EnergyBaselineService,
  MeasurementTooShortError,
  NoActiveBaselineError,
} from './energyBaselineService.js';
import {
  classifyTariffBand,
  CLIENT_VISIBLE_ENERGY_FIELDS,
  CycleType,
  DEFAULT_COSPHI,
  italianHolidayCalendar,
  UserRole,
  WPT_VISIBLE_ENERGY_FIELDS,
  type EnergyBucket,
  type IEnergyCycleRow,
  type IEnergyCyclesResponse,
  type IEnergyDashboardSummary,
  type IEnergyDashboardTariffBreakdown,
  type IEnergyDashboardWptDetails,
  type IEnergyReconciliationResponse,
  type UserRole as UserRoleValue,
} from '@wpt/types';

interface ILatestSnapshotRow {
  rms_curr_l1: number | string | null;
  rms_curr_l2: number | string | null;
  rms_curr_l3: number | string | null;
  pf_total: number | string | null;
}

interface IDashboardWindowStatsRow {
  peak_power_kw: number | string | null;
  avg_l1: number | string | null;
  avg_l2: number | string | null;
  avg_l3: number | string | null;
}

interface ICycleCountRow {
  cycles_today: number | string | null;
}

interface IBaselineEvidenceRow {
  enpi: number | string | null;
}

interface ICycleGroupRow {
  cycle_type: number | string | null;
  cycle_count: number | string | null;
  total_kwh: number | string | null;
  total_kg: number | string | null;
}

function coerceNumber(value: number | string | null | undefined): number | null {
  if (value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function enumKeyName(enumObj: Record<string, string | number>, value: number): string | null {
  const key = enumObj[value];
  return typeof key === 'string' ? key : null;
}

function normalizeOffset(raw: string | undefined): string {
  const match = raw?.match(/^GMT([+-])(\d{1,2})(?::(\d{2}))?$/);
  if (!match) return '+00:00';
  const sign = match[1] ?? '+';
  const hours = (match[2] ?? '0').padStart(2, '0');
  const minutes = match[3] ?? '00';
  return `${sign}${hours}:${minutes}`;
}

function getRomeDayStart(at: Date): Date {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Rome',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZoneName: 'shortOffset',
  }).formatToParts(at);
  const lookup: Record<string, string> = {};
  for (const part of parts) {
    if (part.type !== 'literal') lookup[part.type] = part.value;
  }
  return new Date(
    `${lookup.year}-${lookup.month}-${lookup.day}T00:00:00${normalizeOffset(lookup.timeZoneName)}`,
  );
}

function pickSummaryForRole(
  summary: IEnergyDashboardSummary,
  role: UserRoleValue,
): IEnergyDashboardSummary {
  const fields =
    role === UserRole.CLIENT ? CLIENT_VISIBLE_ENERGY_FIELDS : WPT_VISIBLE_ENERGY_FIELDS;
  const filtered: Partial<IEnergyDashboardSummary> = {};
  for (const field of fields) {
    (filtered as Record<string, unknown>)[field] = summary[field];
  }
  return filtered as IEnergyDashboardSummary;
}

function deriveThreePhasePowerKw(snapshot: ILatestSnapshotRow | undefined): number | null {
  if (!snapshot) return null;
  const currents = [
    coerceNumber(snapshot.rms_curr_l1),
    coerceNumber(snapshot.rms_curr_l2),
    coerceNumber(snapshot.rms_curr_l3),
  ].filter((value): value is number => value != null);
  if (currents.length === 0) return null;
  const avgCurrent = currents.reduce((sum, value) => sum + value, 0) / currents.length;
  const powerFactor = coerceNumber(snapshot.pf_total) ?? DEFAULT_COSPHI;
  return round((Math.sqrt(3) * 400 * avgCurrent * powerFactor) / 1000, 2);
}

function selectAggregateBucket(from: Date, to: Date): EnergyBucket {
  const spanMs = to.getTime() - from.getTime();
  const threeDaysMs = 3 * 24 * 60 * 60 * 1000;
  const fortyFiveDaysMs = 45 * 24 * 60 * 60 * 1000;
  if (spanMs <= threeDaysMs) return '5min';
  if (spanMs <= fortyFiveDaysMs) return 'hour';
  return 'day';
}

async function getBaselineEnpi(baselineId: number): Promise<number | null> {
  const result = await db.execute(sql`
    SELECT enpi
    FROM baseline_evidence
    WHERE baseline_id = ${baselineId}::bigint
    LIMIT 1
  `);
  const row = result.rows[0] as IBaselineEvidenceRow | undefined;
  return coerceNumber(row?.enpi);
}

async function getTariffBandBreakdown(
  from: Date,
  to: Date,
): Promise<IEnergyDashboardTariffBreakdown> {
  const aggregate = await EnergyAggregateService.getAggregate({
    from,
    to,
    bucket: selectAggregateBucket(from, to),
  });
  const totals: IEnergyDashboardTariffBreakdown = { f1: 0, f2: 0, f3: 0 };
  const holidayCache = new Map<number, Set<string>>();

  for (const row of aggregate.rows) {
    const year = row.bucket.getUTCFullYear();
    let holidays = holidayCache.get(year);
    if (!holidays) {
      holidays = italianHolidayCalendar(year);
      holidayCache.set(year, holidays);
    }
    const band = classifyTariffBand(row.bucket, holidays).toLowerCase() as keyof IEnergyDashboardTariffBreakdown;
    totals[band] += row.kwhDelta;
  }

  return {
    f1: round(totals.f1, 2),
    f2: round(totals.f2, 2),
    f3: round(totals.f3, 2),
  };
}

export class EnergyDashboardService {
  static async getDashboardSummary(args: {
    from: Date;
    to: Date;
    role: UserRoleValue;
  }): Promise<IEnergyDashboardSummary> {
    const now = new Date();
    const dayStart = getRomeDayStart(now);
    const [latestSnapshotResult, cyclesTodayResult, dayAggregate] = await Promise.all([
      db.execute(sql`
        SELECT rms_curr_l1, rms_curr_l2, rms_curr_l3, pf_total
        FROM machine_snapshots
        ORDER BY timestamp DESC
        LIMIT 1
      `),
      db.execute(sql`
        SELECT COUNT(*)::int AS cycles_today
        FROM cycle_records
        WHERE started_at >= ${dayStart}::timestamptz
          AND started_at < ${now}::timestamptz
          AND attribution_status = 'ATTRIBUTED'
      `),
      EnergyAggregateService.getAggregate({
        from: dayStart,
        to: now,
        bucket: '5min',
      }),
    ]);

    const latestSnapshot = latestSnapshotResult.rows[0] as ILatestSnapshotRow | undefined;
    const cycleCountRow = cyclesTodayResult.rows[0] as ICycleCountRow | undefined;

    let savings: IEnergyDashboardSummary['savings'] = null;
    let savingsUnavailableReason: IEnergyDashboardSummary['savingsUnavailableReason'] = null;
    let baselineEnpi: number | null = null;

    const activeBaseline = await EnergyBaselineService.getActiveBaseline();
    if (activeBaseline) {
      baselineEnpi = await getBaselineEnpi(activeBaseline.baselineId);
      try {
        savings = await EnergyBaselineService.computeSavings({
          baselineId: activeBaseline.baselineId,
          measurementFrom: args.from,
          measurementTo: args.to,
          detail: 0,
        });
      } catch (error) {
        if (
          error instanceof BaselineOverlapError ||
          error instanceof MeasurementTooShortError ||
          error instanceof BaselinePredatesDataError ||
          error instanceof NoActiveBaselineError
        ) {
          savingsUnavailableReason = error.code;
        } else {
          savingsUnavailableReason = 'UNAVAILABLE';
        }
      }
    } else {
      savingsUnavailableReason = 'NO_ACTIVE_BASELINE';
    }

    let wptDetails: IEnergyDashboardWptDetails | undefined;
    if (args.role !== UserRole.CLIENT) {
      const [windowStatsResult, tariffBandKwh] = await Promise.all([
        db.execute(sql`
          SELECT
            MAX(((COALESCE(rms_curr_l1, 0) + COALESCE(rms_curr_l2, 0) + COALESCE(rms_curr_l3, 0)) / 3.0)
                * sqrt(3)
                * 400
                * COALESCE(NULLIF(pf_total, 0), ${DEFAULT_COSPHI}))::float8 AS peak_power_kw,
            AVG(rms_curr_l1)::float8 AS avg_l1,
            AVG(rms_curr_l2)::float8 AS avg_l2,
            AVG(rms_curr_l3)::float8 AS avg_l3
          FROM machine_snapshots
          WHERE timestamp >= ${args.from}::timestamptz
            AND timestamp < ${args.to}::timestamptz
        `),
        getTariffBandBreakdown(args.from, args.to),
      ]);
      const windowStats = windowStatsResult.rows[0] as IDashboardWindowStatsRow | undefined;
      wptDetails = {
        peakPowerKw: coerceNumber(windowStats?.peak_power_kw),
        baselineEnpi,
        tariffBandKwh,
        rmsCurrentAvg: {
          l1: coerceNumber(windowStats?.avg_l1),
          l2: coerceNumber(windowStats?.avg_l2),
          l3: coerceNumber(windowStats?.avg_l3),
        },
      };
    }

    const summary: IEnergyDashboardSummary = {
      currentPowerKw: deriveThreePhasePowerKw(latestSnapshot),
      dayToDateKwh: round(dayAggregate.rows.reduce((sum, row) => sum + row.kwhDelta, 0), 2),
      dayToDateEur: round(dayAggregate.rows.reduce((sum, row) => sum + row.costEur, 0), 2),
      dayToDateKgCo2: round(dayAggregate.rows.reduce((sum, row) => sum + row.co2Kg, 0), 2),
      cyclesToday: Number(cycleCountRow?.cycles_today ?? 0),
      savings,
      savingsUnavailableReason,
      wptDetails,
    };

    return pickSummaryForRole(summary, args.role);
  }

  static async getCycles(args: {
    from: Date;
    to: Date;
    role: UserRoleValue;
    limit: number;
  }): Promise<IEnergyCyclesResponse> {
    void args.role;
    const result = await db.execute(sql`
      SELECT
        cycle_type,
        COUNT(*)::int AS cycle_count,
        COALESCE(SUM(energy_kwh), 0)::float8 AS total_kwh,
        COALESCE(SUM(material_output_kg), 0)::float8 AS total_kg
      FROM cycle_records
      WHERE started_at >= ${args.from}::timestamptz
        AND started_at < ${args.to}::timestamptz
        AND attribution_status = 'ATTRIBUTED'
        AND cycle_type IS NOT NULL
      GROUP BY cycle_type
      ORDER BY
        CASE
          WHEN COALESCE(SUM(material_output_kg), 0) > 0
            THEN COALESCE(SUM(energy_kwh), 0) / SUM(material_output_kg)
          ELSE NULL
        END DESC NULLS LAST,
        COUNT(*) DESC,
        cycle_type ASC
      LIMIT ${args.limit}
    `);

    const rows = (result.rows as unknown as ICycleGroupRow[]).map((row): IEnergyCycleRow => {
      const cycleType = Number(row.cycle_type ?? 0);
      const totalKwh = Number(row.total_kwh ?? 0);
      const totalKg = Number(row.total_kg ?? 0);
      const cycleLabelKey =
        enumKeyName(CycleType as unknown as Record<string, string | number>, cycleType) ??
        'UNKNOWN';
      return {
        cycleType,
        cycleLabelKey,
        cycleLabel: cycleLabelKey.replaceAll('_', ' '),
        cycleCount: Number(row.cycle_count ?? 0),
        totalKwh: round(totalKwh, 2),
        totalKg: round(totalKg, 2),
        avgKwhPerKg: totalKg > 0 ? round(totalKwh / totalKg, 3) : null,
      };
    });

    return {
      from: args.from.toISOString(),
      to: args.to.toISOString(),
      limit: args.limit,
      rows,
    };
  }

  static async getReconciliation(args: {
    from: Date;
    to: Date;
    role: UserRoleValue;
  }): Promise<IEnergyReconciliationResponse> {
    const [reconciliation, idleBaseload] = await Promise.all([
      EnergyAggregateService.getReconciliation({
        from: args.from,
        to: args.to,
      }),
      args.role === UserRole.CLIENT
        ? Promise.resolve(null)
        : EnergyAggregateService.computeIdleBaseload({
            from: args.from,
            to: args.to,
          }),
    ]);

    const meterKwh = reconciliation.meterKwh;
    const cyclesPct = meterKwh > 0 ? round((reconciliation.cycleKwh / meterKwh) * 100, 2) : 0;
    const idlePct = meterKwh > 0 ? round((reconciliation.idleKwh / meterKwh) * 100, 2) : 0;
    const unknownPct = meterKwh > 0 ? round((reconciliation.unknownKwh / meterKwh) * 100, 2) : 0;

    return {
      meterKwh: round(reconciliation.meterKwh, 2),
      cyclesKwh: round(reconciliation.cycleKwh, 2),
      idleKwh: round(reconciliation.idleKwh, 2),
      unknownKwh: round(reconciliation.unknownKwh, 2),
      cyclesPct,
      idlePct,
      unknownPct,
      warning: unknownPct > 2,
      wptDetails:
        args.role === UserRole.CLIENT
          ? undefined
          : {
              accountedRatio: round(reconciliation.ratio, 4),
              idleBaseloadKw: idleBaseload?.kw ?? null,
            },
    };
  }
}
