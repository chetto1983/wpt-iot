import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../db/index.js', () => ({
  db: {
    execute: vi.fn(),
  },
}));

import { db } from '../db/index.js';
import { MachineAnomalyReplayService } from '../services/anomaly/index.js';

describe('MachineAnomalyReplayService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('replays historical rows and returns anomaly summary', async () => {
    vi.mocked(db.execute)
      .mockResolvedValueOnce({
        rows: [
          {
            timestamp: new Date('2026-01-01T00:00:00.000Z'),
            selected_cycle: 2,
            current_phase: 3,
            machine_status: 1,
            garbage_temp: 180,
            chamber_pressure: -0.8,
            main_motor_speed: 1200,
            main_motor_current: 45,
            main_motor_torque: 12.5,
            vacuum_pump_speed_01: 800,
            energy_consumption: 50,
            rms_curr_l1: 15,
            rms_curr_l2: 15,
            rms_curr_l3: 15,
            material_input_weight: 250,
            material_output_weight: 120,
          },
          ...Array.from({ length: 30 }, (_, index) => ({
            timestamp: new Date(Date.UTC(2026, 0, 1, 0, index + 1, 0)),
            selected_cycle: 2,
            current_phase: 3,
            machine_status: 1,
            garbage_temp: 180 + (index % 3) * 0.2,
            chamber_pressure: -0.8 + (index % 2) * 0.01,
            main_motor_speed: 1200 + (index % 4) * 2,
            main_motor_current: 45 + (index % 3) * 0.1,
            main_motor_torque: 12.5,
            vacuum_pump_speed_01: 800,
            energy_consumption: 50,
            rms_curr_l1: 15,
            rms_curr_l2: 15,
            rms_curr_l3: 15,
            material_input_weight: 250,
            material_output_weight: 120,
          })),
          {
            timestamp: new Date('2026-01-01T01:00:00.000Z'),
            selected_cycle: 2,
            current_phase: 3,
            machine_status: 1,
            garbage_temp: 240,
            chamber_pressure: 3,
            main_motor_speed: 1200,
            main_motor_current: 85,
            main_motor_torque: 28,
            vacuum_pump_speed_01: 980,
            energy_consumption: 65,
            rms_curr_l1: 20,
            rms_curr_l2: 20,
            rms_curr_l3: 20,
            material_input_weight: 250,
            material_output_weight: 120,
          },
          // 2 more anomalous rows to satisfy C4 persistence (N=3 flags in M=5 window)
          {
            timestamp: new Date('2026-01-01T01:01:00.000Z'),
            selected_cycle: 2,
            current_phase: 3,
            machine_status: 1,
            garbage_temp: 240,
            chamber_pressure: 3,
            main_motor_speed: 1200,
            main_motor_current: 85,
            main_motor_torque: 28,
            vacuum_pump_speed_01: 980,
            energy_consumption: 65,
            rms_curr_l1: 20,
            rms_curr_l2: 20,
            rms_curr_l3: 20,
            material_input_weight: 250,
            material_output_weight: 120,
          },
          {
            timestamp: new Date('2026-01-01T01:02:00.000Z'),
            selected_cycle: 2,
            current_phase: 3,
            machine_status: 1,
            garbage_temp: 241,
            chamber_pressure: 3.1,
            main_motor_speed: 1201,
            main_motor_current: 86,
            main_motor_torque: 29,
            vacuum_pump_speed_01: 981,
            energy_consumption: 66,
            rms_curr_l1: 21,
            rms_curr_l2: 21,
            rms_curr_l3: 21,
            material_input_weight: 250,
            material_output_weight: 120,
          },
        ],
      } as never)
      .mockResolvedValueOnce({
        rows: [{ activeCount: 2 }],
      } as never);

    const result = await MachineAnomalyReplayService.replay({
      from: new Date('2026-01-01T00:00:00.000Z'),
      to: new Date('2026-01-01T02:00:00.000Z'),
      // Shorter warmup + no grace period so the 31 pre-anomaly rows are
      // enough to saturate the sampleConfidence multiplier and the final
      // anomaly rows flag as CRITICAL. Production defaults (minReliable=200,
      // grace=30s) are tuned for live streams with millions of samples.
      detectorConfig: {
        minReliableSamples: 30,
        modeChangeGraceMs: 0,
      },
    });

    expect(result.tracking.replayedRows).toBe(34);
    expect(result.tracking.activeAlarmCount).toBe(2);
    expect(result.summary.flaggedRows).toBeGreaterThan(0);
    // C4 persistence filter (N=3 flags in M=5 window) needs 3 consecutive
    // rawFlagged=true before finalFlagged flips — so the first reported flag
    // is the 3rd anomalous row at 01:02:00, not the 1st at 01:00:00.
    expect(result.summary.firstFlaggedAt).toBe('2026-01-01T01:02:00.000Z');
    expect(result.topAnomalies[0]?.score).toBeGreaterThanOrEqual(3);
  });
});
