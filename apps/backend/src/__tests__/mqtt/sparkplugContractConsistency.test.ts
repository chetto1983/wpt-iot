import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { ALIAS_MAP } from '../../mqtt/sparkplugService.js';

/**
 * Phase 37 Plan 05 — D-17 doc/code consistency check.
 *
 * Every alias documented in the integration contract `metric-schema.md` MUST
 * exist in ALIAS_MAP under the same name, and vice versa. The EN and IT files
 * MUST agree on alias numbers and metric names — wire-format strings are part
 * of the contract and are never translated.
 *
 * If this test fails, EITHER the markdown doc changed OR the code changed
 * without its counterpart. Bring them back into sync before merging — the
 * alias numbers and metric names are the wpt-sparkplug B2B contract.
 *
 * Chosen mechanism per D-17 planner discretion: a test in the existing vitest
 * pipeline (not a manual checkbox, not an external CI script). Repeatable,
 * machine-checked, locks docs and code together at PR time.
 *
 * See also:
 *   - docs/integration/sparkplug-b/en/metric-schema.md (parsed here)
 *   - docs/integration/sparkplug-b/it/metric-schema.md (parsed here)
 *   - wpt-iot/apps/backend/src/mqtt/sparkplugService.ts (ALIAS_MAP source)
 *   - wpt-iot/apps/backend/src/mqtt/sparkplugAlarms.ts (ALARM_ALIASES, spread into ALIAS_MAP)
 */

const __dirname = dirname(fileURLToPath(import.meta.url));

// From wpt-iot/apps/backend/src/__tests__/mqtt/ up to the outer repo root (D:/Wpt).
// mqtt → __tests__ → src → backend → apps → wpt-iot → D:/Wpt  (6 hops)
const REPO_ROOT = resolve(__dirname, '..', '..', '..', '..', '..', '..');
const EN_DOC = resolve(REPO_ROOT, 'docs/integration/sparkplug-b/en/metric-schema.md');
const IT_DOC = resolve(REPO_ROOT, 'docs/integration/sparkplug-b/it/metric-schema.md');

/**
 * Parse markdown tables in metric-schema.md and extract (metric_name -> alias) pairs.
 *
 * Expected row format (first column is the metric name wrapped in backticks,
 * third column is the alias integer):
 *
 *   | `metric/name` | Sparkplug Type | 100 | source | notes |
 *
 * The parser is intentionally narrow — it only accepts rows that:
 *   (a) start with a pipe-delimited first cell whose FIRST backticked token
 *       matches the metric-name character class (letters, digits, `/`,
 *       underscore, space — the only exotic name is `Node Control/Rebirth`);
 *   (b) have an integer alias (0..999) in a standalone cell somewhere AFTER
 *       the name cell.
 *
 * Header rows like `| Metric Name | Sparkplug Type | Alias | ... |` are
 * rejected because they lack backticks. Table-separator rows like `|---|---|`
 * are rejected by the `---` guard.
 */
function parseAliasTable(markdown: string): Map<string, number> {
  const map = new Map<string, number>();
  const NAME_CELL_RE = /\|\s*`([A-Za-z][A-Za-z0-9_/\s]*?)`\s*\|/; // first backticked token in a cell
  const ALIAS_CELL_RE = /\|\s*(\d{1,3})\s*\|/; // first standalone integer cell after stripping the name

  for (const rawLine of markdown.split('\n')) {
    const line = rawLine.trim();
    if (!line.startsWith('|')) continue;
    if (line.includes('---')) continue;

    const nameMatch = NAME_CELL_RE.exec(line);
    if (!nameMatch) continue;
    const name = nameMatch[1].trim();
    if (!name) continue;

    // Search for the alias integer AFTER the name cell — guards against a
    // spurious 3-digit number appearing inside the name cell itself (there
    // aren't any in the live doc, but the guard makes the parser robust).
    const afterName = line.slice((nameMatch.index ?? 0) + nameMatch[0].length - 1);
    const aliasMatch = ALIAS_CELL_RE.exec(afterName);
    if (!aliasMatch) continue;
    const alias = Number(aliasMatch[1]);
    if (!Number.isInteger(alias)) continue;

    map.set(name, alias);
  }
  return map;
}

