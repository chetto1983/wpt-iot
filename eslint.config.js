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
      'boundaries/elements': [
        { type: 'shadow',         pattern: 'apps/backend/src/services/anomaly/shadow/**', mode: 'full' },
        { type: 'user-broadcast', pattern: 'apps/backend/src/ws/**',                     mode: 'full' },
        { type: 'user-broadcast', pattern: 'apps/backend/src/mqtt/sparkplug*.ts',        mode: 'full' },
        { type: 'user-broadcast', pattern: 'apps/backend/src/routes/alarm*.ts',          mode: 'full' },
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
