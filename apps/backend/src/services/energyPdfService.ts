import {
  formatItDate,
  formatItDateTime,
  formatItEur,
  formatItKgCO2,
  formatItKwh,
  type IEnergyAggregateResponse,
  type IEnergyBaseline,
  type IEnergyCyclesResponse,
  type ISavingsDetailResponse,
  UserRole,
} from '@wpt/types';
import {
  ENERGY_PDF_COPY,
  ENERGY_PDF_SECTION_ORDER,
  type EnergyPdfLang,
  type EnergyPdfSectionKey,
  type IEnergyPdfCopyBranch,
} from '../i18n/energyPdfCopy.js';
import { EnergyAggregateService } from './energyAggregateService.js';
import { EnergyBaselineService } from './energyBaselineService.js';
import { EnergyDashboardService } from './energyDashboardService.js';
import { createDeterministicPdfBuffer } from './pdfDocumentFactory.js';

type PdfDocumentDefinition = Parameters<typeof createDeterministicPdfBuffer>[0];
type PdfContent = Record<string, unknown>;

const IMPLEMENTED_WAVE_TWO_SECTIONS = [
  'header',
  'executiveSummary',
  'enpiTable',
  'enbDeclaration',
  'energyByPeriod',
  'savingsIndicator',
] as const satisfies readonly EnergyPdfSectionKey[];

interface IEnergyPdfMetricRow {
  label: string;
  value: string;
}

interface IEnergyPdfPeriodRow {
  date: string;
  energy: string;
  cost: string;
  co2: string;
}

interface IEnergyPdfSavingsSummary {
  directionText: string;
  deltaPct: string;
  deltaKwh: string;
  deltaEur: string;
  deltaKgCo2: string;
  confidence: string;
}

export interface IEnergyPdfReportModel {
  lang: EnergyPdfLang;
  copy: IEnergyPdfCopyBranch;
  from: Date;
  to: Date;
  baseline: IEnergyBaseline;
  aggregate: IEnergyAggregateResponse;
  cycles: IEnergyCyclesResponse;
  savings: ISavingsDetailResponse;
  sectionOrder: ReadonlyArray<EnergyPdfSectionKey>;
  implementedSectionKeys: ReadonlyArray<EnergyPdfSectionKey>;
  headerRows: IEnergyPdfMetricRow[];
  executiveSummaryRows: IEnergyPdfMetricRow[];
  enpiRows: IEnergyPdfMetricRow[];
  enbRows: IEnergyPdfMetricRow[];
  energyByPeriodRows: IEnergyPdfPeriodRow[];
  savingsSummary: IEnergyPdfSavingsSummary;
}

function formatEnpi(value: number): string {
  return `${formatItKwh(value, { compact: true })}/kg`;
}

function formatSignedPercent(value: number): string {
  const sign = value > 0 ? '+' : value < 0 ? '-' : '';
  return `${sign}${Math.abs(value).toFixed(1).replace('.', ',')}%`;
}

function formatSignedMetric(
  value: number,
  formatter: (input: number) => string,
): string {
  if (value === 0) {
    return formatter(0);
  }

  const sign = value > 0 ? '+' : '-';
  return `${sign}${formatter(Math.abs(value))}`;
}

function buildSectionHeading(text: string): PdfContent {
  return {
    text,
    style: 'sectionHeading',
    margin: [0, 18, 0, 6],
  } as PdfContent;
}

function buildKeyValueTable(rows: IEnergyPdfMetricRow[]): PdfContent {
  return {
    table: {
      widths: ['*', 'auto'],
      body: rows.map((row) => [row.label, row.value]),
    },
    layout: 'lightHorizontalLines',
    margin: [0, 0, 0, 8],
  } as PdfContent;
}

function buildEnergyByPeriodTable(
  copy: IEnergyPdfCopyBranch,
  rows: IEnergyPdfPeriodRow[],
): PdfContent {
  return {
    table: {
      headerRows: 1,
      widths: ['*', 'auto', 'auto', 'auto'],
      body: [
        [
          copy.energyByPeriod.dateLabel,
          copy.energyByPeriod.energyLabel,
          copy.energyByPeriod.costLabel,
          copy.energyByPeriod.co2Label,
        ],
        ...rows.map((row) => [row.date, row.energy, row.cost, row.co2]),
      ],
    },
    layout: 'lightHorizontalLines',
    margin: [0, 0, 0, 8],
  } as PdfContent;
}

