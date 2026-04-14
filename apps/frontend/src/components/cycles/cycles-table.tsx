'use client';

import { useTranslations } from 'next-intl';
import { ChevronUp, ChevronDown } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from '@/components/ui/pagination';

import type { ICycleRecordResponse, ICyclesPagination } from '@/lib/api/cycles';

type ViewMode = 'register' | 'detail';
type SortOrder = 'asc' | 'desc';

interface CyclesTableProps {
  cycles: ICycleRecordResponse[];
  viewMode: ViewMode;
  sortColumn: string;
  sortOrder: SortOrder;
  onSort: (column: string) => void;
  pagination?: ICyclesPagination;
  onPageChange?: (page: number) => void;
  isLoading?: boolean;
}

interface ColumnDef {
  key: string;
  label: string;
  sortable: boolean;
  registerOnly?: boolean;
}

function getStatusBadgeClasses(status: string): string {
  switch (status?.toUpperCase()) {
    case 'OK':
    case 'COMPLETED':
      return 'bg-green-100 text-green-800 hover:bg-green-100';
    case 'FAILED':
      return 'bg-red-100 text-red-800 hover:bg-red-100';
    case 'ABORTED':
      return 'bg-amber-100 text-amber-800 hover:bg-amber-100';
    default:
      return 'bg-muted text-muted-foreground';
  }
}

function formatStatusLabel(status: string): string {
  switch (status?.toUpperCase()) {
    case 'OK':
    case 'COMPLETED':
      return 'OK';
    case 'FAILED':
      return 'FAILED';
    case 'ABORTED':
      return 'ABORTED';
    default:
      return status || '—';
  }
}

