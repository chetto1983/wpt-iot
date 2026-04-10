import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ICycleRecord } from '@wpt/types';

/**
 * PHASE 24 Wave 0 — Cycle register export (CSV/PDF) test scaffold.
 *
 * Per CONTEXT D-05: Monthly register export as CSV and PDF, matching the
 * Base_registro_mensile_cicli.xls format exactly.
 *
 * CSV column order (per XLS "Registro" sheet):
 *   order_number, cycles, date, start_time, end_time, cycle_status,
 *   weight_input, weight_output, containers, gross_input,
 *   start_energy, end_energy, start_water, end_water, operator
 *
 * PDF layout:
 *   - Header: customer name, machine serial, month/year from energy_config
 *   - Table: same columns as CSV
 *   - Footer: page numbers, generation timestamp
 *
 * Security: CSV formula injection protection (OWASP CSV Security)
 *
 * All tests currently FAIL (RED phase) — implementation in Wave 3.
 */

// ---------------------------------------------------------------------------
// Mock pdf-make and other dependencies
// ---------------------------------------------------------------------------
const mockPdfCreate = vi.fn();

vi.mock('pdfmake/build/pdfmake.js', () => ({
  default: {
    createPdfKitDocument: mockPdfCreate,
  },
}));

vi.mock('pdfmake/build/vfs_fonts.js', () => ({
  default: {
    pdfMake: {
      vfs: {},
    },
  },
}));

// Import SUT after mocks
// Note: Implementation will be in CycleExportService
// const { CycleExportService } = await import('../../services/cycleExportService.js');

// ---------------------------------------------------------------------------
// Test data factories
// ---------------------------------------------------------------------------
function makeCycleRecord(overrides: Partial<ICycleRecord> = {}): ICycleRecord {
  const now = new Date('2026-04-10T14:30:00Z');
  const startedAt = new Date('2026-04-10T14:00:00Z');
  return {
    cycleNumber: 11,
    resetEpoch: 0,
    startedAt,
    endedAt: now,
    cycleType: 3,
    durationSeconds: 1800,
    materialInputKg: 100,
    materialOutputKg: 80,
    energyKwh: 30,
    waterL: 7.3,
    avgRmsCurrent: 15.5,
    kwhPerKg: 0.375,
    attributionStatus: 'ATTRIBUTED' as const,
    serialNumber: 'SN-001',
    orderNumber: 'ORD-2026-001',
    publishedAt: null,
    startEnergyKwh: 1250.5,
    endEnergyKwh: 1280.5,
    startWaterL: 45.2,
    endWaterL: 52.5,
    containers: 13,
    operator: 'MARIO ROSSI',
    cycleStatusLabel: 'OK',
    grossInputKg: 100,
    ...overrides,
  };
}

function makeEnergyConfig() {
  return {
    customerName: 'IDEALSERVICE C/O DON GNOCCHI',
    machineSerial: 'NW30-020',
    machineModel: 'NW30',
    installSite: 'Milano',
  };
}

