import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FastifyBaseLogger } from 'fastify';

/**
 * The Sparkplug uplink honours the TLS settings saved in mqtt_config.
 *
 * Audit 2026-10-01: only the retired command-bus client applied `useTls` /
 * `caCert`; the Sparkplug client always connected in plaintext even when the
 * admin UI showed TLS enabled.
 */

const { mockConnectAsync, mockGetConfig } = vi.hoisted(() => ({
  mockConnectAsync: vi.fn(),
  mockGetConfig: vi.fn(),
}));

vi.mock('mqtt', () => ({ default: { connectAsync: mockConnectAsync } }));

vi.mock('sparkplug-payload', () => ({
  default: { get: vi.fn(() => ({ encodePayload: vi.fn(() => Buffer.from('encoded')) })) },
}));

vi.mock('../../mqtt/configService.js', () => ({
  MqttConfigService: { getConfig: mockGetConfig },
}));

const CA_PEM = '-----BEGIN CERTIFICATE-----\nTEST\n-----END CERTIFICATE-----\n';

function config(overrides: Record<string, unknown>) {
  return {
    id: 1,
    enabled: true,
    brokerHost: 'broker.example.com',
    brokerPort: 8883,
    username: 'NW30-020',
    password: 'secret',
    useTls: false,
    caCert: null,
    sparkplugGroupId: 'WPT',
    sparkplugEdgeNodeId: 'NW30-020',
    publishCycleRecords: true,
    telemetryIntervalSeconds: 30,
    updatedAt: new Date(),
    ...overrides,
  };
}

const log = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
} as unknown as FastifyBaseLogger;

describe('Sparkplug uplink TLS', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mockConnectAsync.mockResolvedValue({
      publishAsync: vi.fn().mockResolvedValue(undefined),
      endAsync: vi.fn().mockResolvedValue(undefined),
      on: vi.fn(),
      connected: true,
    });
    const { SparkplugService } = await import('../../mqtt/sparkplugService.js');
    await SparkplugService.stop();
  });

  it('connects over mqtts with the configured CA when useTls is on', async () => {
    mockGetConfig.mockResolvedValue(config({ useTls: true, caCert: CA_PEM }));
    const { SparkplugService } = await import('../../mqtt/sparkplugService.js');

    await SparkplugService.init(log);

    const opts = mockConnectAsync.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(opts.protocol).toBe('mqtts');
    expect(opts.rejectUnauthorized).toBe(true);
    expect(opts.ca).toEqual([Buffer.from(CA_PEM)]);
  });

  it('connects over plain mqtt when useTls is off', async () => {
    mockGetConfig.mockResolvedValue(config({ useTls: false, brokerPort: 1883 }));
    const { SparkplugService } = await import('../../mqtt/sparkplugService.js');

    await SparkplugService.init(log);

    const opts = mockConnectAsync.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(opts.protocol).toBe('mqtt');
    expect(opts).not.toHaveProperty('ca');
  });
});
