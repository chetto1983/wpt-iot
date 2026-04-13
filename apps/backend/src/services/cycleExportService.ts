/**
 * Phase 24 Wave 4 — CycleExportService for CSV and PDF export.
 *
 * Per CONTEXT D-05: Monthly register export as CSV and PDF matching the
 * Base_registro_mensile_cicli.xls format exactly for ISO 50001 audit trails.
 *
 * CSV column order (per XLS "Elab marzo" sheet):
 *   order_number, cycles, date, start_time, end_time, cycle_status,
 *   weight_input, weight_output, containers, gross_input,
 *   start_energy, end_energy, start_water, end_water, operator
 *
 * PDF layout: Header with customer/machine/month, table matching Registro view.
 *
 * Security: CSV formula injection protection per OWASP (escape =, +, -, @ with ' prefix).
 */

import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { createDeterministicPdfBuffer } from './pdfDocumentFactory.js';
import { formatItDate, formatItDateTime } from '@wpt/types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ICycleRecord {
  cycleNumber: number;
  startedAt: Date;
  endedAt: Date;
  cycleStatusLabel: string | null;
  materialInputKg: number | null;
  materialOutputKg: number | null;
  containers: number | null;
  grossInputKg: number | null;
  startEnergyKwh: number | null;
  endEnergyKwh: number | null;
  startWaterL: number | null;
  endWaterL: number | null;
  operator: string | null;
  orderNumber: string | null;
}

interface IEnergyConfig {
  customerName: string;
  machineSerial: string;
  machineModel: string;
}

// ---------------------------------------------------------------------------
// CSV Helpers
// ---------------------------------------------------------------------------

/**
 * Escape CSV value per OWASP CSV Security guidelines.
 *
 * - Escape values starting with =, +, -, @, tab, carriage return with ' prefix
 * - Escape quotes by doubling
 * - Wrap in quotes if contains comma, semicolon, or newline
 */
function escapeCsv(value: string | number | null | undefined): string {
  if (value == null || value === undefined) return '';
  const str = String(value);

  // Escape formula injection characters (OWASP CSV Security)
  if (/^[+\-=@\t\r]/.test(str)) {
    return `'${str}`;
  }

  // Escape quotes by doubling
  if (str.includes('"')) {
    return `"${str.replace(/"/g, '""')}"`;
  }

  // Wrap in quotes if contains separator characters or newline
  if (str.includes(',') || str.includes(';') || str.includes('\n') || str.includes('\r')) {
    return `"${str}"`;
  }

  return str;
}

/**
 * Format time as HH:MM from Date.
 */
