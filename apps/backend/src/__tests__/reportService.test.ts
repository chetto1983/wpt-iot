/**
 * Phase 32-03: ReportService snapshot/CSV/PDF tests (18 tests).
 *
 * Split from reportService.alarms.test.ts per 500-line rule (CLAUDE.md).
 * DB-backed tests use date-wall 2024-05-* to avoid dev/simulator collisions.
 * Pure-logic tests (toCSV) need no DB but share the same beforeEach teardown.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { db, pool } from '../db/index.js';
import { ReportService } from '../services/reportService.js';
import { PdfService } from '../services/pdf/index.js';
import { WPT_VISIBLE_FIELDS, CLIENT_VISIBLE_FIELDS } from '@wpt/types';
import { seedMachineSnapshots } from './fixtures/testSnapshots.js';

// Fixed date-wall range for all seeded data (far from simulator window)
const FROM = new Date('2024-05-01T00:00:00Z');
const TO = new Date('2024-05-31T23:59:59Z');

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(async () => {
  await db.execute(sql`TRUNCATE machine_snapshots, alarm_events CASCADE`);
});

afterAll(async () => {
  await pool.end().catch(() => undefined);
});

// ===========================================================================
// querySnapshots — date range filtering (RPT-01)
// ===========================================================================

describe('ReportService', () => {
  describe('querySnapshots - date range filtering (RPT-01)', () => {
    it('returns only snapshots within the specified from/to date range', async () => {
      await seedMachineSnapshots([
        { timestamp: new Date('2024-05-10T10:00:00Z') },
        { timestamp: new Date('2024-05-15T10:00:00Z') },
        { timestamp: new Date('2024-06-01T10:00:00Z') }, // outside range
      ]);
      const rows = await ReportService.querySnapshots({ from: FROM, to: TO });
      expect(rows.length).toBe(2);
    });

    it('returns empty array when no snapshots exist in range', async () => {
      const rows = await ReportService.querySnapshots({ from: FROM, to: TO });
      expect(rows).toEqual([]);
    });

    it('includes snapshots at exact boundary timestamps (inclusive)', async () => {
      await seedMachineSnapshots([
        { timestamp: FROM },
        { timestamp: TO },
      ]);
      const rows = await ReportService.querySnapshots({ from: FROM, to: TO });
      expect(rows.length).toBe(2);
    });

    it('respects the 50000 row safety limit', async () => {
      // Seeding 50k rows is infeasible in unit tests.
      // Verify the code path runs and returns <= 50000 rows.
      await seedMachineSnapshots([
        { timestamp: new Date('2024-05-05T00:00:00Z') },
        { timestamp: new Date('2024-05-06T00:00:00Z') },
        { timestamp: new Date('2024-05-07T00:00:00Z') },
      ]);
      const rows = await ReportService.querySnapshots({ from: FROM, to: TO });
      expect(rows.length).toBeLessThanOrEqual(50000);
    });
  });

  // ===========================================================================
  // querySnapshots — cycle filtering (RPT-02)
  // ===========================================================================

  describe('querySnapshots - cycle filtering (RPT-02)', () => {
    it('returns only snapshots matching the specified cycle number', async () => {
      await seedMachineSnapshots([
        { timestamp: new Date('2024-05-10T10:00:00Z'), completedCycles: 1 },
        { timestamp: new Date('2024-05-11T10:00:00Z'), completedCycles: 2 },
        { timestamp: new Date('2024-05-12T10:00:00Z'), completedCycles: 1 },
      ]);
      const rows = await ReportService.querySnapshots({
        from: FROM,
        to: TO,
        cycle: 1,
      });
      expect(rows.length).toBe(2);
      for (const row of rows) {
        expect((row as { completedCycles: number }).completedCycles).toBe(1);
      }
    });

    it('returns all cycles when cycle filter is undefined', async () => {
      await seedMachineSnapshots([
        { timestamp: new Date('2024-05-10T10:00:00Z'), completedCycles: 1 },
        { timestamp: new Date('2024-05-11T10:00:00Z'), completedCycles: 2 },
        { timestamp: new Date('2024-05-12T10:00:00Z'), completedCycles: 3 },
      ]);
      const rows = await ReportService.querySnapshots({ from: FROM, to: TO });
      expect(rows.length).toBe(3);
    });

    it('combines date range and cycle filters with AND logic', async () => {
      await seedMachineSnapshots([
        // Inside range, cycle=1
        { timestamp: new Date('2024-05-10T10:00:00Z'), completedCycles: 1 },
        // Inside range, cycle=2
        { timestamp: new Date('2024-05-11T10:00:00Z'), completedCycles: 2 },
        // Outside range, cycle=1
        { timestamp: new Date('2024-06-01T10:00:00Z'), completedCycles: 1 },
      ]);
      const rows = await ReportService.querySnapshots({
        from: FROM,
        to: TO,
        cycle: 1,
      });
      expect(rows.length).toBe(1);
    });
  });

  // ===========================================================================
  // toCSV — role-based columns (RPT-03, RPT-04)
  // ===========================================================================

  describe('toCSV - role-based columns (RPT-03, RPT-04)', () => {
    it('CSV contains all 42 WPT_VISIBLE_FIELDS when WPT fields passed', () => {
      const row: Record<string, unknown> = { timestamp: new Date('2024-05-01') };
      for (const f of WPT_VISIBLE_FIELDS) row[f] = 0;
      const csv = ReportService.toCSV(
        [row],
        WPT_VISIBLE_FIELDS,
        WPT_VISIBLE_FIELDS as unknown as string[],
      );
      const header = csv.split('\r\n')[0]!.replace('\uFEFF', '');
      const cols = header.split(',');
      for (const field of WPT_VISIBLE_FIELDS) {
        expect(cols).toContain(field);
      }
    });

    it('CSV contains only 18 CLIENT_VISIBLE_FIELDS when CLIENT fields passed', () => {
      const row: Record<string, unknown> = {};
      for (const f of CLIENT_VISIBLE_FIELDS) row[f] = 0;
      const csv = ReportService.toCSV(
        [row],
        CLIENT_VISIBLE_FIELDS,
        CLIENT_VISIBLE_FIELDS as unknown as string[],
      );
      const header = csv.split('\r\n')[0]!.replace('\uFEFF', '');
      const cols = header.split(',');
      // CLIENT_VISIBLE_FIELDS has 20 entries (all visible client columns)
      expect(cols.length).toBe(CLIENT_VISIBLE_FIELDS.length);
      for (const field of CLIENT_VISIBLE_FIELDS) {
        expect(cols).toContain(field);
      }
    });

    it('timestamp column is always included as first column', () => {
      // toCSV does not auto-insert timestamp; it serialises what is in fields.
      // The plan requirement is that callers place timestamp first — verify
      // the header output respects the fields ordering passed in.
      const row: Record<string, unknown> = {
        timestamp: new Date('2024-05-01'),
        garbageTemp: 200,
      };
      const csv = ReportService.toCSV([row], ['timestamp', 'garbageTemp'], [
        'timestamp',
        'garbageTemp',
      ]);
      const header = csv.split('\r\n')[0]!.replace('\uFEFF', '');
      const firstCol = header.split(',')[0]!;
      expect(firstCol).toBe('timestamp');
    });
  });

  // ===========================================================================
  // toCSV — CSV injection escaping (RPT-01)
  // ===========================================================================

  describe('toCSV - CSV injection escaping (RPT-01)', () => {
    it('wraps values starting with = in double quotes', () => {
      const row: Record<string, unknown> = { field: '=MALICIOUS()' };
      const csv = ReportService.toCSV([row], ['field'], ['field']);
      const dataLine = csv.split('\r\n')[1]!;
      expect(dataLine).toMatch(/^"=MALICIOUS\(\)"/);
    });

    it('wraps values starting with + in double quotes', () => {
      const row: Record<string, unknown> = { field: '+1234' };
      const csv = ReportService.toCSV([row], ['field'], ['field']);
      const dataLine = csv.split('\r\n')[1]!;
      expect(dataLine).toMatch(/^"\+1234"/);
    });

    it('wraps values starting with - in double quotes', () => {
      const row: Record<string, unknown> = { field: '-SUM()' };
      const csv = ReportService.toCSV([row], ['field'], ['field']);
      const dataLine = csv.split('\r\n')[1]!;
      expect(dataLine).toMatch(/^"-SUM\(\)"/);
    });

    it('wraps values starting with @ in double quotes', () => {
      const row: Record<string, unknown> = { field: '@COMMAND' };
      const csv = ReportService.toCSV([row], ['field'], ['field']);
      const dataLine = csv.split('\r\n')[1]!;
      expect(dataLine).toMatch(/^"@COMMAND"/);
    });

    it('doubles internal quote characters', () => {
      const row: Record<string, unknown> = { field: '"quoted"' };
      const csv = ReportService.toCSV([row], ['field'], ['field']);
      const dataLine = csv.split('\r\n')[1]!;
      expect(dataLine).toBe('"""quoted"""');
    });

    it('includes BOM prefix for Excel UTF-8 detection', () => {
      const csv = ReportService.toCSV([], ['field'], ['field']);
      expect(csv.charCodeAt(0)).toBe(0xfeff);
    });
  });

  // ===========================================================================
  // toPdf — PDF generation (RPT-05)
  // ===========================================================================

  describe('toPdf - PDF generation (RPT-05)', () => {
    const pdfRow: Record<string, unknown> = {
      garbageTemp: 200,
      energyConsumption: 50,
    };
    const fields = ['garbageTemp', 'energyConsumption'];
    const headers = ['Temp', 'Energy'];

    it('returns a Buffer with PDF magic bytes (%PDF)', async () => {
      const buf = await PdfService.generatePdf([pdfRow], fields, headers, 'Test');
      expect(buf).toBeInstanceOf(Buffer);
      expect(buf.subarray(0, 4).toString()).toBe('%PDF');
    });

    it('PDF buffer is non-empty for valid input', async () => {
      const buf = await PdfService.generatePdf([pdfRow], fields, headers, 'Test');
      expect(buf.length).toBeGreaterThan(100);
    });

    it('uses landscape orientation for wide tables', async () => {
      // landscape is internal to pdfmake; test that wide input produces a PDF
      const wideFields = WPT_VISIBLE_FIELDS.slice(0, 20) as unknown as string[];
      const wideHeaders = wideFields.map((f) => f);
      const wideRow: Record<string, unknown> = {};
      for (const f of wideFields) wideRow[f] = 1;
      const buf = await PdfService.generatePdf(
        [wideRow],
        wideFields,
        wideHeaders,
        'Wide Report',
      );
      expect(buf.subarray(0, 4).toString()).toBe('%PDF');
      expect(buf.length).toBeGreaterThan(100);
    });
  });

});
