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
}

interface IAlarmCountRow {
  activeCount: number | string;
}

export interface IAnomalyReplayRequest {
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

export interface IAnomalyReplayResponse {
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
        material_output_weight
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
    let flaggedRows = 0;
    let maxScore = 0;
    let firstFlaggedAt: string | null = null;

    for (const row of snapshotResult.rows as unknown as IReplaySnapshotRow[]) {
      const result = detector.observe(mapReplayRow(row));
      const observedAt = asIsoString(row.timestamp);

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
    };
  }
}
