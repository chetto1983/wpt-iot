import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ICycleClosedEvent, ICycleStartEvent } from '@wpt/types';

const mocks = vi.hoisted(() => ({
  upsertCycleStart: vi.fn(),
  insertCycleFromEvent: vi.fn(),
  deleteCycleStart: vi.fn(),
}));

let startHandler: ((event: ICycleStartEvent) => void) | null = null;
let closeHandler: ((event: ICycleClosedEvent) => void) | null = null;

vi.mock('../../events/hub.js', () => ({
  dataHub: {
    onCycleStart: vi.fn((handler: (event: ICycleStartEvent) => void) => {
      startHandler = handler;
    }),
    onCycleClosed: vi.fn((handler: (event: ICycleClosedEvent) => void) => {
      closeHandler = handler;
    }),
  },
}));

vi.mock('../../services/energy/index.js', () => ({
  EnergyAttributionService: mocks,
}));

const { startCyclePersister } = await import('../../persistence/cyclePersister.js');

function makeStartEvent(): ICycleStartEvent {
  return {
    resetEpoch: 1,
    cycleNumber: 64,
    startedAt: new Date('2026-08-28T09:38:30Z'),
    startEnergyKwh: 100,
    startWaterL: 20,
    operator: 'MARIO',
    orderNumber: 'ORD-64',
    containers: 5,
    materialInputKg: 90,
    grossInputKg: 100,
  };
}

function makeClosedEvent(): ICycleClosedEvent {
  return {
    resetEpoch: 1,
    cycleNumber: 64,
    startedAt: new Date('2026-08-28T09:38:30Z'),
    endedAt: new Date('2026-08-28T09:52:46Z'),
    cycleType: 6,
    machineStatus: 0,
    cycleStatusLabel: 'OK',
    startEnergyKwh: 100,
    endEnergyKwh: 110,
    startWaterL: 20,
    endWaterL: 25,
    energyKwh: 10,
    waterL: 5,
    containers: 5,
    operator: 'MARIO',
    orderNumber: 'ORD-64',
    grossInputKg: 100,
    materialInputKg: 90,
  };
}

describe('CyclePersister lifecycle queue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    startHandler = null;
    closeHandler = null;
    mocks.upsertCycleStart.mockResolvedValue(undefined);
    mocks.insertCycleFromEvent.mockResolvedValue(true);
    mocks.deleteCycleStart.mockResolvedValue(undefined);
  });

  it('persists start before close and deletes it only after the close succeeds', async () => {
    let releaseStart!: () => void;
    mocks.upsertCycleStart.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        releaseStart = resolve;
      }),
    );
    const log = { info: vi.fn(), error: vi.fn() };
    startCyclePersister(log);

    startHandler!(makeStartEvent());
    closeHandler!(makeClosedEvent());

    await vi.waitFor(() => expect(mocks.upsertCycleStart).toHaveBeenCalledTimes(1));
    expect(mocks.insertCycleFromEvent).not.toHaveBeenCalled();
    expect(mocks.deleteCycleStart).not.toHaveBeenCalled();

    releaseStart();

    await vi.waitFor(() => expect(mocks.deleteCycleStart).toHaveBeenCalledWith(1, 64));
    expect(mocks.insertCycleFromEvent).toHaveBeenCalledWith(
      expect.objectContaining({ resetEpoch: 1, cycleNumber: 64 }),
      log,
      { source: 'LIVE' },
    );
    expect(
      mocks.insertCycleFromEvent.mock.invocationCallOrder[0],
    ).toBeLessThan(mocks.deleteCycleStart.mock.invocationCallOrder[0]);
  });

  it('keeps the durable start when close persistence fails', async () => {
    mocks.insertCycleFromEvent.mockRejectedValueOnce(new Error('db unavailable'));
    const log = { info: vi.fn(), error: vi.fn() };
    startCyclePersister(log);

    closeHandler!(makeClosedEvent());

    await vi.waitFor(() => expect(log.error).toHaveBeenCalledTimes(1));
    expect(mocks.deleteCycleStart).not.toHaveBeenCalled();
  });
});
