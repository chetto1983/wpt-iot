import { render } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock('@/lib/locale', () => ({
  useAppLocale: () => ({ timezone: 'Europe/Rome' }),
}));

import { PanelChart } from '@/components/dashboard/panel-chart';

describe('PanelChart background refresh', () => {
  it('keeps the current chart visible while newer data is loading', () => {
    const { container } = render(
      <PanelChart
        chartType="line"
        config={{
          fields: ['energyConsumption'],
          showLegend: false,
          showGrid: true,
        }}
        data={[
          { timestamp: 1_775_210_400_000, energyConsumption: 10 },
          { timestamp: 1_775_211_300_000, energyConsumption: 11 },
        ]}
        resolution="raw"
        locale="it"
        loading
      />,
    );

    expect(container.querySelector('[data-slot="skeleton"]')).not.toBeInTheDocument();
    expect(container.querySelector('.recharts-responsive-container')).toBeInTheDocument();
  });
});
