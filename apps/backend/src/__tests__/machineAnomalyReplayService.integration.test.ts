import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { db, pool } from '../db/index.js';
import { MachineAnomalyReplayService } from '../services/machineAnomalyReplayService.js';

const WINDOW_FROM = new Date('2099-04-09T08:00:00.000Z');
const WINDOW_TO = new Date('2099-04-09T09:00:00.000Z');

describe('MachineAnomalyReplayService seeded replay', () => {
  beforeEach(async () => {
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
  });

  afterAll(async () => {
    await pool.end().catch(() => undefined);
  });

  it('flags a seeded anomaly spike with finite replay scores', async () => {
    for (let i = 0; i < 30; i += 1) {
      const ts = new Date(WINDOW_FROM.getTime() + i * 60 * 1000);
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
          ${ts},
          7,
          3,
          5,
          ${120 + (i % 3)},
          ${900 + (i % 2) * 3},
          ${1850 + (i % 4)},
          ${45 + (i % 3)},
          ${12 + (i % 2)},
          ${2200 + (i % 3) * 2},
          ${50 + i},
          ${110 + (i % 2)},
          ${111 + (i % 2)},
          ${109 + (i % 2)},
          51,
          40
        )
      `);
    }

    const anomalyTs = new Date(WINDOW_FROM.getTime() + 30 * 60 * 1000);
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
        ${anomalyTs},
        7,
        3,
        5,
        185,
        1250,
        2300,
        88,
        31,
        2750,
        78,
        160,
        159,
        161,
        51,
        40
      )
    `);

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
        ${anomalyTs}::timestamptz,
        NULL,
        'Allarme seed anomalia',
        'Seed anomaly alarm'
      )
    `);

    const result = await MachineAnomalyReplayService.replay({
      from: WINDOW_FROM,
      to: WINDOW_TO,
      topN: 5,
    });

    expect(result.tracking.replayedRows).toBe(31);
    expect(result.tracking.activeAlarmCount).toBe(1);
    expect(result.summary.flaggedRows).toBeGreaterThan(0);
    expect(result.summary.firstFlaggedAt).toBe(anomalyTs.toISOString());
    expect(result.summary.maxScore).toBeGreaterThanOrEqual(3);
    expect(result.summary.maxScore).toBeLessThanOrEqual(25);
    expect(Number.isFinite(result.summary.maxScore)).toBe(true);
    expect(result.topAnomalies[0]?.observedAt).toBe(anomalyTs.toISOString());
    expect(result.topAnomalies[0]?.topContributors.length).toBeGreaterThan(0);
  });
});
