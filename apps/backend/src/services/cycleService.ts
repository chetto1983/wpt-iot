/**
 * Phase 24 — CycleService for /cycles page backend API.
 *
 * Per CONTEXT D-01, D-08: Query cycle_records table with pagination,
 * date range filtering, and sorting support.
 */

import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import type {
  ICycleRecordResponse,
  ICyclesQueryParams,
  ICycleExportRequest,
  ICycleExportResult,
  ValidSortColumn,
} from '@wpt/types';
import { VALID_SORT_COLUMNS } from '@wpt/types';

/**
 * Service for querying and exporting cycle register records.
 * Static-only class — zero instance state.
 */
export class CycleService {
  /**
   * Query cycle records with date range filter, pagination, and sorting.
   *
   * Uses half-open interval [from, to) on the startedAt column.
   * Per T-24-03a-03: Server-side pagination with limit to prevent DoS.
   *
   * @param params Query parameters (Zod-validated upstream)
   * @returns Paginated cycles response with total count
   */
  static async getCycles(params: ICyclesQueryParams): Promise<{
    data: ICycleRecordResponse[];
    pagination: {
      total: number;
      page: number;
      limit: number;
      totalPages: number;
    };
  }> {
    const { from, to, page = 1, limit = 25, sort = 'startedAt', order = 'desc' } = params;
    const offset = (page - 1) * limit;

    // Validate sort column (belt-and-braces defense in depth)
    const sortColumn = VALID_SORT_COLUMNS.includes(sort as ValidSortColumn)
      ? sort
      : 'startedAt';

    // Map sort column to SQL column name
    const columnMap: Record<string, string> = {
      startedAt: 'started_at',
      cycleNumber: 'cycle_number',
      cycleStatusLabel: 'cycle_status_label',
      cycleType: 'cycle_type',
      endedAt: 'ended_at',
      operator: 'operator',
      orderNumber: 'order_number',
    };
    const orderColumn = columnMap[sortColumn] ?? 'started_at';
    const orderDirection = order === 'desc' ? 'DESC' : 'ASC';

    const fromDate = new Date(from);
    const toDate = new Date(to);

    // Get total count for pagination metadata
    const countResult = await db.execute(sql`
      SELECT COUNT(*)::int AS total
      FROM cycle_records
      WHERE started_at >= ${fromDate.toISOString()}::timestamptz
        AND started_at < ${toDate.toISOString()}::timestamptz
    `);
    const total = Number((countResult.rows[0] as { total: number } | undefined)?.total ?? 0);

    // Query paginated records with sorting
    const recordsResult = await db.execute(sql`
      SELECT
        id,
        reset_epoch AS "resetEpoch",
        cycle_number AS "cycleNumber",
        started_at AS "startedAt",
        ended_at AS "endedAt",
        cycle_type AS "cycleType",
        cycle_status_label AS "cycleStatusLabel",
        material_input_kg AS "materialInputKg",
        material_output_kg AS "materialOutputKg",
        gross_input_kg AS "grossInputKg",
        containers,
        start_energy_kwh AS "startEnergyKwh",
        end_energy_kwh AS "endEnergyKwh",
        start_water_l AS "startWaterL",
        end_water_l AS "endWaterL",
        operator,
        order_number AS "orderNumber"
      FROM cycle_records
      WHERE started_at >= ${fromDate.toISOString()}::timestamptz
        AND started_at < ${toDate.toISOString()}::timestamptz
      ORDER BY ${sql.raw(orderColumn)} ${sql.raw(orderDirection)}
      LIMIT ${limit}
      OFFSET ${offset}
    `);

    const rows = recordsResult.rows as Array<{
      id: number;
      resetEpoch: number;
      cycleNumber: number;
      startedAt: Date;
      endedAt: Date;
      cycleType: number;
      cycleStatusLabel: string | null;
      materialInputKg: number | null;
      materialOutputKg: number | null;
      grossInputKg: number | null;
      containers: number | null;
      startEnergyKwh: number | null;
      endEnergyKwh: number | null;
      startWaterL: number | null;
      endWaterL: number | null;
      operator: string | null;
      orderNumber: string | null;
    }>;

    // Map to response format (convert Date objects to ISO strings)
    const data = rows.map((row) => ({
      id: row.id,
      resetEpoch: row.resetEpoch,
      cycleNumber: row.cycleNumber,
      startedAt: row.startedAt.toISOString(),
      endedAt: row.endedAt.toISOString(),
      cycleType: row.cycleType,
      cycleStatusLabel: row.cycleStatusLabel,
      materialInputKg: row.materialInputKg,
      materialOutputKg: row.materialOutputKg,
      grossInputKg: row.grossInputKg,
      containers: row.containers,
      startEnergyKwh: row.startEnergyKwh,
      endEnergyKwh: row.endEnergyKwh,
      startWaterL: row.startWaterL,
      endWaterL: row.endWaterL,
      operator: row.operator,
      orderNumber: row.orderNumber,
    }));

    const totalPages = Math.ceil(total / limit);

    return {
      data,
      pagination: {
        total,
        page,
        limit,
        totalPages,
      },
    };
  }

