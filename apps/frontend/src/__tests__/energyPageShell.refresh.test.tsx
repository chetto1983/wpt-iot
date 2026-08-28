import { act, render, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { apiFetchMock, translate, wsState } = vi.hoisted(() => ({
  apiFetchMock: vi.fn(),
  translate: (key: string) => key,
  wsState: {
    current: {
      machineData: { energyConsumption: 10, completedCycles: 2 },
      connected: true,
      lastUpdate: new Date('2026-08-28T14:00:00.000Z'),
    },
  },
}));

vi.mock('next-intl', () => ({
  useTranslations: () => translate,
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('@/lib/api', () => ({ apiFetch: apiFetchMock }));
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ user: { role: 'SUPER_ADMIN', language: 'it' } }),
}));
vi.mock('@/lib/locale', () => ({
  useAppLocale: () => ({ formatDateParam: vi.fn() }),
}));
vi.mock('@/lib/ws-context', () => ({
  useWsData: () => wsState.current,
}));

vi.mock('@/components/energy/baseline-lock-dialog', () => ({
  BaselineLockDialog: () => null,
}));
vi.mock('@/components/energy/energy-cycles-table', () => ({
  EnergyCyclesTable: () => null,
  buildEnergyCyclesPath: () => '/api/energy/cycles',
}));
vi.mock('@/components/energy/energy-kpi-grid', () => ({
  EnergyKpiGrid: () => null,
}));
vi.mock('@/components/energy/energy-range-controls', () => ({
  EnergyRangeControls: () => null,
}));
vi.mock('@/components/energy/energy-reconciliation-widget', () => ({
  EnergyReconciliationWidget: () => null,
  buildEnergyReconciliationPath: () => '/api/energy/reconciliation',
}));
vi.mock('@/components/energy/energy-savings-widget', () => ({
  EnergySavingsWidget: () => null,
}));
vi.mock('@/components/energy/energy-trend-card', () => ({
  EnergyTrendCard: () => null,
  buildEnergyAggregatePath: () => '/api/energy/aggregate',
}));

import { EnergyPageShell } from '@/components/energy/energy-page-shell';

function dashboardRequestCount(): number {
  return apiFetchMock.mock.calls.filter(([path]) =>
    String(path).startsWith('/api/energy/dashboard?'),
  ).length;
}

describe('EnergyPageShell refresh', () => {
  beforeEach(() => {
    apiFetchMock.mockReset();
    apiFetchMock.mockResolvedValue({});
    wsState.current = {
      machineData: { energyConsumption: 10, completedCycles: 2 },
      connected: true,
      lastUpdate: new Date('2026-08-28T14:00:00.000Z'),
    };
  });

  it('does not refetch the dashboard for every WebSocket update when auto-refresh is off', async () => {
    const { rerender } = render(<EnergyPageShell />);

    await waitFor(() => expect(dashboardRequestCount()).toBe(1));

    wsState.current = {
      machineData: { energyConsumption: 11, completedCycles: 2 },
      connected: true,
      lastUpdate: new Date('2026-08-28T14:00:01.000Z'),
    };

    rerender(<EnergyPageShell />);
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 25));
    });

    expect(dashboardRequestCount()).toBe(1);
  });
});
