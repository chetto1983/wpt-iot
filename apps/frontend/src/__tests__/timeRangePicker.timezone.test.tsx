import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, params?: Record<string, unknown>) =>
    params?.time ? `${key}:${String(params.time)}` : key,
}));

vi.mock('@/lib/locale', () => ({
  useAppLocale: () => ({
    timezone: 'Asia/Tokyo',
    formatDate: (date: Date) =>
      new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Tokyo',
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      }).format(date),
    formatDateTime: (date: Date) =>
      new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Tokyo',
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).format(date),
    formatTime: (date: Date) =>
      new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Tokyo',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).format(date),
    formatTimeFull: (date: Date) =>
      new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Tokyo',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      }).format(date),
  }),
}));

import { TimeRangePicker } from '@/components/shared/time-range-picker';

describe('TimeRangePicker timezone rendering', () => {
  it('renders custom ranges and the last update in the configured timezone', () => {
    render(
      <TimeRangePicker
        from={new Date('2026-08-28T12:00:00.000Z')}
        to={new Date('2026-08-28T13:00:00.000Z')}
        onRangeChange={vi.fn()}
        activePreset={null}
        onPresetChange={vi.fn()}
        refreshInterval={0}
        onRefreshIntervalChange={vi.fn()}
        lastUpdated={new Date('2026-08-28T14:08:30.000Z')}
      />,
    );

    expect(screen.getByText('28/08 21:00 - 28/08 22:00')).toBeInTheDocument();
    expect(screen.getByText('lastUpdated:23:08:30')).toBeInTheDocument();
  });
});
