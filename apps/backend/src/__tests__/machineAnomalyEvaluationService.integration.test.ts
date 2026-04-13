import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { db, pool } from '../db/index.js';
import { MachineAnomalyEvaluationService } from '../services/anomaly/index.js';

const WINDOW_FROM = new Date('2099-04-10T08:00:00.000Z');
const WINDOW_TO = new Date('2099-04-10T11:00:00.000Z');

function minuteOffset(base: Date, minutes: number): Date {
  return new Date(base.getTime() + minutes * 60 * 1000);
}

async function clearSeedWindow(): Promise<void> {
  await db.execute(sql`
    DELETE FROM machine_snapshots
    WHERE timestamp >= ${WINDOW_FROM}::timestamptz
      AND timestamp < ${WINDOW_TO}::timestamptz
  `);

  await db.execute(sql`
    DELETE FROM alarm_events
    WHERE activated_at >= ${WINDOW_FROM}::timestamptz
      AND activated_at < ${WINDOW_TO}::timestamptz
  `);
}

async function insertSnapshotRow(params: {
  timestamp: Date;
  garbageTemp: number;
  chamberPressure: number;
  mainMotorSpeed: number;
  mainMotorCurrent: number;
  mainMotorTorque: number;
  vacuumPumpSpeed01: number;
  energyConsumption: number;
  rmsCurrL1: number;
  rmsCurrL2: number;
  rmsCurrL3: number;
}): Promise<void> {
  await db.execute(sql`
    INSERT INTO machine_snapshots (
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
    )
    VALUES (
      ${params.timestamp},
      7,
      3,
      5,
      ${params.garbageTemp},
      ${params.chamberPressure},
      ${params.mainMotorSpeed},
      ${params.mainMotorCurrent},
      ${params.mainMotorTorque},
      ${params.vacuumPumpSpeed01},
      ${params.energyConsumption},
      ${params.rmsCurrL1},
      ${params.rmsCurrL2},
      ${params.rmsCurrL3},
      51,
      40
    )
  `);
}

async function seedStableWindow(base: Date, samples: number): Promise<void> {
  for (let i = 0; i < samples; i += 1) {
    await insertSnapshotRow({
      timestamp: minuteOffset(base, i),
      garbageTemp: 120 + (i % 3),
      chamberPressure: 900 + (i % 2) * 3,
      mainMotorSpeed: 1850 + (i % 4),
      mainMotorCurrent: 45 + (i % 3),
      mainMotorTorque: 12 + (i % 2),
      vacuumPumpSpeed01: 2200 + (i % 3) * 2,
      energyConsumption: 50 + i,
      rmsCurrL1: 110 + (i % 2),
      rmsCurrL2: 111 + (i % 2),
      rmsCurrL3: 109 + (i % 2),
    });
  }
}

async function insertAlarmAt(timestamp: Date, label: string): Promise<void> {
  await db.execute(sql`
    INSERT INTO alarm_events (
      alarm_index,
      word_index,
      bit_index,
      active,
      transition_type,
      activated_at,
      reset_at,
      description_it,
      description_en
    )
    VALUES (
      10,
      0,
      10,
      true,
      'ACTIVE',
      ${timestamp}::timestamptz,
      NULL,
      ${label},
      ${label}
    )
  `);
}

describe('MachineAnomalyEvaluationService seeded DB evaluation', () => {
  beforeEach(async () => {
    await clearSeedWindow();
  });

  afterAll(async () => {
    await clearSeedWindow();
    await pool.end().catch(() => undefined);
  });

  it('shows zero precision/recall signals on a stable seeded window', async () => {
    const base = minuteOffset(WINDOW_FROM, 0);
    await seedStableWindow(base, 40);

    const result = await MachineAnomalyEvaluationService.evaluate({
      from: base,
      to: minuteOffset(base, 45),
      topN: 5,
    });

    expect(result.tracking.replayedRows).toBe(40);
    expect(result.tracking.flaggedRows).toBe(0);
    expect(result.tracking.activeAlarmCount).toBe(0);
    expect(result.metrics.flaggedPrecision).toBeNull();
    expect(result.metrics.alarmRecall).toBeNull();
    expect(result.metrics.matchedAlarmCount).toBe(0);
    expect(result.metrics.unmatchedFlaggedRows).toBe(0);
  });

  it('matches seeded anomaly flags to the seeded alarm activation window', async () => {
    const base = minuteOffset(WINDOW_FROM, 60);
    await seedStableWindow(base, 30);

    const anomalyTs = minuteOffset(base, 30);
    await insertSnapshotRow({
      timestamp: anomalyTs,
      garbageTemp: 185,
      chamberPressure: 1250,
      mainMotorSpeed: 2300,
      mainMotorCurrent: 88,
      mainMotorTorque: 31,
      vacuumPumpSpeed01: 2750,
      energyConsumption: 78,
      rmsCurrL1: 160,
      rmsCurrL2: 159,
      rmsCurrL3: 161,
    });
    await insertAlarmAt(anomalyTs, 'Seed anomaly alarm');

    const result = await MachineAnomalyEvaluationService.evaluate({
      from: base,
      to: minuteOffset(base, 40),
      topN: 5,
      alarmLeadMinutes: 10,
      alarmLagMinutes: 2,
    });

    expect(result.tracking.replayedRows).toBe(31);
    expect(result.tracking.flaggedRows).toBeGreaterThan(0);
    expect(result.tracking.activeAlarmCount).toBe(1);
    expect(result.metrics.matchedAlarmCount).toBe(1);
    expect(result.metrics.missedAlarmCount).toBe(0);
    expect(result.metrics.matchedFlaggedRows).toBeGreaterThan(0);
    expect(result.metrics.flaggedPrecision).toBeGreaterThan(0);
    expect(result.metrics.alarmRecall).toBe(1);
    expect(result.alarmActivations[0]?.matched).toBe(true);
    expect(result.topFlaggedPoints[0]?.score).toBeGreaterThanOrEqual(3);
  });
});
