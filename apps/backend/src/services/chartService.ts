import { and, gte, lte, asc, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { machineSnapshots } from '../db/schema/machine.js';

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

export interface IChartFilter {
  from: Date;
  to: Date;
  fields: string[];
}

export interface IChartResponse {
  resolution: 'raw' | '5min' | '1h';
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

// ---------------------------------------------------------------------------
// ChartService — static-only class (per project convention)
// ---------------------------------------------------------------------------

export class ChartService {
  /**
   * Auto-select resolution based on time range span.
   * - raw:  <= 6 hours (15s granularity from machine_snapshots)
   * - 5min: 6h to 3 days (snapshots_5min continuous aggregate)
   * - 1h:   > 3 days (snapshots_1h continuous aggregate)
   */
  static selectResolution(from: Date, to: Date): 'raw' | '5min' | '1h' {
    const spanMs = to.getTime() - from.getTime();
    const SIX_HOURS = 6 * 60 * 60 * 1000;
    const THREE_DAYS = 3 * 24 * 60 * 60 * 1000;
    if (spanMs <= SIX_HOURS) return 'raw';
    if (spanMs <= THREE_DAYS) return '5min';
    return '1h';
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
    resolution: '5min' | '1h',
  ): Promise<IChartResponse> {
    const viewName = resolution === '5min' ? 'snapshots_5min' : 'snapshots_1h';

    // Map requested camelCase fields to snake_case column names
    const snakeColumns = filter.fields
      .map((f) => CAMEL_TO_SNAKE[f])
      .filter((col): col is string => col !== undefined);

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
      sql`SELECT bucket, ${sql.raw(columnList)} FROM ${sql.raw(viewName)} WHERE bucket >= ${filter.from} AND bucket <= ${filter.to} ORDER BY bucket ASC LIMIT 5000`,
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
          point[camelKey] = row[snakeCol] as number | string;
        }
      }
      return point;
    });

    return { resolution, points };
  }
}
