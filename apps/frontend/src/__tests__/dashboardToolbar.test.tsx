import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

// Mock next-intl: echo the last segment of the key.
vi.mock('next-intl', () => ({
  useTranslations: () => {
    const t = (key: string, params?: Record<string, unknown>) => {
      const label = key.split('.').pop() ?? key;
      if (params) {
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

import { DashboardToolbar } from '@/components/dashboard/dashboard-toolbar';

function renderDashboardToolbar(overrides: Record<string, unknown> = {}) {
  const props = {
    dashboardName: 'My Dashboard',
    editMode: false,
    onEditModeChange: vi.fn(),
    onAddPanel: vi.fn(),
    onSave: vi.fn(),
    saving: false,
    from: new Date('2026-04-15T10:00:00Z'),
    to: new Date('2026-04-15T11:00:00Z'),
    onRangeChange: vi.fn(),
    activePreset: null as string | null,
    onPresetChange: vi.fn(),
    refreshInterval: 0,
    onRefreshIntervalChange: vi.fn(),
    lastUpdated: null,
    dataLoading: false,
    ...overrides,
  };
  return render(<DashboardToolbar {...props} />);
}

describe('DashboardToolbar', () => {
  it('renders dashboardName as page title inside PageToolbar layout', () => {
    const { container } = renderDashboardToolbar({ dashboardName: 'My Dashboard' });

    // Title text is rendered
    expect(screen.getByText('My Dashboard')).toBeInTheDocument();

    // PageToolbar layout marker: title slot uses `shrink-0 text-xl font-semibold`
    // — any element with that class combination means the PageToolbar wrapper is in use.
    const titleEl = container.querySelector('.shrink-0.text-xl.font-semibold');
    expect(titleEl).not.toBeNull();
    expect(titleEl?.textContent).toBe('My Dashboard');
  });

  it('passes TimeRangePicker props through (auto-refresh Select present)', () => {
    renderDashboardToolbar();

    // TimeRangePicker contains a Select with aria-label "autoRefresh" (key echo
    // from the mocked useTranslations). Confirm it is rendered — proves
    // TimeRangePicker received the props and mounted inside the toolbar.
    const refreshTrigger = screen.getByRole('combobox', { name: 'autoRefresh' });
    expect(refreshTrigger).toBeInTheDocument();
  });
});
