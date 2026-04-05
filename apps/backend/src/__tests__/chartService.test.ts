import { describe, it } from 'vitest';

describe('ChartService', () => {
  describe('selectResolution', () => {
    it.todo('returns "raw" for ranges under 6 hours');
    it.todo('returns "5min" for ranges between 6 hours and 3 days');
    it.todo('returns "1h" for ranges over 3 days');
    it.todo('returns "1h" for exactly 30 days (max retention)');
  });

  describe('queryChartData', () => {
    it.todo('returns timestamped data points for requested fields');
    it.todo('returns resolution in the response');
    it.todo('returns empty points array when no data in range');
    it.todo('caps results at 5000 points safety limit');
  });

  describe('field filtering', () => {
    it.todo('filters requested fields against CLIENT_VISIBLE_FIELDS for CLIENT role');
    it.todo('allows all WPT_VISIBLE_FIELDS for WPT role');
    it.todo('silently drops fields not in the allowed set');
    it.todo('excludes non-chartable fields (strings, enums)');
  });
});
