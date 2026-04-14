import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { IMachineSnapshot } from '@wpt/types';
import type { IAlarmTransition } from '../../events/types.js';
import { ALIAS_MAP } from '../../mqtt/sparkplugService.js';
import type { SparkplugService as SparkplugServiceType } from '../../mqtt/sparkplugService.js';

/**
 * PHASE 37 Plan 02 — Alarms Sparkplug device (D-06).
 *
 * Contract under test:
 *  - publishBirths() emits a DBIRTH on `spBv1.0/{group}/DBIRTH/{edge}/alarms`
 *    with 44 metrics: 40 Int32 word values + 4 last_event metrics.
 *  - publishAlarmsDDATA(transitions: IAlarmTransition[]) emits DDATA on
 *    `spBv1.0/{group}/DDATA/{edge}/alarms` with QoS 1, carrying ONLY the
 *    word metrics that changed since the previous bitmask, plus 4
 *    last_event metrics derived from the final transition in the batch.
 *  - Empty transitions batch => no-op.
 *  - cfg.enabled === false => no-op.
 *  - DDATA metrics are alias-only (per Sparkplug B 3.0 §6.4.4).
 *
 * Bitmask layout: alarms/word_0..alarms/word_39 (alias 300..339),
 * alarms/last_event_code (340), alarms/last_event_state (341),
 * alarms/last_event_at (342), alarms/active_count (343).
 *
 * Decision: bitmask-per-word (40 metrics) chosen over bit-per-metric (640)
 * — see 37-02-PLAN.md header justification.
 */

