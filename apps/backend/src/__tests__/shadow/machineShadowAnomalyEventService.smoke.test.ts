import { describe, expect, it, vi } from 'vitest';

// Mock the db module so getDiff() returns an empty result set without a real DB.
// The shadow event service path is apps/backend/src/services/anomaly/shadow/,
// so the db module resolves via ../../../db/index.js from that file — but the
// mock path must match what the module *imports*, not the test's relative path.
// Vitest hoists vi.mock calls; the mock target uses the import specifier as
// seen from the source file being tested.
vi.mock('../../db/index.js', () => ({
  db: {
    // pg driver shape: QueryResult with .rows array (not the array itself).
    // The earlier `mockResolvedValue([])` was wrong shape — it hid a runtime
    // bug (ISSUE surfaced by 41-07 sacchi human-verify: "rows is not iterable").
    execute: vi.fn().mockResolvedValue({ rows: [] }),
  },
}));

describe('MachineShadowAnomalyEventService smoke', () => {
  it('getDiff() returns IShadowDiffResponse shape (empty-DB scenario)', async () => {
    const { MachineShadowAnomalyEventService } = await import(
      '../../services/anomaly/shadow/machineShadowAnomalyEventService.js'
    );
    const from = new Date('2026-04-19T00:00:00.000Z');
    const to = new Date('2026-04-20T00:00:00.000Z');
    const res = await MachineShadowAnomalyEventService.getDiff({ from, to });

    // Shape assertions — every IShadowDiffResponse key present
    expect(res.totals.primary).toEqual({ flagged: 0, total: 0 });
    expect(res.totals.shadow).toEqual({ flagged: 0, total: 0 });
    expect(res.byModeKey).toEqual([]);
    expect(res.window.from).toBe(from.toISOString());
    expect(res.window.to).toBe(to.toISOString());
  });
});