function buildSavingsDirectionText(
  copy: IEnergyPdfCopyBranch,
  savings: ISavingsDetailResponse,
): string {
  if (savings.deltaPct < 0) {
    return copy.savingsIndicator.belowBaseline;
  }
  if (savings.deltaPct > 0) {
    return copy.savingsIndicator.aboveBaseline;
  }
  return copy.savingsIndicator.atBaseline;
}

function assertSavingsDetail(
  savings: Awaited<ReturnType<typeof EnergyBaselineService.computeSavings>>,
): ISavingsDetailResponse {
  if (!('dailySeries' in savings)) {
    throw new Error('Expected savings detail payload with dailySeries');
  }
  return savings;
}

function buildHeaderRows(
  copy: IEnergyPdfCopyBranch,
  baseline: IEnergyBaseline,
  from: Date,
  to: Date,
): IEnergyPdfMetricRow[] {
  return [
    {
      label: copy.header.periodLabel,
      value: `${formatItDate(from)} - ${formatItDate(to)}`,
    },
    {
      label: copy.header.baselineLabel,
      value: baseline.label,
    },
    {
      label: copy.header.referenceLabel,
      value: formatItDateTime(to),
    },
  ];
}

function buildExecutiveSummaryRows(
  copy: IEnergyPdfCopyBranch,
  aggregate: IEnergyAggregateResponse,
  cycles: IEnergyCyclesResponse,
): IEnergyPdfMetricRow[] {
  const totalCycles = cycles.rows.reduce((sum, row) => sum + row.cycleCount, 0);
  return [
    {
      label: copy.executiveSummary.totalEnergyLabel,
      value: aggregate.display.totalKwh,
    },
    {
      label: copy.executiveSummary.totalCostLabel,
      value: aggregate.display.totalCost,
    },
    {
      label: copy.executiveSummary.totalCo2Label,
      value: aggregate.display.totalCo2,
    },
    {
      label: copy.executiveSummary.totalCyclesLabel,
      value: String(totalCycles),
    },
  ];
}

function buildEnpiRows(
  copy: IEnergyPdfCopyBranch,
  savings: ISavingsDetailResponse,
): IEnergyPdfMetricRow[] {
  return [
    {
      label: copy.enpiTable.baselineEnpiLabel,
      value: formatEnpi(savings.baselineEnpi),
    },
    {
      label: copy.enpiTable.measurementEnpiLabel,
      value: formatEnpi(savings.measurementEnpi),
    },
    {
      label: copy.enpiTable.deltaLabel,
      value: formatSignedPercent(savings.deltaPct),
    },
  ];
}

function buildEnbRows(
  copy: IEnergyPdfCopyBranch,
  baseline: IEnergyBaseline,
): IEnergyPdfMetricRow[] {
  return [
    {
      label: copy.enbDeclaration.labelLabel,
      value: baseline.label,
    },
    {
      label: copy.enbDeclaration.baselineWindowLabel,
      value: `${formatItDate(baseline.periodFrom)} - ${formatItDate(baseline.periodTo)}`,
    },
    {
      label: copy.enbDeclaration.lockedAtLabel,
      value: formatItDateTime(baseline.lockedAt),
    },
    {
      label: copy.enbDeclaration.justificationLabel,
      value: baseline.justification ?? copy.enbDeclaration.defaultJustification,
    },
  ];
}

function buildEnergyByPeriodRows(
  aggregate: IEnergyAggregateResponse,
): IEnergyPdfPeriodRow[] {
  return aggregate.rows.map((row) => ({
    date: formatItDate(row.bucket),
    energy: formatItKwh(row.kwhDelta),
    cost: formatItEur(row.costEur),
    co2: formatItKgCO2(row.co2Kg),
  }));
}

function buildSavingsSummary(
  copy: IEnergyPdfCopyBranch,
  savings: ISavingsDetailResponse,
): IEnergyPdfSavingsSummary {
  return {
    directionText: buildSavingsDirectionText(copy, savings),
    deltaPct: formatSignedPercent(savings.deltaPct),
    deltaKwh: formatSignedMetric(savings.deltaKwh, formatItKwh),
    deltaEur: formatSignedMetric(savings.deltaEur, formatItEur),
    deltaKgCo2: formatSignedMetric(savings.deltaKgco2, formatItKgCO2),
    confidence: savings.confidence,
  };
}

export { ENERGY_PDF_SECTION_ORDER };

