// Phase 41 Plan 41-07 Task 1 — Vitest unit tests for MachineShadowAnomalyService.
// Covers D-11 stricter thresholds, D-12 SHADOW_ENABLED kill-switch, D-13 cold-start,
// D-14 separate state file (EXACT-path assertion per checker ISSUE-08), D-17 shared
// cooldown constant, D-18 try/catch isolation. Additive only — no existing tests
// modified. Pure unit scope — no real DB / no real filesystem.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../events/hub.js', () => ({
  dataHub: {
    onMachineData: vi.fn(),
    off: vi.fn(),
  },
}));

const recordEventMock = vi.fn().mockResolvedValue(undefined);
vi.mock('../services/anomaly/shadow/machineShadowAnomalyEventService.js', () => ({
  MachineShadowAnomalyEventService: {
    recordEvent: recordEventMock,
    getDiff: vi.fn(),
  },
}));

const writeFileMock = vi.fn().mockResolvedValue(undefined);
const readFileMock = vi.fn().mockRejectedValue(new Error('ENOENT (mocked)'));
vi.mock('node:fs/promises', () => ({
  writeFile: writeFileMock,
  readFile: readFileMock,
}));

// Self-contained input fixture (no import from sibling test file).
function makeInput(overrides: Record<string, unknown> = {}) {
  return {
    selectedCycle: 2,
    currentPhase: 3,
    machineStatus: 1,
    garbageTemp: 180,
    chamberPressure: -0.8,
    mainMotorSpeed: 1200,
    mainMotorCurrent: 45,
    mainMotorTorque: 12.5,
    vacuumPumpSpeed01: 800,
    energyConsumption: 50,
    rmsCurrL1: 15,
    rmsCurrL2: 15,
    rmsCurrL3: 15,
    materialInputWeight: 250,
    materialOutputWeight: 120,
    ...overrides,
  };
}

const mockLog = {
  info: vi.fn(),
  error: vi.fn(),
};

describe('D-11 shadow uses stricter thresholds (2.0/3.0 vs primary 2.5/3.5)', () => {
  it('createShadowDetector() config has warningThreshold=2.0 and criticalThreshold=3.0', async () => {
    const { createShadowDetector } = await import(
      '../services/anomaly/shadow/shadowDetector.js'
    );
    const cfg = createShadowDetector().getConfig();
    expect(cfg.warningThreshold).toBe(2.0);
    expect(cfg.criticalThreshold).toBe(3.0);
  });

  it('shadow thresholds are stricter than primary defaults (2.0 < 2.5, 3.0 < 3.5)', async () => {
    const { createShadowDetector } = await import(
      '../services/anomaly/shadow/shadowDetector.js'
    );
    const { OnlineAnomalyDetector } = await import(
      '../services/anomaly/onlineAnomalyDetector.js'
    );
    const primaryCfg = new OnlineAnomalyDetector().getConfig();
    const shadowCfg = createShadowDetector().getConfig();
    expect(shadowCfg.warningThreshold).toBeLessThan(primaryCfg.warningThreshold);
    expect(shadowCfg.criticalThreshold).toBeLessThan(primaryCfg.criticalThreshold);
  });

  it('getDetectorConfigDiff() reports the two threshold deltas', async () => {
    const { machineShadowAnomalyService } = await import(
      '../services/anomaly/shadow/machineShadowAnomalyService.js'
    );
    const diff = machineShadowAnomalyService.getDetectorConfigDiff();
    expect(diff).toHaveProperty('warningThreshold');
    expect(diff).toHaveProperty('criticalThreshold');
    expect(diff.warningThreshold).toMatchObject({ primary: 2.5, shadow: 2.0 });
    expect(diff.criticalThreshold).toMatchObject({ primary: 3.5, shadow: 3.0 });
  });
});

// D-12 kill-switch is read ONCE at module load. Each test uses vi.resetModules()
// + dynamic import after mutating process.env so the fresh module instance
// reads the disabled flag.
describe('D-12 SHADOW_ENABLED kill switch', () => {
  const ORIGINAL_SHADOW_ENABLED = process.env.SHADOW_ENABLED;

  afterEach(() => {
    if (ORIGINAL_SHADOW_ENABLED === undefined) {
      delete process.env.SHADOW_ENABLED;
    } else {
      process.env.SHADOW_ENABLED = ORIGINAL_SHADOW_ENABLED;
    }
    vi.resetModules();
  });

  it('observe() is a no-op when SHADOW_ENABLED=false at module load', async () => {
    vi.resetModules();
    recordEventMock.mockClear();
    process.env.SHADOW_ENABLED = 'false';

    const { machineShadowAnomalyService } = await import(
      '../services/anomaly/shadow/machineShadowAnomalyService.js'
    );

    for (let i = 0; i < 30; i += 1) {
      machineShadowAnomalyService.observe(makeInput(), new Date(), mockLog);
    }
    machineShadowAnomalyService.observe(
      makeInput({ garbageTemp: 800, chamberPressure: 50, mainMotorCurrent: 200 }),
      new Date(),
      mockLog,
    );

    expect(recordEventMock).not.toHaveBeenCalled();
  });

  it('saveState() is a no-op when SHADOW_ENABLED=false at module load', async () => {
    vi.resetModules();
    writeFileMock.mockClear();
    process.env.SHADOW_ENABLED = 'false';

    const { machineShadowAnomalyService } = await import(
      '../services/anomaly/shadow/machineShadowAnomalyService.js'
    );

    await machineShadowAnomalyService.saveState(mockLog);
    expect(writeFileMock).not.toHaveBeenCalled();
  });
});

