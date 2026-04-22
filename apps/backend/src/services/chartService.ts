import { and, gte, lte, asc, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { machineSnapshots } from '../db/schema/machine.js';

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

interface IChartFilter {
  from: Date;
  to: Date;
  fields: string[];
}

interface IChartResponse {
  resolution: 'raw' | '5min' | '1h' | '1d';
  points: Array<Record<string, number | string>>;
}

// ---------------------------------------------------------------------------
// camelCase <-> snake_case mapping for TimescaleDB continuous aggregates
// ---------------------------------------------------------------------------

const CAMEL_TO_SNAKE: Record<string, string> = {
  garbageTemp: 'garbage_temp',
  chamberPressure: 'chamber_pressure',
  mainMotorSpeed: 'main_motor_speed',
  mainMotorCurrent: 'main_motor_current',
  mainMotorTorque: 'main_motor_torque',
  vacuumPumpSpeed01: 'vacuum_pump_speed_01',
  vacuumPumpSpeed02: 'vacuum_pump_speed_02',
  materialInputWeight: 'material_input_weight',
  materialOutputWeight: 'material_output_weight',
  selectedCycle: 'selected_cycle',
  currentPhase: 'current_phase',
  machineStatus: 'machine_status',
  completedCycles: 'completed_cycles',
  user: 'user',
  supervisor: 'supervisor',
  orderNumber: 'order_number',
  serialNumber: 'serial_number',
  spareString01: 'spare_string_01',
  energyConsumption: 'energy_consumption',
  waterConsumption: 'water_consumption',
  thermoLeftLower: 'thermo_left_lower',
  thermoLeftMedium: 'thermo_left_medium',
  thermoLeftUpper: 'thermo_left_upper',
  thermoRightLower: 'thermo_right_lower',
  thermoRightMedium: 'thermo_right_medium',
  thermoRightUpper: 'thermo_right_upper',
  thermoLeftHighLower: 'thermo_left_high_lower',
  thermoLeftHighMedium: 'thermo_left_high_medium',
  thermoLeftHighUpper: 'thermo_left_high_upper',
  thermoRightHighLower: 'thermo_right_high_lower',
  holdingTempSetpoint: 'holding_temp_setpoint',
  rmsCurrL1: 'rms_curr_l1',
  rmsCurrL2: 'rms_curr_l2',
  rmsCurrL3: 'rms_curr_l3',
  rmsCurrN: 'rms_curr_n',
  spareReal01: 'spare_real_01',
  thermoLeftLowSel: 'thermo_left_low_sel',
  thermoLeftMedSel: 'thermo_left_med_sel',
  thermoLeftHighSel: 'thermo_left_high_sel',
  thermoRightLowSel: 'thermo_right_low_sel',
  thermoRightMedSel: 'thermo_right_med_sel',
  thermoRightHighSel: 'thermo_right_high_sel',
};

const SNAKE_TO_CAMEL: Record<string, string> = Object.fromEntries(
  Object.entries(CAMEL_TO_SNAKE).map(([k, v]) => [v, k]),
);

/**
 * Columns available in the snapshots_5min / snapshots_1h / snapshots_1d
 * continuous aggregates.
 * Fields NOT in this set only exist in the raw machine_snapshots table.
 * Must stay in sync with docker/init-timescaledb.sql.
 */
const AGGREGATE_VIEW_COLUMNS = new Set<string>([
  'thermo_left_lower', 'thermo_left_medium', 'thermo_left_upper',
  'thermo_right_lower', 'thermo_right_medium', 'thermo_right_upper',
  'thermo_left_high_lower', 'thermo_left_high_medium', 'thermo_left_high_upper',
  'thermo_right_high_lower',
  'garbage_temp', 'holding_temp_setpoint', 'chamber_pressure',
  'main_motor_speed', 'main_motor_torque', 'main_motor_current',
  'vacuum_pump_speed_01', 'vacuum_pump_speed_02',
  'material_input_weight', 'material_output_weight',
  'energy_consumption', 'rms_curr_l1', 'rms_curr_l2', 'rms_curr_l3', 'rms_curr_n',
  'water_consumption',
  'selected_cycle', 'current_phase', 'machine_status', 'completed_cycles',
  'user', 'supervisor', 'order_number', 'serial_number',
  'thermo_left_low_sel', 'thermo_left_med_sel', 'thermo_left_high_sel',
  'thermo_right_low_sel', 'thermo_right_med_sel', 'thermo_right_high_sel',
]);

// ---------------------------------------------------------------------------
// ChartService — static-only class (per project convention)
// ---------------------------------------------------------------------------

export class ChartService {
  /**
   * Auto-select resolution based on time range span.
   * - raw:  <= 6 hours (15s granularity from machine_snapshots)
   * - 5min: 6h to 7 days (snapshots_5min continuous aggregate)
   * - 1h:   7d to 180 days (snapshots_1h continuous aggregate)
   * - 1d:   > 180 days (snapshots_1d continuous aggregate)
   */
  static selectResolution(from: Date, to: Date): 'raw' | '5min' | '1h' | '1d' {
    const spanMs = to.getTime() - from.getTime();
    const SIX_HOURS = 6 * 60 * 60 * 1000;
    const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;
    const ONE_HUNDRED_EIGHTY_DAYS = 180 * 24 * 60 * 60 * 1000;
    if (spanMs <= SIX_HOURS) return 'raw';
    if (spanMs <= SEVEN_DAYS) return '5min';
    if (spanMs <= ONE_HUNDRED_EIGHTY_DAYS) return '1h';
    return '1d';
  }

  /**
   * Query chart data with automatic resolution selection.
   * Returns epoch-ms timestamps and camelCase field keys.
   */
  static async queryChartData(filter: IChartFilter): Promise<IChartResponse> {
    const resolution = ChartService.selectResolution(filter.from, filter.to);

    if (resolution === 'raw') {
      return ChartService.queryRaw(filter, resolution);
    }

    return ChartService.queryAggregate(filter, resolution);
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private static async queryRaw(
    filter: IChartFilter,
    resolution: 'raw',
  ): Promise<IChartResponse> {
    const rows = await db
      .select()
      .from(machineSnapshots)
      .where(
        and(
          gte(machineSnapshots.timestamp, filter.from),
          lte(machineSnapshots.timestamp, filter.to),
        ),
      )
      .orderBy(asc(machineSnapshots.timestamp))
      .limit(5000);

    const points = rows.map((row) => {
      const point: Record<string, number | string> = {
        timestamp: new Date(row.timestamp).getTime(),
      };
      for (const field of filter.fields) {
        const val = row[field as keyof typeof row];
        if (val !== null && val !== undefined) {
          point[field] = val as number | string;
        }
      }
      return point;
    });

    return { resolution, points };
  }

  private static async queryAggregate(
    filter: IChartFilter,
    resolution: '5min' | '1h' | '1d',
  ): Promise<IChartResponse> {
    const viewName = resolution === '5min'
      ? 'snapshots_5min'
      : resolution === '1h'
        ? 'snapshots_1h'
        : 'snapshots_1d';
    const bucketColumn = resolution === '1d' ? 'bucket_1d' : 'bucket';

    // Map requested camelCase fields to snake_case column names,
    // filtering out any that don't exist in the aggregate view.
    const snakeColumns = filter.fields
      .map((f) => CAMEL_TO_SNAKE[f])
      .filter((col): col is string => col !== undefined && AGGREGATE_VIEW_COLUMNS.has(col));

    if (snakeColumns.length === 0) {
      return { resolution, points: [] };
    }

    // Build column list for SQL (safe: values come from our own mapping object)
    const columnList = snakeColumns
      .map((col) => `"${col}"`)
      .join(', ');

    // Use sql template with raw() for column/view names (from our mapping)
    // and parameterized values for user-supplied dates
    const result = await db.execute(
      sql`SELECT ${sql.raw(`"${bucketColumn}" AS bucket`)}, ${sql.raw(columnList)} FROM ${sql.raw(viewName)} WHERE ${sql.raw(`"${bucketColumn}"`)} >= ${filter.from} AND ${sql.raw(`"${bucketColumn}"`)} <= ${filter.to} ORDER BY ${sql.raw(`"${bucketColumn}"`)} ASC LIMIT 5000`,
    );

    const rows = (result as unknown as { rows: Record<string, unknown>[] }).rows
      ?? result as unknown as Record<string, unknown>[];

    const points = (Array.isArray(rows) ? rows : []).map((row) => {
      const point: Record<string, number | string> = {
        timestamp: new Date(row['bucket'] as string).getTime(),
      };
      for (const snakeCol of snakeColumns) {
        const camelKey = SNAKE_TO_CAMEL[snakeCol];
        if (camelKey && row[snakeCol] !== null && row[snakeCol] !== undefined) {
          // PostgreSQL numeric/double comes as string — parse and round to 2dp
          const raw = row[snakeCol];
          const num = typeof raw === 'string' ? parseFloat(raw) : (raw as number);
          point[camelKey] = Number.isFinite(num)
            ? Math.round(num * 100) / 100
            : (raw as number | string);
        }
      }
      return point;
    });

    return { resolution, points };
  }

  // -------------------------------------------------------------------------
  // Batch query — single DB call, per-panel projection
  // -------------------------------------------------------------------------

  /**
   * Query chart data for multiple panels in a single DB call.
   * Collects all unique fields, fetches once, then projects per query.
   */
  static async queryBatchChartData(
    from: Date,
    to: Date,
    queries: Array<{ id: string; fields: string[] }>,
  ): Promise<{ resolution: 'raw' | '5min' | '1h' | '1d'; results: Record<string, { points: Array<Record<string, number | string>> }> }> {
    // 1. Collect all unique fields across all queries
    const allFields = [...new Set(queries.flatMap(q => q.fields))];

    // 2. Make a single call to queryChartData with the union of all fields
    const unified = await ChartService.queryChartData({ from, to, fields: allFields });

    // 3. Split the result: for each query, project only its requested fields
    const results: Record<string, { points: Array<Record<string, number | string>> }> = {};
    for (const query of queries) {
      results[query.id] = {
        points: unified.points.map(point => {
          const projected: Record<string, number | string> = { timestamp: point['timestamp']! };
          for (const f of query.fields) {
            if (f in point) projected[f] = point[f]!;
          }
          return projected;
        }),
      };
    }

    return { resolution: unified.resolution, results };
  }
}
