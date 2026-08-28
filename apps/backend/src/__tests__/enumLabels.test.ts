import { describe, expect, it } from 'vitest';
import { formatEnumValue } from '../i18n/enumLabels.js';

describe('backend PLC enum labels', () => {
  it('formats the live dashboard state values in Italian', () => {
    expect(formatEnumValue('currentPhase', 4, 'it')).toBe('In Allarme');
    expect(formatEnumValue('machineStatus', 1, 'it')).toBe('Triturazione');
  });

  it('uses the cycle 6/11 names from the PLC field mapping', () => {
    expect(formatEnumValue('selectedCycle', 6, 'it')).toBe('Latte');
    expect(formatEnumValue('selectedCycle', 11, 'it')).toBe('Fine latte');
    expect(formatEnumValue('selectedCycle', 6, 'en')).toBe('Milk');
  });
});
