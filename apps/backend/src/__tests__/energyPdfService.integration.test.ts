import { readFile } from 'node:fs/promises';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  assertReportReproducible,
  extractPdfText,
} from './energy/pdfReportTestUtils.js';

const getAggregateMock = vi.fn();
const getBaselineByIdMock = vi.fn();
const computeSavingsMock = vi.fn();
const getCyclesMock = vi.fn();
const getActivePeriodMock = vi.fn();

const BANNED_TERMS = [
  'Transizione 5.0',
  'iper-ammortamento',
  'GSE',
  'MIMIT',
] as const;

const REQUIRED_ITALIAN_HEADINGS = [
  'Rapporto energetico ISO 50001',
  'Executive summary',
  'Tabella EnPI',
  'Dichiarazione EnB',
  'Energia per periodo',
  'Efficienza per ciclo',
  'Costi e CO₂',
  'Indicatore di risparmio',
  'Fonti',
] as const;

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

vi.mock('../services/energyConfigService.js', () => ({
  EnergyConfigService: {
    getActivePeriod: getActivePeriodMock,
  },
}));

function buildCycleRows(rowCount: number) {
  return Array.from({ length: rowCount }, (_, index) => ({
    cycleType: index + 1,
    cycleLabelKey: `CYCLE_${index + 1}`,
    cycleLabel: `Cycle ${index + 1}`,
    cycleCount: 1,
    totalKwh: 12 + index,
    totalKg: 9.2 + index,
    avgKwhPerKg: 1.111 + index / 1000,
  }));
}

describe('energy pdf integration rendering', () => {
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

    getActivePeriodMock.mockResolvedValue({
      id: 1,
      validFrom: new Date('2024-01-01T00:00:00.000Z'),
      validTo: null,
      emissionFactorKgPerKwh: 0.279,
      emissionFactorYear: 2024,
      emissionFactorSource: 'ISPRA',
      tariffMode: 'single',
      tariffSingleEurPerKwh: 0.25,
      tariffBandsJson: {},
      customHolidays: [],
      createdAt: new Date('2024-01-01T00:00:00.000Z'),
    });
  });

  it('renders italian text with all section headings, footer source labels, and no banned terms', async () => {
    const { EnergyPdfService } = await import('../services/energy/energyPdfService.js');

    const pdf = await EnergyPdfService.generateIso50001Pdf({
      from: new Date('2026-04-01T00:00:00.000Z'),
      to: new Date('2026-04-08T00:00:00.000Z'),
      lang: 'it',
      baselineId: 7,
    });
    const extractedText = await extractPdfText(pdf);

    expect(extractedText).toContain('è');
    expect(extractedText).toContain('Fonte fattore emissivo');
    expect(extractedText).toContain('Anno fattore emissivo');
    expect(extractedText).toContain('Fonte tariffa');
    for (const heading of REQUIRED_ITALIAN_HEADINGS) {
      expect(extractedText).toContain(heading);
    }

    for (const bannedTerm of BANNED_TERMS) {
      expect(extractedText).not.toContain(bannedTerm);
    }
  });

  it('keeps the 1000-row render reproducible above the size gate and pins keepWithHeaderRows', async () => {
    const serviceSource = await readFile(
      new URL('../services/energy/energyPdfService.ts', import.meta.url),
      'utf8',
    );
    const { EnergyPdfService } = await import('../services/energy/energyPdfService.js');

    const reportArgs = {
      from: new Date('2026-04-01T00:00:00.000Z'),
      to: new Date('2026-04-08T00:00:00.000Z'),
      lang: 'en',
      baselineId: 7,
    } as const;

    getCyclesMock.mockResolvedValue({
      from: '2026-04-01T00:00:00.000Z',
      to: '2026-04-08T00:00:00.000Z',
      limit: 1000,
      rows: buildCycleRows(1000),
    });

    const pdfA = await EnergyPdfService.generateIso50001Pdf(reportArgs);
    const pdfB = await EnergyPdfService.generateIso50001Pdf(reportArgs);

    expect(serviceSource).toContain('keepWithHeaderRows: 1');
    expect(Buffer.isBuffer(pdfA)).toBe(true);
    expect(Buffer.isBuffer(pdfB)).toBe(true);
    expect(pdfA.length).toBeGreaterThan(50000);
    expect(pdfB.length).toBeGreaterThan(50000);
    assertReportReproducible(pdfA, pdfB);
  });
});
