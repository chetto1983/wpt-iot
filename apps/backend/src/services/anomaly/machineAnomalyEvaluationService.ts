import { sql } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { OnlineAnomalyDetector } from './onlineAnomalyDetector.js';
import type { IAnomalyReplayPoint } from './machineAnomalyReplayService.js';
import {
  type IReplaySnapshotRow,
  asIsoString,
  mapReplayRow,
} from './anomalyReplayHelpers.js';

interface IAlarmActivationRow {
  activated_at: Date | string;
  alarm_index: number | string;
  description_it: string;
  description_en: string;
}

interface IAnomalyEvaluationRequest {
  from: Date;
  to: Date;
  maxRows?: number;
  topN?: number;
  alarmLeadMinutes?: number;
  alarmLagMinutes?: number;
}

interface IAnomalyEvaluationAlarm {
  activatedAt: string;
  alarmIndex: number;
  descriptionIt: string;
  descriptionEn: string;
  matched: boolean;
}

interface IAnomalyEvaluationResponse {
  window: {
    from: string;
    to: string;
  };
  config: {
    alarmLeadMinutes: number;
    alarmLagMinutes: number;
  };
  tracking: {
    continuousLearning: true;
    persistsAcrossRestart: false;
    replayedRows: number;
    flaggedRows: number;
    activeAlarmCount: number;
  };
  metrics: {
    matchedFlaggedRows: number;
    unmatchedFlaggedRows: number;
    matchedAlarmCount: number;
    missedAlarmCount: number;
    flaggedPrecision: number | null;
    alarmRecall: number | null;
  };
  topFlaggedPoints: IAnomalyReplayPoint[];
  alarmActivations: IAnomalyEvaluationAlarm[];
}


export class MachineAnomalyEvaluationService {
  static async evaluate(
    request: IAnomalyEvaluationRequest,
  ): Promise<IAnomalyEvaluationResponse> {
    const maxRows = request.maxRows ?? 20000;
    const topN = request.topN ?? 20;
    const alarmLeadMinutes = request.alarmLeadMinutes ?? 10;
    const alarmLagMinutes = request.alarmLagMinutes ?? 2;
    const leadMs = alarmLeadMinutes * 60 * 1000;
    const lagMs = alarmLagMinutes * 60 * 1000;

    const snapshotResult = await db.execute(sql`
      SELECT
        timestamp, selected_cycle, current_phase, machine_status,
        garbage_temp, chamber_pressure, main_motor_speed,
        main_motor_current, main_motor_torque, vacuum_pump_speed_01,
        energy_consumption, rms_curr_l1, rms_curr_l2, rms_curr_l3,
        material_input_weight, material_output_weight,
        vacuum_pump_speed_02, rms_curr_n,
        thermo_left_lower, thermo_left_medium, thermo_left_upper,
        thermo_right_lower, thermo_right_medium, thermo_right_upper,
        holding_temp_setpoint, water_consumption,
        line_volt_l1_l2, line_volt_l2_l3, line_volt_l3_l1,
        line_neutral_volt_l1, line_neutral_volt_l2, line_neutral_volt_l3,
        pf_total,
        thermo_left_high_lower, thermo_left_high_medium,
        thermo_left_high_upper, thermo_right_high_lower
      FROM machine_snapshots
      WHERE timestamp >= ${request.from}::timestamptz
        AND timestamp < ${request.to}::timestamptz
      ORDER BY timestamp ASC
      LIMIT ${maxRows}
    `);

    const alarmResult = await db.execute(sql`
      SELECT
        activated_at,
        alarm_index,
        description_it,
        description_en
      FROM alarm_events
      WHERE transition_type = 'ACTIVE'
        AND activated_at >= ${request.from}::timestamptz
        AND activated_at < ${request.to}::timestamptz
      ORDER BY activated_at ASC
    `);

    const alarms = (alarmResult.rows as unknown as IAlarmActivationRow[]).map((row) => ({
      activatedAt: asIsoString(row.activated_at),
      alarmIndex: Number(row.alarm_index),
      descriptionIt: row.description_it,
      descriptionEn: row.description_en,
      matched: false,
    }));

    const detector = new OnlineAnomalyDetector();
    const topFlaggedPoints: IAnomalyReplayPoint[] = [];
    let flaggedRows = 0;
    let matchedFlaggedRows = 0;

    for (const row of snapshotResult.rows as unknown as IReplaySnapshotRow[]) {
      const result = detector.observe(mapReplayRow(row));
      if (!result.flagged) continue;

      flaggedRows += 1;
      const observedAt = asIsoString(row.timestamp);
      const observedMs = Date.parse(observedAt);
      let matched = false;

      for (const alarm of alarms) {
        const activatedMs = Date.parse(alarm.activatedAt);
        if (observedMs >= activatedMs - leadMs && observedMs <= activatedMs + lagMs) {
          matched = true;
          alarm.matched = true;
        }
      }

      if (matched) {
        matchedFlaggedRows += 1;
      }

      topFlaggedPoints.push({
        observedAt,
        modeKey: result.modeKey,
        score: result.score,
        flagged: true,
        topContributors: result.topContributors,
      });
      topFlaggedPoints.sort((a, b) => b.score - a.score);
      if (topFlaggedPoints.length > topN) {
        topFlaggedPoints.length = topN;
      }
    }

    const matchedAlarmCount = alarms.filter((alarm) => alarm.matched).length;
    const missedAlarmCount = alarms.length - matchedAlarmCount;
    const unmatchedFlaggedRows = flaggedRows - matchedFlaggedRows;

    return {
      window: {
        from: request.from.toISOString(),
        to: request.to.toISOString(),
      },
      config: {
        alarmLeadMinutes,
        alarmLagMinutes,
      },
      tracking: {
        continuousLearning: true,
        persistsAcrossRestart: false,
        replayedRows: snapshotResult.rows.length,
        flaggedRows,
        activeAlarmCount: alarms.length,
      },
      metrics: {
        matchedFlaggedRows,
        unmatchedFlaggedRows,
        matchedAlarmCount,
        missedAlarmCount,
        flaggedPrecision: flaggedRows > 0 ? matchedFlaggedRows / flaggedRows : null,
        alarmRecall: alarms.length > 0 ? matchedAlarmCount / alarms.length : null,
      },
      topFlaggedPoints,
      alarmActivations: alarms,
    };
  }
}