describe('Phase 37 D-17 — Sparkplug contract doc/code consistency', () => {
  const codeMap = new Map<string, number>(Object.entries(ALIAS_MAP));
  const enMd = readFileSync(EN_DOC, 'utf8');
  const itMd = readFileSync(IT_DOC, 'utf8');
  const enMap = parseAliasTable(enMd);
  const itMap = parseAliasTable(itMd);

  it('EN metric-schema.md parsed at least 40 rows (sanity check on the parser)', () => {
    expect(enMap.size).toBeGreaterThanOrEqual(40);
  });

  it('IT metric-schema.md parsed at least 40 rows (sanity check)', () => {
    expect(itMap.size).toBeGreaterThanOrEqual(40);
  });

  it('every alias in EN metric-schema.md exists in ALIAS_MAP under the same name (D-17 forward)', () => {
    const mismatches: string[] = [];
    for (const [name, alias] of enMap) {
      const codeAlias = codeMap.get(name);
      if (codeAlias === undefined) {
        mismatches.push(
          `doc has "${name}" alias ${String(alias)} but ALIAS_MAP has no such metric name`,
        );
      } else if (codeAlias !== alias) {
        mismatches.push(
          `doc says "${name}" = alias ${String(alias)} but ALIAS_MAP says alias ${String(codeAlias)}`,
        );
      }
    }
    expect(mismatches, mismatches.join('\n')).toEqual([]);
  });

  it('every alias in ALIAS_MAP is documented in EN metric-schema.md (D-17 reverse)', () => {
    const undocumented: string[] = [];
    for (const [name, alias] of codeMap) {
      const docAlias = enMap.get(name);
      if (docAlias === undefined) {
        undocumented.push(
          `ALIAS_MAP has "${name}" alias ${String(alias)} but EN doc has no such row`,
        );
      } else if (docAlias !== alias) {
        undocumented.push(
          `ALIAS_MAP "${name}" = ${String(alias)} but EN doc says ${String(docAlias)}`,
        );
      }
    }
    expect(undocumented, undocumented.join('\n')).toEqual([]);
  });

  it('EN and IT metric-schema.md have identical alias maps (wire strings preserved across translation, D-15 reinforcement)', () => {
    const enEntries = [...enMap.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    const itEntries = [...itMap.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    expect(itEntries).toEqual(enEntries);
  });

  it('EN metric-schema.md alias numbers are unique within the doc', () => {
    const seen = new Map<number, string>();
    const dupes: string[] = [];
    for (const [name, alias] of enMap) {
      const prev = seen.get(alias);
      if (prev !== undefined) {
        dupes.push(`alias ${String(alias)} appears for both "${prev}" and "${name}"`);
      } else {
        seen.set(alias, name);
      }
    }
    expect(dupes, dupes.join('\n')).toEqual([]);
  });

  it('EN metric-schema.md metric names are unique within the doc (ALIAS_MAP has unique keys, doc must too)', () => {
    // Map.set de-duplicates, so the size is the unique-name count. If any
    // name appears twice in the parsed doc, the parser silently kept the
    // last one — this test would still pass on size but we want to catch
    // the case explicitly by re-parsing and counting raw occurrences.
    const rawNames: string[] = [];
    const NAME_CELL_RE = /\|\s*`([A-Za-z][A-Za-z0-9_/\s]*?)`\s*\|/;
    for (const rawLine of enMd.split('\n')) {
      const line = rawLine.trim();
      if (!line.startsWith('|')) continue;
      if (line.includes('---')) continue;
      const m = NAME_CELL_RE.exec(line);
      if (!m) continue;
      // Only count rows that also have an alias cell — otherwise a prose row
      // with a backticked word would be double-counted.
      const afterName = line.slice((m.index ?? 0) + m[0].length - 1);
      if (!/\|\s*\d{1,3}\s*\|/.test(afterName)) continue;
      rawNames.push(m[1].trim());
    }
    const dupes = rawNames.filter((n, i) => rawNames.indexOf(n) !== i);
    expect(dupes, `duplicate metric names in EN doc: ${dupes.join(', ')}`).toEqual([]);
  });
});
