import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/__tests__/**/*.test.ts'],
    // Phase 19 Plan 12: file-level sequential execution.
    //
    // The energy test directory hits the real dev Postgres DB. Several files
    // own overlapping tables (cycle_resets, cycle_records, energy_config_*)
    // and tariffPeriods.test.ts DROPs them CASCADE in beforeEach. Under
    // vitest's default file parallelism (one worker per file), tariffPeriods'
    // DROP races with cycleTracker / aggregate.fixture's table reads, leaving
    // a non-deterministic ~80% failure rate where 'relation "cycle_resets"
    // does not exist' surfaces mid-run.
    //
    // The least-invasive fix is to disable file-level parallelism so a DROP
    // in one file cannot fire while another file is querying the same table.
    // Tests inside a single file still run in their declared order; only the
    // cross-file dispatch is serialized. Total runtime impact for the energy
    // suite is a few seconds — acceptable trade for determinism.
    //
    // Alternatives considered (all rejected):
    //  (a) suite-level beforeAll: doesn't help — race is BETWEEN files, not
    //      within a single file.
    //  (b) remove CASCADE from tariffPeriods: leaves stale state behind and
    //      adds CREATE TABLE IF NOT EXISTS calls everywhere with no real
    //      determinism guarantee.
    //  (c) fileParallelism: false (this fix): minimal, mechanical, no test
    //      code changes, no schema gymnastics. WINNER.
    fileParallelism: false,
  },
});
