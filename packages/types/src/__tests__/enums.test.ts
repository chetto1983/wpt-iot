import { describe, expect, it } from 'vitest';
import { CycleType, MachinePhase, MachineStatus } from '../enums.js';

describe('PLC enum mappings', () => {
  it('maps S1_I_DATO_60 machine phases 0..4', () => {
    expect(MachinePhase).toMatchObject({
      NO_SELECTION: 0,
      STANDBY: 1,
      MANUAL: 2,
      AUTOMATIC_STARTED: 3,
      IN_ALARM: 4,
    });
    expect(MachinePhase[4]).toBe('IN_ALARM');
  });

  it('maps S1_I_DATO_61 machine statuses 0..8', () => {
    expect(MachineStatus).toMatchObject({
      LOADING: 0,
      SHREDDING: 1,
      HEATING: 2,
      EVAPORATION: 3,
      OVERHEATING: 4,
      HOLDING: 5,
      COOLING: 6,
      FINAL_DRYING: 7,
      DISCHARGE: 8,
    });
    expect(MachineStatus[1]).toBe('SHREDDING');
  });

  it('maps cycle 6/11 to MILK according to the field specification', () => {
    expect(CycleType.MILK).toBe(6);
    expect(CycleType.MILK_END).toBe(11);
    expect(CycleType[6]).toBe('MILK');
  });
});
