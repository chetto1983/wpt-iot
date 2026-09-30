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

  it('maps S1_I_DATO_61 machine statuses 0..9', () => {
    expect(MachineStatus).toMatchObject({
      NONE: 0,
      LOADING: 1,
      SHREDDING: 2,
      HEATING: 3,
      EVAPORATION: 4,
      OVERHEATING: 5,
      HOLDING: 6,
      COOLING: 7,
      FINAL_DRYING: 8,
      DISCHARGE: 9,
    });
    expect(MachineStatus[0]).toBe('NONE');
    expect(MachineStatus[2]).toBe('SHREDDING');
  });

  it('maps cycle 6/11 to MILK according to the field specification', () => {
    expect(CycleType.MILK).toBe(6);
    expect(CycleType.MILK_END).toBe(11);
    expect(CycleType[6]).toBe('MILK');
  });
});
