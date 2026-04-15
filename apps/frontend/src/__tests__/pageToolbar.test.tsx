import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

// Mock next-intl — PageToolbar itself does not call useTranslations, but keep
// the mock in place for parity with other frontend test files.
vi.mock('next-intl', () => ({
  useTranslations: () => {
    const t = (key: string) => key.split('.').pop() ?? key;
    return t;
  },
}));

import { PageToolbar } from '@/components/shared/page-toolbar';

describe('PageToolbar', () => {
  it('renders title slot content', () => {
    render(
      <PageToolbar title="My Title">
        <span>child</span>
      </PageToolbar>,
    );
    expect(screen.getByText('My Title')).toBeInTheDocument();
  });

  it('renders children in the center slot', () => {
    render(
      <PageToolbar title="t">
        <div data-testid="child-center">C</div>
      </PageToolbar>,
    );
    expect(screen.getByTestId('child-center')).toBeInTheDocument();
  });

  it('renders actionsRight only when provided', () => {
    // Without actionsRight — no Save button
    const { rerender } = render(
      <PageToolbar title="t">
        <span>child</span>
      </PageToolbar>,
    );
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();

    // With actionsRight — Save button present
    rerender(
      <PageToolbar title="t" actionsRight={<button type="button">Save</button>}>
        <span>child</span>
      </PageToolbar>,
    );
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
  });
});
