import {
  OnlineAnomalyDetector,
  type IAnomalyInput,
  type IAnomalyResult,
  type IDetectorConfig,
} from './onlineAnomalyDetector.js';

type AnomalyScenarioName =
  | 'temperature_spike'
  | 'pressure_runaway'
  | 'energy_drift'
  | 'voltage_sag'
  | 'pump_failure'
  | 'water_leak'
  | 'thermal_gradient';

interface IScenarioRunOptions {
  scenario: AnomalyScenarioName;
  warmupSamples?: number;
  scenarioSamples?: number;
  /** Optional detector overrides — matches replay API for parity. */
  detectorConfig?: Partial<IDetectorConfig>;
}

interface IScenarioPoint extends IAnomalyResult {
  index: number;
  phase: 'warmup' | 'scenario';
}

interface IScenarioRunResult {
  scenario: AnomalyScenarioName;
  warmupSamples: number;
  scenarioSamples: number;
  summary: {
    maxScore: number;
    anomalyFlags: number;
    firstFlaggedIndex: number | null;
  };
  timeline: IScenarioPoint[];
}

const BASELINE_SAMPLE: IAnomalyInput = {
  selectedCycle: 2, currentPhase: 3, machineStatus: 1,
  garbageTemp: 180, chamberPressure: -0.8,
  mainMotorSpeed: 1200, mainMotorCurrent: 45, mainMotorTorque: 12.5,
  vacuumPumpSpeed01: 800, energyConsumption: 50,
  rmsCurrL1: 15, rmsCurrL2: 15, rmsCurrL3: 15,
  materialInputWeight: 250, materialOutputWeight: 120,
  vacuumPumpSpeed02: 780, rmsCurrN: 0.5,
  thermoLeftLower: 160, thermoLeftMedium: 170, thermoLeftUpper: 175,
  thermoRightLower: 158, thermoRightMedium: 168, thermoRightUpper: 173,
  holdingTempSetpoint: 180, waterConsumption: 12,
  lineVoltL1L2: 400, lineVoltL2L3: 400, lineVoltL3L1: 400,
  lineNeutralVoltL1: 230, lineNeutralVoltL2: 230, lineNeutralVoltL3: 230,
  pfTotal: 0.92,
  thermoLeftHighLower: 200, thermoLeftHighMedium: 210,
  thermoLeftHighUpper: 215, thermoRightHighLower: 198,
};

function makeWarmupSample(index: number): IAnomalyInput {
  return {
    ...BASELINE_SAMPLE,
    garbageTemp: 180 + (index % 3) * 0.25,
    chamberPressure: -0.8 + (index % 2) * 0.01,
    mainMotorSpeed: 1200 + (index % 4) * 4,
    mainMotorCurrent: 45 + (index % 3) * 0.15,
    energyConsumption: 50 + (index % 4) * 0.1,
    rmsCurrL1: 15 + (index % 3) * 0.05,
    rmsCurrL2: 15 + (index % 2) * 0.05,
    rmsCurrL3: 15 + (index % 4) * 0.04,
  };
}

function makeScenarioSample(
  scenario: AnomalyScenarioName,
  index: number,
): IAnomalyInput {
  switch (scenario) {
    case 'temperature_spike':
      return {
        ...makeWarmupSample(index),
        garbageTemp: 220 + index * 3,
        mainMotorCurrent: 58 + index * 1.2,
        mainMotorTorque: 19 + index * 0.7,
      };
    case 'pressure_runaway':
      return {
        ...makeWarmupSample(index),
        chamberPressure: 1.2 + index * 0.5,
        mainMotorCurrent: 55 + index * 0.8,
        vacuumPumpSpeed01: 950 + index * 20,
      };
    case 'energy_drift':
      return {
        ...makeWarmupSample(index),
        energyConsumption: 56 + index * 1.1,
        rmsCurrL1: 17 + index * 0.2,
        rmsCurrL2: 17 + index * 0.22,
        rmsCurrL3: 17 + index * 0.21,
        materialOutputWeight: 120,
      };
    case 'voltage_sag':
      return {
        ...makeWarmupSample(index),
        lineVoltL1L2: 400 - index * 8,
        lineVoltL2L3: 400 - index * 9,
        lineVoltL3L1: 400 - index * 7,
        lineNeutralVoltL1: 230 - index * 5,
        lineNeutralVoltL2: 230 - index * 6,
        lineNeutralVoltL3: 230 - index * 4,
        pfTotal: 0.92 - index * 0.05,
      };
    case 'pump_failure':
      return {
        ...makeWarmupSample(index),
        vacuumPumpSpeed01: Math.max(0, 800 - index * 100),
        vacuumPumpSpeed02: Math.max(0, 780 - index * 90),
        chamberPressure: -0.8 + index * 0.2,
        mainMotorCurrent: 45 + index * 3,
      };
    case 'water_leak':
      return {
        ...makeWarmupSample(index),
        waterConsumption: 12 + index * 10,
        chamberPressure: -0.8 + index * 0.05,
      };
    case 'thermal_gradient':
      return {
        ...makeWarmupSample(index),
        thermoLeftLower: 160 + index * 15,
        thermoLeftMedium: 170 + index * 12,
        thermoLeftUpper: 175 + index * 10,
        thermoRightLower: 158 - index * 5,
        thermoRightMedium: 168 - index * 4,
        thermoRightUpper: 173 - index * 3,
      };
  }
}

export class MachineAnomalyScenarioService {
  static run(options: IScenarioRunOptions): IScenarioRunResult {
    const warmupSamples = options.warmupSamples ?? 30;
    const scenarioSamples = options.scenarioSamples ?? 8;
    const detector = new OnlineAnomalyDetector(options.detectorConfig ?? {});
    const timeline: IScenarioPoint[] = [];

    for (let i = 0; i < warmupSamples; i += 1) {
      const result = detector.observe(makeWarmupSample(i));
      timeline.push({ ...result, index: i, phase: 'warmup' });
    }

    for (let i = 0; i < scenarioSamples; i += 1) {
      const index = warmupSamples + i;
      const result = detector.observe(makeScenarioSample(options.scenario, i));
      timeline.push({ ...result, index, phase: 'scenario' });
    }

    const scenarioTimeline = timeline.filter((point) => point.phase === 'scenario');
    const firstFlagged = scenarioTimeline.find((point) => point.flagged);

    return {
      scenario: options.scenario,
      warmupSamples,
      scenarioSamples,
      summary: {
        maxScore: Math.max(...timeline.map((point) => point.score), 0),
        anomalyFlags: scenarioTimeline.filter((point) => point.flagged).length,
        firstFlaggedIndex: firstFlagged?.index ?? null,
      },
      timeline,
    };
  }
}
