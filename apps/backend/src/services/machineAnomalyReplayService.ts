import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import {
  OnlineAnomalyDetector,
  type IAnomalyInput,
} from './onlineAnomalyDetector.js';

interface IReplaySnapshotRow {
  timestamp: Date | string;
  selected_cycle: number | null;
  current_phase: number | null;
  machine_status: number | null;
  garbage_temp: number | null;
  chamber_pressure: number | null;
  main_motor_speed: number | null;
  main_motor_current: number | null;
  main_motor_torque: number | null;
  vacuum_pump_speed_01: number | null;
  energy_consumption: number | null;
  rms_curr_l1: number | null;
  rms_curr_l2: number | null;
  rms_curr_l3: number | null;
  material_input_weight: number | null;
  material_output_weight: number | null;
  // V03 fields — parity with mapSnapshotToDetectorInput
  vacuum_pump_speed_02: number | null;
  rms_curr_n: number | null;
  thermo_left_lower: number | null;
  thermo_left_medium: number | null;
  thermo_left_upper: number | null;
  thermo_right_lower: number | null;
  thermo_right_medium: number | null;
  thermo_right_upper: number | null;
  holding_temp_setpoint: number | null;
  water_consumption: number | null;
  line_volt_l1_l2: number | null;
  line_volt_l2_l3: number | null;
  line_volt_l3_l1: number | null;
  line_neutral_volt_l1: number | null;
  line_neutral_volt_l2: number | null;
  line_neutral_volt_l3: number | null;
  pf_total: number | null;
  thermo_left_high_lower: number | null;
  thermo_left_high_medium: number | null;
  thermo_left_high_upper: number | null;
  thermo_right_high_lower: number | null;
}

interface IAlarmCountRow {
  activeCount: number | string;
}

interface IAnomalyReplayRequest {
  from: Date;
  to: Date;
  maxRows?: number;
  topN?: number;
}

export interface IAnomalyReplayPoint {
  observedAt: string;
  modeKey: string;
  score: number;
  flagged: boolean;
  topContributors: Array<{ feature: string; zScore: number }>;
}

interface IAnomalyReplayResponse {
  window: {
    from: string;
    to: string;
  };
  tracking: {
    continuousLearning: true;
    persistsAcrossRestart: false;
    replayedRows: number;
    activeAlarmCount: number;
  };
  summary: {
    flaggedRows: number;
    maxScore: number;
    firstFlaggedAt: string | null;
  };
  topAnomalies: IAnomalyReplayPoint[];
  /** Downsampled score timeline for charting (max ~120 points). */
  timeline?: Array<{ time: string; score: number; flagged: boolean }>;
}

function asIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function mapReplayRow(row: IReplaySnapshotRow): IAnomalyInput {
  return {
    selectedCycle: row.selected_cycle,
    currentPhase: row.current_phase,
    machineStatus: row.machine_status,
    garbageTemp: row.garbage_temp,
    chamberPressure: row.chamber_pressure,
    mainMotorSpeed: row.main_motor_speed,
    mainMotorCurrent: row.main_motor_current,
    mainMotorTorque: row.main_motor_torque,
    vacuumPumpSpeed01: row.vacuum_pump_speed_01,
    energyConsumption: row.energy_consumption,
    rmsCurrL1: row.rms_curr_l1,
    rmsCurrL2: row.rms_curr_l2,
    rmsCurrL3: row.rms_curr_l3,
    materialInputWeight: row.material_input_weight,
    materialOutputWeight: row.material_output_weight,
    // V03 fields — parity with mapSnapshotToDetectorInput
    vacuumPumpSpeed02: row.vacuum_pump_speed_02,
    rmsCurrN: row.rms_curr_n,
    thermoLeftLower: row.thermo_left_lower,
    thermoLeftMedium: row.thermo_left_medium,
    thermoLeftUpper: row.thermo_left_upper,
    thermoRightLower: row.thermo_right_lower,
    thermoRightMedium: row.thermo_right_medium,
    thermoRightUpper: row.thermo_right_upper,
    holdingTempSetpoint: row.holding_temp_setpoint,
    waterConsumption: row.water_consumption,
    lineVoltL1L2: row.line_volt_l1_l2,
    lineVoltL2L3: row.line_volt_l2_l3,
    lineVoltL3L1: row.line_volt_l3_l1,
    lineNeutralVoltL1: row.line_neutral_volt_l1,
    lineNeutralVoltL2: row.line_neutral_volt_l2,
    lineNeutralVoltL3: row.line_neutral_volt_l3,
    pfTotal: row.pf_total,
    thermoLeftHighLower: row.thermo_left_high_lower,
    thermoLeftHighMedium: row.thermo_left_high_medium,
    thermoLeftHighUpper: row.thermo_left_high_upper,
    thermoRightHighLower: row.thermo_right_high_lower,
  };
}

