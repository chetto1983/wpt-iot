import { describe, it, expect } from 'vitest';
import { JobDataSchema, type IJobData } from '../jobs.js';
import {
  CycleType,
  RemoteJobEnable,
  MaintenanceRequest,
  RemoteCycleSelection,
} from '../enums.js';

/** Build a fully-populated IJobData fixture (V03 9 keys). */
function buildFixture(): IJobData {
  return {
    supervisor: 'WPT_SUPER',
    orderNumber: 'ORD-001',
    serialNumber: 'SN-1234',
    remoteJobEnable: RemoteJobEnable.NO_REQUEST,
    maintenanceRequest: MaintenanceRequest.NO_REQUEST,
    remoteCycleSelection: RemoteCycleSelection.NO_REQUEST,
    cycleType: CycleType.NO_CYCLE,
    spareInt02: 99,
    spareInt03: 88,
  };
}

describe('JobDataSchema (V03)', () => {
  it('parses a fully-populated fixture and preserves spareInt02/spareInt03', () => {
    const parsed = JobDataSchema.parse(buildFixture());
    expect(parsed.spareInt02).toBe(99);
    expect(parsed.spareInt03).toBe(88);
  });

  it('rejects payload where spareInt02 is a string', () => {
    const bad = { ...buildFixture(), spareInt02: 'not-a-number' as unknown as number };
    expect(() => JobDataSchema.parse(bad)).toThrow();
  });

  it('rejects payload missing spareInt02 / spareInt03 (required, not optional)', () => {
    const fixture = buildFixture();
    const { spareInt02: _s2, spareInt03: _s3, ...withoutSpares } = fixture;
    expect(() => JobDataSchema.parse(withoutSpares)).toThrow();
  });

  it('IJobData has exactly 9 enumerable keys (V03 contract)', () => {
    const fixture = buildFixture();
    const keys = Object.keys(fixture).sort();
    expect(keys).toEqual(
      [
        'supervisor',
        'orderNumber',
        'serialNumber',
        'remoteJobEnable',
        'maintenanceRequest',
        'remoteCycleSelection',
        'cycleType',
        'spareInt02',
        'spareInt03',
      ].sort()
    );
    expect(keys.length).toBe(9);
  });
});