describe('Cycle register export — CSV (RED — Phase 24)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ==========================================================================
  // Test 1: CSV export matches XLS column order
  // ==========================================================================
  it('CSV export matches XLS column order', async () => {
    const records = [makeCycleRecord()];
    const config = makeEnergyConfig();

    // const csv = await CycleExportService.exportCsv(records, config);
    const csv = ''; // Placeholder — will fail

    // Expected column headers in Italian per XLS template
    const expectedHeaders = [
      'Numero Ordine',
      'Ciclo',
      'Data',
      'Ora Inizio',
      'Ora Fine',
      'Stato Ciclo',
      'Ingresso Netto (kg)',
      'Uscita Netta (kg)',
      'Numero Bidoni',
      'Ingresso Lordo (kg)',
      'Energia Inizio (kWh)',
      'Energia Fine (kWh)',
      'Acqua Inizio (L)',
      'Acqua Fine (L)',
      'Operatore',
    ];

    const lines = csv.split('\n');
    const headerLine = lines[0];

    // Verify header matches expected order
    expectedHeaders.forEach((header) => {
      expect(headerLine).toContain(header);
    });
  });

  // ==========================================================================
  // Test 2: CSV formula injection protection
  // ==========================================================================
  it('CSV formula injection protection (escape leading =, +, -, @)', async () => {
    const maliciousRecord = makeCycleRecord({
      operator: '=CMD|\' /C calc\'!A0', // Formula injection attempt
      orderNumber: '+123456',
    });

    // const csv = await CycleExportService.exportCsv([maliciousRecord], makeEnergyConfig());
    const csv = ''; // Placeholder

    // Verify dangerous characters are escaped
    expect(csv).not.toContain('=CMD');
    expect(csv).toContain("'=CMD"); // Should be prefixed with single quote
    expect(csv).not.toMatch(/^\+123456/m); // Should not start with +
  });

  // ==========================================================================
  // Test 3: Date range filtering works correctly
  // ==========================================================================
  it('Date range filtering uses [from, to) half-open interval', async () => {
    const from = new Date('2026-04-01T00:00:00Z');
    const to = new Date('2026-04-30T23:59:59Z');

    const records = [
      makeCycleRecord({ endedAt: new Date('2026-03-31T23:59:59Z') }), // Before range
      makeCycleRecord({ endedAt: new Date('2026-04-01T00:00:00Z') }), // At start (include)
      makeCycleRecord({ endedAt: new Date('2026-04-15T12:00:00Z') }), // In range
      makeCycleRecord({ endedAt: new Date('2026-04-30T23:59:59Z') }), // At end (exclude)
      makeCycleRecord({ endedAt: new Date('2026-05-01T00:00:00Z') }), // After range
    ];

    // const filtered = await CycleExportService.filterByDateRange(records, from, to);
    const filtered: ICycleRecord[] = []; // Placeholder

    // Should include records 2 and 3 (within [from, to))
    expect(filtered).toHaveLength(2);
    expect(filtered[0]?.cycleNumber).toBe(11); // At start
    expect(filtered[1]?.cycleNumber).toBe(11); // In range
  });

  // ==========================================================================
  // Test 4: Empty result set returns valid empty CSV
  // ==========================================================================
  it('Empty result set returns valid empty CSV with headers', async () => {
    // const csv = await CycleExportService.exportCsv([], makeEnergyConfig());
    const csv = ''; // Placeholder

    const lines = csv.split('\n').filter((l) => l.trim() !== '');

    // Should have header row but no data rows
    expect(lines.length).toBeGreaterThanOrEqual(1);
    expect(lines[0]).toContain('Ciclo');
  });

  // ==========================================================================
  // Test 5: CSV date format matches Italian locale (DD/MM/YYYY)
  // ==========================================================================
  it('CSV date format matches Italian locale (DD/MM/YYYY)', async () => {
    const record = makeCycleRecord({
      startedAt: new Date('2026-04-10T08:30:00Z'),
      endedAt: new Date('2026-04-10T09:00:00Z'),
    });

    // const csv = await CycleExportService.exportCsv([record], makeEnergyConfig());
    const csv = ''; // Placeholder

    // Should contain date in DD/MM/YYYY format
    expect(csv).toContain('10/04/2026');
    // Time format should be HH:MM
    expect(csv).toMatch(/08:30/);
    expect(csv).toMatch(/09:00/);
  });

  // ==========================================================================
  // Test 6: CSV separator is semicolon for Excel compatibility
  // ==========================================================================
  it('CSV separator is semicolon for European Excel compatibility', async () => {
    const record = makeCycleRecord();

    // const csv = await CycleExportService.exportCsv([record], makeEnergyConfig());
    const csv = ''; // Placeholder

    // European CSV uses semicolon separator
    expect(csv).toContain(';');
    // Should not use comma as separator (to avoid decimal point confusion)
    const firstLine = csv.split('\n')[0];
    const commaCount = (firstLine.match(/,/g) || []).length;
    const semicolonCount = (firstLine.match(/;/g) || []).length;
    expect(semicolonCount).toBeGreaterThan(commaCount);
  });
});

