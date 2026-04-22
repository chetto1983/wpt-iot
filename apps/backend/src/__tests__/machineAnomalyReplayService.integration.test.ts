import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { db, pool } from '../db/index.js';
import { MachineAnomalyReplayService } from '../services/anomaly/index.js';

const WINDOW_FROM = new Date('2099-04-09T08:00:00.000Z');
const WINDOW_TO = new Date('2099-04-09T11:00:00.000Z');

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
  materialInputWeight?: number;
  materialOutputWeight?: number;
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
      ${params.materialInputWeight ?? 51},
      ${params.materialOutputWeight ?? 40}
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

describe('MachineAnomalyReplayService seeded DB validation', () => {
  beforeEach(async () => {
    await clearSeedWindow();
  });

  afterAll(async () => {
    await clearSeedWindow();
    await pool.end().catch(() => undefined);
  });

  it('keeps stable seeded telemetry below anomaly threshold', async () => {
    const base = minuteOffset(WINDOW_FROM, 0);
    await seedStableWindow(base, 40);

    const result = await MachineAnomalyReplayService.replay({
      from: base,
      to: minuteOffset(base, 45),
      topN: 5,
    });

    expect(result.tracking.replayedRows).toBe(40);
    expect(result.tracking.activeAlarmCount).toBe(0);
    expect(result.summary.flaggedRows).toBe(0);
    expect(result.summary.maxScore).toBeLessThan(3);
    expect(Number.isFinite(result.summary.maxScore)).toBe(true);
  });

  it('flags a seeded anomaly spike with finite replay scores', async () => {
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
    // 2 more anomalous rows to satisfy C4 persistence (N=3 flags in M=5 window)
    await insertSnapshotRow({
      timestamp: minuteOffset(anomalyTs, 1),
      garbageTemp: 186,
      chamberPressure: 1251,
      mainMotorSpeed: 2301,
      mainMotorCurrent: 89,
      mainMotorTorque: 32,
      vacuumPumpSpeed01: 2751,
      energyConsumption: 79,
      rmsCurrL1: 161,
      rmsCurrL2: 160,
      rmsCurrL3: 162,
    });
    await insertSnapshotRow({
      timestamp: minuteOffset(anomalyTs, 2),
      garbageTemp: 187,
      chamberPressure: 1252,
      mainMotorSpeed: 2302,
      mainMotorCurrent: 90,
      mainMotorTorque: 33,
      vacuumPumpSpeed01: 2752,
      energyConsumption: 80,
      rmsCurrL1: 162,
      rmsCurrL2: 161,
      rmsCurrL3: 163,
    });

    await insertAlarmAt(anomalyTs, 'Seed anomaly alarm');

    const result = await MachineAnomalyReplayService.replay({
      from: base,
      to: minuteOffset(base, 40),
      topN: 5,
      // Match the scenario + unit-test conventions — 33 rows cannot
      // saturate minReliableSamples=200, and the run is too fast for the
      // 30s grace period to elapse naturally.
      detectorConfig: { minReliableSamples: 30, modeChangeGraceMs: 0 },
    });

    expect(result.tracking.replayedRows).toBe(33);
    expect(result.tracking.activeAlarmCount).toBe(1);
    expect(result.summary.flaggedRows).toBeGreaterThan(0);
    // C4 persistence filter (N=3 flags in M=5 window) — first finalFlagged
    // lands on the 3rd consecutive anomalous row (anomalyTs + 2 minutes),
    // not the 1st. Keep `topAnomalies[0]` pinned to the primary anomaly
    // timestamp since topAnomalies is ranked by score, not time.
    expect(result.summary.firstFlaggedAt).toBe(minuteOffset(anomalyTs, 2).toISOString());
    expect(result.summary.maxScore).toBeGreaterThanOrEqual(3);
    expect(result.summary.maxScore).toBeLessThanOrEqual(25);
    expect(Number.isFinite(result.summary.maxScore)).toBe(true);
    expect(result.topAnomalies[0]?.observedAt).toBe(anomalyTs.toISOString());
    expect(result.topAnomalies[0]?.topContributors.length).toBeGreaterThan(0);
  });

  it('adapts to gradual seeded drift without treating the whole window as anomalous', async () => {
    const base = minuteOffset(WINDOW_FROM, 120);

    for (let i = 0; i < 50; i += 1) {
      await insertSnapshotRow({
        timestamp: minuteOffset(base, i),
        garbageTemp: 120 + Math.floor(i / 5),
        chamberPressure: 900 + Math.floor(i / 8),
        mainMotorSpeed: 1850 + Math.floor(i / 10),
        mainMotorCurrent: 45 + Math.floor(i / 12),
        mainMotorTorque: 12 + Math.floor(i / 15),
        vacuumPumpSpeed01: 2200 + Math.floor(i / 10),
        energyConsumption: 50 + i,
        rmsCurrL1: 110 + Math.floor(i / 20),
        rmsCurrL2: 111 + Math.floor(i / 20),
        rmsCurrL3: 109 + Math.floor(i / 20),
      });
    }

    const result = await MachineAnomalyReplayService.replay({
      from: base,
      to: minuteOffset(base, 55),
      topN: 5,
    });

    expect(result.tracking.replayedRows).toBe(50);
    expect(result.tracking.activeAlarmCount).toBe(0);
    expect(result.summary.flaggedRows).toBe(0);
    expect(result.summary.maxScore).toBeLessThan(3);
    expect(Number.isFinite(result.summary.maxScore)).toBe(true);
  });
});
