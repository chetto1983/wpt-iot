import React from 'react';
import { act, render } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { apiFetchMock, translate } = vi.hoisted(() => ({
  apiFetchMock: vi.fn(),
  translate: (key: string) => key,
}));

vi.mock('next/navigation', () => ({ useParams: () => ({ id: '1' }) }));
vi.mock('next-intl', () => ({ useTranslations: () => translate }));
vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), {
    error: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
  }),
}));
vi.mock('@/lib/api', () => ({ apiFetch: apiFetchMock }));
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ user: { language: 'it' } }),
}));
vi.mock('@/lib/locale', () => ({
  useAppLocale: () => ({ timezone: 'Europe/Rome' }),
}));

vi.mock('nuqs', () => {
  const parser = { withDefault: (defaultValue: unknown) => ({ defaultValue }) };
  return {
    parseAsString: parser,
    parseAsInteger: parser,
    useQueryStates: (parsers: Record<string, { defaultValue: unknown }>) => {
      const [state, setState] = React.useState(() =>
        Object.fromEntries(
          Object.entries(parsers).map(([key, value]) => [key, value.defaultValue]),
        ),
      );
      const setQueryState = React.useCallback(
        async (next: Record<string, unknown>) => {
          setState((current) => ({ ...current, ...next }));
        },
        [],
      );
      return [state, setQueryState];
    },
  };
});

vi.mock('react-grid-layout', () => ({
  ResponsiveGridLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  useContainerWidth: () => ({
    width: 1200,
    containerRef: { current: null },
    mounted: true,
  }),
  verticalCompactor: {},
}));
vi.mock('react-grid-layout/extras', () => ({ GridBackground: () => null }));

vi.mock('@/components/dashboard/dashboard-panel-item', () => ({
  DashboardPanelItem: () => null,
}));
vi.mock('@/components/dashboard/dashboard-toolbar', () => ({
  DashboardToolbar: () => null,
}));
vi.mock('@/components/dashboard/panel-editor-dialog', () => ({
  PanelEditorDialog: () => null,
}));

import SingleDashboardPage from '@/app/(app)/dashboards/[id]/page';

function batchRequestCount(): number {
  return apiFetchMock.mock.calls.filter(([path]) => path === '/api/charts/batch').length;
}

describe('dashboard auto-refresh', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-28T14:30:00.000Z'));
    apiFetchMock.mockReset();
    apiFetchMock.mockImplementation((path: string) => {
      if (path === '/api/dashboards/1') {
        return Promise.resolve({
          dashboard: {
            id: 1,
            userId: 1,
            name: 'Demo',
            isDefault: true,
            layout: [{ i: 'energy', x: 0, y: 0, w: 12, h: 8 }],
            settings: {},
            createdAt: '2026-08-28T12:00:00.000Z',
            updatedAt: '2026-08-28T12:00:00.000Z',
          },
          panels: [
            {
              id: 1,
              dashboardId: 1,
              panelKey: 'energy',
              title: 'Energy',
              chartType: 'line',
              config: {
                fields: ['energyConsumption'],
                showLegend: false,
                showGrid: true,
              },
              createdAt: '2026-08-28T12:00:00.000Z',
              updatedAt: '2026-08-28T12:00:00.000Z',
            },
          ],
        });
      }
      if (path === '/api/charts/batch') {
        return Promise.resolve({
          resolution: 'raw',
          results: { energy: { points: [] } },
        });
      }
      return Promise.resolve({});
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('fetches fresh panel data after 15 seconds for a relative preset', async () => {
    render(<SingleDashboardPage />);

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(batchRequestCount()).toBe(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });

    expect(batchRequestCount()).toBe(2);
  });
});
