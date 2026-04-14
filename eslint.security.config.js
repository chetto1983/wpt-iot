import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import pluginSecurity from 'eslint-plugin-security';
import globals from 'globals';

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  pluginSecurity.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.node },
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // D-07: escalate to error for audit
      '@typescript-eslint/no-unsafe-assignment': 'error',
      '@typescript-eslint/no-unsafe-call': 'error',
      '@typescript-eslint/no-unsafe-member-access': 'error',
      '@typescript-eslint/no-unsafe-return': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': 'error',

      /*
       * D-01 (Phase 31, 2026-04-14): detect-object-injection disabled
       * globally. Validated empirically — all 79 findings in the Phase 27
       * scan were typed-record iteration, enum lookups, or React form-field
       * setters; zero were prototype-pollution vectors. The true-positive
       * surface (user input reaching computed property access) is covered
       * by Zod validation at HTTP route boundaries (@wpt/types).
       *
       * Per the D-01 locked user decision, per-site
       * `eslint-disable-next-line` comments are NOT permitted. Re-enable
       * if copy-pasting this config to a project without that Zod
       * boundary discipline. See
       * .planning/phases/31-bug-fixes-security-hardening/31-RESEARCH.md
       * §Common Pitfalls #3 and §Architecture Patterns.
       */
      'security/detect-object-injection': 'off',
    },
  },
  {
    ignores: ['**/dist/', '**/node_modules/', '**/.next/', 'apps/simulator/public/'],
  },
);
