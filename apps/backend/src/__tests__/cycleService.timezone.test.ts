import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbExecuteMock = vi.fn();

vi.mock('../db/index.js', () => ({
  db: { execute: dbExecuteMock },
}));

vi.mock('../services/applicationConfigService.js', () => ({
  ApplicationConfigService: {
    getTimezone: vi.fn(() => 'America/Los_Angeles'),
  },
}));

const { CycleService } = await import('../services/cycleService.js');

describe('CycleService timezone-aware legacy exports', () => {
  beforeEach(() => {
    dbExecuteMock.mockReset();
  });

  it('formats CSV dates and the filename in the configured timezone', async () => {
    dbExecuteMock.mockResolvedValue({
      rows: [
        {
          cycleNumber: 1,
          startedAt: '2026-01-01T01:00:00.000Z',
          endedAt: '2026-01-01T02:00:00.000Z',
          cycleType: 1,
          cycleStatusLabel: 'OK',
          materialInputKg: null,
          materialOutputKg: null,
          grossInputKg: null,
          containers: null,
          operator: null,
          orderNumber: null,
        },
      ],
    });

    const result = await CycleService.exportCsv({
      from: '2026-01-01T01:00:00.000Z',
      to: '2026-02-01T01:00:00.000Z',
    });

    expect(result.filename).toBe('registro_cicli_2025_12.csv');
    expect(result.content).toContain('1,31/12/2025,31/12/2025');
  });
});
