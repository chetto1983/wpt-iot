/**
 * Unit tests for PlcConfigService / getCachedPlcConfig / PlcConfigUnavailableError.
 *
 * The module-level cache (cachedConfig, configCacheExpiry) is reset between
 * tests via vi.resetModules() + vi.doMock() + dynamic import so each test
 * gets a fresh module instance with an empty cache, scoped inside each test
 * to avoid polluting the global module registry between test files.
 *
 * No real DB is used — PlcConfigService.getConfig is spied on in each test.
 */
import { describe, it, expect, vi } from 'vitest';
import { PlcConfigUnavailableError } from '../udp/plcConfigService.js';

// ---------------------------------------------------------------------------
// Helper: load a fresh module instance with mocked DB, per test
// ---------------------------------------------------------------------------
interface IMinimalPlcModule {
  PlcConfigService: {
    getConfig: () => Promise<{ id: number; targetHost: string | null; endian: 'be' | 'le'; updatedAt: Date }>;
  };
  PlcConfigUnavailableError: typeof PlcConfigUnavailableError;
  getCachedPlcConfig: () => Promise<{ targetHost: string }>;
}

async function loadFreshModule(): Promise<IMinimalPlcModule> {
  vi.resetModules();
  vi.doMock('../db/index.js', () => ({ db: {} }));
  const mod = await import('../udp/plcConfigService.js');
  return mod as unknown as IMinimalPlcModule;
}

// ---------------------------------------------------------------------------
// Tests: PlcConfigUnavailableError class
// ---------------------------------------------------------------------------

describe('PlcConfigUnavailableError', () => {
  it('has correct name and is instanceof Error', () => {
    const err = new PlcConfigUnavailableError('NOT_CONFIGURED');
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('PlcConfigUnavailableError');
    expect(err.code).toBe('PLC_CONFIG_UNAVAILABLE');
    expect(err.message.toLowerCase()).toContain('not configured');
  });

  it('DB_UNREACHABLE variant has correct reason, code, and message', () => {
    const cause = new Error('connection refused');
    const err = new PlcConfigUnavailableError('DB_UNREACHABLE', cause);
    expect(err.reason).toBe('DB_UNREACHABLE');
    expect(err.code).toBe('PLC_CONFIG_UNAVAILABLE');
    expect(err.message).toContain('DB read failed');
  });
});

// ---------------------------------------------------------------------------
// Tests: getCachedPlcConfig
// ---------------------------------------------------------------------------

describe('getCachedPlcConfig', () => {
  it('throws NOT_CONFIGURED when targetHost is null', async () => {
    const mod = await loadFreshModule();
    vi.spyOn(mod.PlcConfigService, 'getConfig').mockResolvedValue({
      id: 1,
      targetHost: null,
      endian: 'le',
      updatedAt: new Date(),
    });

    const err = await mod.getCachedPlcConfig().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(mod.PlcConfigUnavailableError);
    expect((err as InstanceType<typeof PlcConfigUnavailableError>).reason).toBe('NOT_CONFIGURED');
    expect((err as InstanceType<typeof PlcConfigUnavailableError>).code).toBe('PLC_CONFIG_UNAVAILABLE');
  });

  it('throws NOT_CONFIGURED when targetHost is empty string', async () => {
    const mod = await loadFreshModule();
    vi.spyOn(mod.PlcConfigService, 'getConfig').mockResolvedValue({
      id: 1,
      targetHost: '',
      endian: 'le',
      updatedAt: new Date(),
    });

    const err = await mod.getCachedPlcConfig().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(mod.PlcConfigUnavailableError);
    expect((err as InstanceType<typeof PlcConfigUnavailableError>).reason).toBe('NOT_CONFIGURED');
  });

  it('throws DB_UNREACHABLE when getConfig throws', async () => {
    const mod = await loadFreshModule();
    vi.spyOn(mod.PlcConfigService, 'getConfig').mockRejectedValue(
      new Error('connection refused'),
    );

    const err = await mod.getCachedPlcConfig().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(mod.PlcConfigUnavailableError);
    expect((err as InstanceType<typeof PlcConfigUnavailableError>).reason).toBe('DB_UNREACHABLE');
  });

  it('returns cached config on second call without re-fetching DB', async () => {
    const mod = await loadFreshModule();
    const spy = vi.spyOn(mod.PlcConfigService, 'getConfig').mockResolvedValue({
      id: 1,
      targetHost: '192.168.0.10',
      endian: 'le',
      updatedAt: new Date(),
    });

    const first = await mod.getCachedPlcConfig();
    const second = await mod.getCachedPlcConfig();

    expect(first.targetHost).toBe('192.168.0.10');
    expect(second.targetHost).toBe('192.168.0.10');
    // DB should only be queried once — second call hits the warm cache
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('returns resolved targetHost on valid config', async () => {
    const mod = await loadFreshModule();
    vi.spyOn(mod.PlcConfigService, 'getConfig').mockResolvedValue({
      id: 1,
      targetHost: '10.0.0.5',
      endian: 'le',
      updatedAt: new Date(),
    });

    const result = await mod.getCachedPlcConfig();
    expect(result.targetHost).toBe('10.0.0.5');
  });

  it('resolves targetHost while the config shape carries endian', async () => {
    const mod = await loadFreshModule();
    vi.spyOn(mod.PlcConfigService, 'getConfig').mockResolvedValue({
      id: 1,
      targetHost: '192.168.0.42',
      endian: 'le',
      updatedAt: new Date(),
    });

    // getCachedPlcConfig only surfaces targetHost to the handshake FSM; the
    // endian field lives on IPlcConfig and is applied to the parsers elsewhere.
    const result = await mod.getCachedPlcConfig();
    expect(result.targetHost).toBe('192.168.0.42');
    expect(result).not.toHaveProperty('endian');

    const cfg = await mod.PlcConfigService.getConfig();
    expect(cfg.endian).toBe('le');
  });
});
