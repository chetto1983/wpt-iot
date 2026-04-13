/**
 * Per-field unit registry and value formatter.
 *
 * Used by chart tooltips, axis labels, and the pie chart aggregator.
 *
 * Each field declares:
 *   - unit:      display unit string ("°C", "kW", "L", etc.)
 *   - category:  groups fields with comparable semantics for pie aggregation
 *   - aggregate: how the pie chart should reduce a series of values:
 *                  "sum" for additive metrics (consumption counters),
 *                  "avg" for instantaneous readings (temperatures, speeds),
 *                  "last" for state-like values (cycle counter)
 *   - decimals:  display precision
 */

type Aggregate = 'sum' | 'avg' | 'last';

interface FieldUnit {
  unit: string;
  category: string;
  aggregate: Aggregate;
  decimals: number;
}

const UNITS: Record<string, FieldUnit> = {
  // Temperatures (°C) — instantaneous, average makes sense
  garbageTemp:           { unit: '°C', category: 'temperature', aggregate: 'avg', decimals: 1 },
  thermoLeftLower:       { unit: '°C', category: 'temperature', aggregate: 'avg', decimals: 1 },
  thermoLeftMedium:      { unit: '°C', category: 'temperature', aggregate: 'avg', decimals: 1 },
  thermoLeftUpper:       { unit: '°C', category: 'temperature', aggregate: 'avg', decimals: 1 },
  thermoRightLower:      { unit: '°C', category: 'temperature', aggregate: 'avg', decimals: 1 },
  thermoRightMedium:     { unit: '°C', category: 'temperature', aggregate: 'avg', decimals: 1 },
  thermoRightUpper:      { unit: '°C', category: 'temperature', aggregate: 'avg', decimals: 1 },
  thermoLeftHighLower:   { unit: '°C', category: 'temperature', aggregate: 'avg', decimals: 1 },
  thermoLeftHighMedium:  { unit: '°C', category: 'temperature', aggregate: 'avg', decimals: 1 },
  thermoLeftHighUpper:   { unit: '°C', category: 'temperature', aggregate: 'avg', decimals: 1 },
  thermoRightHighLower:  { unit: '°C', category: 'temperature', aggregate: 'avg', decimals: 1 },
  holdingTempSetpoint:   { unit: '°C', category: 'temperature', aggregate: 'avg', decimals: 1 },

  // Pressure
  chamberPressure:       { unit: 'bar', category: 'pressure', aggregate: 'avg', decimals: 2 },

  // Motors / pumps — RPM and torque
  mainMotorSpeed:        { unit: 'rpm', category: 'speed', aggregate: 'avg', decimals: 0 },
  mainMotorCurrent:      { unit: 'A',   category: 'current', aggregate: 'avg', decimals: 1 },
  mainMotorTorque:       { unit: 'Nm',  category: 'torque', aggregate: 'avg', decimals: 1 },
  vacuumPumpSpeed01:     { unit: 'rpm', category: 'speed', aggregate: 'avg', decimals: 0 },
  vacuumPumpSpeed02:     { unit: 'rpm', category: 'speed', aggregate: 'avg', decimals: 0 },

  // Electrical RMS currents
  rmsCurrL1:             { unit: 'A',   category: 'current', aggregate: 'avg', decimals: 1 },
  rmsCurrL2:             { unit: 'A',   category: 'current', aggregate: 'avg', decimals: 1 },
  rmsCurrL3:             { unit: 'A',   category: 'current', aggregate: 'avg', decimals: 1 },
  rmsCurrN:              { unit: 'A',   category: 'current', aggregate: 'avg', decimals: 1 },

  // V03 — Three-phase line voltages (line-to-line + line-to-neutral) and power factor
  lineVoltL1L2:          { unit: 'V',   category: 'voltage', aggregate: 'avg', decimals: 1 },
  lineVoltL2L3:          { unit: 'V',   category: 'voltage', aggregate: 'avg', decimals: 1 },
  lineVoltL3L1:          { unit: 'V',   category: 'voltage', aggregate: 'avg', decimals: 1 },
  lineNeutralVoltL1:     { unit: 'V',   category: 'voltage', aggregate: 'avg', decimals: 1 },
  lineNeutralVoltL2:     { unit: 'V',   category: 'voltage', aggregate: 'avg', decimals: 1 },
  lineNeutralVoltL3:     { unit: 'V',   category: 'voltage', aggregate: 'avg', decimals: 1 },
  pfTotal:               { unit: '',    category: 'power',   aggregate: 'avg', decimals: 3 },

  // V03 — Cycle status verdict + container slot (state-like, not chartable as numeric)
  cycleStatus:           { unit: '',    category: 'state',   aggregate: 'last', decimals: 0 },
  container:             { unit: '',    category: 'state',   aggregate: 'last', decimals: 0 },

  // Weights / consumption — counters/totals, sum makes sense for pie
  materialInputWeight:   { unit: 'kg',  category: 'weight', aggregate: 'last', decimals: 1 },
  materialOutputWeight:  { unit: 'kg',  category: 'weight', aggregate: 'last', decimals: 1 },
  energyConsumption:     { unit: 'kWh', category: 'energy', aggregate: 'last', decimals: 2 },
  waterConsumption:      { unit: 'L',   category: 'water',  aggregate: 'last', decimals: 1 },
  spareReal01:           { unit: '',    category: 'misc',   aggregate: 'avg',  decimals: 2 },
  spareReal02:           { unit: '',    category: 'misc',   aggregate: 'avg',  decimals: 2 },

  // Counters
  completedCycles:       { unit: '',    category: 'count',  aggregate: 'last', decimals: 0 },
};

