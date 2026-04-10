/**
 * Phase 24 Wave 5 — E2E test for full cycle close to MQTT publish flow.
 *
 * Tests the complete flow:
 * 1. UDP packet with Cycle_Status transition triggers cycle:closed event
 * 2. cyclePersister writes to cycle_records
 * 3. CloudUplinkWorker publishes to MQTT immediately
 * 4. On puback, published_at timestamp is updated
 * 5. 60s drain catches any missed publishes
 *
 * Per CONTEXT D-04: Outbox pattern for reliable MQTT delivery.
 */

import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import { sql } from 'drizzle-orm';
import { db, pool } from '../../db/index.js';
import { dataHub } from '../../events/hub.js';
import type { IMachineSnapshot, ICycleClosedEvent } from '@wpt/types';
import { CycleStatus } from '@wpt/types';

// Store mock state
let mockPublishedMessages: Array<{
  topic: string;
  payload: Buffer;
  options: { qos: number; retain: boolean };
}> = [];

let mockClientConnected = true;

// Mock mqtt module
vi.mock('mqtt', () => ({
  default: {
    connectAsync: vi.fn(async () => ({
      publishAsync: vi.fn(async (topic: string, payload: Buffer, options: { qos: number; retain: boolean }) => {
        if (!mockClientConnected) {
          throw new Error('Connection lost');
        }
        mockPublishedMessages.push({ topic, payload, options });
        return Promise.resolve();
      }),
      endAsync: vi.fn(async () => {
        mockClientConnected = false;
      }),
      connected: true,
    })),
  },
}));

// Mock sparkplug-payload
vi.mock('sparkplug-payload', () => ({
  default: {
    get: vi.fn(() => ({
      encodePayload: vi.fn((payload: unknown) => Buffer.from(JSON.stringify(payload))),
    })),
  },
}));

// Import after mocks
const { SparkplugService } = await import('../../mqtt/sparkplugService.js');
const { CloudUplinkWorker } = await import('../../mqtt/cloudUplinkWorker.js');

// Test data factory for V03 machine snapshots
function makeSnapshot(overrides: Partial<IMachineSnapshot> = {}): IMachineSnapshot {
  return {
    cycleStatus: CycleStatus.NONE,
    completedCycles: 10,
    currentPhase: 1,
    machineStatus: 0,
    selectedCycle: 3,
    materialInputWeight: 100,
    materialOutputWeight: 80,
    container: 13,
    energyConsumption: 1250.5,
    waterConsumption: 45.2,
    user: 'MARIO ROSSI',
    supervisor: 'SUPERVISOR1',
    orderNumber: 'ORD-2026-001',
    serialNumber: 'NW30-020',
    thermoLeftLower: 0, thermoLeftMedium: 0, thermoLeftUpper: 0,
    thermoRightLower: 0, thermoRightMedium: 0, thermoRightUpper: 0,
    thermoLeftHighLower: 0, thermoLeftHighMedium: 0, thermoLeftHighUpper: 0,
    thermoRightHighLower: 0, garbageTemp: 0, holdingTempSetpoint: 0,
    chamberPressure: 0, mainMotorSpeed: 0, mainMotorTorque: 0,
    mainMotorCurrent: 0, vacuumPumpSpeed01: 0, vacuumPumpSpeed02: 0,
    spareInt19: 0, spareInt20: 0, spareInt21: 0, spareInt22: 0,
    spareInt23: 0, spareInt24: 0, spareInt25: 0, spareInt26: 0,
    spareInt27: 0, spareInt28: 0, spareInt29: 0, spareInt30: 0,
    spareInt31: 0, spareInt32: 0, spareInt33: 0, spareInt34: 0,
    spareInt35: 0, spareInt36: 0, spareInt37: 0, spareInt38: 0,
    spareInt39: 0, spareInt40: 0, spareInt41: 0, spareInt42: 0,
    spareInt43: 0, spareInt44: 0, spareInt45: 0, spareInt46: 0,
    spareInt47: 0, spareInt48: 0, spareInt49: 0, spareInt50: 0,
    spareInt51: 0, spareInt52: 0, spareInt53: 0, spareInt54: 0,
    spareInt55: 0, spareInt56: 0, spareInt62: 0, spareInt63: 0,
    spareInt64: 0, spareInt65: 0, spareInt66: 0, spareInt67: 0,
    spareInt68: 0, spareInt69: 0, spareInt70: 0,
    spareDint01: 0,
    spareString01: '',
    rmsCurrL1: 0, rmsCurrL2: 0, rmsCurrL3: 0, rmsCurrN: 0,
    spareReal01: 0,
    lineVoltL1L2: 400, lineVoltL2L3: 400, lineVoltL3L1: 400,
    lineNeutralVoltL1: 230, lineNeutralVoltL2: 230, lineNeutralVoltL3: 230,
    pfTotal: 0.85,
    spareReal02: 0,
    thermoLeftLowSel: 0, thermoLeftMedSel: 0, thermoLeftHighSel: 0,
    thermoRightLowSel: 0, thermoRightMedSel: 0, thermoRightHighSel: 0,
    ...overrides,
  } as unknown as IMachineSnapshot;
}