// ---------------------------------------------------------------------------
// Hoisted mocks — sparkplugService.ts is eagerly imported at module load so
// these bindings must be in scope when vi.mock factories run.
// ---------------------------------------------------------------------------
const { mockPublishAsync, mockConnectAsync, mockEncodePayload, mockGetActiveAlarmIndices } = vi.hoisted(() => ({
  mockPublishAsync: vi.fn(),
  mockConnectAsync: vi.fn(),
  mockEncodePayload: vi.fn(() => Buffer.from('encoded')),
  mockGetActiveAlarmIndices: vi.fn<() => Promise<number[]>>(),
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

vi.mock('../../persistence/alarmStore.js', () => ({
  getActiveAlarmIndices: mockGetActiveAlarmIndices,
}));

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

/** Locate the latest encodePayload call whose payload targets the /alarms DBIRTH topic. */
function findAlarmsDbirthPayload(): EncodedPayloadArg | undefined {
  // Find publish-call index on alarms DBIRTH, then pick the matching encode payload
  const alarmsDbirthCallIndex = mockPublishAsync.mock.calls.findIndex(
    (c) => typeof c[0] === 'string' && /\/DBIRTH\/[^/]+\/alarms$/.test(c[0] as string),
  );
  if (alarmsDbirthCallIndex < 0) return undefined;
  // encodePayload happens 1:1 with publishAsync (NBIRTH + DBIRTHs each emit one
  // encode→publish pair, plus one NDEATH encode up front for the will payload).
  // Safer: locate by metric-shape signature (contains alarms/word_0 name).
  const match = mockEncodePayload.mock.calls
    .map((c) => c[0] as EncodedPayloadArg)
    .find((arg) => arg?.metrics?.some((m) => m.name === 'alarms/word_0'));
  return match;
}

describe('Phase 37 Plan 02 — alarms Sparkplug device (D-06)', () => {
  let SparkplugService: typeof SparkplugServiceType;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockPublishAsync.mockResolvedValue(undefined);
    mockConnectAsync.mockResolvedValue({
      publishAsync: mockPublishAsync,
      endAsync: vi.fn(),
    });
    mockGetActiveAlarmIndices.mockResolvedValue([]);
    mockEncodePayload.mockImplementation(() => Buffer.from('encoded'));

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
  // Contract: ALIAS_MAP exposes the 44 alarms entries at alias 300..343
  // --------------------------------------------------------------------------
  it('ALIAS_MAP exposes 44 alarms entries (300..339 words, 340..343 last_event/count)', () => {
    for (let w = 0; w < 40; w++) {
      expect(ALIAS_MAP[`alarms/word_${w}`]).toBe(300 + w);
    }
    expect(ALIAS_MAP['alarms/last_event_code']).toBe(340);
    expect(ALIAS_MAP['alarms/last_event_state']).toBe(341);
    expect(ALIAS_MAP['alarms/last_event_at']).toBe(342);
    expect(ALIAS_MAP['alarms/active_count']).toBe(343);
  });

  // --------------------------------------------------------------------------
  // 1. DBIRTH /alarms carries 44 metrics with name + alias (Sparkplug B §6.4.4)
  // --------------------------------------------------------------------------
  it('publishes DBIRTH on /alarms with 44 metrics (40 word + 4 last_event)', async () => {
    mockGetActiveAlarmIndices.mockResolvedValue([]);
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    await SparkplugService.init(log);

    const alarmsDbirthCall = mockPublishAsync.mock.calls.find(
      (c) => typeof c[0] === 'string' && /\/DBIRTH\/[^/]+\/alarms$/.test(c[0] as string),
    );
    expect(alarmsDbirthCall).toBeDefined();

    const payload = findAlarmsDbirthPayload();
    expect(payload).toBeDefined();
    expect(payload!.metrics).toHaveLength(44);

    // Every metric carries both name and alias (DBIRTH contract).
    for (const m of payload!.metrics) {
      expect(typeof m.name).toBe('string');
      expect(typeof m.alias).toBe('number');
    }

    // Check the canonical names are present.
    const names = payload!.metrics.map((m) => m.name);
    expect(names).toContain('alarms/word_0');
    expect(names).toContain('alarms/word_39');
    expect(names).toContain('alarms/last_event_code');
    expect(names).toContain('alarms/last_event_state');
    expect(names).toContain('alarms/last_event_at');
    expect(names).toContain('alarms/active_count');
  });

  // --------------------------------------------------------------------------
  // 2. DBIRTH word values reflect getActiveAlarmIndices() initial state
  // --------------------------------------------------------------------------
  it('DBIRTH word values reflect getActiveAlarmIndices initial state', async () => {
    // alarmIndex 3 => word 0 bit 3 (value 0b1000 = 8)
    // alarmIndex 17 => word 1 bit 1 (value 0b10 = 2)
    mockGetActiveAlarmIndices.mockResolvedValue([3, 17]);
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    await SparkplugService.init(log);

    const payload = findAlarmsDbirthPayload();
    expect(payload).toBeDefined();

    const word0 = payload!.metrics.find((m) => m.name === 'alarms/word_0');
    const word1 = payload!.metrics.find((m) => m.name === 'alarms/word_1');
    const word2 = payload!.metrics.find((m) => m.name === 'alarms/word_2');
    const activeCount = payload!.metrics.find((m) => m.name === 'alarms/active_count');

    expect(word0?.value).toBe(0b1000); // bit 3 set => 8
    expect(word1?.value).toBe(0b10);   // bit 1 set => 2
    expect(word2?.value).toBe(0);
    expect(activeCount?.value).toBe(2);
  });

  // --------------------------------------------------------------------------
  // 3. publishAlarmsDDATA emits only changed words (delta semantics)
  // --------------------------------------------------------------------------
  it('publishAlarmsDDATA emits only changed words (delta semantics)', async () => {
    // Seed: active = [3, 17] (word 0 bit 3, word 1 bit 1)
    mockGetActiveAlarmIndices.mockResolvedValue([3, 17]);
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    await SparkplugService.init(log);

    // Clear init-time publishes.
    mockPublishAsync.mockClear();
    mockEncodePayload.mockClear();

    // New active: add alarm at word 5 bit 2 (index 82) — only word_5 changes.
    // 82 / 16 = 5, 82 % 16 = 2 -> word_5 = 0b100 = 4
    mockGetActiveAlarmIndices.mockResolvedValue([3, 17, 82]);

    const transitions: IAlarmTransition[] = [
      { alarmIndex: 82, wordIndex: 5, bitIndex: 2, active: true, timestamp: new Date('2026-04-14T12:00:00Z') },
    ];
    await SparkplugService.publishAlarmsDDATA(transitions);

    const ddataCall = mockPublishAsync.mock.calls.find(
      (c) => typeof c[0] === 'string' && /\/DDATA\/[^/]+\/alarms$/.test(c[0] as string),
    );
    expect(ddataCall).toBeDefined();

    const lastEncode = mockEncodePayload.mock.calls.at(-1)?.[0] as EncodedPayloadArg | undefined;
    expect(lastEncode).toBeDefined();

    // Expect exactly 1 word metric (word_5) + 4 last_event metrics = 5 metrics.
    expect(lastEncode!.metrics).toHaveLength(5);

    // word_5 should be present with alias 305.
    const word5Metric = lastEncode!.metrics.find((m) => m.alias === ALIAS_MAP['alarms/word_5']);
    expect(word5Metric).toBeDefined();
    expect(word5Metric!.value).toBe(0b100); // bit 2 set
  });

  // --------------------------------------------------------------------------
  // 4. publishAlarmsDDATA uses QoS 1
  // --------------------------------------------------------------------------
  it('publishAlarmsDDATA uses QoS 1 (per §14 alarm reliability mandate)', async () => {
    mockGetActiveAlarmIndices.mockResolvedValue([]);
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    await SparkplugService.init(log);

    mockPublishAsync.mockClear();
    mockGetActiveAlarmIndices.mockResolvedValue([5]);

    const transitions: IAlarmTransition[] = [
      { alarmIndex: 5, wordIndex: 0, bitIndex: 5, active: true, timestamp: new Date() },
    ];
    await SparkplugService.publishAlarmsDDATA(transitions);

    const ddataCall = mockPublishAsync.mock.calls.find(
      (c) => typeof c[0] === 'string' && /\/DDATA\/[^/]+\/alarms$/.test(c[0] as string),
    );
    expect(ddataCall).toBeDefined();
    const [, , opts] = ddataCall!;
    expect(opts).toMatchObject({ qos: 1, retain: false });
  });

  // --------------------------------------------------------------------------
  // 5. publishAlarmsDDATA emits last_event from the final transition in the batch
  // --------------------------------------------------------------------------
  it('publishAlarmsDDATA emits last_event from final transition in batch', async () => {
    mockGetActiveAlarmIndices.mockResolvedValue([]);
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    await SparkplugService.init(log);

    mockPublishAsync.mockClear();
    mockEncodePayload.mockClear();
    // Batch: alarm 5 activated, then alarm 9 reset.
    mockGetActiveAlarmIndices.mockResolvedValue([5]);

    const t2 = new Date('2026-04-14T12:30:00Z');
    const transitions: IAlarmTransition[] = [
      { alarmIndex: 5, wordIndex: 0, bitIndex: 5, active: true, timestamp: new Date('2026-04-14T12:00:00Z') },
      { alarmIndex: 9, wordIndex: 0, bitIndex: 9, active: false, timestamp: t2 },
    ];
    await SparkplugService.publishAlarmsDDATA(transitions);

    const lastEncode = mockEncodePayload.mock.calls.at(-1)?.[0] as EncodedPayloadArg | undefined;
    expect(lastEncode).toBeDefined();

    const lastEventCode = lastEncode!.metrics.find((m) => m.alias === ALIAS_MAP['alarms/last_event_code']);
    const lastEventState = lastEncode!.metrics.find((m) => m.alias === ALIAS_MAP['alarms/last_event_state']);
    const lastEventAt = lastEncode!.metrics.find((m) => m.alias === ALIAS_MAP['alarms/last_event_at']);

    expect(lastEventCode?.value).toBe('9');
    expect(lastEventState?.value).toBe(0);
    expect(lastEventAt?.value).toBe(t2.getTime());
  });

  // --------------------------------------------------------------------------
  // 6. DDATA metrics are alias-only (no name) per §6.4.4
  // --------------------------------------------------------------------------
  it('publishAlarmsDDATA carries alias-only metrics (no name key)', async () => {
    mockGetActiveAlarmIndices.mockResolvedValue([]);
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    await SparkplugService.init(log);

    mockPublishAsync.mockClear();
    mockEncodePayload.mockClear();
    mockGetActiveAlarmIndices.mockResolvedValue([5]);

    const transitions: IAlarmTransition[] = [
      { alarmIndex: 5, wordIndex: 0, bitIndex: 5, active: true, timestamp: new Date() },
    ];
    await SparkplugService.publishAlarmsDDATA(transitions);

    const lastEncode = mockEncodePayload.mock.calls.at(-1)?.[0] as EncodedPayloadArg | undefined;
    expect(lastEncode).toBeDefined();
    expect(lastEncode!.metrics.length).toBeGreaterThan(0);
    for (const m of lastEncode!.metrics) {
      expect(typeof m.alias).toBe('number');
      expect(m.name).toBeUndefined();
    }
  });

  // --------------------------------------------------------------------------
  // 7. No-op when transitions array is empty
  // --------------------------------------------------------------------------
  it('no-op when transitions array is empty', async () => {
    mockGetActiveAlarmIndices.mockResolvedValue([]);
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    await SparkplugService.init(log);

    mockPublishAsync.mockClear();
    await SparkplugService.publishAlarmsDDATA([]);

    const ddataCall = mockPublishAsync.mock.calls.find(
      (c) => typeof c[0] === 'string' && /\/DDATA\/[^/]+\/alarms$/.test(c[0] as string),
    );
    expect(ddataCall).toBeUndefined();
  });

  // --------------------------------------------------------------------------
  // 8. No-op when cfg.enabled is false
  // --------------------------------------------------------------------------
  it('publishAlarmsDDATA no-ops when cfg.enabled is false', async () => {
    mockGetActiveAlarmIndices.mockResolvedValue([]);
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    await SparkplugService.init(log);

    // Flip config to disabled AFTER init — the publish path must gate on the
    // live cfg.enabled flag, not on a cached value from init().
    const { MqttConfigService } = await import('../../mqtt/configService.js');
    vi.mocked(MqttConfigService.getConfig).mockResolvedValue({
      id: 1,
      enabled: false,
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
    });

    mockPublishAsync.mockClear();
    mockGetActiveAlarmIndices.mockResolvedValue([5]);

    const transitions: IAlarmTransition[] = [
      { alarmIndex: 5, wordIndex: 0, bitIndex: 5, active: true, timestamp: new Date() },
    ];
    await SparkplugService.publishAlarmsDDATA(transitions);

    const ddataCall = mockPublishAsync.mock.calls.find(
      (c) => typeof c[0] === 'string' && /\/DDATA\/[^/]+\/alarms$/.test(c[0] as string),
    );
    expect(ddataCall).toBeUndefined();
  });
});
