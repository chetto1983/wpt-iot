/**
 * Phase 20 scope-wall fence — asserts `energyBaselineService` is imported
 * ONLY by the route plugin (`routes/energy.ts`) and its sibling math file,
 * never from any other service under `apps/backend/src/services/`.
 *
 * Approach: Node-native recursive `fs` walk. No shell, no `grep`, no
 * `execSync`. Works identically on Windows, Linux, and macOS (BLOCKER fix —
 * the dev host is Windows and neither cmd.exe nor PowerShell ships `grep`).
 *
 * The allowlist pre-includes:
 *   - `energyBaselineService.ts` itself (self-import / re-exports)
 *   - `energyBaselineMath.ts` (pre-committed split per WARNING 5; circular
 *     value import for the error classes)
 *
 * Any other sibling service file importing `energyBaselineService` is a
 * scope-wall violation and fails the test.
 */
import { describe, it, expect } from 'vitest';
import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

async function* walkTs(dir: string): AsyncGenerator<string> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walkTs(full);
    } else if (entry.isFile() && /\.(ts|tsx|mts|cts)$/.test(entry.name)) {
      yield full;
    }
  }
}

async function findImporters(
  servicesDir: string,
  needle: RegExp,
  ignoreFiles: Set<string>,
): Promise<string[]> {
  const hits: string[] = [];
  for await (const file of walkTs(servicesDir)) {
    if (ignoreFiles.has(file)) continue;
    const content = await readFile(file, 'utf8');
    if (needle.test(content)) hits.push(file);
  }
  return hits;
}

describe('scope wall — energyBaselineService', () => {
  it('no sibling service imports energyBaselineService', async () => {
    // Resolve servicesDir relative to THIS test file so the test is
    // cwd-independent (Vitest may run from apps/backend or monorepo root).
    const servicesDir = resolve(
      fileURLToPath(new URL('../services', import.meta.url)),
    );
    const selfFile = resolve(servicesDir, 'energyBaselineService.ts');
    // Pre-allowlist the split sibling from Plan 04 WARNING 5.
    const mathFile = resolve(servicesDir, 'energyBaselineMath.ts');
    const ignoreFiles = new Set<string>([selfFile, mathFile]);

    // Match ES-module relative imports: `from '...energyBaselineService'`
    // or `from '...energyBaselineService.js'`. Single or double quotes.
    const needle = /from\s+['"][^'"]*energyBaselineService(\.js)?['"]/;

    const hits = await findImporters(servicesDir, needle, ignoreFiles);
    expect(
      hits,
      `scope-wall fence: these files must not import energyBaselineService:\n${hits.join('\n')}`,
    ).toEqual([]);
  });
});
