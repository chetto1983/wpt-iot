import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';
import boundaries from 'eslint-plugin-boundaries';

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: {
        ...globals.node,
      },
      parserOptions: {
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
  {
    // Phase 41 D-08 — SHADOW-03 defense layer 3 (lint-time).
    // element-types rule wires file-system paths to abstract tags so
    // user-broadcast paths (ws/, mqtt/sparkplug*, routes/alarm*) cannot
    // import from services/anomaly/shadow/**. Combined with Plan 41-01's
    // branded types (layer 1) and Plan 41-04's narrowed service interface
    // (layer 2), this closes the lint-time regression window.
    plugins: { boundaries },
    settings: {
      // WR-01 fix (2026-04-20): patterns are resolved relative to eslint's
      // cwd. The backend lint script is `eslint src/` executed from
      // apps/backend/, so eslint sees file paths like
      // `src/services/anomaly/shadow/foo.ts`. Patterns must be rooted at
      // `src/...` (NOT `apps/backend/src/...`) to match. Verified via
      // `boundaries/debug` that the element-tagging side now matches:
      // `src/ws/broadcaster.ts` is correctly tagged `user-broadcast`.
      //
      // KNOWN LIMITATION (not addressed in this fix): the plugin relies on
      // the node import resolver to classify the *target* of each import.
      // Our backend uses the TypeScript ESM convention `import … from
      // '…/foo.js'` even though source files end in `.ts` — the node
      // resolver returns `null` for those targets, so the `boundaries/
      // element-types` rule cannot classify them as `shadow` and the
      // forbidden-import check silently passes. Making the rule actually
      // fire requires installing `eslint-import-resolver-typescript` and
      // wiring it via `settings['import/resolver']`. That is a new
      // dependency — out of scope for this REVIEW-FIX pass. Layers 1
      // (branded types, D-06) and 2 (narrowed interface, D-07) still hold
      // regardless. Tracked separately; patterns are now at least correct.
      'boundaries/elements': [
        { type: 'shadow',         pattern: 'src/services/anomaly/shadow/**', mode: 'full' },
        { type: 'user-broadcast', pattern: 'src/ws/**',                     mode: 'full' },
        { type: 'user-broadcast', pattern: 'src/mqtt/sparkplug*.ts',        mode: 'full' },
        { type: 'user-broadcast', pattern: 'src/routes/alarm*.ts',          mode: 'full' },
      ],
    },
    rules: {
      'boundaries/element-types': ['error', {
        default: 'allow',
        rules: [
          {
            from: ['user-broadcast'],
            disallow: ['shadow'],
            message: 'SHADOW-03 violation: files reachable by end users (ws/, mqtt/sparkplug*, routes/alarm*) must not import from services/anomaly/shadow/**. Shadow events are evaluation-only (D-06/D-07/D-08).',
          },
        ],
      }],
    },
  },
  {
    ignores: ['**/dist/', '**/node_modules/', '**/.next/', 'apps/simulator/public/'],
  },
);
