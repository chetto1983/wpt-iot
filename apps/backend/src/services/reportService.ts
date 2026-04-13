import { and, gte, lte, eq, isNull, isNotNull, asc, desc } from 'drizzle-orm';
import { db } from '../db/index.js';
import { machineSnapshots } from '../db/schema/machine.js';
import { alarmEvents } from '../db/schema/alarms.js';
import { formatEnumValue } from '../i18n/enumLabels.js';

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

interface IReportFilter {
  from: Date;
  to: Date;
  cycle?: number;
}

interface IAlarmReportFilter {
  from: Date;
  to: Date;
  status?: 'all' | 'active' | 'resolved';
}

interface IAlarmEventRow {
  id: number;
  alarmIndex: number;
  wordIndex: number;
  bitIndex: number;
  active: boolean;
  transitionType: string;
  activatedAt: Date;
  resetAt: Date | null;
  descriptionIt: string;
  descriptionEn: string;
}

// ---------------------------------------------------------------------------
// ReportService — static-only class (per project convention)
// ---------------------------------------------------------------------------

export class ReportService {
  /**
   * Query machine snapshots filtered by date range and optional cycle number.
   * Safety valve: max 50,000 rows to prevent OOM.
   */
  static async querySnapshots(
    filter: IReportFilter,
  ): Promise<Record<string, unknown>[]> {
    const conditions = [
      gte(machineSnapshots.timestamp, filter.from),
      lte(machineSnapshots.timestamp, filter.to),
    ];

    if (filter.cycle !== undefined) {
      conditions.push(eq(machineSnapshots.completedCycles, filter.cycle));
    }

    const rows = await db
      .select()
      .from(machineSnapshots)
      .where(and(...conditions))
      .orderBy(asc(machineSnapshots.timestamp))
      .limit(50000);

    return rows as unknown as Record<string, unknown>[];
  }

  /**
   * Query alarm events filtered by date range and optional status.
   * Safety valve: max 50,000 rows.
   */
  static async queryAlarmEvents(
    filter: IAlarmReportFilter,
  ): Promise<IAlarmEventRow[]> {
    const conditions = [
      gte(alarmEvents.activatedAt, filter.from),
      lte(alarmEvents.activatedAt, filter.to),
    ];

    if (filter.status === 'active') {
      conditions.push(isNull(alarmEvents.resetAt));
    } else if (filter.status === 'resolved') {
      conditions.push(isNotNull(alarmEvents.resetAt));
    }

    const rows = await db
      .select()
      .from(alarmEvents)
      .where(and(...conditions))
      .orderBy(desc(alarmEvents.activatedAt))
      .limit(50000);

    return rows as IAlarmEventRow[];
  }

  /**
   * Serialize rows to CSV string with BOM for Excel UTF-8 detection.
   * Includes CSV injection protection per Research Pitfall 3.
   */
  static toCSV(
    rows: Record<string, unknown>[],
    fields: readonly string[],
    headers: string[],
    locale: 'it' | 'en' = 'it',
  ): string {
    const lines: string[] = [];

    // BOM + header row
    lines.push('\uFEFF' + headers.map(h => escapeCSV(String(h))).join(','));

    // Data rows
    for (const row of rows) {
      const values = fields.map((field) => {
        const val = row[field];
        if (val === null || val === undefined) return '';
        if (val instanceof Date) return val.toISOString();
        return escapeCSV(formatEnumValue(field, val, locale));
      });
      lines.push(values.join(','));
    }

    return lines.join('\r\n') + '\r\n';
  }

  /**
   * Format an alarm event for export.
   * Returns isActive boolean for frontend badge rendering (not fragile locale detection).
   */
  static formatAlarmForExport(
    event: IAlarmEventRow,
    locale: 'it' | 'en',
  ): Record<string, string | boolean> {
    const alarmCode = `A${String(event.alarmIndex + 1).padStart(4, '0')}`;
    const description =
      locale === 'it' ? event.descriptionIt : event.descriptionEn;
    const activatedAt = event.activatedAt.toISOString();
    const isActive = event.resetAt === null;
    const resetAt = isActive
      ? locale === 'it'
        ? 'Attivo'
        : 'Active'
      : event.resetAt!.toISOString();

    let duration = '--';
    if (event.resetAt) {
      const diffMs =
        event.resetAt.getTime() - event.activatedAt.getTime();
      const totalMinutes = Math.floor(diffMs / 60000);
      const hours = Math.floor(totalMinutes / 60);
      const minutes = totalMinutes % 60;
      duration = hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
    }

    return {
      alarmCode,
      description,
      activatedAt,
      resetAt,
      duration,
      isActive,
    };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Escape a CSV value. Handles commas, quotes, newlines, and CSV injection
 * characters (=, +, -, @).
 */
function escapeCSV(value: string): string {
  if (
    value.includes(',') ||
    value.includes('"') ||
    value.includes('\n') ||
    value.includes('\r') ||
    value.startsWith('=') ||
    value.startsWith('+') ||
    value.startsWith('-') ||
    value.startsWith('@')
  ) {
    return '"' + value.replace(/"/g, '""') + '"';
  }
  return value;
}
