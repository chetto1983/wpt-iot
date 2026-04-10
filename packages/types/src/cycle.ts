/**
 * Phase 24 — Cycle Register types for /cycles page API.
 *
 * Per CONTEXT D-01, D-08: Backend types for monthly register queries
 * with pagination, sorting, and export.
 */

import { z } from 'zod/v4';

/**
 * API response shape for a single cycle record in the register.
 * Mirrors the cycle_records table columns (Phase 24 extended schema).
 */
export interface ICycleRecordResponse {
  id: number;
  resetEpoch: number;
  cycleNumber: number;
  startedAt: string; // ISO datetime string
  endedAt: string; // ISO datetime string
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
}

/**
 * Query parameters for GET /api/cycles endpoint.
 * Supports date range filtering, pagination, and sorting.
 */
export interface ICyclesQueryParams {
  from: string; // ISO datetime
  to: string; // ISO datetime
  page?: number;
  limit?: number;
  sort?: string;
  order?: 'asc' | 'desc';
}

/**
 * Response shape for GET /api/cycles with pagination metadata.
 */
export interface ICyclesResponse {
  cycles: ICycleRecordResponse[];
  pagination: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

/**
 * Request body for cycle register export (CSV/PDF).
 */
export interface ICycleExportRequest {
  from: string; // ISO datetime
  to: string; // ISO datetime
  format: 'csv' | 'pdf';
}

/**
 * Valid sort columns for cycle register queries.
 * These map to cycle_records table columns.
 */
export const VALID_SORT_COLUMNS = [
  'startedAt',
  'cycleNumber',
  'cycleStatusLabel',
  'cycleType',
  'endedAt',
  'operator',
  'orderNumber',
] as const;

export type ValidSortColumn = (typeof VALID_SORT_COLUMNS)[number];

/**
 * Zod schema for /api/cycles query parameter validation.
 * Per T-24-03a-02: Zod validation on query params prevents SQL injection.
 */
export const CyclesQuerySchema = z.object({
  from: z.string().datetime(),
  to: z.string().datetime(),
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(25),
  sort: z
    .enum(VALID_SORT_COLUMNS as unknown as readonly [string, ...string[]])
    .optional()
    .default('startedAt'),
  order: z.enum(['asc', 'desc']).optional().default('desc'),
});

/**
 * Zod schema for /api/cycles/export query parameter validation.
 */
export const CycleExportQuerySchema = z.object({
  from: z.string().datetime(),
  to: z.string().datetime(),
  format: z.enum(['csv', 'pdf']),
});

/**
 * Export result shape for CSV/PDF generation.
 */
export interface ICycleExportResult {
  content: Buffer | string;
  filename: string;
  contentType: string;
}

/**
 * Service-level query parameters (after Zod validation and parsing).
 */
export interface ICyclesServiceQuery {
  from: Date;
  to: Date;
  page: number;
  limit: number;
  sort: ValidSortColumn;
  order: 'asc' | 'desc';
}
