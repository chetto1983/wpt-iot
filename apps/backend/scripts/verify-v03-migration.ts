/**
 * Standalone verification script for the V03 schema migration.
 *
 * Why a standalone script instead of `tsx -e "..."`:
 *   The original Task 3 verify command embedded ES module syntax inside a `-e`
 *   flag (`pnpm --filter @wpt/backend exec tsx -e "import ..."`), which is brittle
 *   on Windows cmd/pwsh due to nested-quote handling. This script is the portable
 *   replacement — same behavior, no shell quoting hazards.
 *
 * Usage: pnpm --filter @wpt/backend exec tsx scripts/verify-v03-migration.ts
 *
 * Side effects:
 *   - Runs ensureV03Columns() once (idempotent, safe to repeat)
 *   - Logs the verified column list via the internal console.log in the service
 *   - Exits 0 on success, non-zero on any error
 *
 * Prerequisite: local Docker PostgreSQL must be up (cd wpt-iot && docker compose up -d db)
 * and the schema must have been pushed at least once (pnpm --filter @wpt/backend run db:push).
 */
import { MachineSchemaMigrationService } from '../src/db/machineSchemaMigrationService.js';

async function main(): Promise<void> {
  await MachineSchemaMigrationService.ensureV03Columns();
  // Call it a second time to prove idempotency — should succeed with no errors.
  await MachineSchemaMigrationService.ensureV03Columns();
  console.log('[verify-v03-migration] idempotency check passed (ran ensureV03Columns twice)');
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error('[verify-v03-migration] FAILED:', err);
    process.exit(1);
  },
);
