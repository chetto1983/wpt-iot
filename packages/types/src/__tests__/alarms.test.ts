import { describe, expect, it } from 'vitest';
import { getAlarmCode } from '../alarms.js';

describe('getAlarmCode', () => {
  it.each([
    [0, 'A0001'],
    [398, 'A0399'],
    [399, 'W0001'],
    [639, 'W0241'],
  ])('maps PLC alarm index %i to %s', (alarmIndex, expected) => {
    expect(getAlarmCode(alarmIndex)).toBe(expected);
  });
});
