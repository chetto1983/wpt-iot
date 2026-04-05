/**
 * Field-name-to-translated-label map for chart legends.
 * Mirrors apps/backend/src/i18n/fieldLabels.ts (subset: numeric fields only).
 */

const itLabels: Record<string, string> = {
  garbageTemp: 'Temperatura rifiuti',
  chamberPressure: 'Pressione camera',
  mainMotorSpeed: 'Velocita motore',
  mainMotorCurrent: 'Corrente motore',
  mainMotorTorque: 'Coppia motore',
  vacuumPumpSpeed01: 'Velocita pompa vuoto 1',
  vacuumPumpSpeed02: 'Velocita pompa vuoto 2',
  materialInputWeight: 'Peso ingresso',
  materialOutputWeight: 'Peso uscita',
  completedCycles: 'Cicli completati',
  energyConsumption: 'Consumo energia',
  waterConsumption: 'Consumo acqua',
  thermoLeftLower: 'Termo sinistra basso',
  thermoLeftMedium: 'Termo sinistra medio',
  thermoLeftUpper: 'Termo sinistra alto',
  thermoRightLower: 'Termo destra basso',
  thermoRightMedium: 'Termo destra medio',
  thermoRightUpper: 'Termo destra alto',
  thermoLeftHighLower: 'Termo sinistra HH basso',
  thermoLeftHighMedium: 'Termo sinistra HH medio',
  thermoLeftHighUpper: 'Termo sinistra HH alto',
  thermoRightHighLower: 'Termo destra HH basso',
  holdingTempSetpoint: 'Setpoint temperatura',
  rmsCurrL1: 'Corrente RMS L1',
  rmsCurrL2: 'Corrente RMS L2',
  rmsCurrL3: 'Corrente RMS L3',
  rmsCurrN: 'Corrente RMS N',
  spareReal01: 'Reale riserva 1',
  thermoLeftLowSel: 'Sel. termo SX basso',
  thermoLeftMedSel: 'Sel. termo SX medio',
  thermoLeftHighSel: 'Sel. termo SX alto',
  thermoRightLowSel: 'Sel. termo DX basso',
  thermoRightMedSel: 'Sel. termo DX medio',
  thermoRightHighSel: 'Sel. termo DX alto',
};

const enLabels: Record<string, string> = {
  garbageTemp: 'Garbage Temperature',
  chamberPressure: 'Chamber Pressure',
  mainMotorSpeed: 'Main Motor Speed',
  mainMotorCurrent: 'Main Motor Current',
  mainMotorTorque: 'Main Motor Torque',
  vacuumPumpSpeed01: 'Vacuum Pump Speed 1',
  vacuumPumpSpeed02: 'Vacuum Pump Speed 2',
  materialInputWeight: 'Material Input Weight',
  materialOutputWeight: 'Material Output Weight',
  completedCycles: 'Completed Cycles',
  energyConsumption: 'Energy Consumption',
  waterConsumption: 'Water Consumption',
  thermoLeftLower: 'Thermo Left Lower',
  thermoLeftMedium: 'Thermo Left Medium',
  thermoLeftUpper: 'Thermo Left Upper',
  thermoRightLower: 'Thermo Right Lower',
  thermoRightMedium: 'Thermo Right Medium',
  thermoRightUpper: 'Thermo Right Upper',
  thermoLeftHighLower: 'Thermo Left High Lower',
  thermoLeftHighMedium: 'Thermo Left High Medium',
  thermoLeftHighUpper: 'Thermo Left High Upper',
  thermoRightHighLower: 'Thermo Right High Lower',
  holdingTempSetpoint: 'Holding Temp Setpoint',
  rmsCurrL1: 'RMS Current L1',
  rmsCurrL2: 'RMS Current L2',
  rmsCurrL3: 'RMS Current L3',
  rmsCurrN: 'RMS Current N',
  spareReal01: 'Spare Real 1',
  thermoLeftLowSel: 'Thermo Left Low Sel',
  thermoLeftMedSel: 'Thermo Left Med Sel',
  thermoLeftHighSel: 'Thermo Left High Sel',
  thermoRightLowSel: 'Thermo Right Low Sel',
  thermoRightMedSel: 'Thermo Right Med Sel',
  thermoRightHighSel: 'Thermo Right High Sel',
};

/**
 * Get translated label for a machine field.
 * Returns the raw field name if no translation exists.
 */
export function getFieldLabel(field: string, locale: 'it' | 'en'): string {
  const map = locale === 'it' ? itLabels : enLabels;
  return map[field] ?? field;
}
