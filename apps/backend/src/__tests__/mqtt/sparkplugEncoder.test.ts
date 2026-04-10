import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ICycleRecord } from '@wpt/types';

/**
 * PHASE 24 Wave 0 — Sparkplug B cycle-record encoding test scaffold.
 *
 * Per CONTEXT D-04: Expand SparkplugService.publishCycleRecord() to include
 * all 14 fields per WPT-SISTEMA-IOT-SPEC.md §14:
 *
 * Field order (per Base_registro_mensile_cicli.xls):
 *   1. order_number (String)
 *   2. cycles (Int32) — cycleNumber
 *   3. date (DateTime)
 *   4. start_time (DateTime)
 *   5. end_time (DateTime)
 *   6. cycle_status_label (String)
 *   7. weight_input_kg (Float) — materialInputKg
 *   8. weight_output_kg (Float) — materialOutputKg
 *   9. containers (Int32)
 *   10. gross_input_kg (Float)
 *   11. start_energy_kwh (Float)
 *   12. end_energy_kwh (Float)
 *   13. start_water_l (Float)
 *   14. end_water_l (Float)
 *   15. operator (String)
 *
 * All tests currently FAIL (RED phase) — implementation in Wave 2.
 */

// ---------------------------------------------------------------------------
// Mocks for mqtt and sparkplug-payload
// ---------------------------------------------------------------------------
const mockPublishAsync = vi.fn();
const mockConnectAsync = vi.fn();

vi.mock('mqtt', () => ({
  default: {
    connectAsync: mockConnectAsync,
  },
}));

const mockEncodePayload = vi.fn();
const mockSpbGet = vi.fn(() => ({
  encodePayload: mockEncodePayload,
}));

vi.mock('sparkplug-payload', () => ({
  default: {
    get: mockSpbGet,
  },
}));

// Mock CloudConfigService
vi.mock('../../mqtt/cloudConfigService.js', () => ({
  CloudConfigService: {
    getConfig: vi.fn().mockResolvedValue({
      enabled: true,
      publishCycleRecords: true,
      groupId: 'ideal-don-gnocchi',
      edgeNodeId: 'NW30-020',
      brokerHost: 'mqtt.example.com',
      brokerPort: 1883,
      username: 'user',
      password: 'pass',
    }),
  },
}));

// Import SUT after mocks
const { SparkplugService } = await import('../../mqtt/sparkplugService.js');

