'use client';

import { apiFetch } from '@/lib/api';

interface ICyclesQueryParams {
  from: Date;
  to: Date;
  page?: number;
  limit?: number;
  sort?: string;
  order?: 'asc' | 'desc';
}

export interface ICycleRecordResponse {
  cycleNumber: number;
  startedAt: string;
  endedAt: string;
  date: string;
  startTime: string;
  endTime: string;
  cycleStatusLabel: string;
  materialInputKg: number;
  materialOutputKg: number;
  containers: number;
  grossInputKg: number;
  startEnergyKwh: number | null;
  endEnergyKwh: number | null;
  startWaterL: number | null;
  endWaterL: number | null;
  operator: string | null;
  orderNumber: string | null;
}

export interface ICyclesPagination {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface ICyclesResponse {
  cycles: ICycleRecordResponse[];
  pagination: ICyclesPagination;
}

interface ICycleExportRequest {
  format: 'csv' | 'pdf';
  from: Date;
  to: Date;
}

/**
 * Fetch cycle records with pagination and filtering.
 */
export async function getCycles(params: ICyclesQueryParams): Promise<ICyclesResponse> {
  const queryParams = new URLSearchParams({
    from: params.from.toISOString(),
    to: params.to.toISOString(),
    page: String(params.page ?? 1),
    limit: String(params.limit ?? 25),
  });

  if (params.sort) {
    queryParams.set('sort', params.sort);
  }
  if (params.order) {
    queryParams.set('order', params.order);
  }

  return apiFetch<ICyclesResponse>(`/api/cycles?${queryParams.toString()}`);
}

/**
 * Export cycles to CSV or PDF.
 */
export async function exportCycles(params: ICycleExportRequest): Promise<Blob> {
  const queryParams = new URLSearchParams({
    format: params.format,
    from: params.from.toISOString(),
    to: params.to.toISOString(),
  });

  const API_BASE = process.env.NEXT_PUBLIC_API_URL || '';
  const res = await fetch(`${API_BASE}/api/cycles/export?${queryParams.toString()}`, {
    method: 'GET',
    credentials: 'include',
  });

  if (!res.ok) {
    const body: unknown = await res.json().catch(() => ({}));
    const errorMessage =
      typeof (body as { error?: unknown }).error === 'string'
        ? (body as { error: string }).error
        : `Export failed: ${res.status}`;
    throw new Error(errorMessage);
  }

  return res.blob();
}
