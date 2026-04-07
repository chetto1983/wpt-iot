/**
 * S1_I_DATO_71 Cycle_Status decoder (V03, PROT-V03-08).
 *
 * Resolved 2026-04-07 (ROADMAP Phase 19.1 "Q9 RESOLVED"):
 * - 0 = nothing (no cycle activity, no register row)
 * - 1 = Cycle_START (lifecycle marker, rising edge 0->1 triggers START)
 * - 2 = COMPLETED (cycle-end verdict)
 * - 3 = FAILED (cycle-end verdict, alarm-stopped)
 * - 4 = ABORTED (cycle-end verdict, manual stop)
 * - 5+ = reserved (export as bare int with 'reserved(N)' label; emit WARN log in parser)
 *
 * This module ONLY decodes the integer. It does NOT implement the rising-edge
 * state machine that emits register rows — that lives in v1.2 per PROT-V03-08.
 * Phase 19.1 stops at "parse the byte, store the column, surface the label."
 */

export enum CycleStatusVerdict {
  NOTHING = 'nothing',
  CYCLE_START = 'Cycle_START',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  ABORTED = 'ABORTED',
  RESERVED = 'reserved',
}

/** Pre-built label lookup for known values 0..4. Used by dashboard rendering. */
export const CYCLE_STATUS_LABELS: Record<number, string> = {
  0: 'nothing',
  1: 'Cycle_START',
  2: 'COMPLETED',
  3: 'FAILED',
  4: 'ABORTED',
};

/**
 * Decode a cycle_status integer value from the PLC into a verdict + label.
 * Returns { verdict, label, raw }. For values >= 5, returns
 * { verdict: RESERVED, label: `reserved(${value})`, raw: value }.
 *
 * Throws if value < 0 — the PLC INT field is unsigned-in-practice and a negative
 * would indicate a wire-level corruption the parser should catch upstream.
 */
export function decodeCycleStatus(value: number): {
  verdict: CycleStatusVerdict;
  label: string;
  raw: number;
} {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`decodeCycleStatus: invalid value ${value} (expected non-negative integer)`);
  }
  if (value === 0) return { verdict: CycleStatusVerdict.NOTHING, label: 'nothing', raw: 0 };
  if (value === 1) return { verdict: CycleStatusVerdict.CYCLE_START, label: 'Cycle_START', raw: 1 };
  if (value === 2) return { verdict: CycleStatusVerdict.COMPLETED, label: 'COMPLETED', raw: 2 };
  if (value === 3) return { verdict: CycleStatusVerdict.FAILED, label: 'FAILED', raw: 3 };
  if (value === 4) return { verdict: CycleStatusVerdict.ABORTED, label: 'ABORTED', raw: 4 };
  return { verdict: CycleStatusVerdict.RESERVED, label: `reserved(${value})`, raw: value };
}
