/**
 * Alarm catalog version constant.
 *
 * Versioned independently from the Sparkplug B contract version.
 * Bump this when the alarm description catalog (en.json / it.json) changes.
 * The current contract version is v2.0.0; the catalog itself has not changed
 * since its initial cut, so the catalog version remains 1.0.0.
 *
 * Published as `machine/alarm_catalog_version` (alias 8) in NBIRTH only.
 * Consumers read it once per birth to detect catalog drift and refetch
 * GET /api/alarms/catalog when the value changes.
 */
export const ALARM_CATALOG_VERSION = '1.0.0';
