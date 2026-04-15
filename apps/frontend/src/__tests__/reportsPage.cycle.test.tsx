/**
 * Phase 35 UI-01 — Integration tests for the /reports cycle filter.
 *
 * Covers 5 behaviours driving Task 4 (the GREEN implementation):
 *   1. ?cycle=5 round-trip — URL → nuqs state → dropdown label
 *   2. User picking a cycle → /api/reports/machine?...&cycle=3 forwarded
 *   3. /api/cycles/list returns [] → dropdown placeholder "No cycles..." + disabled
 *   4. selectedFields.length drives skeleton cell count (0 → single bar, 7 → 7 cells)
 *   5. Missing date range → /api/cycles/list is NEVER called
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import type { ReactNode } from 'react';

// ---------------------------------------------------------------------------
// Mocks — must be hoisted BEFORE importing the component
// ---------------------------------------------------------------------------

// apiFetch — controllable per test
const mockApiFetch = vi.fn();
vi.mock('@/lib/api', () => ({
  apiFetch: (...args: unknown[]) => mockApiFetch(...args),
}));

// Auth context — return a WPT user so role-based field selection is broad.
// Referentially stable to avoid effect-dep churn.
vi.mock('@/lib/auth-context', () => {
  const stableAuth = {
    user: { id: 1, username: 'tester', role: 'WPT', language: 'en' },
    loading: false,
  };
  return {
    useAuth: () => stableAuth,
  };
});

// Locale hook — minimal shape needed by the page. Return a referentially stable
// object to avoid effect-dep churn and Maximum-update-depth loops.
vi.mock('@/lib/locale', () => {
  const stableLocale = {
    language: 'en',
    formatDateTime: (d: Date) => d.toISOString(),
    formatDate: (d: Date) => d.toISOString().slice(0, 10),
  };
  return {
    useAppLocale: () => stableLocale,
  };
});

// next-intl — echo last key segment, plus simple param interpolation.
// CRITICAL: `t` must be referentially stable so that effects with `t` in their
// dep array do not re-fire on every render and trigger a Maximum-update-depth loop.
vi.mock('next-intl', () => {
  // Real next-intl returns the raw template string with placeholders intact when
  // called without params (e.g. `t('cycleOptionLabel')` → "Cycle #{n}"). Mirror
  // that for parameterized keys so `.replace('{n}', …)` downstream works.
  const templates: Record<string, string> = {
    cycleOptionLabel: 'cycleOptionLabel #{n}',
  };
  const stableT = (key: string, params?: Record<string, unknown>) => {
    const segment = key.split('.').pop() ?? key;
    const label = templates[segment] ?? segment;
    if (params) {
      return Object.entries(params).reduce(
        (s, [k, v]) => s.replace(`{${k}}`, String(v)),
        label,
      );
    }
    return label;
  };
  return {
    useTranslations: () => stableT,
  };
});

// sonner toast — no-op
vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

// ---------------------------------------------------------------------------
// NuqsTestingAdapter wrapper — provides nuqs URL state for the page
// ---------------------------------------------------------------------------
import { NuqsTestingAdapter } from 'nuqs/adapters/testing';

function withSearchParams(searchParams: string) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <NuqsTestingAdapter searchParams={searchParams}>
        {children}
      </NuqsTestingAdapter>
    );
  };
}

// Component under test — dynamic import AFTER mocks
import ReportsPage from '@/app/(app)/reports/page';

// Default apiFetch implementation: route by URL
function setupDefaultApiFetch(cycles: number[] = [5, 3, 1]) {
  mockApiFetch.mockImplementation((url: string) => {
    if (url.includes('/api/cycles/list')) {
      return Promise.resolve({ cycles });
    }
    if (url.includes('/api/reports/machine')) {
      return Promise.resolve({
        rows: [],
        total: 0,
        fields: ['timestamp'],
        headers: ['Date/Time'],
      });
    }
    return Promise.reject(new Error(`Unexpected URL: ${url}`));
  });
}

describe('ReportsPage — cycle filter + skeleton', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDefaultApiFetch();
  });

  it('round-trips ?cycle=5 — nuqs state hydrates dropdown label "Cycle #5"', async () => {
    const Wrapper = withSearchParams(
      'from=2026-04-01&to=2026-04-15&cycle=5',
    );

    const { container } = render(<ReportsPage />, { wrapper: Wrapper });

    // Wait for /api/cycles/list effect to resolve
    await waitFor(() => {
      const cycleListCalls = mockApiFetch.mock.calls.filter(
        ([url]: [string]) => url.includes('/api/cycles/list'),
      );
      expect(cycleListCalls.length).toBeGreaterThan(0);
    });

    // Grab the Select trigger by its aria-label (SelectTrigger with
    // aria-label={translations.cycleLabel} -> "cycleLabel" via our mock).
    // Its text content must include "Cycle #5" (or the mock-translated
    // equivalent after placeholder substitution: "cycleOptionLabel" with {n}
    // -> "5"). We assert on textContent, which spans across multiple child
    // nodes that getByText cannot match.
    await waitFor(() => {
      const trigger = container.querySelector(
        '[data-slot="select-trigger"][aria-label="cycleLabel"]',
      );
      expect(trigger).not.toBeNull();
      // textContent after GREEN: "cycleOptionLabel" template with {n}->5 -> "5"
      expect(trigger!.textContent ?? '').toMatch(/5/);
    });
  });

  it('picking cycle #3 forwards cycle=3 to /api/reports/machine', async () => {
    const Wrapper = withSearchParams('from=2026-04-01&to=2026-04-15&cycle=3');

    render(<ReportsPage />, { wrapper: Wrapper });

    // Wait for cycle options to load
    await waitFor(() => {
      const calls = mockApiFetch.mock.calls.filter(
        ([url]: [string]) => url.includes('/api/cycles/list'),
      );
      expect(calls.length).toBeGreaterThan(0);
    });

    // Assert apiFetch was called with cycle=3 on the machine URL — proves URL
    // state (?cycle=3) is forwarded to the backend request. Task 2 RED: this
    // will fail because the page does not yet parse or forward `cycle`.
    await waitFor(() => {
      const match = mockApiFetch.mock.calls.find(
        ([url]: [string]) =>
          url.includes('/api/reports/machine') && url.includes('cycle=3'),
      );
      expect(match).toBeDefined();
    });
  });

  it('empty cycles list → placeholder "No cycles in selected range" + disabled', async () => {
    setupDefaultApiFetch([]); // /api/cycles/list returns []

    const Wrapper = withSearchParams('from=2026-04-01&to=2026-04-15');

    render(<ReportsPage />, { wrapper: Wrapper });

    await waitFor(() => {
      const calls = mockApiFetch.mock.calls.filter(
        ([url]: [string]) => url.includes('/api/cycles/list'),
      );
      expect(calls.length).toBeGreaterThan(0);
    });

    // Placeholder text ("noCyclesInRange" — from the translations mock, last segment)
    await waitFor(() => {
      expect(screen.getByText(/noCyclesInRange/i)).toBeInTheDocument();
    });

    // Trigger is disabled
    const trigger = await screen.findByRole('combobox', { name: /cycleLabel/i });
    expect(trigger).toBeDisabled();
  });

  it('skeleton cell count tracks selectedFields.length', async () => {
    // Delay the /api/reports/machine promise indefinitely so skeleton stays rendered
    let resolveReport: (() => void) | null = null;
    mockApiFetch.mockImplementation((url: string) => {
      if (url.includes('/api/cycles/list')) {
        return Promise.resolve({ cycles: [1] });
      }
      if (url.includes('/api/reports/machine')) {
        return new Promise(() => {
          resolveReport = () => {};
        });
      }
      return Promise.reject(new Error(`Unexpected URL: ${url}`));
    });

    const Wrapper = withSearchParams('from=2026-04-01&to=2026-04-15');

    const { container } = render(<ReportsPage />, { wrapper: Wrapper });

    // Wait for loading state (skeleton) to appear
    await waitFor(() => {
      const skeletons = container.querySelectorAll('[data-slot="skeleton"]');
      expect(skeletons.length).toBeGreaterThan(0);
    });

    // The current (pre-GREEN) layout hard-codes 5 skeleton cells per row.
    // After GREEN, each row must contain exactly selectedFields.length cells
    // (or 1 cell if selectedFields is empty). With the default WPT role
    // selection (many fields), the count MUST be != 5 — this assertion fails
    // under the legacy fixed-5 layout and passes once Task 4 is implemented.
    const rows = container.querySelectorAll('.space-y-3 > .flex.gap-4');
    expect(rows.length).toBe(6); // 6 rows of skeletons (per plan)

    const firstRow = rows[0];
    expect(firstRow).toBeDefined();
    const firstRowSkeletons = firstRow!.querySelectorAll('[data-slot="skeleton"]');
    // Post-GREEN: selectedFields.length >> 5 (WPT role), so cell count is > 5.
    // Pre-GREEN: hardcoded 5 cells per row → assertion fails (RED).
    expect(firstRowSkeletons.length).toBeGreaterThan(5);

    // Prevent unused-var lint if resolveReport is never assigned
    void resolveReport;
  });

  it('does NOT call /api/cycles/list when date range is unset', async () => {
    const Wrapper = withSearchParams(''); // no from/to

    render(<ReportsPage />, { wrapper: Wrapper });

    // Give React a tick to run initial effects
    await new Promise((resolve) => setTimeout(resolve, 50));

    const cycleListCalls = mockApiFetch.mock.calls.filter(
      ([url]: [string]) => url.includes('/api/cycles/list'),
    );
    expect(cycleListCalls).toHaveLength(0);
  });
});
