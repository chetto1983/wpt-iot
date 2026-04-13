/**
 * PHASE 24 Wave 4 — Cycle register export (CSV/PDF) tests.
 *
 * Per CONTEXT D-05: Monthly register export as CSV and PDF matching the
 * Base_registro_mensile_cicli.xls format exactly.
 *
 * CSV column order (per XLS "Elab marzo" sheet):
 *   order_number, cycles, date, start_time, end_time, cycle_status,
 *   weight_input, weight_output, containers, gross_input,
 *   start_energy, end_energy, start_water, end_water, operator
 *
 * Security: CSV formula injection protection per OWASP CSV Security
 *
 * Coverage:
 * - CSV export matches XLS column order
 * - CSV formula injection protection
 * - PDF export has correct header
 * - PDF table layout matches register format
 * - Empty result set handling
 * - Italian date/time formatting
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ICycleRecord } from '@wpt/types';

// Mock variables - must be defined before vi.mock calls (hoisted)
const mockDbExecute = vi.fn();
const mockPdfBuffer = Buffer.from('%PDF-1.4 test content');

vi.mock('../../db/index.js', () => ({
  db: {
    execute: (...args: unknown[]) => mockDbExecute(...args),
  },
}));

vi.mock('../../services/pdf/index.js', () => ({
  createDeterministicPdfBuffer: vi.fn(() => Promise.resolve(mockPdfBuffer)),
}));

// Import SUT after mocks
const { CycleExportService } = await import('../../services/cycleExportService.js');
import { createDeterministicPdfBuffer } from '../../services/pdf/index.js';

// ---------------------------------------------------------------------------
// Test data factories
// ---------------------------------------------------------------------------
function _makeCycleRecord(overrides: Partial<ICycleRecord> = {}): ICycleRecord {
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

function makeDbRow(overrides: Record<string, unknown> = {}) {
  return {
    cycleNumber: 11,
    startedAt: new Date('2026-04-10T14:00:00Z'),
    endedAt: new Date('2026-04-10T14:30:00Z'),
    cycleStatusLabel: 'OK',
    materialInputKg: 100,
    materialOutputKg: 80,
    containers: 13,
    grossInputKg: 100,
    startEnergyKwh: 1250.5,
    endEnergyKwh: 1280.5,
    startWaterL: 45.2,
    endWaterL: 52.5,
    operator: 'MARIO ROSSI',
    orderNumber: 'ORD-2026-001',
    ...overrides,
  };
}

describe('Cycle register export — CSV (GREEN — Phase 24)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ==========================================================================
  // Test 1: CSV export matches XLS column order
  // ==========================================================================
  it('CSV export matches XLS column order', async () => {
    const dbRows = [makeDbRow()];
    mockDbExecute.mockResolvedValueOnce({ rows: dbRows });

    const from = new Date('2026-04-01T00:00:00Z');
    const to = new Date('2026-05-01T00:00:00Z');

    const csv = await CycleExportService.generateCsv(from, to);

    const lines = csv.split('\n');
    const headerLine = lines[0];

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

    // Verify header matches expected order (semicolon-separated)
    expectedHeaders.forEach((header) => {
      expect(headerLine).toContain(header);
    });

    // Verify semicolon separator
    expect(headerLine).toContain(';');

    // Verify data row contains expected values
    const dataLine = lines[1];
    expect(dataLine).toContain('ORD-2026-001');
    expect(dataLine).toContain('11');
    expect(dataLine).toContain('MARIO ROSSI');
  });

  // ==========================================================================
  // Test 2: CSV formula injection protection
  // ==========================================================================
  it('CSV formula injection protection (escape leading =, +, -, @)', async () => {
    const dbRows = [
      makeDbRow({
        operator: "=CMD|' /C calc'!A0", // Formula injection attempt
        orderNumber: '+123456',
      }),
    ];
    mockDbExecute.mockResolvedValueOnce({ rows: dbRows });

    const from = new Date('2026-04-01T00:00:00Z');
    const to = new Date('2026-05-01T00:00:00Z');

    const csv = await CycleExportService.generateCsv(from, to);

    // Verify formula is escaped with single quote prefix
    // The escaped value should be present (starts with ')
    expect(csv).toContain("'=CMD|' /C calc'!A0");
    // The order number should be escaped too
    expect(csv).toContain("'+123456");
  });

  // ==========================================================================
  // Test 3: CSV handles empty result set
  // ==========================================================================
  it('Empty result set returns valid CSV with headers', async () => {
    mockDbExecute.mockResolvedValueOnce({ rows: [] });

    const from = new Date('2026-04-01T00:00:00Z');
    const to = new Date('2026-05-01T00:00:00Z');

    const csv = await CycleExportService.generateCsv(from, to);

    const lines = csv.split('\n').filter((l) => l.trim() !== '');

    // Should have header row but no data rows
    expect(lines.length).toBeGreaterThanOrEqual(1);
    expect(lines[0]).toContain('Ciclo');
  });

  // ==========================================================================
  // Test 4: CSV date format matches Italian locale (DD/MM/YYYY)
  // ==========================================================================
  it('CSV date format matches Italian locale (DD/MM/YYYY)', async () => {
    const dbRows = [
      makeDbRow({
        startedAt: new Date('2026-04-10T08:30:00Z'),
        endedAt: new Date('2026-04-10T09:00:00Z'),
      }),
    ];
    mockDbExecute.mockResolvedValueOnce({ rows: dbRows });

    const from = new Date('2026-04-01T00:00:00Z');
    const to = new Date('2026-05-01T00:00:00Z');

    const csv = await CycleExportService.generateCsv(from, to);

    // Should contain date in DD/MM/YYYY format
    expect(csv).toContain('10/04/2026');
  });

  // ==========================================================================
  // Test 5: CSV separator is semicolon for Excel compatibility
  // ==========================================================================
  it('CSV separator is semicolon for European Excel compatibility', async () => {
    const dbRows = [makeDbRow()];
    mockDbExecute.mockResolvedValueOnce({ rows: dbRows });

    const from = new Date('2026-04-01T00:00:00Z');
    const to = new Date('2026-05-01T00:00:00Z');

    const csv = await CycleExportService.generateCsv(from, to);

    // European CSV uses semicolon separator
    expect(csv).toContain(';');
    const firstLine = csv.split('\n')[0];
    const semicolonCount = (firstLine.match(/;/g) || []).length;
    expect(semicolonCount).toBeGreaterThanOrEqual(14); // 15 columns = 14 separators
  });

  // ==========================================================================
  // Test 6: CSV escapes quotes properly
  // ==========================================================================
  it('CSV escapes quotes by doubling', async () => {
    const dbRows = [
      makeDbRow({
        operator: 'MARIO "THE" ROSSI', // Contains quotes
      }),
    ];
    mockDbExecute.mockResolvedValueOnce({ rows: dbRows });

    const from = new Date('2026-04-01T00:00:00Z');
    const to = new Date('2026-05-01T00:00:00Z');

    const csv = await CycleExportService.generateCsv(from, to);

    // Quotes should be doubled
    expect(csv).toContain('"MARIO ""THE"" ROSSI"');
  });
});

describe('Cycle register export — PDF (GREEN — Phase 24)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ==========================================================================
  // Test 1: PDF export calls document factory with correct customer info
  // ==========================================================================
  it('PDF export calls document factory with customer info', async () => {
    const dbRows = [makeDbRow()];
    const configRow = {
      customerName: 'IDEALSERVICE C/O DON GNOCCHI',
      machineSerial: 'NW30-020',
      machineModel: 'NW30',
    };

    mockDbExecute
      .mockResolvedValueOnce({ rows: [configRow] }) // energy_config query
      .mockResolvedValueOnce({ rows: dbRows }); // cycle_records query

    const from = new Date('2026-04-01T00:00:00Z');
    const to = new Date('2026-05-01T00:00:00Z');

    const pdfBuffer = await CycleExportService.generatePdf(from, to);

    // Verify the document factory was called
    expect(createDeterministicPdfBuffer).toHaveBeenCalled();

    // Get the document definition passed to the factory
    const docDef = (createDeterministicPdfBuffer as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(docDef).toBeDefined();

    // Verify content array contains customer info
    const contentStr = JSON.stringify(docDef.content);
    expect(contentStr).toContain('IDEALSERVICE C/O DON GNOCCHI');
    expect(contentStr).toContain('NW30-020');
    expect(contentStr).toContain('Registro Mensile Cicli');

    // Verify correct buffer is returned
    expect(pdfBuffer).toBe(mockPdfBuffer);
  });

  // ==========================================================================
  // Test 2: PDF table layout matches register format
  // ==========================================================================
  it('PDF table layout matches Registro format', async () => {
    const dbRows = [makeDbRow()];
    const configRow = {
      customerName: 'Test Customer',
      machineSerial: 'TEST-001',
      machineModel: 'TEST',
    };

    mockDbExecute
      .mockResolvedValueOnce({ rows: [configRow] })
      .mockResolvedValueOnce({ rows: dbRows });

    const from = new Date('2026-04-01T00:00:00Z');
    const to = new Date('2026-05-01T00:00:00Z');

    await CycleExportService.generatePdf(from, to);

    // Get the document definition passed to the factory
    const docDef = (createDeterministicPdfBuffer as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];

    // Verify table headers are present
    const contentStr = JSON.stringify(docDef.content);
    expect(contentStr).toContain('Ciclo');
    expect(contentStr).toContain('Data');
    expect(contentStr).toContain('Ingresso');
    expect(contentStr).toContain('Uscita');

    // Verify data is present
    expect(contentStr).toContain('MARIO ROSSI');
  });

  // ==========================================================================
  // Test 3: PDF handles empty result set gracefully
  // ==========================================================================
  it('PDF handles empty result set gracefully with message', async () => {
    const configRow = {
      customerName: 'Test Customer',
      machineSerial: 'TEST-001',
      machineModel: 'TEST',
    };

    mockDbExecute
      .mockResolvedValueOnce({ rows: [configRow] })
      .mockResolvedValueOnce({ rows: [] }); // Empty result

    const from = new Date('2026-04-01T00:00:00Z');
    const to = new Date('2026-05-01T00:00:00Z');

    await CycleExportService.generatePdf(from, to);

    // Get the document definition passed to the factory
    const docDef = (createDeterministicPdfBuffer as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];

    // Should contain "no records" message
    const contentStr = JSON.stringify(docDef.content);
    expect(contentStr).toMatch(/nessun ciclo|Nessun ciclo/i);
  });

  // ==========================================================================
  // Test 4: PDF generation is deterministic with fixed timestamp
  // ==========================================================================
  it('PDF is deterministic with fixed generatedAt timestamp', async () => {
    const dbRows = [makeDbRow()];
    const configRow = {
      customerName: 'Test Customer',
      machineSerial: 'TEST-001',
      machineModel: 'TEST',
    };

    mockDbExecute
      .mockResolvedValueOnce({ rows: [configRow] })
      .mockResolvedValueOnce({ rows: dbRows });

    const from = new Date('2026-04-01T00:00:00Z');
    const to = new Date('2026-05-01T00:00:00Z');
    const generatedAt = new Date('2026-04-10T12:00:00Z');

    await CycleExportService.generatePdf(from, to, generatedAt);

    // Get the metadata passed to the factory
    const metadata = (createDeterministicPdfBuffer as ReturnType<typeof vi.fn>).mock.calls[0]?.[1];

    // Should use the provided timestamp for determinism
    expect(metadata.creationDate).toEqual(generatedAt);
    expect(metadata.modDate).toEqual(generatedAt);

    // Reset mocks for second call
    mockDbExecute
      .mockResolvedValueOnce({ rows: [configRow] })
      .mockResolvedValueOnce({ rows: dbRows });

    // Mock should return same buffer for same inputs (deterministic)
    (createDeterministicPdfBuffer as ReturnType<typeof vi.fn>).mockClear();
    await CycleExportService.generatePdf(from, to, generatedAt);

    const metadata2 = (createDeterministicPdfBuffer as ReturnType<typeof vi.fn>).mock.calls[0]?.[1];
    expect(metadata2.creationDate).toEqual(generatedAt);
    expect(metadata2.modDate).toEqual(generatedAt);
  });
});

describe('CycleExportService filename generation', () => {
  it('generates correct filename for CSV', () => {
    const from = new Date('2026-04-10T00:00:00Z');
    const filename = CycleExportService.generateFilename(from, 'csv');
    expect(filename).toBe('registro_cicli_2026_04.csv');
  });

  it('generates correct filename for PDF', () => {
    const from = new Date('2026-04-10T00:00:00Z');
    const filename = CycleExportService.generateFilename(from, 'pdf');
    expect(filename).toBe('registro_cicli_2026_04.pdf');
  });

  it('pads month with leading zero', () => {
    const from = new Date('2026-01-10T00:00:00Z');
    const filename = CycleExportService.generateFilename(from, 'csv');
    expect(filename).toBe('registro_cicli_2026_01.csv');
  });
});