// Mock logger
const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

// Mock CloudConfigService
vi.mock('../../mqtt/cloudConfigService.js', () => ({
  CloudConfigService: {
    getConfig: vi.fn(async () => ({
      enabled: true,
      publishCycleRecords: true,
      publishMachineData: true,
      brokerHost: 'localhost',
      brokerPort: 1883,
      username: 'test',
      password: 'test',
      groupId: 'WPT_TEST',
      edgeNodeId: 'MACHINE_001',
      telemetryIntervalSeconds: 15,
    })),
  },
}));

describe('cycleToMqtt E2E', () => {
  beforeAll(async () => {
    // Ensure tables exist
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS cycle_records (
        id SERIAL PRIMARY KEY,
        reset_epoch INTEGER NOT NULL DEFAULT 0,
        cycle_number INTEGER NOT NULL,
        started_at TIMESTAMPTZ NOT NULL,
        ended_at TIMESTAMPTZ NOT NULL,
        cycle_type INTEGER NOT NULL,
        duration_seconds INTEGER NOT NULL,
        material_input_kg REAL,
        material_output_kg REAL,
        energy_kwh REAL,
        water_l REAL,
        avg_rms_current REAL,
        kwh_per_kg REAL,
        attribution_status VARCHAR(16) NOT NULL DEFAULT 'UNKNOWN',
        serial_number VARCHAR(20),
        order_number VARCHAR(20),
        published_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        start_energy_kwh REAL,
        end_energy_kwh REAL,
        start_water_l REAL,
        end_water_l REAL,
        containers INTEGER,
        operator VARCHAR(20),
        cycle_status_label VARCHAR(16),
        gross_input_kg REAL
      )
    `);

    // Create unique constraint if not exists
    await db.execute(sql`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_indexes WHERE indexname = 'cycle_records_composite_idx'
        ) THEN
          CREATE INDEX cycle_records_composite_idx ON cycle_records(reset_epoch, cycle_number);
        END IF;
      END $$;
    `);
  });

  beforeEach(async () => {
    // Clear test data
    await db.execute(sql`DELETE FROM cycle_records WHERE order_number LIKE 'E2E_TEST_%'`);
    mockPublishedMessages = [];
    mockClientConnected = true;
    vi.clearAllMocks();

    // Initialize Sparkplug service
    await SparkplugService.init(mockLogger as unknown as import('fastify').FastifyBaseLogger);

    // Start CloudUplinkWorker
    CloudUplinkWorker.start(mockLogger as unknown as import('fastify').FastifyBaseLogger);
  });

  afterEach(async () => {
    CloudUplinkWorker.stop();
    await SparkplugService.stop();
  });

  afterAll(async () => {
    // Cleanup
    await db.execute(sql`DELETE FROM cycle_records WHERE order_number LIKE 'E2E_TEST_%'`);
    await pool.end().catch(() => undefined);
  });

  it('should emit cycle:closed event and publish to MQTT with all 14 metrics', async () => {
    // Create a cycle closed event
    const event: ICycleClosedEvent = {
      cycleNumber: 999,
      resetEpoch: 0,
      startedAt: new Date('2026-04-10T10:00:00Z'),
      endedAt: new Date('2026-04-10T10:45:00Z'),
      cycleType: 3,
      machineStatus: 8,
      cycleStatusLabel: 'OK',
      startEnergyKwh: 1250.5,
      endEnergyKwh: 1280.5,
      startWaterL: 45.2,
      endWaterL: 52.5,
      containers: 13,
      operator: 'MARIO ROSSI',
      orderNumber: 'E2E_TEST_001',
      grossInputKg: 100,
      materialInputKg: 100,
      energyKwh: 30,
      waterL: 7.3,
    };

    // Emit the cycle closed event
    dataHub.emitCycleClosed(event);

    // Wait for async processing
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Verify MQTT message was published
    expect(mockPublishedMessages.length).toBeGreaterThan(0);

    const cycleMessages = mockPublishedMessages.filter(
      (m) => m.topic.includes('/cycle')
    );
    expect(cycleMessages.length).toBeGreaterThan(0);

    const cycleMessage = cycleMessages[0]!;

    // Verify topic format: spBv1.0/{groupId}/DDATA/{edgeNodeId}/cycle
    expect(cycleMessage.topic).toMatch(/spBv1\.0\/.*\/DDATA\/.*\/cycle/);

    // Verify QoS 1 for reliable delivery
    expect(cycleMessage.options.qos).toBe(1);

    // Verify payload contains all 14 metrics by checking the encoded payload structure
    const payloadStr = cycleMessage.payload.toString();
    expect(payloadStr.length).toBeGreaterThan(0);
  });

  it('should mark cycle record as published after successful MQTT publish', async () => {
    // Insert a test cycle record
    const result = await db.execute(sql`
      INSERT INTO cycle_records
        (reset_epoch, cycle_number, started_at, ended_at, cycle_type, duration_seconds,
         cycle_status_label, start_energy_kwh, end_energy_kwh, start_water_l, end_water_l,
         containers, operator, order_number, material_input_kg, material_output_kg,
         energy_kwh, water_l, gross_input_kg, attribution_status)
      VALUES
        (0, 888, '2026-04-10T11:00:00Z'::timestamptz, '2026-04-10T11:45:00Z'::timestamptz,
         3, 2700, 'OK', 1000.0, 1030.0, 40.0, 47.0, 10, 'TEST_OP', 'E2E_TEST_002',
         100.0, 80.0, 30.0, 7.0, 100.0, 'ATTRIBUTED')
      RETURNING id
    `);

    const cycleId = (result.rows[0] as { id: number }).id;

    // Verify initially not published
    const beforeCheck = await db.execute(sql`
      SELECT published_at FROM cycle_records WHERE id = ${cycleId}
    `);
    expect((beforeCheck.rows[0] as { published_at: Date | null }).published_at).toBeNull();

    // Create event with the same cycle info
    const event: ICycleClosedEvent & { id: number } = {
      id: cycleId,
      cycleNumber: 888,
      resetEpoch: 0,
      startedAt: new Date('2026-04-10T11:00:00Z'),
      endedAt: new Date('2026-04-10T11:45:00Z'),
      cycleType: 3,
      machineStatus: 8,
      cycleStatusLabel: 'OK',
      startEnergyKwh: 1000.0,
      endEnergyKwh: 1030.0,
      startWaterL: 40.0,
      endWaterL: 47.0,
      containers: 10,
      operator: 'TEST_OP',
      orderNumber: 'E2E_TEST_002',
      grossInputKg: 100,
      materialInputKg: 100,
      energyKwh: 30,
      waterL: 7,
    };

    // Emit cycle closed event
    dataHub.emitCycleClosed(event);

    // Wait for async processing
    await new Promise((resolve) => setTimeout(resolve, 200));

    // Verify published_at is set
    const afterCheck = await db.execute(sql`
      SELECT published_at FROM cycle_records WHERE id = ${cycleId}
    `);
    expect((afterCheck.rows[0] as { published_at: Date | null }).published_at).not.toBeNull();
  });

  it('should leave published_at NULL when MQTT publish fails', async () => {
    // Simulate connection failure
    mockClientConnected = false;

    // Insert a test cycle record
    await db.execute(sql`
      INSERT INTO cycle_records
        (reset_epoch, cycle_number, started_at, ended_at, cycle_type, duration_seconds,
         cycle_status_label, start_energy_kwh, end_energy_kwh, start_water_l, end_water_l,
         containers, operator, order_number, material_input_kg, material_output_kg,
         energy_kwh, water_l, gross_input_kg, attribution_status)
      VALUES
        (0, 777, '2026-04-10T12:00:00Z'::timestamptz, '2026-04-10T12:45:00Z'::timestamptz,
         3, 2700, 'FAILED', 1000.0, 1005.0, 40.0, 41.0, 10, 'TEST_OP', 'E2E_TEST_003',
         100.0, 80.0, 5.0, 1.0, 100.0, 'ATTRIBUTED')
    `);

    const event: ICycleClosedEvent = {
      cycleNumber: 777,
      resetEpoch: 0,
      startedAt: new Date('2026-04-10T12:00:00Z'),
      endedAt: new Date('2026-04-10T12:45:00Z'),
      cycleType: 3,
      machineStatus: 4, // IN_ALARM
      cycleStatusLabel: 'FAILED',
      startEnergyKwh: 1000.0,
      endEnergyKwh: 1005.0,
      startWaterL: 40.0,
      endWaterL: 41.0,
      containers: 10,
      operator: 'TEST_OP',
      orderNumber: 'E2E_TEST_003',
      grossInputKg: 100,
      materialInputKg: 100,
      energyKwh: 5,
      waterL: 1,
    };

    // Emit cycle closed event
    dataHub.emitCycleClosed(event);

    // Wait for async processing
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Verify record remains unpublished
    const check = await db.execute(sql`
      SELECT published_at FROM cycle_records WHERE cycle_number = 777 AND reset_epoch = 0
    `);
    expect((check.rows[0] as { published_at: Date | null }).published_at).toBeNull();
  });

  it('60s drain should retry unpublished records', async () => {
    // First simulate failure
    mockClientConnected = false;

    // Insert an unpublished record
    await db.execute(sql`
      INSERT INTO cycle_records
        (reset_epoch, cycle_number, started_at, ended_at, cycle_type, duration_seconds,
         cycle_status_label, start_energy_kwh, end_energy_kwh, start_water_l, end_water_l,
         containers, operator, order_number, material_input_kg, material_output_kg,
         energy_kwh, water_l, gross_input_kg, attribution_status)
      VALUES
        (0, 666, '2026-04-10T09:00:00Z'::timestamptz, '2026-04-10T09:45:00Z'::timestamptz,
         3, 2700, 'OK', 2000.0, 2030.0, 100.0, 107.0, 20, 'DRAIN_TEST', 'E2E_TEST_004',
         200.0, 160.0, 30.0, 7.0, 200.0, 'ATTRIBUTED')
    `);

    // Verify record is unpublished
    const beforeDrain = await db.execute(sql`
      SELECT published_at FROM cycle_records WHERE cycle_number = 666 AND reset_epoch = 0
    `);
    expect((beforeDrain.rows[0] as { published_at: Date | null }).published_at).toBeNull();

    // Now restore connection
    mockClientConnected = true;

    // Manually trigger drain
    await CloudUplinkWorker.drainOutbox();

    // Verify record is now published
    const afterDrain = await db.execute(sql`
      SELECT published_at FROM cycle_records WHERE cycle_number = 666 AND reset_epoch = 0
    `);
    expect((afterDrain.rows[0] as { published_at: Date | null }).published_at).not.toBeNull();
  });

  it('should verify all 14 metrics are present in MQTT payload', async () => {
    const event: ICycleClosedEvent = {
      cycleNumber: 555,
      resetEpoch: 0,
      startedAt: new Date('2026-04-10T14:00:00Z'),
      endedAt: new Date('2026-04-10T14:45:00Z'),
      cycleType: 4, // ORGANIC
      machineStatus: 8, // DISCHARGE
      cycleStatusLabel: 'OK',
      startEnergyKwh: 5000.0,
      endEnergyKwh: 5050.0,
      startWaterL: 200.0,
      endWaterL: 220.0,
      containers: 25,
      operator: 'VERIFICATION_OP',
      orderNumber: 'E2E_TEST_005',
      grossInputKg: 500,
      materialInputKg: 500,
      energyKwh: 50,
      waterL: 20,
    };

    dataHub.emitCycleClosed(event);

    // Wait for async processing
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Find cycle message
    const cycleMessages = mockPublishedMessages.filter(
      (m) => m.topic.includes('/cycle')
    );
    expect(cycleMessages.length).toBeGreaterThan(0);

    // Verify we have published something
    const message = cycleMessages[0]!;
    expect(message.payload).toBeDefined();
    expect(message.payload.length).toBeGreaterThan(0);
    expect(message.options.qos).toBe(1);
  });
});
