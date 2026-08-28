import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

const { apiFetchMock, refreshUserMock, toastErrorMock, translate } = vi.hoisted(() => ({
  apiFetchMock: vi.fn(),
  refreshUserMock: vi.fn(),
  toastErrorMock: vi.fn(),
  translate: (key: string) => key,
}));

vi.mock('next-intl', () => ({
  useTranslations: () => translate,
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: toastErrorMock },
}));

vi.mock('@/lib/api', () => ({ apiFetch: apiFetchMock }));
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ refreshUser: refreshUserMock }),
}));

import { ApplicationSettingsForm } from '@/components/settings/application-settings-form';

describe('ApplicationSettingsForm timezone', () => {
  beforeEach(() => {
    apiFetchMock.mockReset();
    refreshUserMock.mockReset();
    toastErrorMock.mockReset();
  });

  it('saves an IANA timezone and refreshes the timezone used by every page', async () => {
    apiFetchMock
      .mockResolvedValueOnce({
        id: 1,
        timezone: 'Europe/Rome',
        updatedAt: '2026-08-28T12:00:00.000Z',
      })
      .mockResolvedValueOnce({
        id: 1,
        timezone: 'Asia/Tokyo',
        updatedAt: '2026-08-28T12:01:00.000Z',
      });

    render(<ApplicationSettingsForm />);

    const selector = await screen.findByRole('combobox', { name: 'timezone' });
    expect(await screen.findByText(/Europe\/Rome/)).toBeInTheDocument();

    fireEvent.focus(selector);
    fireEvent.keyDown(selector, { key: 'ArrowDown' });
    fireEvent.click(await screen.findByRole('option', { name: /Asia\/Tokyo/ }));
    fireEvent.click(screen.getByRole('button', { name: 'save' }));

    await waitFor(() => {
      expect(apiFetchMock).toHaveBeenLastCalledWith('/api/application/config', {
        method: 'PUT',
        body: JSON.stringify({ timezone: 'Asia/Tokyo' }),
      });
      expect(refreshUserMock).toHaveBeenCalledOnce();
    });
  });

  it('offers the complete searchable IANA timezone list', async () => {
    apiFetchMock.mockResolvedValueOnce({
      id: 1,
      timezone: 'Europe/Rome',
      updatedAt: '2026-08-28T12:00:00.000Z',
    });

    render(<ApplicationSettingsForm />);

    const selector = await screen.findByRole('combobox', { name: 'timezone' });
    fireEvent.focus(selector);
    fireEvent.keyDown(selector, { key: 'ArrowDown' });

    expect(
      await screen.findByRole('option', { name: /Pacific\/Auckland/ }),
    ).toBeInTheDocument();
  });

  it('renders the timezone menu outside the card that would clip it', async () => {
    apiFetchMock.mockResolvedValueOnce({
      id: 1,
      timezone: 'Europe/Rome',
      updatedAt: '2026-08-28T12:00:00.000Z',
    });

    render(<ApplicationSettingsForm />);

    const selector = await screen.findByRole('combobox', { name: 'timezone' });
    fireEvent.focus(selector);
    fireEvent.keyDown(selector, { key: 'ArrowDown' });

    const listbox = await screen.findByRole('listbox');
    const card = screen.getByText('title').closest('[data-slot="card"]');

    expect(card).not.toContainElement(listbox);
    expect(document.body).toContainElement(listbox);
  });

  it('shows the translated load error instead of a backend error string', async () => {
    apiFetchMock.mockRejectedValueOnce(new Error('raw backend error'));

    render(<ApplicationSettingsForm />);

    await waitFor(() => {
      expect(toastErrorMock).toHaveBeenCalledWith('loadError');
    });
  });
});
