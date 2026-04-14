import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

/**
 * Phase 37 Plan 05 — D-07 / D-08 retirement-boundary regression tests.
 *
 * D-07: `apps/backend/src/mqtt/publisher.ts` was deleted in plan 37-02 and
 *       `connectionManager.ts` no longer calls `initMqttPublisher` or
 *       `shutdownMqttPublisher`. Sparkplug B is the sole outbound cloud
 *       uplink. This test fails if a future refactor reintroduces the file
 *       or an import path referencing it.
 *
 * D-08: `commandHandler.ts` and the local `wpt/{site}/{machine}/cmd/+/req`
 *       command namespace are preserved — they serve local dashboard/ops
 *       subscribers on the on-box Mosquitto broker. This test fails if a
 *       future refactor accidentally removes them.
 *
 * See also:
 *   - .planning/phases/37-.../37-02-SUMMARY.md (publisher.ts deletion)
 *   - wpt-iot/apps/backend/src/mqtt/connectionManager.ts
 *   - wpt-iot/apps/backend/src/mqtt/commandHandler.ts
 */

const __dirname = dirname(fileURLToPath(import.meta.url));

// Up to the outer repo root (D:/Wpt): mqtt → __tests__ → src → backend → apps → wpt-iot → D:/Wpt
const REPO_ROOT = resolve(__dirname, '..', '..', '..', '..', '..', '..');
const BACKEND_SRC = resolve(REPO_ROOT, 'wpt-iot/apps/backend/src');
const FRONTEND_SRC = resolve(REPO_ROOT, 'wpt-iot/apps/frontend/src');
const PUBLISHER_FILE = resolve(BACKEND_SRC, 'mqtt/publisher.ts');
const CONNECTION_MANAGER = resolve(BACKEND_SRC, 'mqtt/connectionManager.ts');
const COMMAND_HANDLER = resolve(BACKEND_SRC, 'mqtt/commandHandler.ts');

/**
 * Recursively collect all .ts/.tsx files under `dir`. Skips `node_modules`,
 * `dist`, `.next`, and `__tests__` directories — the retirement rule is
 * about production source, and this test file lives under `__tests__`
 * with the forbidden import-path pattern appearing as a regex literal.
 */
function collectTsFiles(dir: string): string[] {
  const out: string[] = [];
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (entry === 'node_modules') continue;
      if (entry === 'dist') continue;
      if (entry === '.next') continue;
      if (entry === '__tests__') continue;
      out.push(...collectTsFiles(full));
    } else if (st.isFile()) {
      if (full.endsWith('.ts') || full.endsWith('.tsx')) out.push(full);
    }
  }
  return out;
}

describe('Phase 37 D-07 — Legacy publisher retirement boundary', () => {
  it('publisher.ts no longer exists in the repo (D-07 deletion holds)', () => {
    expect(existsSync(PUBLISHER_FILE)).toBe(false);
  });

  it('no production source file imports from mqtt/publisher.js (D-07 retirement boundary)', () => {
    const files = [...collectTsFiles(BACKEND_SRC), ...collectTsFiles(FRONTEND_SRC)];
    // Matches: `from './publisher.js'`, `from '../publisher.js'`,
    // `from '...mqtt/publisher.js'`. Deliberately narrow — only real import
    // statements, not prose occurrences of the string "publisher.js".
    const importRe = /from\s+['"](?:[^'"]*\/mqtt\/publisher\.js|\.{1,2}\/publisher\.js)['"]/;
    const offenders: string[] = [];
    for (const f of files) {
      const content = readFileSync(f, 'utf8');
      if (importRe.test(content)) offenders.push(f);
    }
    expect(offenders, `Offending imports from retired publisher:\n${offenders.join('\n')}`).toEqual(
      [],
    );
  });

  it('no production source file publishes to a non-Sparkplug topic via mqtt client (D-07 wire-contract boundary)', () => {
    // Any `.publish(...)` or `.publishAsync(...)` call from a backend source
    // file must target a Sparkplug topic (`spBv1.0/...`) or a LOCAL command
    // topic (handled by commandHandler.ts). Catches future reintroduction of
    // an ad-hoc JSON uplink via mqtt client.
    //
    // The regex is intentionally narrow: it looks for a string-literal first
    // argument to a publish* call. If a future refactor computes the topic
    // dynamically, this test will not catch it — that case is covered by
    // the import-path test above (any new publisher module would need an
    // import, and its entry point is observable at module load time).
    const files = collectTsFiles(BACKEND_SRC);
    const offenders: string[] = [];
    const publishCallRe = /\.publish(?:Async)?\(\s*['"`]([^'"`]+)['"`]/g;
    for (const f of files) {
      const content = readFileSync(f, 'utf8');
      let m: RegExpExecArray | null;
      while ((m = publishCallRe.exec(content)) !== null) {
        const topicLiteral = m[1];
        if (topicLiteral.startsWith('spBv1.0/')) continue;
        offenders.push(`${f}: publishes to literal topic "${topicLiteral}"`);
      }
    }
    expect(offenders, `Non-Sparkplug publish calls:\n${offenders.join('\n')}`).toEqual([]);
  });

  it('connectionManager.ts does not call initMqttPublisher or shutdownMqttPublisher (D-07)', () => {
    const content = readFileSync(CONNECTION_MANAGER, 'utf8');
    expect(content).not.toMatch(/initMqttPublisher/);
    expect(content).not.toMatch(/shutdownMqttPublisher/);
  });
});

describe('Phase 37 D-08 — Local command namespace preserved', () => {
  it('connectionManager.ts still calls initCommandHandler (D-08 preservation)', () => {
    const content = readFileSync(CONNECTION_MANAGER, 'utf8');
    expect(content).toMatch(/initCommandHandler/);
  });

  it('commandHandler.ts exists and exports initCommandHandler (D-08)', () => {
    expect(existsSync(COMMAND_HANDLER)).toBe(true);
    const content = readFileSync(COMMAND_HANDLER, 'utf8');
    expect(content).toMatch(/export\s+(?:async\s+)?function\s+initCommandHandler/);
  });

  it('commandHandler.ts still subscribes to the wpt/{site}/{machine}/cmd/+/req local namespace (D-08)', () => {
    const content = readFileSync(COMMAND_HANDLER, 'utf8');
    expect(content).toMatch(/cmd\/\+\/req/);
  });
});