export class EnergyPdfService {
  static async buildReportModel(args: {
    from: Date;
    to: Date;
    lang: EnergyPdfLang;
    baselineId: number;
  }): Promise<IEnergyPdfReportModel> {
    const copy = ENERGY_PDF_COPY[args.lang];
    const [aggregate, baseline, rawSavings, cycles] = await Promise.all([
      EnergyAggregateService.getAggregate({
        from: args.from,
        to: args.to,
        bucket: 'day',
      }),
      EnergyBaselineService.getBaselineById(args.baselineId),
      EnergyBaselineService.computeSavings({
        baselineId: args.baselineId,
        measurementFrom: args.from,
        measurementTo: args.to,
        detail: 1,
      }),
      EnergyDashboardService.getCycles({
        from: args.from,
        to: args.to,
        role: UserRole.WPT,
        limit: 1000,
      }),
    ]);

    if (!baseline) {
      throw new Error(`Baseline ${args.baselineId} not found`);
    }

    const savings = assertSavingsDetail(rawSavings);

    return {
      lang: args.lang,
      copy,
      from: args.from,
      to: args.to,
      baseline,
      aggregate,
      cycles,
      savings,
      sectionOrder: ENERGY_PDF_SECTION_ORDER,
      implementedSectionKeys: IMPLEMENTED_WAVE_TWO_SECTIONS,
      headerRows: buildHeaderRows(copy, baseline, args.from, args.to),
      executiveSummaryRows: buildExecutiveSummaryRows(copy, aggregate, cycles),
      enpiRows: buildEnpiRows(copy, savings),
      enbRows: buildEnbRows(copy, baseline),
      energyByPeriodRows: buildEnergyByPeriodRows(aggregate),
      savingsSummary: buildSavingsSummary(copy, savings),
    };
  }

  static buildDocumentDefinition(model: IEnergyPdfReportModel): PdfDocumentDefinition {
    const content: PdfContent[] = [];

    content.push(
      buildSectionHeading(model.copy.header.title),
      { text: model.copy.header.subtitle, style: 'subheading', margin: [0, 0, 0, 8] },
      buildKeyValueTable(model.headerRows),
      buildSectionHeading(model.copy.executiveSummary.title),
      buildKeyValueTable(model.executiveSummaryRows),
      buildSectionHeading(model.copy.enpiTable.title),
      buildKeyValueTable(model.enpiRows),
      buildSectionHeading(model.copy.enbDeclaration.title),
      buildKeyValueTable(model.enbRows),
      buildSectionHeading(model.copy.energyByPeriod.title),
      buildEnergyByPeriodTable(model.copy, model.energyByPeriodRows),
      buildSectionHeading(model.copy.perCycleEfficiency.title),
      buildSectionHeading(model.copy.costAndCo2.title),
      buildSectionHeading(model.copy.savingsIndicator.title),
      buildKeyValueTable([
        { label: model.copy.savingsIndicator.confidenceLabel, value: model.savingsSummary.confidence },
        { label: model.copy.savingsIndicator.deltaKwhLabel, value: model.savingsSummary.deltaKwh },
        { label: model.copy.savingsIndicator.deltaEurLabel, value: model.savingsSummary.deltaEur },
        { label: model.copy.savingsIndicator.deltaKgCo2Label, value: model.savingsSummary.deltaKgCo2 },
        { label: model.copy.enpiTable.deltaLabel, value: model.savingsSummary.deltaPct },
      ]),
      { text: model.savingsSummary.directionText, margin: [0, 0, 0, 8] },
      buildSectionHeading(model.copy.footer.title),
      { text: model.copy.footer.note, margin: [0, 0, 0, 0] },
    );

    return {
      compress: true,
      defaultStyle: {
        font: 'Roboto',
        fontSize: 10,
      },
      styles: {
        sectionHeading: {
          bold: true,
          fontSize: 14,
        },
        subheading: {
          fontSize: 11,
          italics: true,
        },
      },
      content: content as unknown as PdfDocumentDefinition['content'],
    };
  }

  static async generateIso50001Pdf(args: {
    from: Date;
    to: Date;
    lang: EnergyPdfLang;
    baselineId: number;
  }): Promise<Buffer> {
    const model = await EnergyPdfService.buildReportModel(args);
    const docDefinition = EnergyPdfService.buildDocumentDefinition(model);
    const title = model.copy.header.title;

    return createDeterministicPdfBuffer(docDefinition, {
      title,
      author: 'WPT',
      subject: title,
      creator: 'energyPdfService',
      producer: 'energyPdfService',
      creationDate: args.to,
      modDate: args.to,
    });
  }
}
