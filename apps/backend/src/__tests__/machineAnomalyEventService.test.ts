import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../db/index.js', () => ({
  db: {
    execute: vi.fn(),
  },
}));

import { db } from '../db/index.js';
import { MachineAnomalyEventService } from '../services/machineAnomalyEventService.js';

describe('MachineAnomalyEventService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('records a flagged anomaly event', async () => {
    vi.mocked(db.execute).mockResolvedValue({ rows: [] } as never);

    await MachineAnomalyEventService.recordEvent({
      observedAt: '2026-01-01T00:00:00.000Z',
      modeKey: '2:3:1',
      score: 4.2,
      flagged: true,
      warm: true,
      sampleCount: 30,
      topContributors: [{ feature: 'garbageTemp', zScore: 5.1 }],
    });

    expect(db.execute).toHaveBeenCalledOnce();
  });

  it('lists recent persisted anomaly events', async () => {
    vi.mocked(db.execute).mockResolvedValue({
      rows: [
        {
          id: 1,
          observed_at: new Date('2026-01-01T00:00:00.000Z'),
          mode_key: '2:3:1',
          score: 4.2,
          flagged: true,
          warm: true,
          sample_count: 30,
          top_contributors: [{ feature: 'garbageTemp', zScore: 5.1 }],
          created_at: new Date('2026-01-01T00:00:01.000Z'),
        },
      ],
    } as never);

    const rows = await MachineAnomalyEventService.listRecent({
      limit: 10,
      flaggedOnly: true,
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: 1,
      modeKey: '2:3:1',
      score: 4.2,
      flagged: true,
    });
  });
});
