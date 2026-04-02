import type { IMachineSnapshot } from '@wpt/types';
import { UserRole, CLIENT_VISIBLE_FIELDS, WPT_VISIBLE_FIELDS } from '@wpt/types';

type FilteredSnapshot = Partial<IMachineSnapshot>;

/**
 * Filter machine snapshot fields based on user role.
 * Per D-09: service-level pick function, called explicitly.
 * Per D-10: reused by API routes (Phase 5+), WebSocket (Phase 6), CSV (Phase 9).
 *
 * SUPER_ADMIN and WPT see all WPT_VISIBLE_FIELDS (42 fields).
 * CLIENT sees only CLIENT_VISIBLE_FIELDS (18 fields).
 */
export function filterByRole(
  snapshot: IMachineSnapshot,
  role: UserRole,
): FilteredSnapshot {
  const fields = role === UserRole.CLIENT ? CLIENT_VISIBLE_FIELDS : WPT_VISIBLE_FIELDS;
  const result: Record<string, unknown> = {};
  for (const field of fields) {
    result[field] = snapshot[field];
  }
  return result as FilteredSnapshot;
}