const FALLBACK: FieldUnit = { unit: '', category: 'misc', aggregate: 'avg', decimals: 2 };

export function getFieldUnit(field: string): FieldUnit {
  return UNITS[field] ?? FALLBACK;
}

/**
 * Format a number for display with unit suffix.
 * Examples: formatValue(23.456, 'garbageTemp') → "23.5 °C"
 *           formatValue(1500, 'mainMotorSpeed') → "1500 rpm"
 */
export function formatValue(value: number, field: string): string {
  if (!Number.isFinite(value)) return '—';
  const u = getFieldUnit(field);
  const fixed = value.toFixed(u.decimals);
  // Strip trailing zeros after the decimal point but keep at least 0 dp
  const num = u.decimals > 0 ? Number(fixed).toString() : fixed;
  return u.unit ? `${num} ${u.unit}` : num;
}

/**
 * Reduce a series of (timestamp, value) points to a single number per the
 * field's aggregation rule. Used by the pie chart.
 */
export function aggregateField(
  field: string,
  data: Array<Record<string, number | string>>,
): number {
  const u = getFieldUnit(field);
  const values: number[] = [];
  for (const row of data) {
    const v = row[field];
    if (typeof v === 'number' && Number.isFinite(v)) values.push(v);
  }
  if (values.length === 0) return 0;
  switch (u.aggregate) {
    case 'sum':
      return values.reduce((a, b) => a + b, 0);
    case 'last':
      // For monotonic counters (energy, water, weight), the difference between
      // first and last is the total consumed during the window.
      return Math.max(0, values[values.length - 1]! - values[0]!);
    case 'avg':
    default:
      return values.reduce((a, b) => a + b, 0) / values.length;
  }
}

/**
 * Returns true when all fields share a unit (so a pie chart is meaningful).
 * Returns false when fields mix units (e.g. °C + kWh) — the UI should warn
 * the user instead of rendering a misleading pie.
 */
export function fieldsShareUnit(fields: string[]): boolean {
  if (fields.length === 0) return true;
  const first = getFieldUnit(fields[0]!).unit;
  return fields.every((f) => getFieldUnit(f).unit === first);
}
