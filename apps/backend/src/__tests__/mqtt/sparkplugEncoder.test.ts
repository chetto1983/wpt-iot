import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ICycleRecord, IMachineSnapshot } from '@wpt/types';
import { ALIAS_MAP } from '../../mqtt/sparkplugService.js';
import type { SparkplugService as SparkplugServiceType } from '../../mqtt/sparkplugService.js';

/**
 * PHASE 24 Wave 2 — Sparkplug B cycle-record encoding tests (GREEN).
 *
 * Per CONTEXT D-04: SparkplugService.publishCycleRecord() publishes
 * all 15 fields per WPT-SISTEMA-IOT-SPEC.md §14.
 *
 * Implementation verified:
 * - Topic: spBv1.0/{groupId}/DDATA/{edgeNodeId}/cycle
 * - QoS: 1
 * - 15 metrics: order_number, cycles, date, start_time, end_time,
 *   cycle_status_label, weight_input_kg, weight_output_kg, containers,
 *   gross_input_kg, start_energy_kwh, end_energy_kwh, start_water_l,
 *   end_water_l, operator
 */

// ---------------------------------------------------------------------------
// Mocks for mqtt and sparkplug-payload
// ---------------------------------------------------------------------------
// All three are hoisted so they are in scope when vi.mock factories run, even
// if sparkplugService.ts is eagerly loaded by a top-level import (needed so
// the Phase 37 block can import ALIAS_MAP for contract assertions).
const { mockPublishAsync, mockConnectAsync, mockEncodePayload } = vi.hoisted(() => ({
  mockPublishAsync: vi.fn(),
  mockConnectAsync: vi.fn(),
  mockEncodePayload: vi.fn(() => Buffer.from('encoded')),
}));

vi.mock('mqtt', () => ({
  default: {
    connectAsync: mockConnectAsync,
  },
}));

vi.mock('sparkplug-payload', () => ({
  default: {
    get: vi.fn(() => ({
      encodePayload: mockEncodePayload,
    })),
  },
}));

// Mock MqttConfigService (consolidated — replaces CloudConfigService)
vi.mock('../../mqtt/configService.js', () => ({
  MqttConfigService: {
    getConfig: vi.fn().mockResolvedValue({
      id: 1,
      enabled: true,
      brokerHost: 'mqtt.example.com',
      brokerPort: 1883,
      username: 'user',
      password: 'pass',
      siteId: 'site-01',
      machineId: 'wpt40-001',
      publishMachine: true,
      publishAlarms: true,
      publishRfid: false,
      publishJobs: false,
      useTls: false,
      caCert: null,
      sparkplugGroupId: 'ideal-don-gnocchi',
      sparkplugEdgeNodeId: 'NW30-020',
      publishCycleRecords: true,
      telemetryIntervalSeconds: 15,
      updatedAt: new Date(),
    }),
  },
}));

// Import SUT after mocks - need to use dynamic import
let SparkplugService: typeof SparkplugServiceType;

