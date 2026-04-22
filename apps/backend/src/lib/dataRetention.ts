export const RAW_MACHINE_RETENTION_DAYS = 30;
export const ALARM_HISTORY_RETENTION_DAYS = 730;
export const ALARM_HISTORY_RETENTION_INTERVAL = '24 months';
export const ALARM_RETENTION_RUN_INTERVAL_MS = 24 * 60 * 60 * 1000;

function getOldestAvailable(days: number, now = new Date()): Date {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}

export function getRawMachineRetentionViolation(
  from: Date,
  now = new Date(),
): string | null {
  const oldestAvailable = getOldestAvailable(RAW_MACHINE_RETENTION_DAYS, now);
  if (from < oldestAvailable) {
    return `Machine raw reports are limited to the last ${RAW_MACHINE_RETENTION_DAYS} days; available from ${oldestAvailable.toISOString()}`;
  }
  return null;
}

export function getAlarmHistoryRetentionViolation(
  from: Date,
  now = new Date(),
): string | null {
  const oldestAvailable = getOldestAvailable(ALARM_HISTORY_RETENTION_DAYS, now);
  if (from < oldestAvailable) {
    return `Alarm history reports are limited to the last ${ALARM_HISTORY_RETENTION_DAYS} days; available from ${oldestAvailable.toISOString()}`;
  }
  return null;
}
