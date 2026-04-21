import { readFile } from 'node:fs/promises';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  formatItEur,
  formatItKgCO2,
  formatItKwh,
  UserRole,
} from '@wpt/types';

const getAggregateMock = vi.fn();
const getBaselineByIdMock = vi.fn();
const computeSavingsMock = vi.fn();
const getCyclesMock = vi.fn();
const getActivePeriodMock = vi.fn();

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
      '../services/energy/energyPdfService.js'
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
      'perCycleEfficiency',
      'costAndCo2',
      'savingsIndicator',
      'footer',
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

  it('emits all 9 section headings in the document-definition path with a 10pt body font', async () => {
    const { ENERGY_PDF_COPY } = await import('../i18n/energyPdfCopy.js');
    const { EnergyPdfService } = await import('../services/energy/energyPdfService.js');

    const model = await EnergyPdfService.buildReportModel({
      from: new Date('2026-04-01T00:00:00.000Z'),
      to: new Date('2026-04-08T00:00:00.000Z'),
      lang: 'en',
      baselineId: 7,
    });
    const definition = EnergyPdfService.buildDocumentDefinition(model);
    const headings = ((definition.content as unknown[]) ?? [])
      .filter((item): item is { text: string; style: string } => {
        if (!item || typeof item !== 'object') {
          return false;
        }
        const candidate = item as { text?: unknown; style?: unknown };
        return candidate.style === 'sectionHeading' && typeof candidate.text === 'string';
      })
      .map((item) => item.text);

    expect(headings).toEqual([
      ENERGY_PDF_COPY.en.header.title,
      ENERGY_PDF_COPY.en.executiveSummary.title,
      ENERGY_PDF_COPY.en.enpiTable.title,
      ENERGY_PDF_COPY.en.enbDeclaration.title,
      ENERGY_PDF_COPY.en.energyByPeriod.title,
      ENERGY_PDF_COPY.en.perCycleEfficiency.title,
      ENERGY_PDF_COPY.en.costAndCo2.title,
      ENERGY_PDF_COPY.en.savingsIndicator.title,
      ENERGY_PDF_COPY.en.footer.title,
    ]);
    expect(model.implementedSectionKeys).toEqual([
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
    expect((definition.defaultStyle as { fontSize?: number }).fontSize).toBe(10);
  });

  it('builds the real per-cycle table node and footer source labels', async () => {
    const { ENERGY_PDF_COPY } = await import('../i18n/energyPdfCopy.js');
    const { EnergyPdfService } = await import('../services/energy/energyPdfService.js');

    const model = await EnergyPdfService.buildReportModel({
      from: new Date('2026-04-01T00:00:00.000Z'),
      to: new Date('2026-04-08T00:00:00.000Z'),
      lang: 'it',
      baselineId: 7,
    });
    const definition = EnergyPdfService.buildDocumentDefinition(model);
    const perCycleNode = ((definition.content as unknown[]) ?? []).find((item) => {
      if (!item || typeof item !== 'object') {
        return false;
      }
      const candidate = item as {
        table?: { body?: unknown[]; keepWithHeaderRows?: number };
      };
      const firstRow = candidate.table?.body?.[0];
      return Array.isArray(firstRow) && firstRow.includes(ENERGY_PDF_COPY.it.perCycleEfficiency.cycleLabel);
    }) as {
      fontSize?: number;
      table: {
        headerRows: number;
        dontBreakRows: boolean;
        keepWithHeaderRows: number;
        body: unknown[][];
      };
    } | undefined;

    expect(perCycleNode).toBeDefined();
    expect(perCycleNode?.table.headerRows).toBe(1);
    expect(perCycleNode?.table.dontBreakRows).toBe(true);
    expect(perCycleNode?.table.keepWithHeaderRows).toBe(1);
    expect(perCycleNode?.fontSize).toBeLessThan(10);
    expect(perCycleNode?.table.body[1]).toEqual([
      'Dry Mixed',
      '8',
      '120 kWh',
      '96,2 kg',
      '1,3',
    ]);

    const footer = (definition as { footer?: (currentPage: number, pageCount: number) => unknown })
      .footer;
    expect(typeof footer).toBe('function');

    const footerNode = footer?.(1, 3) as { columns?: Array<{ text?: string }>; margin?: number[] };
    const footerText = footerNode.columns
      ?.map((column) => column.text ?? '')
      .join(' ') ?? '';

    expect(footerText).toContain(ENERGY_PDF_COPY.it.footer.emissionFactorSourceLabel);
    expect(footerText).toContain(ENERGY_PDF_COPY.it.footer.emissionFactorYearLabel);
    expect(footerText).toContain(ENERGY_PDF_COPY.it.footer.tariffSourceLabel);
    expect(footerText).toContain('1 / 3');
    expect(footerNode.margin).toEqual([40, 8, 40, 0]);
  });

  it('exposes accented Italian footer/source copy', async () => {
    const { ENERGY_PDF_COPY } = await import('../i18n/energyPdfCopy.js');

    expect(ENERGY_PDF_COPY.it.executiveSummary.totalCo2Label).toContain('CO₂');
    expect(ENERGY_PDF_COPY.it.costAndCo2.title).toBe('Costi e CO₂');
    expect(ENERGY_PDF_COPY.it.footer.note).toContain('dell’energia');
    expect(ENERGY_PDF_COPY.en.footer.emissionFactorSourceLabel).toBe('Emission factor source');
    expect(ENERGY_PDF_COPY.en.footer.tariffSourceLabel).toBe('Tariff source');
  });

  it('uses formatItKwh, formatItEur, formatItKgCO2, and explicit above baseline / below baseline wording', async () => {
    const serviceSource = await readFile(
      new URL('../services/energy/energyPdfService.ts', import.meta.url),
      'utf8',
    );
    const { EnergyPdfService } = await import('../services/energy/energyPdfService.js');

    expect(serviceSource).toContain('formatItKwh');
    expect(serviceSource).toContain('formatItEur');
    expect(serviceSource).toContain('formatItKgCO2');
    expect(serviceSource).not.toContain('Intl.NumberFormat');

    const belowBaselineModel = await EnergyPdfService.buildReportModel({
      from: new Date('2026-04-01T00:00:00.000Z'),
      to: new Date('2026-04-08T00:00:00.000Z'),
      lang: 'en',
      baselineId: 7,
    });

    computeSavingsMock.mockResolvedValueOnce({
      baselineId: 7,
      baselineLabel: 'Install baseline',
      baselineEnpi: 1.55,
      measurementEnpi: 1.73,
      deltaPct: 11.61,
      deltaKwh: 14.2,
      deltaEur: 3.6,
      deltaKgco2: 5.8,
      confidence: 'HIGH',
      windowFrom: '2026-04-01T00:00:00.000Z',
      windowTo: '2026-04-08T00:00:00.000Z',
      excludedStatuses: ['ABORTED'],
      dailySeries: [],
    });

    const aboveBaselineModel = await EnergyPdfService.buildReportModel({
      from: new Date('2026-04-01T00:00:00.000Z'),
      to: new Date('2026-04-08T00:00:00.000Z'),
      lang: 'en',
      baselineId: 7,
    });

    expect(belowBaselineModel.energyByPeriodRows[0]).toEqual({
      date: '01/04/2026',
      energy: formatItKwh(120.4),
      cost: formatItEur(28.76),
      co2: formatItKgCO2(41.3),
    });
    expect(belowBaselineModel.savingsSummary.directionText).toContain('below baseline');
    expect(aboveBaselineModel.savingsSummary.directionText).toContain('above baseline');
  });
});
