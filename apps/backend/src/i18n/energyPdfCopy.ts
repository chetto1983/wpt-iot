export type EnergyPdfLang = 'it' | 'en';

export const ENERGY_PDF_SECTION_ORDER = [
  'header',
  'executiveSummary',
  'enpiTable',
  'enbDeclaration',
  'energyByPeriod',
  'perCycleEfficiency',
  'costAndCo2',
  'savingsIndicator',
  'footer',
] as const;

export type EnergyPdfSectionKey = (typeof ENERGY_PDF_SECTION_ORDER)[number];

interface IEnergyPdfCopySectionTitle {
  title: string;
}

interface IEnergyPdfHeaderCopy extends IEnergyPdfCopySectionTitle {
  subtitle: string;
  periodLabel: string;
  baselineLabel: string;
  referenceLabel: string;
}

interface IEnergyPdfExecutiveSummaryCopy extends IEnergyPdfCopySectionTitle {
  totalEnergyLabel: string;
  totalCostLabel: string;
  totalCo2Label: string;
  totalCyclesLabel: string;
}

interface IEnergyPdfEnpiTableCopy extends IEnergyPdfCopySectionTitle {
  metricLabel: string;
  valueLabel: string;
  baselineEnpiLabel: string;
  measurementEnpiLabel: string;
  deltaLabel: string;
}

interface IEnergyPdfEnbDeclarationCopy extends IEnergyPdfCopySectionTitle {
  labelLabel: string;
  baselineWindowLabel: string;
  lockedAtLabel: string;
  justificationLabel: string;
  defaultJustification: string;
}

interface IEnergyPdfEnergyByPeriodCopy extends IEnergyPdfCopySectionTitle {
  dateLabel: string;
  energyLabel: string;
  costLabel: string;
  co2Label: string;
}

interface IEnergyPdfPerCycleEfficiencyCopy extends IEnergyPdfCopySectionTitle {
  cycleLabel: string;
  cycleCountLabel: string;
  energyLabel: string;
  outputKgLabel: string;
  efficiencyLabel: string;
  emptyLabel: string;
  notAvailableLabel: string;
}

interface IEnergyPdfCostAndCo2Copy extends IEnergyPdfCopySectionTitle {
  totalCostLabel: string;
  totalCo2Label: string;
  deltaCostLabel: string;
  deltaCo2Label: string;
}

interface IEnergyPdfSavingsIndicatorCopy extends IEnergyPdfCopySectionTitle {
  aboveBaseline: string;
  belowBaseline: string;
  atBaseline: string;
  deltaKwhLabel: string;
  deltaEurLabel: string;
  deltaKgCo2Label: string;
  confidenceLabel: string;
}

interface IEnergyPdfFooterCopy extends IEnergyPdfCopySectionTitle {
  emissionFactorSourceLabel: string;
  emissionFactorYearLabel: string;
  tariffSourceLabel: string;
  configuredTariffValueLabel: string;
  singleTariffModeLabel: string;
  tou3TariffModeLabel: string;
  note: string;
}

export interface IEnergyPdfCopyBranch {
  header: IEnergyPdfHeaderCopy;
  executiveSummary: IEnergyPdfExecutiveSummaryCopy;
  enpiTable: IEnergyPdfEnpiTableCopy;
  enbDeclaration: IEnergyPdfEnbDeclarationCopy;
  energyByPeriod: IEnergyPdfEnergyByPeriodCopy;
  perCycleEfficiency: IEnergyPdfPerCycleEfficiencyCopy;
  costAndCo2: IEnergyPdfCostAndCo2Copy;
  savingsIndicator: IEnergyPdfSavingsIndicatorCopy;
  footer: IEnergyPdfFooterCopy;
}

