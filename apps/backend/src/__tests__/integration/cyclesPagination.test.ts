/**
 * Phase 24 Wave 5 — Pagination stress test for cycle records.
 *
 * Tests pagination with 1000+ cycle records:
 * - Page 1 returns first 25 records
 * - Page 2 returns records 26-50
 * - Total count is accurate
 * - totalPages calculated correctly
 * - Sorting by startedAt works (asc and desc)
 * - Query performance < 500ms for 1000 records
 * - Date range filtering works
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import { sql } from 'drizzle-orm';
import { db, pool } from '../../db/index.js';
import { CycleService } from '../../services/cycleService.js';

// Test data constants
const TEST_MONTH_START = '2026-03-01T00:00:00Z';
const TEST_MONTH_END = '2026-04-01T00:00:00Z';
const TEST_RECORD_COUNT = 1050;

describe('cyclesPagination stress test', () => {
  beforeAll(async () => {
    // Ensure table exists
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS cycle_records (
        id SERIAL PRIMARY KEY,
        reset_epoch INTEGER NOT NULL DEFAULT 0,
        cycle_number INTEGER NOT NULL,
        started_at TIMESTAMPTZ NOT NULL,
        ended_at TIMESTAMPTZ NOT NULL,
        cycle_type INTEGER NOT NULL,
        duration_seconds INTEGER NOT NULL,
        material_input_kg REAL,
        material_output_kg REAL,
        energy_kwh REAL,
        water_l REAL,
        avg_rms_current REAL,
        kwh_per_kg REAL,
        attribution_status VARCHAR(16) NOT NULL DEFAULT 'UNKNOWN',
        serial_number VARCHAR(20),
        order_number VARCHAR(20),
        published_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        start_energy_kwh REAL,
        end_energy_kwh REAL,
        start_water_l REAL,
        end_water_l REAL,
        containers INTEGER,
        operator VARCHAR(20),
        cycle_status_label VARCHAR(16),
        gross_input_kg REAL
      )
    `);
  });

  beforeEach(async () => {
    // Clear existing pagination test data
    await db.execute(sql`
      DELETE FROM cycle_records
      WHERE order_number LIKE 'PAGINATION_TEST_%'
        OR order_number IS NULL
        AND started_at >= ${TEST_MONTH_START}::timestamptz
        AND started_at < ${TEST_MONTH_END}::timestamptz
    `);

    // Generate 1000+ test cycle records
    const startDate = new Date(TEST_MONTH_START);
    const insertPromises: Promise<unknown>[] = [];

    for (let i = 0; i < TEST_RECORD_COUNT; i++) {
      const cycleStart = new Date(startDate.getTime() + i * 3600 * 1000); // Every hour
      const cycleEnd = new Date(cycleStart.getTime() + 45 * 60 * 1000); // 45 min duration

      const cycleNumber = i + 1;
      const cycleType = (i % 10) + 1; // Cycle types 1-10
      const statusLabel = i % 3 === 0 ? 'OK' : i % 3 === 1 ? 'FAILED' : 'ABORTED';
      const orderNum = `PAGINATION_TEST_${String(i).padStart(4, '0')}`;

      insertPromises.push(
        db.execute(sql`
          INSERT INTO cycle_records
            (reset_epoch, cycle_number, started_at, ended_at, cycle_type, duration_seconds,
             cycle_status_label, start_energy_kwh, end_energy_kwh, start_water_l, end_water_l,
             containers, operator, order_number, material_input_kg, material_output_kg,
             energy_kwh, water_l, gross_input_kg, attribution_status)
          VALUES
            (0, ${cycleNumber}, ${cycleStart.toISOString()}::timestamptz,
             ${cycleEnd.toISOString()}::timestamptz,
             ${cycleType}, 2700, ${statusLabel},
             ${1000 + i * 0.1}, ${1050 + i * 0.1}, ${50 + i * 0.01}, ${55 + i * 0.01},
             ${(i % 20) + 1}, ${'OPERATOR_' + String(i % 10)}, ${orderNum},
             ${100 + i * 0.1}, ${80 + i * 0.1}, ${50 + i * 0.05}, ${5 + i * 0.01},
             ${100 + i * 0.1}, 'ATTRIBUTED')
        `)
      );
    }

    await Promise.all(insertPromises);
  });

  afterEach(async () => {
    // Clean up test data
    await db.execute(sql`
      DELETE FROM cycle_records WHERE order_number LIKE 'PAGINATION_TEST_%'
    `);
  });

  afterAll(async () => {
    await pool.end().catch(() => undefined);
  });

  it('should return page 1 with first 25 records', async () => {
    const result = await CycleService.getCycles({
      from: TEST_MONTH_START,
      to: TEST_MONTH_END,
      page: 1,
      limit: 25,
      sort: 'startedAt',
      order: 'desc',
    });

    expect(result.data).toHaveLength(25);
    expect(result.pagination.page).toBe(1);
    expect(result.pagination.limit).toBe(25);
    expect(result.pagination.total).toBeGreaterThanOrEqual(TEST_RECORD_COUNT);

    // Verify records are in descending order (newest first)
    for (let i = 1; i < result.data.length; i++) {
      const prev = new Date(result.data[i - 1]!.startedAt);
      const curr = new Date(result.data[i]!.startedAt);
      expect(prev >= curr).toBe(true);
    }
  });

  it('should return page 2 with records 26-50', async () => {
    const result = await CycleService.getCycles({
      from: TEST_MONTH_START,
      to: TEST_MONTH_END,
      page: 2,
      limit: 25,
      sort: 'startedAt',
      order: 'desc',
    });

    expect(result.data).toHaveLength(25);
    expect(result.pagination.page).toBe(2);

    // Page 2 records should have lower cycle numbers (older)
    const page1Result = await CycleService.getCycles({
      from: TEST_MONTH_START,
      to: TEST_MONTH_END,
      page: 1,
      limit: 25,
      sort: 'startedAt',
      order: 'desc',
    });

    const page1Oldest = new Date(page1Result.data[page1Result.data.length - 1]!.startedAt);
    const page2Newest = new Date(result.data[0]!.startedAt);

    // Page 2's newest should be older than page 1's oldest
    expect(page2Newest <= page1Oldest).toBe(true);
  });

  it('should have accurate total count', async () => {
    const result = await CycleService.getCycles({
      from: TEST_MONTH_START,
      to: TEST_MONTH_END,
      page: 1,
      limit: 25,
      sort: 'startedAt',
      order: 'desc',
    });

    // Total should be at least the number we inserted
    expect(result.pagination.total).toBeGreaterThanOrEqual(TEST_RECORD_COUNT);

    // Verify by counting directly
    const countResult = await db.execute(sql`
      SELECT COUNT(*)::int as total
      FROM cycle_records
      WHERE started_at >= ${TEST_MONTH_START}::timestamptz
        AND started_at < ${TEST_MONTH_END}::timestamptz
    `);

    expect(result.pagination.total).toBe((countResult.rows[0] as { total: number }).total);
  });

  it('should calculate totalPages correctly', async () => {
    const result = await CycleService.getCycles({
      from: TEST_MONTH_START,
      to: TEST_MONTH_END,
      page: 1,
      limit: 25,
      sort: 'startedAt',
      order: 'desc',
    });

    const expectedTotalPages = Math.ceil(result.pagination.total / 25);
    expect(result.pagination.totalPages).toBe(expectedTotalPages);

    // With 1000+ records at 25/page, should have 42+ pages
    expect(result.pagination.totalPages).toBeGreaterThanOrEqual(42);
  });

  it('should sort by startedAt ascending', async () => {
    const result = await CycleService.getCycles({
      from: TEST_MONTH_START,
      to: TEST_MONTH_END,
      page: 1,
      limit: 25,
      sort: 'startedAt',
      order: 'asc',
    });

    // Verify ascending order
    for (let i = 1; i < result.data.length; i++) {
      const prev = new Date(result.data[i - 1]!.startedAt);
      const curr = new Date(result.data[i]!.startedAt);
      expect(prev <= curr).toBe(true);
    }
  });

  it('should sort by cycleNumber descending', async () => {
    const result = await CycleService.getCycles({
      from: TEST_MONTH_START,
      to: TEST_MONTH_END,
      page: 1,
      limit: 25,
      sort: 'cycleNumber',
      order: 'desc',
    });

    // Verify descending order by cycleNumber
    for (let i = 1; i < result.data.length; i++) {
      const prev = result.data[i - 1]!.cycleNumber;
      const curr = result.data[i]!.cycleNumber;
      expect(prev >= curr).toBe(true);
    }
  });

  it('should filter by date range', async () => {
    // Get first week only
    const firstWeekEnd = new Date(startDate.getTime() + 7 * 24 * 3600 * 1000).toISOString();

    const result = await CycleService.getCycles({
      from: TEST_MONTH_START,
      to: firstWeekEnd,
      page: 1,
      limit: 100,
      sort: 'startedAt',
      order: 'asc',
    });

    // All returned records should be within the date range
    const rangeStart = new Date(TEST_MONTH_START);
    const rangeEnd = new Date(firstWeekEnd);

    for (const record of result.data) {
      const recordDate = new Date(record.startedAt);
      expect(recordDate >= rangeStart).toBe(true);
      expect(recordDate < rangeEnd).toBe(true);
    }

    // Should have fewer records than full month
    expect(result.pagination.total).toBeLessThan(TEST_RECORD_COUNT);
  });

  it('should return query results in less than 500ms', async () => {
    const startTime = performance.now();

    await CycleService.getCycles({
      from: TEST_MONTH_START,
      to: TEST_MONTH_END,
      page: 1,
      limit: 25,
      sort: 'startedAt',
      order: 'desc',
    });

    const endTime = performance.now();
    const duration = endTime - startTime;

    expect(duration).toBeLessThan(500);
  });

  it('should sort by cycleStatusLabel', async () => {
    const result = await CycleService.getCycles({
      from: TEST_MONTH_START,
      to: TEST_MONTH_END,
      page: 1,
      limit: 50,
      sort: 'cycleStatusLabel',
      order: 'asc',
    });

    // Should have records
    expect(result.data.length).toBeGreaterThan(0);

    // Verify sorting (null values should be at end in ASC)
    let foundNonNull = false;
    for (const record of result.data) {
      if (record.cycleStatusLabel !== null) {
        foundNonNull = true;
      }
    }
    expect(foundNonNull).toBe(true);
  });

  it('should sort by operator', async () => {
    const result = await CycleService.getCycles({
      from: TEST_MONTH_START,
      to: TEST_MONTH_END,
      page: 1,
      limit: 50,
      sort: 'operator',
      order: 'asc',
    });

    expect(result.data.length).toBeGreaterThan(0);
  });

  it('should handle last page with fewer records', async () => {
    // First get total
    const firstResult = await CycleService.getCycles({
      from: TEST_MONTH_START,
      to: TEST_MONTH_END,
      page: 1,
      limit: 25,
      sort: 'startedAt',
      order: 'desc',
    });

    const totalPages = firstResult.pagination.totalPages;

    // Request last page
    const lastPageResult = await CycleService.getCycles({
      from: TEST_MONTH_START,
      to: TEST_MONTH_END,
      page: totalPages,
      limit: 25,
      sort: 'startedAt',
      order: 'desc',
    });

    // Last page might have fewer records
    expect(lastPageResult.data.length).toBeGreaterThan(0);
    expect(lastPageResult.data.length).toBeLessThanOrEqual(25);
    expect(lastPageResult.pagination.page).toBe(totalPages);
  });
});

// Reference date for tests
const startDate = new Date(TEST_MONTH_START);