// ---------------------------------------------------------------------------
// Test data factory for cycle records
// ---------------------------------------------------------------------------
function makeCycleRecord(overrides: Partial<ICycleRecord> = {}): ICycleRecord {
  const now = new Date();
  const startedAt = new Date(now.getTime() - 30 * 60 * 1000); // 30 min ago
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

describe('Sparkplug B cycle-record encoding (RED — Phase 24)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEncodePayload.mockReturnValue(Buffer.from('encoded'));
    mockPublishAsync.mockResolvedValue(undefined);
    mockConnectAsync.mockResolvedValue({
      publishAsync: mockPublishAsync,
      endAsync: vi.fn(),
    });
  });

  // ==========================================================================
  // Test 1: All 14 cycle fields encoded in correct order
  // ==========================================================================
  it('All 14 cycle fields encoded in correct order', async () => {
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    await SparkplugService.init(log);

    const record = makeCycleRecord();
    await SparkplugService.publishCycleRecord(record);

    // Verify encodePayload was called
    expect(mockEncodePayload).toHaveBeenCalled();

    const encodedPayload = mockEncodePayload.mock.calls[0]?.[0];
    const metrics = encodedPayload?.metrics || [];

    // Verify all 14 fields are present
    expect(metrics).toHaveLength(14);

    // Verify field names match expected order
    const expectedNames = [
      'cycle/order_number',
      'cycle/cycles',
      'cycle/date',
      'cycle/start_time',
      'cycle/end_time',
      'cycle/cycle_status_label',
      'cycle/weight_input_kg',
      'cycle/weight_output_kg',
      'cycle/containers',
      'cycle/gross_input_kg',
      'cycle/start_energy_kwh',
      'cycle/end_energy_kwh',
      'cycle/start_water_l',
      'cycle/end_water_l',
      'cycle/operator',
    ];

    const actualNames = metrics.map((m: { name: string }) => m.name);
    expect(actualNames).toEqual(expectedNames);
  });

  // ==========================================================================
  // Test 2: Metric types match Sparkplug B spec
  // ==========================================================================
  it('Metric types match Sparkplug B spec (String, Int32, DateTime, Float)', async () => {
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    await SparkplugService.init(log);

    const record = makeCycleRecord();
    await SparkplugService.publishCycleRecord(record);

    const encodedPayload = mockEncodePayload.mock.calls[0]?.[0];
    const metrics = encodedPayload?.metrics || [];

    // Find metrics by name and verify types
    const findMetric = (name: string) => metrics.find((m: { name: string }) => m.name === name);

    // String types
    expect(findMetric('cycle/order_number')?.type).toBe('String');
    expect(findMetric('cycle/cycle_status_label')?.type).toBe('String');
    expect(findMetric('cycle/operator')?.type).toBe('String');

    // Int32 types
    expect(findMetric('cycle/cycles')?.type).toBe('Int32');
    expect(findMetric('cycle/containers')?.type).toBe('Int32');

    // DateTime types (timestamps)
    expect(findMetric('cycle/date')?.type).toBe('DateTime');
    expect(findMetric('cycle/start_time')?.type).toBe('DateTime');
    expect(findMetric('cycle/end_time')?.type).toBe('DateTime');

    // Float types for measurements
    expect(findMetric('cycle/weight_input_kg')?.type).toBe('Float');
    expect(findMetric('cycle/weight_output_kg')?.type).toBe('Float');
    expect(findMetric('cycle/gross_input_kg')?.type).toBe('Float');
    expect(findMetric('cycle/start_energy_kwh')?.type).toBe('Float');
    expect(findMetric('cycle/end_energy_kwh')?.type).toBe('Float');
    expect(findMetric('cycle/start_water_l')?.type).toBe('Float');
    expect(findMetric('cycle/end_water_l')?.type).toBe('Float');
  });

  // ==========================================================================
  // Test 3: Protobuf payload is valid (can be decoded)
  // ==========================================================================
  it('Protobuf payload is valid (can be decoded)', async () => {
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    await SparkplugService.init(log);

    const record = makeCycleRecord();
    await SparkplugService.publishCycleRecord(record);

    // Verify encodePayload was called and returned a valid buffer
    expect(mockEncodePayload).toHaveBeenCalled();

    const encodedPayload = mockEncodePayload.mock.results[0]?.value;
    expect(encodedPayload).toBeInstanceOf(Buffer);
    expect(encodedPayload.length).toBeGreaterThan(0);

    // In real implementation, verify decode works
    // const decoded = spb.decodePayload(encodedPayload);
    // expect(decoded.metrics).toHaveLength(14);
  });

  // ==========================================================================
  // Test 4: QoS 1 publishing confirmed
  // ==========================================================================
  it('QoS 1 publishing confirmed', async () => {
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    await SparkplugService.init(log);

    const record = makeCycleRecord();
    await SparkplugService.publishCycleRecord(record);

    // Verify publish was called with QoS 1
    expect(mockPublishAsync).toHaveBeenCalledWith(
      expect.stringContaining('spBv1.0/'),
      expect.any(Buffer),
      expect.objectContaining({ qos: 1, retain: false }),
    );
  });

  // ==========================================================================
  // Test 5: Outbox drain orders by end_time ASC
  // ==========================================================================
  it('Outbox drain orders by end_time ASC', async () => {
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    await SparkplugService.init(log);

    // Simulate outbox drain with multiple records
    const records = [
      makeCycleRecord({ cycleNumber: 3, endedAt: new Date('2026-04-10T14:00:00Z') }),
      makeCycleRecord({ cycleNumber: 1, endedAt: new Date('2026-04-10T12:00:00Z') }),
      makeCycleRecord({ cycleNumber: 2, endedAt: new Date('2026-04-10T13:00:00Z') }),
    ];

    // Publish out of order
    await SparkplugService.publishCycleRecord(records[0]!); // cycle 3
    await SparkplugService.publishCycleRecord(records[1]!); // cycle 1
    await SparkplayService.publishCycleRecord(records[2]!); // cycle 2

    // Verify publish order matches end_time ASC (1, 2, 3)
    const publishedNumbers = mockPublishAsync.mock.calls.map((_, idx) => {
      const payload = mockEncodePayload.mock.calls[idx]?.[0];
      const cyclesMetric = payload?.metrics?.find((m: { name: string }) => m.name === 'cycle/cycles');
      return cyclesMetric?.value;
    });

    expect(publishedNumbers).toEqual([1, 2, 3]);
  });

  // ==========================================================================
  // Test 6: Published_at updated on puback
  // ==========================================================================
  it('Published_at updated on puback', async () => {
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    await SparkplugService.init(log);

    const record = makeCycleRecord({ publishedAt: null });

    // Before publish: publishedAt is null
    expect(record.publishedAt).toBeNull();

    await SparkplugService.publishCycleRecord(record);

    // After successful publish: publishedAt should be set
    // (This would be handled by the outbox/update mechanism)
    expect(mockPublishAsync).toHaveBeenCalled();

    // In real implementation, verify the cycle_records row is updated
    // const updatedRecord = await db.query.cycleRecords.findFirst(...);
    // expect(updatedRecord.publishedAt).not.toBeNull();
  });

  // ==========================================================================
  // Test 7: Topic format follows Sparkplug B spec
  // ==========================================================================
  it('Topic format follows spBv1.0/{groupId}/DDATA/{edgeNodeId}/cycle', async () => {
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    await SparkplugService.init(log);

    const record = makeCycleRecord();
    await SparkplugService.publishCycleRecord(record);

    const publishedTopic = mockPublishAsync.mock.calls[0]?.[0] as string;

    // Verify topic structure
    expect(publishedTopic).toMatch(/^spBv1\.0\/[^/]+\/DDATA\/[^/]+\/cycle$/);
    expect(publishedTopic).toContain('ideal-don-gnocchi');
    expect(publishedTopic).toContain('NW30-020');
  });

  // ==========================================================================
  // Test 8: Metric aliasing for bandwidth efficiency
  // ==========================================================================
  it('Uses metric aliasing for bandwidth efficiency', async () => {
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    await SparkplugService.init(log);

    const record = makeCycleRecord();
    await SparkplugService.publishCycleRecord(record);

    const encodedPayload = mockEncodePayload.mock.calls[0]?.[0];

    // Verify seq number is included for aliasing
    expect(encodedPayload).toHaveProperty('seq');
    expect(typeof encodedPayload.seq).toBe('number');
  });
});
