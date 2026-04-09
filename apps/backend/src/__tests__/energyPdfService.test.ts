import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UserRole } from '@wpt/types';

const getAggregateMock = vi.fn();
const getBaselineByIdMock = vi.fn();
const computeSavingsMock = vi.fn();
const getCyclesMock = vi.fn();

vi.mock('../services/energyAggregateService.js', () => ({
  EnergyAggregateService: {
    getAggregate: getAggregateMock,
  },
}));

vi.mock('../services/energyBaselineService.js', () => ({
  EnergyBaselineService: {
    getBaselineById: getBaselineByIdMock,
    computeSavings: computeSavingsMock,
  },
}));

vi.mock('../services/energyDashboardService.js', () => ({
  EnergyDashboardService: {
    getCycles: getCyclesMock,
  },
}));

describe('energy pdf service task 02.1', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    getAggregateMock.mockResolvedValue({
      bucket: 'day',
      from: new Date('2026-04-01T00:00:00.000Z'),
      to: new Date('2026-04-08T00:00:00.000Z'),
      rows: [
        {
          bucket: new Date('2026-04-01T00:00:00.000Z'),
          kwhDelta: 120.4,
          costEur: 28.76,
          co2Kg: 41.3,
          sampleCount: 288,
        },
      ],
      display: {
        totalKwh: '120 kWh',
        totalCost: '28,76 €',
        totalCo2: '41 kgCO₂',
      },
    });

    getBaselineByIdMock.mockResolvedValue({
      baselineId: 7,
      label: 'Install baseline',
      periodFrom: new Date('2026-03-01T00:00:00.000Z'),
      periodTo: new Date('2026-03-31T00:00:00.000Z'),
      lockedAt: new Date('2026-04-01T12:00:00.000Z'),
      retiredAt: null,
      justification: 'Initial commissioning window',
      normalizationVariables: {},
      createdBy: 'qa',
    });

    computeSavingsMock.mockResolvedValue({
      baselineId: 7,
      baselineLabel: 'Install baseline',
      baselineEnpi: 1.55,
      measurementEnpi: 1.21,
      deltaPct: -21.94,
      deltaKwh: -48.6,
      deltaEur: -12.45,
      deltaKgco2: -18.7,
      confidence: 'HIGH',
      windowFrom: '2026-04-01T00:00:00.000Z',
      windowTo: '2026-04-08T00:00:00.000Z',
      excludedStatuses: ['ABORTED'],
      dailySeries: [],
    });

    getCyclesMock.mockResolvedValue({
      from: '2026-04-01T00:00:00.000Z',
      to: '2026-04-08T00:00:00.000Z',
      limit: 1000,
      rows: [
        {
          cycleType: 3,
          cycleLabelKey: 'DRY_MIXED',
          cycleLabel: 'Dry Mixed',
          cycleCount: 8,
          totalKwh: 120.4,
          totalKg: 96.2,
          avgKwhPerKg: 1.251,
        },
      ],
    });
  });

  it('exposes backend-owned IT/EN copy with the required section keys', async () => {
    const { ENERGY_PDF_COPY } = await import('../i18n/energyPdfCopy.js');

    expect(Object.keys(ENERGY_PDF_COPY.it)).toEqual([
      'header',
      'executiveSummary',
      'enpiTable',
      'enbDeclaration',
      'energyByPeriod',
      'perCycleEfficiency',
      'costAndCo2',
      'savingsIndicator',
      'footer',
    ]);
    expect(Object.keys(ENERGY_PDF_COPY.en)).toEqual([
      'header',
      'executiveSummary',
      'enpiTable',
      'enbDeclaration',
      'energyByPeriod',
      'perCycleEfficiency',
      'costAndCo2',
      'savingsIndicator',
      'footer',
    ]);
  });

  it('builds a report model from aggregate, baseline, savings, and cycles services', async () => {
    const { ENERGY_PDF_SECTION_ORDER, EnergyPdfService } = await import(
      '../services/energyPdfService.js'
    );

    const model = await EnergyPdfService.buildReportModel({
      from: new Date('2026-04-01T00:00:00.000Z'),
      to: new Date('2026-04-08T00:00:00.000Z'),
      lang: 'it',
      baselineId: 7,
    });

    expect(ENERGY_PDF_SECTION_ORDER).toEqual([
      'header',
      'executiveSummary',
      'enpiTable',
      'enbDeclaration',
      'energyByPeriod',
      'perCycleEfficiency',
      'costAndCo2',
      'savingsIndicator',
      'footer',
    ]);
    expect(model.implementedSectionKeys).toEqual([
      'header',
      'executiveSummary',
      'enpiTable',
      'enbDeclaration',
      'energyByPeriod',
      'savingsIndicator',
    ]);
    expect(getAggregateMock).toHaveBeenCalledWith({
      from: new Date('2026-04-01T00:00:00.000Z'),
      to: new Date('2026-04-08T00:00:00.000Z'),
      bucket: 'day',
    });
    expect(getBaselineByIdMock).toHaveBeenCalledWith(7);
    expect(computeSavingsMock).toHaveBeenCalledWith({
      baselineId: 7,
      measurementFrom: new Date('2026-04-01T00:00:00.000Z'),
      measurementTo: new Date('2026-04-08T00:00:00.000Z'),
      detail: 1,
    });
    expect(getCyclesMock).toHaveBeenCalledWith({
      from: new Date('2026-04-01T00:00:00.000Z'),
      to: new Date('2026-04-08T00:00:00.000Z'),
      role: UserRole.WPT,
      limit: 1000,
    });
  });
});