describe('Cycle register export — PDF (RED — Phase 24)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ==========================================================================
  // Test 1: PDF export has correct header
  // ==========================================================================
  it('PDF export has correct header (customer, machine, month)', async () => {
    const records = [makeCycleRecord()];
    const config = makeEnergyConfig();

    // const pdfBuffer = await CycleExportService.exportPdf(records, config, '2026-04');
    // mockPdfCreate should have been called with document definition

    expect(mockPdfCreate).toHaveBeenCalled();

    const docDefinition = mockPdfCreate.mock.calls[0]?.[0];

    // Verify header contains customer info
    const headerText = JSON.stringify(docDefinition);
    expect(headerText).toContain('IDEALSERVICE C/O DON GNOCCHI');
    expect(headerText).toContain('NW30-020');
    expect(headerText).toContain('MARZO 2026'); // or current month
  });

  // ==========================================================================
  // Test 2: PDF table layout matches register format
  // ==========================================================================
  it('PDF table layout matches Registro and Elab sheet layouts', async () => {
    const records = [makeCycleRecord()];

    // const pdfBuffer = await CycleExportService.exportPdf(records, makeEnergyConfig(), '2026-04');

    expect(mockPdfCreate).toHaveBeenCalled();

    const docDefinition = mockPdfCreate.mock.calls[0]?.[0];
    const content = docDefinition?.content || [];

    // Find table in content
    const table = content.find((c: { table?: unknown }) => c.table);
    expect(table).toBeDefined();

    // Verify table has correct number of columns
    const headerRow = table?.table?.headerRows;
    expect(headerRow).toBeGreaterThanOrEqual(1);

    // Verify column headers match XLS format
    const headers = table?.table?.body?.[0] || [];
    expect(headers.length).toBe(15); // 15 columns per spec
  });

  // ==========================================================================
  // Test 3: PDF includes page numbers and generation timestamp
  // ==========================================================================
  it('PDF includes page numbers and generation timestamp', async () => {
    const records = [makeCycleRecord()];

    // await CycleExportService.exportPdf(records, makeEnergyConfig(), '2026-04');

    const docDefinition = mockPdfCreate.mock.calls[0]?.[0];

    // Verify footer function exists
    expect(docDefinition?.footer).toBeDefined();

    // Check for page number in footer structure
    const footerText = JSON.stringify(docDefinition);
    expect(footerText).toMatch(/page|pagina/i);
  });

  // ==========================================================================
  // Test 4: PDF status badges show correct colors
  // ==========================================================================
  it('PDF status badges show correct colors (OK=green, FAILED=red, ABORTED=amber)', async () => {
    const records = [
      makeCycleRecord({ cycleStatusLabel: 'OK' }),
      makeCycleRecord({ cycleStatusLabel: 'FAILED', cycleNumber: 12 }),
      makeCycleRecord({ cycleStatusLabel: 'ABORTED', cycleNumber: 13 }),
    ];

    // await CycleExportService.exportPdf(records, makeEnergyConfig(), '2026-04');

    const docDefinition = mockPdfCreate.mock.calls[0]?.[0];
    const content = JSON.stringify(docDefinition);

    // Verify color definitions exist for status badges
    expect(content).toMatch(/#1ABC9C|green/i); // OK - teal/green
    expect(content).toMatch(/#dc3545|red/i); // FAILED - red
    expect(content).toMatch(/#f59e0b|amber|orange/i); // ABORTED - amber
  });

  // ==========================================================================
  // Test 5: PDF handles empty result set gracefully
  // ==========================================================================
  it('PDF handles empty result set gracefully with message', async () => {
    // await CycleExportService.exportPdf([], makeEnergyConfig(), '2026-04');

    const docDefinition = mockPdfCreate.mock.calls[0]?.[0];
    const content = JSON.stringify(docDefinition);

    // Should contain "no records" or similar message
    expect(content).toMatch(/nessun ciclo|no cycles|empty/i);
  });

  // ==========================================================================
  // Test 6: PDF column widths match XLS proportions
  // ==========================================================================
  it('PDF column widths match XLS proportions for readability', async () => {
    const records = [makeCycleRecord()];

    // await CycleExportService.exportPdf(records, makeEnergyConfig(), '2026-04');

    const docDefinition = mockPdfCreate.mock.calls[0]?.[0];
    const content = docDefinition?.content || [];
    const table = content.find((c: { table?: unknown }) => c.table);

    // Verify widths are defined and sum reasonably
    const widths = table?.table?.widths;
    expect(widths).toBeDefined();
    expect(widths.length).toBe(15);
  });
});
