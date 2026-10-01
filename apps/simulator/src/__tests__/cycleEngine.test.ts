import { beforeEach, describe, expect, it } from 'vitest';
import { MachineStatus } from '@wpt/types';
import { cycleEngine } from '../state/cycleEngine.js';
import { getState, resetState } from '../state/simulatorState.js';

describe('cycleEngine', () => {
  beforeEach(() => {
    resetState();
    cycleEngine.reset();
  });

  // S1_I_DATO_61 codes per the PLC mapping since b3362b6: 0 = blank, 1..9 = stages.
  it('reports every stage with its MachineStatus PLC code, in cycle order', () => {
    const seen: number[] = [];
    for (let tick = 0; tick < 10_000 && cycleEngine.completedCycles === 0; tick++) {
      cycleEngine.tick();
      const status = getState().machine.machineStatus;
      if (seen[seen.length - 1] !== status) seen.push(status);
    }
    expect(seen.slice(0, 9)).toEqual([
      MachineStatus.LOADING, MachineStatus.SHREDDING, MachineStatus.HEATING,
      MachineStatus.EVAPORATION, MachineStatus.OVERHEATING, MachineStatus.HOLDING,
      MachineStatus.COOLING, MachineStatus.FINAL_DRYING, MachineStatus.DISCHARGE,
    ]);
    expect(seen).not.toContain(MachineStatus.NONE);
  });
});