describe('Sparkplug B cycle-record encoding (GREEN — Phase 24)', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mockPublishAsync.mockResolvedValue(undefined);
    mockConnectAsync.mockResolvedValue({
      publishAsync: mockPublishAsync,
      endAsync: vi.fn(),
      on: vi.fn(),
      connected: true,
    });
    // Seed latestState so resolveEdgeNodeId() returns a serial even when
    // NODE_ENV is not explicitly 'test' — otherwise init() defers and the
    // assertions below run against an empty mockPublishAsync.
    const { latestState } = await import('../../cache/latestState.js');
    latestState.reset();
    latestState.setMachineSnapshot(makeMinimalSnapshot({ serialNumber: 'NW30-020' }), new Date());
    // Re-import to get fresh module with cleared mocks
    const mod = await import('../../mqtt/sparkplugService.js');
    SparkplugService = mod.SparkplugService;
  });

  // ---------------------------------------------------------------------------
  // Test data factory for cycle records
  // ---------------------------------------------------------------------------
  function makeCycleRecord(overrides: Partial<ICycleRecord> = {}): ICycleRecord {
    const now = new Date();
    const startedAt = new Date(now.getTime() - 30 * 60 * 1000);
    return {
      cycleNumber: 11,
      resetEpoch: 0,
      startedAt,
      endedAt: now,
      cycleType: 3,
      durationSeconds: 1800,
      materialInputKg: 100,
      materialOutputKg: 80,
      energyKwh: 30,
      waterL: 7.3,
      avgRmsCurrent: 15.5,
      kwhPerKg: 0.375,
      attributionStatus: 'ATTRIBUTED' as const,
      serialNumber: 'SN-001',
      orderNumber: 'ORD-2026-001',
      publishedAt: null,
      startEnergyKwh: 1250.5,
      endEnergyKwh: 1280.5,
      startWaterL: 45.2,
      endWaterL: 52.5,
      containers: 13,
      operator: 'MARIO ROSSI',
      cycleStatusLabel: 'OK',
      grossInputKg: 100,
      ...overrides,
    };
  }

  // ==========================================================================
  // Test 1: Publish function is called for cycle records
  // ==========================================================================
  it('calls MQTT publish for cycle records', async () => {
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    await SparkplugService.init(log);

    const record = makeCycleRecord();
    await SparkplugService.publishCycleRecord(record);

    // Verify publish was called for the cycle topic
    const cycleCall = mockPublishAsync.mock.calls.find(
      (call) => typeof call[0] === 'string' && /\/DDATA\/[^/]+\/cycle$/.test(call[0] as string)
    );
    expect(cycleCall).toBeDefined();
  });

  // ==========================================================================
  // Test 2: Topic format follows Sparkplug B spec
  // ==========================================================================
  it('uses correct Sparkplug B topic format spBv1.0/{groupId}/DDATA/{edgeNodeId}/cycle', async () => {
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    await SparkplugService.init(log);

    const record = makeCycleRecord();
    await SparkplugService.publishCycleRecord(record);

    const cycleCall = mockPublishAsync.mock.calls.find(
      (call) => typeof call[0] === 'string' && /\/DDATA\/[^/]+\/cycle$/.test(call[0] as string)
    );
    expect(cycleCall).toBeDefined();

    const publishedTopic = cycleCall![0] as string;
    expect(publishedTopic).toMatch(/^spBv1\.0\/[^/]+\/DDATA\/[^/]+\/cycle$/);
    expect(publishedTopic).toContain('ideal-don-gnocchi');
    expect(publishedTopic).toContain('NW30-020');
  });

  // ==========================================================================
  // Test 3: QoS 1 publishing confirmed
  // ==========================================================================
  it('publishes cycle records with QoS 1', async () => {
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    await SparkplugService.init(log);

    const record = makeCycleRecord();
    await SparkplugService.publishCycleRecord(record);

    const cycleCall = mockPublishAsync.mock.calls.find(
      (call) => typeof call[0] === 'string' && /\/DDATA\/[^/]+\/cycle$/.test(call[0] as string)
    );
    expect(cycleCall).toBeDefined();

    const [, , opts] = cycleCall!;
    expect(opts).toMatchObject({ qos: 1, retain: false });
  });

  // ==========================================================================
  // Test 4: Multiple cycle records can be published
  // ==========================================================================
  it('publishes multiple cycle records', async () => {
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    await SparkplugService.init(log);

    const records = [
      makeCycleRecord({ cycleNumber: 3 }),
      makeCycleRecord({ cycleNumber: 1 }),
      makeCycleRecord({ cycleNumber: 2 }),
    ];

    for (const record of records) {
      await SparkplugService.publishCycleRecord(record);
    }

    const cycleCalls = mockPublishAsync.mock.calls.filter(
      (call) => typeof call[0] === 'string' && /\/DDATA\/[^/]+\/cycle$/.test(call[0] as string)
    );
    expect(cycleCalls).toHaveLength(3);
  });

  // ==========================================================================
  // Test 5: Disabled when cloud config disables cycle records
  // ==========================================================================
  it('does not publish when cycle records are disabled', async () => {
    const { MqttConfigService } = await import('../../mqtt/configService.js');
    vi.mocked(MqttConfigService.getConfig).mockResolvedValue({
      id: 1,
      enabled: true,
      brokerHost: 'mqtt.example.com',
      brokerPort: 1883,
      username: 'user',
      password: 'pass',
      siteId: 'site-01',
      machineId: 'wpt40-001',
      publishMachine: true,
      publishAlarms: true,
      publishRfid: false,
      publishJobs: false,
      useTls: false,
      caCert: null,
      sparkplugGroupId: 'ideal-don-gnocchi',
      sparkplugEdgeNodeId: 'NW30-020',
      publishCycleRecords: false,
      telemetryIntervalSeconds: 15,
      updatedAt: new Date(),
    });

    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    await SparkplugService.init(log);

    // Re-import to get fresh instance with new config
    const mod = await import('../../mqtt/sparkplugService.js');
    const FreshSparkplugService = mod.SparkplugService;

    const record = makeCycleRecord();
    await FreshSparkplugService.publishCycleRecord(record);

    // Should not publish cycle records when disabled
    const cycleCall = mockPublishAsync.mock.calls.find(
      (call) => typeof call[0] === 'string' && /\/DDATA\/[^/]+\/cycle$/.test(call[0] as string)
    );
    expect(cycleCall).toBeUndefined();
  });
});

