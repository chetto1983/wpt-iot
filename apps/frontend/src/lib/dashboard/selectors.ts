import type { IMachineSnapshot } from '@wpt/types';
import { TECHNICAL_GROUPS } from './fields';

type DashboardConnectionState =
  | 'waiting'
  | 'live'
  | 'reconnecting'
  | 'offline'
  | 'plc-offline';

/**
 * Derive the dashboard connection display state from ws context.
 * - connected + data present = 'live'
 * - connected + no data yet + plcConnected === false = 'plc-offline' (backend says PLC is silent >20s)
 * - connected + no data yet + plcConnected null/true = 'waiting' (first-packet window)
 * - disconnected + stale data = 'reconnecting'
 * - disconnected + no data = 'offline'
 */
export function getConnectionState(
  machineData: Partial<IMachineSnapshot> | null,
  connected: boolean,
  plcConnected: boolean | null,
): DashboardConnectionState {
  if (!connected && machineData !== null) return 'reconnecting';
  if (!connected) return 'offline';
  if (machineData !== null) return 'live';
  if (plcConnected === false) return 'plc-offline';
  return 'waiting';
}

/** Returns true if any WPT-only technical field is present in the payload */
export function hasTechnicalSignals(machineData: Partial<IMachineSnapshot> | null): boolean {
  if (!machineData) return false;
  return TECHNICAL_GROUPS.some((group) =>
    group.fields.some((field) => machineData[field] !== undefined),
  );
}
