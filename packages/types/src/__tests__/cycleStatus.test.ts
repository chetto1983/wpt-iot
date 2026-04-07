import { describe, it, expect } from 'vitest';
import {
  decodeCycleStatus,
  CycleStatusVerdict,
  CYCLE_STATUS_LABELS,
} from '../cycleStatus.js';

describe('decodeCycleStatus', () => {
  it('decodes 0 as NOTHING with label "nothing"', () => {
    const result = decodeCycleStatus(0);
    expect(result.verdict).toBe(CycleStatusVerdict.NOTHING);
    expect(result.label).toBe('nothing');
    expect(result.raw).toBe(0);
  });

  it('decodes 1 as CYCLE_START with label "Cycle_START"', () => {
    const result = decodeCycleStatus(1);
    expect(result.verdict).toBe(CycleStatusVerdict.CYCLE_START);
    expect(result.label).toBe('Cycle_START');
    expect(result.raw).toBe(1);
  });

  it('decodes 2 as COMPLETED with label "COMPLETED"', () => {
    const result = decodeCycleStatus(2);
    expect(result.verdict).toBe(CycleStatusVerdict.COMPLETED);
    expect(result.label).toBe('COMPLETED');
    expect(result.raw).toBe(2);
  });

  it('decodes 3 as FAILED with label "FAILED"', () => {
    const result = decodeCycleStatus(3);
    expect(result.verdict).toBe(CycleStatusVerdict.FAILED);
    expect(result.label).toBe('FAILED');
    expect(result.raw).toBe(3);
  });

  it('decodes 4 as ABORTED with label "ABORTED"', () => {
    const result = decodeCycleStatus(4);
    expect(result.verdict).toBe(CycleStatusVerdict.ABORTED);
    expect(result.label).toBe('ABORTED');
    expect(result.raw).toBe(4);
  });

  it('decodes 5 and 6 as RESERVED with bare-int label "reserved(N)"', () => {
    const r5 = decodeCycleStatus(5);
    expect(r5.verdict).toBe(CycleStatusVerdict.RESERVED);
    expect(r5.label).toBe('reserved(5)');
    expect(r5.raw).toBe(5);

    const r6 = decodeCycleStatus(6);
    expect(r6.verdict).toBe(CycleStatusVerdict.RESERVED);
    expect(r6.label).toBe('reserved(6)');
    expect(r6.raw).toBe(6);
  });

  it('throws on negative values (wire-level corruption signal)', () => {
    expect(() => decodeCycleStatus(-1)).toThrow(/invalid value/);
  });

  it('exposes CYCLE_STATUS_LABELS lookup map for dashboard rendering', () => {
    expect(CYCLE_STATUS_LABELS[0]).toBe('nothing');
    expect(CYCLE_STATUS_LABELS[3]).toBe('FAILED');
  });
});