function formatTime(d: Date): string {
  return new Intl.DateTimeFormat('it-IT', {
    timeZone: 'Europe/Rome',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(d);
}

/**
 * Format month-year for filename: YYYY_MM (e.g., 2026_04).
 */
function formatMonthYear(d: Date): string {
  return `${d.getUTCFullYear()}_${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/**
 * Format month-year for PDF header: "Aprile 2026" / "MARZO 2026".
 */
function formatMonthYearItalian(d: Date, uppercase = false): string {
  const monthNames: readonly string[] = [
    'gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno',
    'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre',
  ];
  const monthIdx = d.getUTCMonth();
  const month = monthNames[monthIdx] ?? 'sconosciuto';
  const year = d.getUTCFullYear();
  if (uppercase) {
    return `${month.toUpperCase()} ${year}`;
  }
  return `${month.charAt(0).toUpperCase() + month.slice(1)} ${year}`;
}

// ---------------------------------------------------------------------------
// CSV Generation
// ---------------------------------------------------------------------------

/**
 * Generate CSV content for cycle register export.
 *
 * Uses semicolon separator for European Excel compatibility.
 * Column order matches XLS "Elab marzo" sheet exactly.
 */
function buildCsvContent(records: ICycleRecord[]): string {
  // Header row in Italian (matching XLS column order)
  const headers = [
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

  const headerLine = headers.map(escapeCsv).join(';');

  // Data rows
  const dataLines = records.map((r) => {
    const values = [
      r.orderNumber ?? '',           // Numero Ordine
      r.cycleNumber,                 // Ciclo
      formatItDate(r.startedAt),     // Data
      formatTime(r.startedAt),       // Ora Inizio
      formatTime(r.endedAt),         // Ora Fine
      r.cycleStatusLabel ?? '',      // Stato Ciclo
      r.materialInputKg ?? '',       // Ingresso Netto (kg)
      r.materialOutputKg ?? '',      // Uscita Netta (kg)
      r.containers ?? '',            // Numero Bidoni
      r.grossInputKg ?? '',          // Ingresso Lordo (kg)
      r.startEnergyKwh ?? '',        // Energia Inizio (kWh)
      r.endEnergyKwh ?? '',          // Energia Fine (kWh)
      r.startWaterL ?? '',           // Acqua Inizio (L)
      r.endWaterL ?? '',             // Acqua Fine (L)
      r.operator ?? '',              // Operatore
    ];
    return values.map(escapeCsv).join(';');
  });

  return [headerLine, ...dataLines].join('\n');
}

// ---------------------------------------------------------------------------
// PDF Generation
// ---------------------------------------------------------------------------

/**
 * Build pdfmake document definition for cycle register PDF.
 *
 * Uses landscape A4 for wide table, includes header with customer info.
 */
function buildPdfDocumentDefinition(
  records: ICycleRecord[],
  config: IEnergyConfig,
  fromDate: Date,
  generatedAt: Date,
) {
  const monthYear = formatMonthYearItalian(fromDate, true);

  // Table headers (Italian)
  const tableHeaders = [
    'Ciclo', 'Data', 'Inizio', 'Fine', 'Stato',
    'Ingresso kg', 'Uscita kg', 'Bidoni', 'Lordo kg',
    'En. Inizio', 'En. Fine', 'H₂O Inizio', 'H₂O Fine', 'Operatore',
  ];

  // Table data rows
  const tableRows = records.map((r) => [
    r.cycleNumber,
    formatItDate(r.startedAt),
    formatTime(r.startedAt),
    formatTime(r.endedAt),
    r.cycleStatusLabel ?? '',
    r.materialInputKg?.toFixed(2) ?? '',
    r.materialOutputKg?.toFixed(2) ?? '',
    r.containers ?? '',
    r.grossInputKg?.toFixed(2) ?? '',
    r.startEnergyKwh?.toFixed(2) ?? '',
    r.endEnergyKwh?.toFixed(2) ?? '',
    r.startWaterL?.toFixed(2) ?? '',
    r.endWaterL?.toFixed(2) ?? '',
    r.operator ?? '',
  ]);

  // Build content array
  const content: unknown[] = [
    // Customer info
    { text: config.customerName || 'Cliente', style: 'customer' },
    {
      text: `Matricola: ${config.machineSerial || 'N/A'}${config.machineModel ? ` (${config.machineModel})` : ''}`,
      style: 'subtitle',
    },
    { text: `Registro Mensile Cicli - ${monthYear}`, style: 'title' },
    { text: `Generato: ${formatItDateTime(generatedAt)}`, style: 'timestamp' },
    { text: '', margin: [0, 10, 0, 10] as [number, number, number, number] }, // spacer
  ];

  // Add table (or empty message)
  if (records.length > 0) {
    content.push({
      table: {
        headerRows: 1,
        widths: ['auto', 'auto', 'auto', 'auto', 'auto', 'auto', 'auto', 'auto', 'auto', 'auto', 'auto', 'auto', 'auto', 'auto'],
        dontBreakRows: true,
        body: [tableHeaders, ...tableRows],
      },
      layout: 'lightHorizontalLines',
      fontSize: 8,
    });
  } else {
    content.push({
      text: 'Nessun ciclo trovato per il periodo selezionato.',
      italics: true,
      color: '#666',
      margin: [0, 20, 0, 20] as [number, number, number, number],
    });
  }

  return {
    content,
    styles: {
      customer: { fontSize: 12, bold: true },
      subtitle: { fontSize: 10 },
      title: { fontSize: 16, bold: true, margin: [0, 10, 0, 5] as [number, number, number, number] },
      timestamp: { fontSize: 8, italics: true, color: '#666' },
    },
    defaultStyle: {
      font: 'Roboto',
      fontSize: 10,
    },
    pageSize: 'A4',
    pageOrientation: 'landscape' as const,
  };
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

/**
 * CycleExportService — static-only class for CSV and PDF export.
 *
 * CSV uses semicolon separator for European Excel compatibility.
 * PDF uses landscape A4 with customer header and table matching Registro view.
 *
 * Deterministic: Uses provided/generatedAt timestamp for reproducible PDFs.
 */
export class CycleExportService {
  /**
   * Generate CSV export for cycle records in date range.
   *
   * @param from Start date (inclusive)
   * @param to End date (exclusive)
   * @returns CSV string with semicolon separator
   */
  static async generateCsv(from: Date, to: Date): Promise<string> {
    // Query all records in date range (no pagination for export)
    const recordsResult = await db.execute(sql`
      SELECT
        cycle_number AS "cycleNumber",
        started_at AS "startedAt",
        ended_at AS "endedAt",
        cycle_status_label AS "cycleStatusLabel",
        material_input_kg AS "materialInputKg",
        material_output_kg AS "materialOutputKg",
        containers,
        gross_input_kg AS "grossInputKg",
        start_energy_kwh AS "startEnergyKwh",
        end_energy_kwh AS "endEnergyKwh",
        start_water_l AS "startWaterL",
        end_water_l AS "endWaterL",
        operator,
        order_number AS "orderNumber"
      FROM cycle_records
      WHERE started_at >= ${from.toISOString()}::timestamptz
        AND started_at < ${to.toISOString()}::timestamptz
      ORDER BY started_at ASC
    `);

    // PostgreSQL returns timestamptz as strings — convert to Date objects
    const rows = (recordsResult.rows as Array<Record<string, unknown>>).map((r) => ({
      ...r,
      startedAt: new Date(r.startedAt as string),
      endedAt: new Date(r.endedAt as string),
    })) as ICycleRecord[];

    return buildCsvContent(rows);
  }

  /**
   * Generate PDF export for cycle records in date range.
   *
   * @param from Start date (inclusive) - used for month label and query
   * @param to End date (exclusive) - used for query only
   * @param generatedAt Timestamp for PDF generation (deterministic - pass fixed value for reproducibility)
   * @returns PDF as Buffer
   */
  static async generatePdf(from: Date, to: Date, generatedAt?: Date): Promise<Buffer> {
    const deterministicTimestamp = generatedAt ?? new Date();

    // Fetch customer info from energy_config
    const configResult = await db.execute(sql`
      SELECT
        customer_name AS "customerName",
        machine_serial AS "machineSerial",
        machine_model AS "machineModel"
      FROM energy_config
      WHERE id = 1
    `);
    const configRow = configResult.rows[0] as IEnergyConfig | undefined;
    const config: IEnergyConfig = configRow ?? { customerName: '', machineSerial: '', machineModel: '' };

    // Query cycle records
    const recordsResult = await db.execute(sql`
      SELECT
        cycle_number AS "cycleNumber",
        started_at AS "startedAt",
        ended_at AS "endedAt",
        cycle_status_label AS "cycleStatusLabel",
        material_input_kg AS "materialInputKg",
        material_output_kg AS "materialOutputKg",
        containers,
        gross_input_kg AS "grossInputKg",
        start_energy_kwh AS "startEnergyKwh",
        end_energy_kwh AS "endEnergyKwh",
        start_water_l AS "startWaterL",
        end_water_l AS "endWaterL",
        operator,
        order_number AS "orderNumber"
      FROM cycle_records
      WHERE started_at >= ${from.toISOString()}::timestamptz
        AND started_at < ${to.toISOString()}::timestamptz
      ORDER BY started_at ASC
    `);

    // PostgreSQL returns timestamptz as strings — convert to Date objects
    // so formatTime() and formatItDate() work correctly.
    const rows = (recordsResult.rows as Array<Record<string, unknown>>).map((r) => ({
      ...r,
      startedAt: new Date(r.startedAt as string),
      endedAt: new Date(r.endedAt as string),
    })) as ICycleRecord[];

    // Build PDF document
    const docDef = buildPdfDocumentDefinition(rows, config, from, deterministicTimestamp);

    return createDeterministicPdfBuffer(
      docDef as unknown as Parameters<typeof createDeterministicPdfBuffer>[0],
      {
        title: 'Registro Mensile Cicli',
        author: 'WPT',
        subject: `Registro cicli ${formatMonthYearItalian(from)}`,
        creator: 'WPT IoT Backend',
        producer: 'cycleExportService',
        creationDate: deterministicTimestamp,
        modDate: deterministicTimestamp,
      },
    );
  }

  /**
   * Generate filename for export.
   *
   * Format: registro_cicli_YYYY_MM.{format}
   */
  static generateFilename(from: Date, format: 'csv' | 'pdf'): string {
    return `registro_cicli_${formatMonthYear(from)}.${format}`;
  }
}