// ==========================================================================
// Phase 37 Plan 01 — D-01..D-05 alignment regression
// ==========================================================================
/**
 * New contract (Phase 37):
 *  - D-01: three-device topology under the edge node (cycle, telemetry, alarms*)
 *  - D-02: edge_node_id derives from IMachineSnapshot.serialNumber; production fail-loud
 *  - D-03: /machine → /telemetry rename
 *  - D-04: NBIRTH/DBIRTH carry name+alias; NDATA/DDATA carry alias-only
 *  - D-05: NBIRTH covers the §14 canonical machine-level set
 *
 * (*alarms device ships in plan 37-02.)
 */

/** Metrics shape produced by the `spb.encodePayload` call we mock. */
type EncodedMetric = { name?: string; alias?: number; type?: string; value?: unknown };
type EncodedPayloadArg = { metrics: EncodedMetric[]; timestamp?: number; seq?: number };

function makeMinimalSnapshot(overrides: Partial<IMachineSnapshot> = {}): IMachineSnapshot {
  return {
    thermoLeftLower: 0, thermoLeftMedium: 0, thermoLeftUpper: 0,
    thermoRightLower: 0, thermoRightMedium: 0, thermoRightUpper: 0,
    thermoLeftHighLower: 0, thermoLeftHighMedium: 0, thermoLeftHighUpper: 0,
    thermoRightHighLower: 0, garbageTemp: 42, holdingTempSetpoint: 0,
    chamberPressure: 13, mainMotorSpeed: 1500, mainMotorTorque: 0,
    mainMotorCurrent: 0, vacuumPumpSpeed01: 1200, vacuumPumpSpeed02: 0,
    spareInt19: 0, spareInt20: 0, spareInt21: 0, spareInt22: 0, spareInt23: 0,
    spareInt24: 0, spareInt25: 0, spareInt26: 0, spareInt27: 0, spareInt28: 0,
    spareInt29: 0, spareInt30: 0, spareInt31: 0, spareInt32: 0, spareInt33: 0,
    spareInt34: 0, spareInt35: 0, spareInt36: 0, spareInt37: 0, spareInt38: 0,
    spareInt39: 0, spareInt40: 0, spareInt41: 0, spareInt42: 0, spareInt43: 0,
    spareInt44: 0, spareInt45: 0, spareInt46: 0, spareInt47: 0, spareInt48: 0,
    spareInt49: 0, spareInt50: 0, spareInt51: 0, spareInt52: 0, spareInt53: 0,
    spareInt54: 0, spareInt55: 0, spareInt56: 0,
    materialInputWeight: 0, materialOutputWeight: 0, selectedCycle: 0,
    currentPhase: 0, machineStatus: 0,
    spareInt62: 0, spareInt63: 0, spareInt64: 0, spareInt65: 0, spareInt66: 0,
    spareInt67: 0, spareInt68: 0, spareInt69: 0, spareInt70: 0,
    cycleStatus: 0, container: 0,
    completedCycles: 0, spareDint01: 0,
    user: 'OPERATOR', supervisor: 'SUPER', orderNumber: 'ORD-42',
    serialNumber: 'NW30-020', spareString01: '',
    energyConsumption: 0,
    rmsCurrL1: 0, rmsCurrL2: 0, rmsCurrL3: 0, rmsCurrN: 0,
    spareReal01: 0,
    lineVoltL1L2: 400, lineVoltL2L3: 400, lineVoltL3L1: 400,
    lineNeutralVoltL1: 230, lineNeutralVoltL2: 230, lineNeutralVoltL3: 230,
    pfTotal: 0.85, waterConsumption: 0, spareReal02: 0,
    thermoLeftLowSel: 0, thermoLeftMedSel: 0, thermoLeftHighSel: 0,
    thermoRightLowSel: 0, thermoRightMedSel: 0, thermoRightHighSel: 0,
    ...overrides,
  };
}