export const ENERGY_PDF_COPY: Record<EnergyPdfLang, IEnergyPdfCopyBranch> = {
  it: {
    header: {
      title: 'Rapporto energetico ISO 50001',
      subtitle: 'Sintesi energetica cliente',
      periodLabel: 'Periodo report',
      baselineLabel: 'Baseline energetica',
      referenceLabel: 'Riferimento report',
    },
    executiveSummary: {
      title: 'Executive summary',
      totalEnergyLabel: 'Energia totale',
      totalCostLabel: 'Costo totale',
      totalCo2Label: 'CO₂ totale',
      totalCyclesLabel: 'Cicli attribuiti',
    },
    enpiTable: {
      title: 'Tabella EnPI',
      metricLabel: 'Indicatore',
      valueLabel: 'Valore',
      baselineEnpiLabel: 'EnPI baseline',
      measurementEnpiLabel: 'EnPI periodo',
      deltaLabel: 'Delta vs baseline',
    },
    enbDeclaration: {
      title: 'Dichiarazione EnB',
      labelLabel: 'Baseline',
      baselineWindowLabel: 'Finestra baseline',
      lockedAtLabel: 'Bloccata il',
      justificationLabel: 'Giustificazione',
      defaultJustification: 'Nessuna giustificazione fornita',
    },
    energyByPeriod: {
      title: 'Energia per periodo',
      dateLabel: 'Data',
      energyLabel: 'Energia',
      costLabel: 'Costo',
      co2Label: 'CO₂',
    },
    perCycleEfficiency: {
      title: 'Efficienza per ciclo',
      cycleLabel: 'Ciclo',
      cycleCountLabel: 'Numero cicli',
      energyLabel: 'Energia',
      outputKgLabel: 'Output',
      efficiencyLabel: 'kWh/kg',
      emptyLabel: 'Nessun ciclo attribuito nel periodo selezionato',
      notAvailableLabel: 'n.d.',
    },
    costAndCo2: {
      title: 'Costi e CO₂',
      totalCostLabel: 'Costo totale del periodo',
      totalCo2Label: 'CO₂ totale del periodo',
      deltaCostLabel: 'Delta costo vs baseline',
      deltaCo2Label: 'Delta CO₂ vs baseline',
    },
    savingsIndicator: {
      title: 'Indicatore di risparmio',
      aboveBaseline: 'Consumo sopra baseline',
      belowBaseline: 'Consumo sotto baseline',
      atBaseline: 'Consumo in linea con la baseline',
      deltaKwhLabel: 'Delta kWh',
      deltaEurLabel: 'Delta EUR',
      deltaKgCo2Label: 'Delta kgCO₂',
      confidenceLabel: 'Confidenza',
    },
    footer: {
      title: 'Fonti',
      emissionFactorSourceLabel: 'Fonte fattore emissivo',
      emissionFactorYearLabel: 'Anno fattore emissivo',
      tariffSourceLabel: 'Fonte tariffa',
      configuredTariffValueLabel: 'Configurazione energia WPT',
      singleTariffModeLabel: 'monoraria',
      tou3TariffModeLabel: 'fasce F1/F2/F3',
      note: 'Il costo dell’energia è stimato dalla tariffa configurata e la CO₂ è calcolata dal fattore emissivo selezionato.',
    },
  },
  en: {
    header: {
      title: 'ISO 50001 energy report',
      subtitle: 'Customer-facing energy summary',
      periodLabel: 'Report period',
      baselineLabel: 'Energy baseline',
      referenceLabel: 'Report reference',
    },
    executiveSummary: {
      title: 'Executive summary',
      totalEnergyLabel: 'Total energy',
      totalCostLabel: 'Total cost',
      totalCo2Label: 'Total CO₂',
      totalCyclesLabel: 'Attributed cycles',
    },
    enpiTable: {
      title: 'EnPI table',
      metricLabel: 'Indicator',
      valueLabel: 'Value',
      baselineEnpiLabel: 'Baseline EnPI',
      measurementEnpiLabel: 'Measurement EnPI',
      deltaLabel: 'Delta vs baseline',
    },
    enbDeclaration: {
      title: 'EnB declaration',
      labelLabel: 'Baseline',
      baselineWindowLabel: 'Baseline window',
      lockedAtLabel: 'Locked at',
      justificationLabel: 'Justification',
      defaultJustification: 'No justification provided',
    },
    energyByPeriod: {
      title: 'Energy by period',
      dateLabel: 'Date',
      energyLabel: 'Energy',
      costLabel: 'Cost',
      co2Label: 'CO₂',
    },
    perCycleEfficiency: {
      title: 'Per-cycle efficiency',
      cycleLabel: 'Cycle',
      cycleCountLabel: 'Cycle count',
      energyLabel: 'Energy',
      outputKgLabel: 'Output',
      efficiencyLabel: 'kWh/kg',
      emptyLabel: 'No attributed cycles in the selected window',
      notAvailableLabel: 'n/a',
    },
    costAndCo2: {
      title: 'Cost and CO₂',
      totalCostLabel: 'Total cost in window',
      totalCo2Label: 'Total CO₂ in window',
      deltaCostLabel: 'Cost delta vs baseline',
      deltaCo2Label: 'CO₂ delta vs baseline',
    },
    savingsIndicator: {
      title: 'Savings indicator',
      aboveBaseline: 'Energy use above baseline',
      belowBaseline: 'Energy use below baseline',
      atBaseline: 'Energy use aligned with baseline',
      deltaKwhLabel: 'Delta kWh',
      deltaEurLabel: 'Delta EUR',
      deltaKgCo2Label: 'Delta kgCO₂',
      confidenceLabel: 'Confidence',
    },
    footer: {
      title: 'Sources',
      emissionFactorSourceLabel: 'Emission factor source',
      emissionFactorYearLabel: 'Emission factor year',
      tariffSourceLabel: 'Tariff source',
      configuredTariffValueLabel: 'WPT energy settings',
      singleTariffModeLabel: 'single-rate',
      tou3TariffModeLabel: 'F1/F2/F3 bands',
      note: 'Energy cost is estimated from the configured tariff and CO₂ is calculated from the selected emission factor; the tariff source is the active WPT energy setting.',
    },
  },
};