describe('D-13 shadow cold-starts (no state cloning from primary)', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('fresh shadow detector has zero totalObservations before any observe() call', async () => {
    const { createShadowDetector } = await import(
      '../services/anomaly/shadow/shadowDetector.js'
    );
    const detector = createShadowDetector();
    const snap = detector.inspect();
    expect(snap.totalObservations).toBe(0);
  });

  it('fresh shadow service (new instance) has zero totalObservations via inspect()', async () => {
    const { MachineShadowAnomalyService } = await import(
      '../services/anomaly/shadow/machineShadowAnomalyService.js'
    );
    const svc = new MachineShadowAnomalyService();
    expect(svc.inspect().totalObservations).toBe(0);
  });
});

// D-14 uses EXACT path.resolve() equality on both the positive and negative
// assertion (ISSUE-08) — substring-match would false-positive on the shadow path.
describe('D-14 shadow persists to uploads/anomaly-shadow-state.json', () => {
  beforeEach(() => {
    vi.resetModules();
    writeFileMock.mockClear();
  });

  it('saveState writes to EXACT anomaly-shadow-state.json path, NEVER to primary anomaly-state.json path', async () => {
    const { machineShadowAnomalyService } = await import(
      '../services/anomaly/shadow/machineShadowAnomalyService.js'
    );
    await machineShadowAnomalyService.saveState(mockLog);
    expect(writeFileMock).toHaveBeenCalledWith(
      path.resolve('uploads', 'anomaly-shadow-state.json'),
      expect.any(String),
      'utf-8',
    );
    expect(writeFileMock).not.toHaveBeenCalledWith(
      path.resolve('uploads', 'anomaly-state.json'),
      expect.any(String),
      'utf-8',
    );
  });
});

// D-17 source-level assertion: shadow imports PERSIST_COOLDOWN_MS and does
// not duplicate the 15-min literal.
describe('D-17 shadow uses PERSIST_COOLDOWN_MS (no duplicate 15-min literal)', () => {
  it('shadow service source imports PERSIST_COOLDOWN_MS and contains no 15*60*1000 literal', () => {
    const thisFileDir = path.dirname(fileURLToPath(import.meta.url));
    const shadowSourcePath = path.resolve(
      thisFileDir,
      '..', 'services', 'anomaly', 'shadow', 'machineShadowAnomalyService.ts',
    );
    const source = readFileSync(shadowSourcePath, 'utf-8');
    expect(source).toContain('PERSIST_COOLDOWN_MS');
    expect(source).not.toMatch(/15\s*\*\s*60\s*\*\s*1000/);
  });

  it('PERSIST_COOLDOWN_MS exported from primary service equals 15 minutes', async () => {
    const { PERSIST_COOLDOWN_MS } = await import(
      '../services/anomaly/machineAnomalyService.js'
    );
    expect(PERSIST_COOLDOWN_MS).toBe(15 * 60 * 1000);
  });
});

describe('D-18 shadow observe() throws do NOT propagate', () => {
  beforeEach(() => {
    vi.resetModules();
    mockLog.error.mockClear();
  });

  it('detector throw inside observe() is caught; caller sees no throw', async () => {
    const { OnlineAnomalyDetector } = await import(
      '../services/anomaly/onlineAnomalyDetector.js'
    );
    const { machineShadowAnomalyService } = await import(
      '../services/anomaly/shadow/machineShadowAnomalyService.js'
    );

    const original = OnlineAnomalyDetector.prototype.observe;
    OnlineAnomalyDetector.prototype.observe = vi.fn(() => {
      throw new Error('simulated detector failure');
    });

    try {
      expect(() =>
        machineShadowAnomalyService.observe(makeInput(), new Date(), mockLog),
      ).not.toThrow();
      expect(mockLog.error).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'MachineAnomalyShadow' }),
        expect.stringContaining('Shadow observe failed'),
      );
    } finally {
      OnlineAnomalyDetector.prototype.observe = original;
    }
  });

  it('observe() without a logger still swallows the throw (no-logger path)', async () => {
    const { OnlineAnomalyDetector } = await import(
      '../services/anomaly/onlineAnomalyDetector.js'
    );
    const { machineShadowAnomalyService } = await import(
      '../services/anomaly/shadow/machineShadowAnomalyService.js'
    );

    const original = OnlineAnomalyDetector.prototype.observe;
    OnlineAnomalyDetector.prototype.observe = vi.fn(() => {
      throw new Error('simulated detector failure (no log)');
    });

    try {
      expect(() => machineShadowAnomalyService.observe(makeInput(), new Date())).not.toThrow();
    } finally {
      OnlineAnomalyDetector.prototype.observe = original;
    }
  });
});
