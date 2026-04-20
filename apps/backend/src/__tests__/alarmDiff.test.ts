import { describe, it, expect, beforeEach } from 'vitest';
import { latestState } from '../cache/latestState.js';

/**
 * Tests for the alarm XOR diff algorithm and in-memory state cache.
 * Validates D-01 (XOR diff reduces 86,400 raw packets/day to transitions only)
 * and D-03 (first packet = baseline, no events generated).
 */
describe('latestState.detectAlarmTransitions', () => {
  beforeEach(() => {
    latestState.reset();
  });

  it('returns empty array on first call (D-03 baseline)', () => {
    const words = new Array<number>(40).fill(0);
    words[0] = 0x0005; // bits 0 and 2 set
    const transitions = latestState.detectAlarmTransitions(words);
    expect(transitions).toEqual([]);
  });

  it('returns empty array when words are unchanged', () => {
    const words = new Array<number>(40).fill(0);
    words[0] = 0x0005;
    // First call sets baseline
    latestState.detectAlarmTransitions(words);
    // Second call with same words
    const transitions = latestState.detectAlarmTransitions(words);
    expect(transitions).toEqual([]);
  });

  it('detects 2 activated transitions when word[0] changes from 0 to 0x0005', () => {
    const baseline = new Array<number>(40).fill(0);
    latestState.detectAlarmTransitions(baseline);

    const updated = new Array<number>(40).fill(0);
    updated[0] = 0x0005; // bits 0 and 2 set
    const transitions = latestState.detectAlarmTransitions(updated);

    expect(transitions).toHaveLength(2);

    const t0 = transitions.find(t => t.bitIndex === 0);
    expect(t0).toBeDefined();
    expect(t0!.alarmIndex).toBe(0);
    expect(t0!.wordIndex).toBe(0);
    expect(t0!.active).toBe(true);

    const t2 = transitions.find(t => t.bitIndex === 2);
    expect(t2).toBeDefined();
    expect(t2!.alarmIndex).toBe(2);
    expect(t2!.wordIndex).toBe(0);
    expect(t2!.active).toBe(true);
  });

  it('detects 1 cleared transition when word[0] changes from 0x0005 to 0x0004', () => {
    const baseline = new Array<number>(40).fill(0);
    baseline[0] = 0x0005;
    latestState.detectAlarmTransitions(baseline);

    const updated = new Array<number>(40).fill(0);
    updated[0] = 0x0004; // bit 0 cleared, bit 2 still set
    const transitions = latestState.detectAlarmTransitions(updated);

    expect(transitions).toHaveLength(1);
    expect(transitions[0]!.alarmIndex).toBe(0);
    expect(transitions[0]!.wordIndex).toBe(0);
    expect(transitions[0]!.bitIndex).toBe(0);
    expect(transitions[0]!.active).toBe(false);
  });

  it('detects 1 activated transition when word[0] changes from 0x0005 to 0x000D', () => {
    const baseline = new Array<number>(40).fill(0);
    baseline[0] = 0x0005;
    latestState.detectAlarmTransitions(baseline);

    const updated = new Array<number>(40).fill(0);
    updated[0] = 0x000D; // 0x0005 | 0x0008 = bits 0,2,3 set (bit 3 newly activated)
    const transitions = latestState.detectAlarmTransitions(updated);

    expect(transitions).toHaveLength(1);
    expect(transitions[0]!.alarmIndex).toBe(3);
    expect(transitions[0]!.wordIndex).toBe(0);
    expect(transitions[0]!.bitIndex).toBe(3);
    expect(transitions[0]!.active).toBe(true);
  });

  it('detects transitions across multiple words changing simultaneously', () => {
    const baseline = new Array<number>(40).fill(0);
    latestState.detectAlarmTransitions(baseline);

    const updated = new Array<number>(40).fill(0);
    updated[0] = 0x0001;  // word 0, bit 0 activated
    updated[5] = 0x0010;  // word 5, bit 4 activated
    updated[39] = 0x8000; // word 39, bit 15 activated (alarm index 639)
    const transitions = latestState.detectAlarmTransitions(updated);

    expect(transitions).toHaveLength(3);

    const tw0 = transitions.find(t => t.wordIndex === 0);
    expect(tw0).toBeDefined();
    expect(tw0!.alarmIndex).toBe(0);
    expect(tw0!.active).toBe(true);

    const tw5 = transitions.find(t => t.wordIndex === 5);
    expect(tw5).toBeDefined();
    expect(tw5!.alarmIndex).toBe(5 * 16 + 4); // 84
    expect(tw5!.active).toBe(true);

    const tw39 = transitions.find(t => t.wordIndex === 39);
    expect(tw39).toBeDefined();
    expect(tw39!.alarmIndex).toBe(39 * 16 + 15); // 639
    expect(tw39!.active).toBe(true);
  });

  it('returns all transitions with valid timestamp', () => {
    const baseline = new Array<number>(40).fill(0);
    latestState.detectAlarmTransitions(baseline);

    const updated = new Array<number>(40).fill(0);
    updated[0] = 0x0003;
    const before = new Date();
    const transitions = latestState.detectAlarmTransitions(updated);
    const after = new Date();

    expect(transitions).toHaveLength(2);
    for (const t of transitions) {
      expect(t.timestamp.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(t.timestamp.getTime()).toBeLessThanOrEqual(after.getTime());
    }
  });
});

describe('latestState.seedAlarmState', () => {
  beforeEach(() => {
    latestState.reset();
  });

  it('seeded state matches subsequent identical packet (no transitions)', () => {
    // Seed with alarms 0 and 2 active -> word[0] = 0x0005
    latestState.seedAlarmState([0, 2]);

    const words = new Array<number>(40).fill(0);
    words[0] = 0x0005;
    const transitions = latestState.detectAlarmTransitions(words);

    expect(transitions).toEqual([]);
  });

  it('suppresses spurious ACTIVE transitions on first packet after seed', () => {
    // Seed with alarms 0 and 2 active -> word[0] = 0x0005
    latestState.seedAlarmState([0, 2]);

    const words = new Array<number>(40).fill(0);
    words[0] = 0x0007; // bits 0, 1, 2 -- bit 1 looks like a new activation
    const transitions = latestState.detectAlarmTransitions(words);

    // Post-seed first packet: ACTIVE suppressed (we can't know when it
    // truly activated, so stamping it at first-packet-time would lie).
    expect(transitions).toEqual([]);
  });

  it('emits ACTIVE transition on subsequent packets after the first post-seed packet', () => {
    latestState.seedAlarmState([0, 2]);

    const first = new Array<number>(40).fill(0);
    first[0] = 0x0005; // matches seed — no transitions, consumes the suppression window
    expect(latestState.detectAlarmTransitions(first)).toEqual([]);

    const second = new Array<number>(40).fill(0);
    second[0] = 0x0007; // bit 1 newly activates AFTER the first post-seed packet
    const transitions = latestState.detectAlarmTransitions(second);

    expect(transitions).toHaveLength(1);
    expect(transitions[0]!.alarmIndex).toBe(1);
    expect(transitions[0]!.active).toBe(true);
  });

  it('emits CLEAR transitions on first packet after seed (closes zombie DB rows)', () => {
    // DB thought alarms 0 and 2 were active (seeded), but PLC says neither is set.
    // This happens when alarms cleared during backend downtime — we must mark
    // the open DB rows as resolved.
    latestState.seedAlarmState([0, 2]);

    const words = new Array<number>(40).fill(0); // all cleared
    const transitions = latestState.detectAlarmTransitions(words);

    expect(transitions).toHaveLength(2);
    expect(transitions.every(t => !t.active)).toBe(true);
    expect(transitions.map(t => t.alarmIndex).sort()).toEqual([0, 2]);
  });

  it('prevents boot-flood when DB is empty but PLC has alarms asserted', () => {
    // Fresh install / truncated DB: seed with [] -> alarm words all zero.
    // PLC has real alarms asserted. Without the suppression, every bit in
    // the first packet would be recorded as a fresh activation timestamped
    // at boot time. With the fix, none are recorded.
    latestState.seedAlarmState([]);

    const words = new Array<number>(40).fill(0);
    words[0] = 0x0001;  // alarm 0 active
    words[1] = 0x0001;  // alarm 16 active
    words[2] = 0x0001;  // alarm 32 active
    words[3] = 0x0001;  // alarm 48 active
    const transitions = latestState.detectAlarmTransitions(words);

    expect(transitions).toEqual([]);
  });

  it('seeds across multiple words correctly', () => {
    // Seed alarms across multiple words
    latestState.seedAlarmState([0, 16, 32]); // bit 0 in word 0, bit 0 in word 1, bit 0 in word 2

    const words = new Array<number>(40).fill(0);
    words[0] = 0x0001; // matches seed
    words[1] = 0x0001; // matches seed
    words[2] = 0x0001; // matches seed
    const transitions = latestState.detectAlarmTransitions(words);

    expect(transitions).toEqual([]);
  });
});

describe('latestState machine snapshot cache', () => {
  beforeEach(() => {
    latestState.reset();
  });

  it('stores and retrieves machine snapshot', () => {
    const snapshot = { garbageTemp: 450 } as any;
    const timestamp = new Date('2026-01-15T10:00:00Z');
    latestState.setMachineSnapshot(snapshot, timestamp);

    expect(latestState.getMachineSnapshot()).toBe(snapshot);
  });

  it('getLastMachineTimestamp returns the stored timestamp', () => {
    const snapshot = { garbageTemp: 450 } as any;
    const timestamp = new Date('2026-01-15T10:00:00Z');
    latestState.setMachineSnapshot(snapshot, timestamp);

    expect(latestState.getLastMachineTimestamp()).toEqual(timestamp);
  });

  it('returns null before any snapshot is set', () => {
    expect(latestState.getMachineSnapshot()).toBeNull();
    expect(latestState.getLastMachineTimestamp()).toBeNull();
  });
});

describe('latestState alarm words cache', () => {
  beforeEach(() => {
    latestState.reset();
  });

  it('stores and retrieves alarm words', () => {
    const words = new Array<number>(40).fill(0);
    words[0] = 0x0005;
    const timestamp = new Date('2026-01-15T10:00:00Z');
    latestState.setAlarmWords(words, timestamp);

    const retrieved = latestState.getAlarmWords();
    expect(retrieved).toEqual(words);
    expect(retrieved).not.toBe(words); // must be a copy, not a reference
  });

  it('getLastAlarmTimestamp returns the stored timestamp', () => {
    const words = new Array<number>(40).fill(0);
    const timestamp = new Date('2026-01-15T10:00:00Z');
    latestState.setAlarmWords(words, timestamp);

    expect(latestState.getLastAlarmTimestamp()).toEqual(timestamp);
  });

  it('returns null before any alarm words are set', () => {
    expect(latestState.getAlarmWords()).toBeNull();
    expect(latestState.getLastAlarmTimestamp()).toBeNull();
  });
});
