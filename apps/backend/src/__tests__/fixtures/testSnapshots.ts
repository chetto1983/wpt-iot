/**
 * Machine snapshot and alarm event seeding helpers for Phase 32 tests.
 *
 * Use fixed past dates in the 2024-05-* range (date-wall per PATTERNS.md)
 * to avoid collisions with dev-session simulator data.
 *
 * machineSnapshots rows: timestamp is the only required column; all numeric
 * fields are nullable in the schema, so callers can pass sparse objects.
 * seedMachineSnapshots merges sensible defaults (machineStatus: 1) before insert.
 *
 * alarmEvents rows: all non-nullable columns must be supplied by the caller —
 * the helper inserts them verbatim.
 */
import { db } from '../../db/index.js';
import { machineSnapshots } from '../../db/schema/machine.js';
import { alarmEvents } from '../../db/schema/alarms.js';

type MachineSnapshotInsert = typeof machineSnapshots.$inferInsert;
type AlarmEventInsert = typeof alarmEvents.$inferInsert;

export type PartialSnapshotRow = Partial<MachineSnapshotInsert> & { timestamp: Date };

export async function seedMachineSnapshots(rows: PartialSnapshotRow[]): Promise<void> {
  const inserts: MachineSnapshotInsert[] = rows.map((row) => ({
    machineStatus: 1,
    garbageTemp: 0,
    energyConsumption: 0,
    ...row,
  }));
  await db.insert(machineSnapshots).values(inserts);
}

export type AlarmEventRow = Pick<
  AlarmEventInsert,
  | 'alarmIndex'
  | 'wordIndex'
  | 'bitIndex'
  | 'active'
  | 'transitionType'
  | 'activatedAt'
  | 'descriptionIt'
  | 'descriptionEn'
> & { resetAt?: Date | null };

export async function seedAlarmEvents(rows: AlarmEventRow[]): Promise<void> {
  await db.insert(alarmEvents).values(rows);
}
