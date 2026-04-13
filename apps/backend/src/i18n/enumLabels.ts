/**
 * Backend-side enum-to-text mapping for CSV/PDF exports.
 * Maps numeric enum values to human-readable locale strings
 * for selectedCycle, currentPhase, and machineStatus fields.
 */

const ENUM_FIELDS: Record<string, Record<string, Record<number, string>>> = {
  selectedCycle: {
    en: {
      0: 'No Cycle',
      1: 'Discharge Only',
      2: 'Load Only',
      3: 'Dry Mixed',
      4: 'Organic',
      5: 'Paper/Cardboard',
      6: 'Cans',
      7: 'Hospital',
      8: 'Glass',
      9: 'Plastic',
      10: 'Paper/Cardboard End',
      11: 'Cans End',
      12: 'Plastic End',
    },
    it: {
      0: 'Nessun ciclo',
      1: 'Solo scarico',
      2: 'Solo carico',
      3: 'Secco misto',
      4: 'Organico',
      5: 'Carta/Cartone',
      6: 'Lattine',
      7: 'Ospedaliero',
      8: 'Vetro',
      9: 'Plastica',
      10: 'Fine carta/cartone',
      11: 'Fine lattine',
      12: 'Fine plastica',
    },
  },
  currentPhase: {
    en: {
      0: 'No Selection',
      1: 'Standby',
      2: 'Manual',
      3: 'Auto Started',
      4: 'In Alarm',
    },
    it: {
      0: 'Nessuna Selezione',
      1: 'Standby',
      2: 'Manuale',
      3: 'Automatico Avviato',
      4: 'In Allarme',
    },
  },
  machineStatus: {
    en: {
      0: 'Loading',
      1: 'Shredding',
      2: 'Heating',
      3: 'Evaporation',
      4: 'Overheating',
      5: 'Holding',
      6: 'Cooling',
      7: 'Final Drying',
      8: 'Discharge',
    },
    it: {
      0: 'Caricamento',
      1: 'Triturazione',
      2: 'Riscaldamento',
      3: 'Evaporazione',
      4: 'Surriscaldamento',
      5: 'Mantenimento',
      6: 'Raffreddamento',
      7: 'Essiccazione Finale',
      8: 'Scarico',
    },
  },
};

/**
 * Format a value for an enum field to its human-readable label.
 * Falls through to String(value) for non-enum fields or unknown values.
 */
export function formatEnumValue(
  field: string,
  value: unknown,
  locale: 'it' | 'en',
): string {
  const fieldMap = ENUM_FIELDS[field];
  if (!fieldMap) return String(value);

  const localeMap = fieldMap[locale];
  if (!localeMap) return String(value);

  const numVal = Number(value);
  if (isNaN(numVal)) return String(value);

  return localeMap[numVal] ?? String(value);
}
