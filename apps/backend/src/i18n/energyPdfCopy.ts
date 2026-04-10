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
  noBaselineLabel: string;
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
  notAvailableValue: string;
}

interface IEnergyPdfEnbDeclarationCopy extends IEnergyPdfCopySectionTitle {
  labelLabel: string;
  baselineWindowLabel: string;
  lockedAtLabel: string;
  justificationLabel: string;
  defaultJustification: string;
  unavailableWindow: string;
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
  notAvailableValue: string;
}

interface IEnergyPdfSavingsIndicatorCopy extends IEnergyPdfCopySectionTitle {
  aboveBaseline: string;
  belowBaseline: string;
  atBaseline: string;
  deltaKwhLabel: string;
  deltaEurLabel: string;
  deltaKgCo2Label: string;
  confidenceLabel: string;
  noBaseline: string;
  notAvailableValue: string;
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
      noBaselineLabel: 'Nessuna baseline attiva',
    },
    executiveSummary: {
      title: 'Executive summary',
      totalEnergyLabel: 'Energia totale',
      totalCostLabel: 'Costo totale',
      totalCo2Label: 'CO2 totale',
      totalCyclesLabel: 'Cicli attribuiti',
    },
    enpiTable: {
      title: 'Tabella EnPI',
      metricLabel: 'Indicatore',
      valueLabel: 'Valore',
      baselineEnpiLabel: 'EnPI baseline',
      measurementEnpiLabel: 'EnPI periodo',
      deltaLabel: 'Delta vs baseline',
      notAvailableValue: 'n.d.',
    },
    enbDeclaration: {
      title: 'Dichiarazione EnB',
      labelLabel: 'Baseline',
      baselineWindowLabel: 'Finestra baseline',
      lockedAtLabel: 'Bloccata il',
      justificationLabel: 'Giustificazione',
      defaultJustification: 'Nessuna giustificazione fornita',
      unavailableWindow: 'Nessuna finestra baseline disponibile',
    },
    energyByPeriod: {
      title: 'Energia per periodo',
      dateLabel: 'Data',
      energyLabel: 'Energia',
      costLabel: 'Costo',
      co2Label: 'CO2',
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
      title: 'Costi e CO2',
      totalCostLabel: 'Costo totale del periodo',
      totalCo2Label: 'CO2 totale del periodo',
      deltaCostLabel: 'Delta costo vs baseline',
      deltaCo2Label: 'Delta CO2 vs baseline',
      notAvailableValue: 'n.d.',
    },
    savingsIndicator: {
      title: 'Indicatore di risparmio',
      aboveBaseline: 'Consumo sopra baseline',
      belowBaseline: 'Consumo sotto baseline',
      atBaseline: 'Consumo in linea con la baseline',
      deltaKwhLabel: 'Delta kWh',
      deltaEurLabel: 'Delta EUR',
      deltaKgCo2Label: 'Delta kgCO2',
      confidenceLabel: 'Confidenza',
      noBaseline: 'Nessuna baseline attiva: il report mostra i totali del periodo senza confronto storico.',
      notAvailableValue: 'n.d.',
    },
    footer: {
      title: 'Fonti',
      emissionFactorSourceLabel: 'Fonte fattore emissivo',
      emissionFactorYearLabel: 'Anno fattore emissivo',
      tariffSourceLabel: 'Fonte tariffa',
      configuredTariffValueLabel: 'Configurazione energia WPT',
      singleTariffModeLabel: 'monoraria',
      tou3TariffModeLabel: 'fasce F1/F2/F3',
      note: 'Il costo dell energia e stimato dalla tariffa configurata e la CO2 e calcolata dal fattore emissivo selezionato.',
    },
  },
  en: {
    header: {
      title: 'ISO 50001 energy report',
      subtitle: 'Customer-facing energy summary',
      periodLabel: 'Report period',
      baselineLabel: 'Energy baseline',
      referenceLabel: 'Report reference',
      noBaselineLabel: 'No active baseline',
    },
    executiveSummary: {
      title: 'Executive summary',
      totalEnergyLabel: 'Total energy',
      totalCostLabel: 'Total cost',
      totalCo2Label: 'Total CO2',
      totalCyclesLabel: 'Attributed cycles',
    },
    enpiTable: {
      title: 'EnPI table',
      metricLabel: 'Indicator',
      valueLabel: 'Value',
      baselineEnpiLabel: 'Baseline EnPI',
      measurementEnpiLabel: 'Measurement EnPI',
      deltaLabel: 'Delta vs baseline',
      notAvailableValue: 'n/a',
    },
    enbDeclaration: {
      title: 'EnB declaration',
      labelLabel: 'Baseline',
      baselineWindowLabel: 'Baseline window',
      lockedAtLabel: 'Locked at',
      justificationLabel: 'Justification',
      defaultJustification: 'No justification provided',
      unavailableWindow: 'No baseline window available',
    },
    energyByPeriod: {
      title: 'Energy by period',
      dateLabel: 'Date',
      energyLabel: 'Energy',
      costLabel: 'Cost',
      co2Label: 'CO2',
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
      title: 'Cost and CO2',
      totalCostLabel: 'Total cost in window',
      totalCo2Label: 'Total CO2 in window',
      deltaCostLabel: 'Cost delta vs baseline',
      deltaCo2Label: 'CO2 delta vs baseline',
      notAvailableValue: 'n/a',
    },
    savingsIndicator: {
      title: 'Savings indicator',
      aboveBaseline: 'Energy use above baseline',
      belowBaseline: 'Energy use below baseline',
      atBaseline: 'Energy use aligned with baseline',
      deltaKwhLabel: 'Delta kWh',
      deltaEurLabel: 'Delta EUR',
      deltaKgCo2Label: 'Delta kgCO2',
      confidenceLabel: 'Confidence',
      noBaseline: 'No active baseline: the report includes period totals without historical comparison.',
      notAvailableValue: 'n/a',
    },
    footer: {
      title: 'Sources',
      emissionFactorSourceLabel: 'Emission factor source',
      emissionFactorYearLabel: 'Emission factor year',
      tariffSourceLabel: 'Tariff source',
      configuredTariffValueLabel: 'WPT energy settings',
      singleTariffModeLabel: 'single-rate',
      tou3TariffModeLabel: 'F1/F2/F3 bands',
      note: 'Energy cost is estimated from the configured tariff and CO2 is calculated from the selected emission factor.',
    },
  },
};
