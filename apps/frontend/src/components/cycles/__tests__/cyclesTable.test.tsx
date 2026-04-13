import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

// Mock next-intl: useTranslations returns a function that echoes the key's last segment
vi.mock('next-intl', () => ({
  useTranslations: () => {
    const t = (key: string, params?: Record<string, unknown>) => {
      // Return the last segment of the key for readability
      const label = key.split('.').pop() ?? key;
      if (params) {
        // Simple template: replace {name} with value
        return Object.entries(params).reduce(
          (s, [k, v]) => s.replace(`{${k}}`, String(v)),
          label,
        );
      }
      return label;
    };
    return t;
  },
}));

import { CyclesTable } from '../cycles-table';
import type { ICycleRecordResponse, ICyclesPagination } from '@/lib/api/cycles';

function makeCycle(overrides: Partial<ICycleRecordResponse> = {}): ICycleRecordResponse {
  return {
    cycleNumber: 11,
    startedAt: '2026-04-10T08:00:00.000Z',
    endedAt: '2026-04-10T08:30:00.000Z',
    date: '10/04/2026',
    startTime: '10:00',
    endTime: '10:30',
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

const defaultProps = {
  sortColumn: 'cycleNumber',
  sortOrder: 'desc' as const,
  onSort: vi.fn(),
};

describe('CyclesTable component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ====================================================================
  // Test 1: Renders table with Register view columns (8 columns)
  // ====================================================================
  it('renders Register view with 8 columns', () => {
    const cycles = [makeCycle(), makeCycle({ cycleNumber: 12 })];
    render(
      <CyclesTable cycles={cycles} viewMode="register" {...defaultProps} />,
    );

    const headers = screen.getAllByRole('columnheader');
    // Register view: cycleNumber, date, startTime, endTime, status, inputWeight, outputWeight, containers
    expect(headers).toHaveLength(8);
    // Verify the first and last column labels are present (mocked keys echo last segment)
    expect(screen.getByText('cycleNumber')).toBeInTheDocument();
    expect(screen.getByText('containers')).toBeInTheDocument();
    // Detail-only columns should NOT be visible
    expect(screen.queryByText('operator')).not.toBeInTheDocument();
    expect(screen.queryByText('grossInput')).not.toBeInTheDocument();
  });

  // ====================================================================
  // Test 2: Renders table with Detail view columns (14 columns)
  // ====================================================================
  it('renders Detail view with 14 columns', () => {
    const cycles = [makeCycle()];
    render(
      <CyclesTable cycles={cycles} viewMode="detail" {...defaultProps} />,
    );

    const headers = screen.getAllByRole('columnheader');
    expect(headers).toHaveLength(14);
    // Detail-only columns now visible
    expect(screen.getByText('grossInput')).toBeInTheDocument();
    expect(screen.getByText('startEnergy')).toBeInTheDocument();
    expect(screen.getByText('endEnergy')).toBeInTheDocument();
    expect(screen.getByText('startWater')).toBeInTheDocument();
    expect(screen.getByText('endWater')).toBeInTheDocument();
    expect(screen.getByText('operator')).toBeInTheDocument();
  });

  // ====================================================================
  // Test 3: Status badges show correct data-status attributes
  // ====================================================================
  it('renders status badges with correct data-status attributes', () => {
    const cycles = [
      makeCycle({ cycleNumber: 10, cycleStatusLabel: 'OK' }),
      makeCycle({ cycleNumber: 11, cycleStatusLabel: 'FAILED' }),
      makeCycle({ cycleNumber: 12, cycleStatusLabel: 'ABORTED' }),
    ];
    render(
      <CyclesTable cycles={cycles} viewMode="register" {...defaultProps} />,
    );

    // Badges render with data-status attribute
    const okBadge = screen.getByText('OK').closest('[data-status]');
    expect(okBadge).toHaveAttribute('data-status', 'ok');

    const failedBadge = screen.getByText('FAILED').closest('[data-status]');
    expect(failedBadge).toHaveAttribute('data-status', 'failed');

    const abortedBadge = screen.getByText('ABORTED').closest('[data-status]');
    expect(abortedBadge).toHaveAttribute('data-status', 'aborted');
  });

  // ====================================================================
  // Test 4: Clicking column header triggers onSort callback
  // ====================================================================
  it('clicking sortable column header triggers onSort', () => {
    const onSort = vi.fn();
    const cycles = [makeCycle()];
    render(
      <CyclesTable cycles={cycles} viewMode="register" {...defaultProps} onSort={onSort} />,
    );

    // Click the first column header (cycleNumber)
    const firstHeader = screen.getAllByRole('columnheader')[0];
    fireEvent.click(firstHeader);
    expect(onSort).toHaveBeenCalledWith('cycleNumber');
  });

  // ====================================================================
  // Test 5: Empty state renders when no cycles
  // ====================================================================
  it('shows empty state when cycles array is empty', () => {
    render(
      <CyclesTable cycles={[]} viewMode="register" {...defaultProps} />,
    );

    // The component renders t('empty') and t('emptyDescription')
    expect(screen.getByText('empty')).toBeInTheDocument();
    expect(screen.getByText('emptyDescription')).toBeInTheDocument();
    // No table should be present
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  // ====================================================================
  // Test 6: Loading skeleton renders when isLoading=true
  // ====================================================================
  it('shows loading skeleton when isLoading is true', () => {
    const { container } = render(
      <CyclesTable cycles={[]} viewMode="register" isLoading={true} {...defaultProps} />,
    );

    // No table role when loading (skeleton uses divs, not <table>)
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    // The shadcn Skeleton component renders <div data-slot="skeleton" class="animate-pulse ...">
    // Verified from apps/frontend/src/components/ui/skeleton.tsx
    const skeletons = container.querySelectorAll('[data-slot="skeleton"]');
    expect(skeletons.length).toBeGreaterThan(0);
  });

  // ====================================================================
  // Test 7: Cell values are formatted correctly
  // ====================================================================
  it('formats cell values correctly (date, weight with kg suffix, energy with kWh)', () => {
    const cycles = [makeCycle({
      date: '10/04/2026',
      materialInputKg: 100,
      materialOutputKg: 80.5,
      grossInputKg: 999,
      startEnergyKwh: 1250.5,
    })];
    render(
      <CyclesTable cycles={cycles} viewMode="detail" {...defaultProps} />,
    );

    // Date displayed as-is
    expect(screen.getByText('10/04/2026')).toBeInTheDocument();
    // Weight values include kg suffix (unique values to avoid multiple-match error)
    expect(screen.getByText('100 kg')).toBeInTheDocument();
    expect(screen.getByText('80.5 kg')).toBeInTheDocument();
    // Energy values include kWh suffix with 2 decimal places
    expect(screen.getByText('1250.50 kWh')).toBeInTheDocument();
  });

  // ====================================================================
  // Test 8: Pagination renders when multiple pages exist
  // ====================================================================
  it('renders pagination controls when totalPages > 1', () => {
    const onPageChange = vi.fn();
    const pagination: ICyclesPagination = {
      page: 1,
      limit: 25,
      total: 100,
      totalPages: 4,
    };
    const cycles = [makeCycle()];
    render(
      <CyclesTable
        cycles={cycles}
        viewMode="register"
        {...defaultProps}
        pagination={pagination}
        onPageChange={onPageChange}
      />,
    );

    // Page number links are present (pagination shows pages 1-4)
    // Use getAllByText for '1' since cycleNumber=11 also contains '1' in the table cell
    const oneLinks = screen.getAllByText('1');
    expect(oneLinks.length).toBeGreaterThan(0);
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('4')).toBeInTheDocument();
  });
});