export function CyclesTable({
  cycles,
  viewMode,
  sortColumn,
  sortOrder,
  onSort,
  pagination,
  onPageChange,
  isLoading = false,
}: CyclesTableProps) {
  const t = useTranslations('cycles');

  const columns: ColumnDef[] = [
    { key: 'cycleNumber', label: t('columns.cycleNumber'), sortable: true },
    { key: 'date', label: t('columns.date'), sortable: true },
    { key: 'startTime', label: t('columns.startTime'), sortable: true },
    { key: 'endTime', label: t('columns.endTime'), sortable: true },
    { key: 'cycleStatusLabel', label: t('columns.status'), sortable: true },
    { key: 'materialInputKg', label: t('columns.inputWeight'), sortable: true },
    { key: 'materialOutputKg', label: t('columns.outputWeight'), sortable: true },
    { key: 'containers', label: t('columns.containers'), sortable: true },
    { key: 'grossInputKg', label: t('columns.grossInput'), sortable: true, registerOnly: true },
    { key: 'startEnergyKwh', label: t('columns.startEnergy'), sortable: true, registerOnly: true },
    { key: 'endEnergyKwh', label: t('columns.endEnergy'), sortable: true, registerOnly: true },
    { key: 'startWaterL', label: t('columns.startWater'), sortable: true, registerOnly: true },
    { key: 'endWaterL', label: t('columns.endWater'), sortable: true, registerOnly: true },
    { key: 'operator', label: t('columns.operator'), sortable: true, registerOnly: true },
  ];

  const visibleColumns = columns.filter(
    (col) => viewMode === 'detail' || !col.registerOnly
  );

  function handleSort(columnKey: string) {
    if (!columns.find((c) => c.key === columnKey)?.sortable) return;
    onSort(columnKey);
  }

  function formatCellValue(column: ColumnDef, cycle: ICycleRecordResponse): string {
    switch (column.key) {
      case 'date':
        return cycle.date || '—';
      case 'startTime':
        return cycle.startTime || '—';
      case 'endTime':
        return cycle.endTime || '—';
      case 'materialInputKg':
        return cycle.materialInputKg != null ? `${cycle.materialInputKg} kg` : '—';
      case 'materialOutputKg':
        return cycle.materialOutputKg != null ? `${cycle.materialOutputKg} kg` : '—';
      case 'grossInputKg':
        return cycle.grossInputKg != null ? `${cycle.grossInputKg} kg` : '—';
      case 'startEnergyKwh':
        return cycle.startEnergyKwh != null ? `${cycle.startEnergyKwh.toFixed(2)} kWh` : '—';
      case 'endEnergyKwh':
        return cycle.endEnergyKwh != null ? `${cycle.endEnergyKwh.toFixed(2)} kWh` : '—';
      case 'startWaterL':
        return cycle.startWaterL != null ? `${cycle.startWaterL.toFixed(1)} L` : '—';
      case 'endWaterL':
        return cycle.endWaterL != null ? `${cycle.endWaterL.toFixed(1)} L` : '—';
      case 'operator':
        return cycle.operator || '—';
      case 'cycleStatusLabel':
        return formatStatusLabel(cycle.cycleStatusLabel);
      default: {
        const value = (cycle as unknown as Record<string, unknown>)[column.key];
        if (value == null) return '—';
        if (typeof value === 'string') return value;
        if (typeof value === 'number' || typeof value === 'boolean') return String(value);
        return '—';
      }
    }
  }

  function renderStatusBadge(cycle: ICycleRecordResponse) {
    const status = cycle.cycleStatusLabel?.toUpperCase() || '';
    const displayLabel = formatStatusLabel(cycle.cycleStatusLabel);
    const badgeClasses = getStatusBadgeClasses(status);

    return (
      <Badge
        variant="outline"
        className={cn('text-[10px] font-medium uppercase tracking-wide', badgeClasses)}
        data-status={status.toLowerCase()}
      >
        {displayLabel}
      </Badge>
    );
  }

  if (isLoading) {
    return (
      <div className="rounded-lg border overflow-hidden">
        <div className="space-y-0">
          {/* Header skeleton */}
          <div className="flex items-center gap-4 border-b bg-muted/50 px-4 py-3">
            {visibleColumns.map((_, i) => (
              <Skeleton key={i} className="h-4 flex-1" />
            ))}
          </div>
          {/* Body skeleton */}
          {Array.from({ length: 5 }).map((_, rowIdx) => (
            <div key={rowIdx} className="flex items-center gap-4 border-b px-4 py-3 last:border-b-0">
              {visibleColumns.map((_, colIdx) => (
                <Skeleton key={colIdx} className="h-4 flex-1" />
              ))}
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (!cycles || cycles.length === 0) {
    return (
      <div className="rounded-lg border overflow-hidden">
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <p className="text-sm font-medium text-muted-foreground">{t('empty')}</p>
          <p className="text-xs text-muted-foreground/60 mt-1">{t('emptyDescription')}</p>
        </div>
      </div>
    );
  }

  const startIndex = pagination ? (pagination.page - 1) * pagination.limit + 1 : 1;
  const endIndex = pagination
    ? Math.min(startIndex + cycles.length - 1, pagination.total)
    : cycles.length;

  return (
    <div className="space-y-4">
      <div className="rounded-lg border overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50 hover:bg-muted/50">
              {visibleColumns.map((column) => (
                <TableHead
                  key={column.key}
                  className={cn(
                    'text-xs uppercase tracking-wider text-muted-foreground/60 px-4 py-3',
                    column.sortable && 'cursor-pointer select-none'
                  )}
                  onClick={() => column.sortable && handleSort(column.key)}
                >
                  <div className="flex items-center gap-1">
                    {column.label}
                    {column.sortable && sortColumn === column.key && (
                      <span className="inline-flex">
                        {sortOrder === 'asc' ? (
                          <ChevronUp className="size-3" />
                        ) : (
                          <ChevronDown className="size-3" />
                        )}
                      </span>
                    )}
                  </div>
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {cycles.map((cycle, index) => (
              <TableRow
                key={cycle.cycleNumber}
                className={cn(
                  'min-h-11 hover:bg-muted/40',
                  index % 2 === 1 && 'bg-muted/20'
                )}
              >
                {visibleColumns.map((column) => (
                  <TableCell key={column.key} className="px-4 py-3 text-sm">
                    {column.key === 'cycleStatusLabel'
                      ? renderStatusBadge(cycle)
                      : formatCellValue(column, cycle)}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      {pagination && pagination.totalPages > 1 && onPageChange && (
        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground">
            {t('pagination.showing', {
              from: startIndex,
              to: endIndex,
              total: pagination.total,
            })}
          </p>
          <Pagination>
            <PaginationContent>
              <PaginationItem>
                <PaginationPrevious
                  onClick={() => onPageChange(Math.max(1, pagination.page - 1))}
                  className={
                    pagination.page <= 1 ? 'pointer-events-none opacity-50' : 'cursor-pointer'
                  }
                />
              </PaginationItem>

              {/* Page numbers */}
              {Array.from({ length: Math.min(5, pagination.totalPages) }, (_, i) => {
                let pageNum: number;
                if (pagination.totalPages <= 5) {
                  pageNum = i + 1;
                } else if (pagination.page <= 3) {
                  pageNum = i + 1;
                } else if (pagination.page >= pagination.totalPages - 2) {
                  pageNum = pagination.totalPages - 4 + i;
                } else {
                  pageNum = pagination.page - 2 + i;
                }

                return (
                  <PaginationItem key={pageNum}>
                    <PaginationLink
                      onClick={() => onPageChange(pageNum)}
                      isActive={pageNum === pagination.page}
                      className="cursor-pointer"
                    >
                      {pageNum}
                    </PaginationLink>
                  </PaginationItem>
                );
              })}

              <PaginationItem>
                <PaginationNext
                  onClick={() =>
                    onPageChange(Math.min(pagination.totalPages, pagination.page + 1))
                  }
                  className={
                    pagination.page >= pagination.totalPages
                      ? 'pointer-events-none opacity-50'
                      : 'cursor-pointer'
                  }
                />
              </PaginationItem>
            </PaginationContent>
          </Pagination>
        </div>
      )}
    </div>
  );
}
