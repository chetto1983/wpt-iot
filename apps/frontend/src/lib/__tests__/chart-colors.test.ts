import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { computePresetRange } from '../chart-colors';

describe('computePresetRange', () => {
  const originalTimezone = process.env.TZ;

  beforeEach(() => {
    process.env.TZ = 'America/Los_Angeles';
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-28T01:30:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
    process.env.TZ = originalTimezone;
  });

  it('starts todaySoFar at midnight in the configured timezone', () => {
    const range = computePresetRange('todaySoFar', 'Asia/Tokyo');

    expect(range?.from.toISOString()).toBe('2026-08-27T15:00:00.000Z');
    expect(range?.to.toISOString()).toBe('2026-08-28T01:30:00.000Z');
  });
});