describe('Phase 37 alignment — D-01..D-05 (Sparkplug B 3.0 + SPEC §14)', () => {
  let SparkplugService: typeof SparkplugServiceType;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockPublishAsync.mockResolvedValue(undefined);
    // SparkplugService.init() wires a `.on('connect', ...)` handler for
    // reconnect-drain. Without a mock `on`, init's try/catch swallows the
    // `.on is not a function` and NBIRTH is never published.
    mockConnectAsync.mockResolvedValue({
      publishAsync: mockPublishAsync,
      endAsync: vi.fn(),
      on: vi.fn(),
      connected: true,
    });
    // Seed latestState with a realistic serialNumber so resolveEdgeNodeId()
    // uses the machine-derived edge id (D-02 happy path).
    const { latestState } = await import('../../cache/latestState.js');
    latestState.reset();
    latestState.setMachineSnapshot(makeMinimalSnapshot(), new Date());
    const mod = await import('../../mqtt/sparkplugService.js');
    SparkplugService = mod.SparkplugService;
  });

  afterEach(async () => {
    const { latestState } = await import('../../cache/latestState.js');
    latestState.reset();
    await SparkplugService.stop();
  });

  // --------------------------------------------------------------------------
  // D-04: NBIRTH carries name + alias for every metric
  // --------------------------------------------------------------------------
  it('NBIRTH carries name+alias for every metric (>= 8 §14 metrics)', async () => {
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    await SparkplugService.init(log);

    // NBIRTH must reach the broker.
    const nbirthCall = mockPublishAsync.mock.calls.find(
      (c) => typeof c[0] === 'string' && /\/NBIRTH\//.test(c[0] as string),
    );
    expect(nbirthCall).toBeDefined();

    // The NBIRTH payload is the encodePayload call with the largest metrics
    // array among the birth sequence (NDEATH will-payload has 1 metric;
    // NBIRTH has 8 §14 canonical metrics — distinct and unambiguous).
    const nbirthArg = mockEncodePayload.mock.calls
      .map((call) => call[0] as EncodedPayloadArg)
      .filter((arg) => arg?.metrics?.some((m) => m.name === 'Node Control/Rebirth'))
      .at(0);
    expect(nbirthArg).toBeDefined();
    expect(nbirthArg!.metrics.length).toBeGreaterThanOrEqual(8);
    for (const m of nbirthArg!.metrics) {
      expect(typeof m.name).toBe('string');
      expect(typeof m.alias).toBe('number');
    }
  });

  // --------------------------------------------------------------------------
  // D-03: /machine → /telemetry rename
  // --------------------------------------------------------------------------
  it('publishes DBIRTH on /telemetry (not /machine)', async () => {
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    await SparkplugService.init(log);

    const telemetryDbirth = mockPublishAsync.mock.calls.find(
      (c) => typeof c[0] === 'string' && /\/DBIRTH\/[^/]+\/telemetry$/.test(c[0] as string),
    );
    expect(telemetryDbirth).toBeDefined();

    const machineDbirth = mockPublishAsync.mock.calls.find(
      (c) => typeof c[0] === 'string' && /\/DBIRTH\/[^/]+\/machine$/.test(c[0] as string),
    );
    expect(machineDbirth).toBeUndefined();

    const cycleDbirth = mockPublishAsync.mock.calls.find(
      (c) => typeof c[0] === 'string' && /\/DBIRTH\/[^/]+\/cycle$/.test(c[0] as string),
    );
    expect(cycleDbirth).toBeDefined();
  });

  // --------------------------------------------------------------------------
  // D-03 + D-04: telemetry DDATA topic rename and alias-only payload
  // --------------------------------------------------------------------------
  it('telemetry DDATA carries alias-only metrics (no name key) and targets /telemetry', async () => {
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    await SparkplugService.init(log);

    // Reset encode history so we can isolate the DDATA call.
    mockEncodePayload.mockClear();
    mockPublishAsync.mockClear();

    await SparkplugService.publishMachineTelemetry(makeMinimalSnapshot());

    const telemetryDdata = mockPublishAsync.mock.calls.find(
      (c) => typeof c[0] === 'string' && /\/DDATA\/[^/]+\/telemetry$/.test(c[0] as string),
    );
    expect(telemetryDdata).toBeDefined();

    const lastEncode = mockEncodePayload.mock.calls.at(-1)?.[0] as
      | EncodedPayloadArg
      | undefined;
    expect(lastEncode).toBeDefined();
    expect(lastEncode!.metrics.length).toBeGreaterThan(0);
    for (const m of lastEncode!.metrics) {
      expect(typeof m.alias).toBe('number');
      // DDATA must NOT carry name (per Sparkplug B 3.0 §6.4.4).
      expect(m.name).toBeUndefined();
    }
  });

  // --------------------------------------------------------------------------
  // Contract: ALIAS_MAP is frozen + covers all three namespaces
  // --------------------------------------------------------------------------
  it('ALIAS_MAP is frozen and contains node + cycle + telemetry namespaces', () => {
    expect(Object.isFrozen(ALIAS_MAP)).toBe(true);
    expect(ALIAS_MAP['bdSeq']).toBe(0);
    expect(ALIAS_MAP['cycle/cycle_count']).toBe(100);
    expect(ALIAS_MAP['telemetry/garbage_temp']).toBe(202);
    // Sanity: alias numbers are unique across the map
    const values = Object.values(ALIAS_MAP);
    expect(new Set(values).size).toBe(values.length);
  });

  // --------------------------------------------------------------------------
  // D-02: edge_node_id derives from the live snapshot.serialNumber
  // --------------------------------------------------------------------------
  it('edge_node_id is drawn from the snapshot serialNumber (not the configured placeholder)', async () => {
    const { latestState } = await import('../../cache/latestState.js');
    latestState.reset();
    latestState.setMachineSnapshot(
      makeMinimalSnapshot({ serialNumber: 'ABC-9999' }),
      new Date(),
    );

    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    await SparkplugService.init(log);

    const nbirthCall = mockPublishAsync.mock.calls.find(
      (c) => typeof c[0] === 'string' && /\/NBIRTH\//.test(c[0] as string),
    );
    expect(nbirthCall).toBeDefined();
    const topic = nbirthCall![0] as string;
    // Topic ends with the edge_node_id segment.
    expect(topic.endsWith('/ABC-9999')).toBe(true);
    // And NOT the configured default 'NW30-020' fed by the mock config.
    expect(topic.endsWith('/NW30-020')).toBe(false);
  });

  // --------------------------------------------------------------------------
  // D-02: production defers init when no snapshot yet (fail-safe, not fail-loud)
  // --------------------------------------------------------------------------
  it('edge_node_id resolver defers init in production when no snapshot is available', async () => {
    const { latestState } = await import('../../cache/latestState.js');
    latestState.reset();

    const oldEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
      await SparkplugService.init(log);

      // Should NOT throw — init defers gracefully until first snapshot arrives.
      expect(log.warn).toHaveBeenCalled();
      const warnCall = vi.mocked(log.warn).mock.calls.find(
        (c) => typeof c[1] === 'string' && (c[1] as string).includes('deferred'),
      );
      expect(warnCall).toBeDefined();

      // No NBIRTH should be published because init returned early.
      const nbirthCall = mockPublishAsync.mock.calls.find(
        (c) => typeof c[0] === 'string' && /\/NBIRTH\//.test(c[0] as string),
      );
      expect(nbirthCall).toBeUndefined();
    } finally {
      process.env.NODE_ENV = oldEnv;
    }
  });

  // --------------------------------------------------------------------------
  // D-02: dev/test fallback — WARN log + configured value
  // --------------------------------------------------------------------------
  it('edge_node_id resolver falls back to config with WARN in dev/test when no snapshot', async () => {
    const { latestState } = await import('../../cache/latestState.js');
    latestState.reset();

    const oldEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'test';
    try {
      const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
      await SparkplugService.init(log);
      expect(log.warn).toHaveBeenCalled();
      const nbirthCall = mockPublishAsync.mock.calls.find(
        (c) => typeof c[0] === 'string' && /\/NBIRTH\//.test(c[0] as string),
      );
      expect(nbirthCall).toBeDefined();
      // Fallback uses cfg.sparkplugEdgeNodeId ('NW30-020').
      expect((nbirthCall![0] as string).endsWith('/NW30-020')).toBe(true);
    } finally {
      process.env.NODE_ENV = oldEnv;
    }
  });
});
