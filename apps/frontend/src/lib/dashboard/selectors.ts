import type { IMachineSnapshot } from '@wpt/types';
import { TECHNICAL_GROUPS } from './fields.js';

export type DashboardConnectionState = 'waiting' | 'live' | 'reconnecting' | 'offline';

/**
 * Derive the dashboard connection display state from ws context.
 * - connected + no data yet = 'waiting'
 * - connected + data present = 'live'
 * - disconnected + stale data = 'reconnecting'
 * - disconnected + no data = 'offline'
 */
export function getConnectionState(
  machineData: Partial<IMachineSnapshot> | null,
  connected: boolean,
): DashboardConnectionState {
  if (connected && machineData === null) return 'waiting';
  if (connected) return 'live';
  if (machineData !== null) return 'reconnecting';
  return 'offline';
}

/** Returns true if any WPT-only technical field is present in the payload */
export function hasTechnicalSignals(machineData: Partial<IMachineSnapshot> | null): boolean {
  if (!machineData) return false;
  return TECHNICAL_GROUPS.some((group) =>
    group.fields.some((field) => machineData[field] !== undefined),
  );
}