export class MachineAnomalyReplayService {
  static async replay(
    request: IAnomalyReplayRequest,
  ): Promise<IAnomalyReplayResponse> {
    const maxRows = request.maxRows ?? 20000;
    const topN = request.topN ?? 20;

    const snapshotResult = await db.execute(sql`
      SELECT
        timestamp,
        selected_cycle,
        current_phase,
        machine_status,
        garbage_temp,
        chamber_pressure,
        main_motor_speed,
        main_motor_current,
        main_motor_torque,
        vacuum_pump_speed_01,
        energy_consumption,
        rms_curr_l1,
        rms_curr_l2,
        rms_curr_l3,
        material_input_weight,
        material_output_weight,
        vacuum_pump_speed_02,
        rms_curr_n,
        thermo_left_lower,
        thermo_left_medium,
        thermo_left_upper,
        thermo_right_lower,
        thermo_right_medium,
        thermo_right_upper,
        holding_temp_setpoint,
        water_consumption,
        line_volt_l1_l2,
        line_volt_l2_l3,
        line_volt_l3_l1,
        line_neutral_volt_l1,
        line_neutral_volt_l2,
        line_neutral_volt_l3,
        pf_total,
        thermo_left_high_lower,
        thermo_left_high_medium,
        thermo_left_high_upper,
        thermo_right_high_lower
      FROM machine_snapshots
      WHERE timestamp >= ${request.from}::timestamptz
        AND timestamp < ${request.to}::timestamptz
      ORDER BY timestamp ASC
      LIMIT ${maxRows}
    `);

    const alarmCountResult = await db.execute(sql`
      SELECT COUNT(*)::int AS "activeCount"
      FROM alarm_events
      WHERE transition_type = 'ACTIVE'
        AND activated_at >= ${request.from}::timestamptz
        AND activated_at < ${request.to}::timestamptz
    `);

    const detector = new OnlineAnomalyDetector();
    const topAnomalies: IAnomalyReplayPoint[] = [];
    const allScores: Array<{ time: string; score: number; flagged: boolean }> = [];
    let flaggedRows = 0;
    let maxScore = 0;
    let firstFlaggedAt: string | null = null;
    const totalRows = snapshotResult.rows.length;

    for (const row of snapshotResult.rows as unknown as IReplaySnapshotRow[]) {
      const result = detector.observe(mapReplayRow(row));
      const observedAt = asIsoString(row.timestamp);

      allScores.push({ time: observedAt, score: result.score, flagged: result.flagged });

      if (result.flagged) {
        flaggedRows += 1;
        if (!firstFlaggedAt) {
          firstFlaggedAt = observedAt;
        }
      }

      if (result.score > maxScore) {
        maxScore = result.score;
      }

      const point: IAnomalyReplayPoint = {
        observedAt,
        modeKey: result.modeKey,
        score: result.score,
        flagged: result.flagged,
        topContributors: result.topContributors,
      };

      topAnomalies.push(point);
      topAnomalies.sort((a, b) => b.score - a.score);
      if (topAnomalies.length > topN) {
        topAnomalies.length = topN;
      }
    }

    // Downsample timeline to ~120 points for charting
    const MAX_TIMELINE = 120;
    const step = totalRows > MAX_TIMELINE ? Math.floor(totalRows / MAX_TIMELINE) : 1;
    const timeline: Array<{ time: string; score: number; flagged: boolean }> = [];
    for (let i = 0; i < allScores.length; i += step) {
      const pt = allScores[i];
      if (pt) timeline.push(pt);
    }

    const activeAlarmCount = Number(
      (alarmCountResult.rows[0] as IAlarmCountRow | undefined)?.activeCount ?? 0,
    );

    return {
      window: {
        from: request.from.toISOString(),
        to: request.to.toISOString(),
      },
      tracking: {
        continuousLearning: true,
        persistsAcrossRestart: false,
        replayedRows: snapshotResult.rows.length,
        activeAlarmCount,
      },
      summary: {
        flaggedRows,
        maxScore,
        firstFlaggedAt,
      },
      topAnomalies,
      timeline,
    };
  }
}