  /**
   * Export cycle records as CSV.
   * Stub implementation — full CSV generation in Wave 4.
   *
   * @param request Export request parameters
   * @returns Export result with CSV content
   */
  static async exportCsv(request: ICycleExportRequest): Promise<ICycleExportResult> {
    const fromDate = new Date(request.from);
    const toDate = new Date(request.to);

    // Query all records in date range (no pagination for export)
    const recordsResult = await db.execute(sql`
      SELECT
        cycle_number AS "cycleNumber",
        started_at AS "startedAt",
        ended_at AS "endedAt",
        cycle_type AS "cycleType",
        cycle_status_label AS "cycleStatusLabel",
        material_input_kg AS "materialInputKg",
        material_output_kg AS "materialOutputKg",
        gross_input_kg AS "grossInputKg",
        containers,
        operator,
        order_number AS "orderNumber"
      FROM cycle_records
      WHERE started_at >= ${fromDate.toISOString()}::timestamptz
        AND started_at < ${toDate.toISOString()}::timestamptz
      ORDER BY started_at ASC
    `);

    const rows = recordsResult.rows as Array<{
      cycleNumber: number;
      startedAt: Date;
      endedAt: Date;
      cycleType: number;
      cycleStatusLabel: string | null;
      materialInputKg: number | null;
      materialOutputKg: number | null;
      grossInputKg: number | null;
      containers: number | null;
      operator: string | null;
      orderNumber: string | null;
    }>;

    // Generate CSV content (stub — Wave 4 will enhance)
    const header = 'Ciclo,Data Inizio,Data Fine,Tipo,Stato,Input (kg),Output (kg),Bruto (kg),Bidoni,Operatore,Ordine\n';
    const csvRows = rows.map((row) => {
      const startedAtFormatted = row.startedAt.toLocaleDateString('it-IT');
      return [
        row.cycleNumber,
        startedAtFormatted,
        row.endedAt.toLocaleDateString('it-IT'),
        row.cycleType,
        row.cycleStatusLabel ?? '',
        row.materialInputKg ?? '',
        row.materialOutputKg ?? '',
        row.grossInputKg ?? '',
        row.containers ?? '',
        row.operator ?? '',
        row.orderNumber ?? '',
      ].join(',');
    }).join('\n');

    const content = header + csvRows;
    // Format: YYYY_MM (e.g., 2026_04 for April 2026)
    const monthLabel = `${fromDate.getUTCFullYear()}_${String(fromDate.getUTCMonth() + 1).padStart(2, '0')}`;

    return {
      content,
      filename: `registro_cicli_${monthLabel}.csv`,
      contentType: 'text/csv; charset=utf-8',
    };
  }

  /**
   * Export cycle records as PDF.
   * Stub implementation — full PDF generation in Wave 4.
   *
   * @param request Export request parameters
   * @returns Export result with PDF content
   */
  static async exportPdf(request: ICycleExportRequest): Promise<ICycleExportResult> {
    const fromDate = new Date(request.from);

    // Format: YYYY_MM (e.g., 2026_04 for April 2026)
    const monthLabel = `${fromDate.getUTCFullYear()}_${String(fromDate.getUTCMonth() + 1).padStart(2, '0')}`;

    // Minimal valid PDF content (header only) — Wave 4 will generate proper PDF
    const pdfHeader = '%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [] /Count 0 >>\nendobj\nxref\n0 3\n0000000000 65535 f\n0000000009 00000 n\n0000000058 00000 n\ntrailer\n<< /Size 3 /Root 1 0 R >>\nstartxref\n106\n%%EOF';

    return {
      content: Buffer.from(pdfHeader, 'ascii'),
      filename: `registro_cicli_${monthLabel}.pdf`,
      contentType: 'application/pdf',
    };
  }
}
