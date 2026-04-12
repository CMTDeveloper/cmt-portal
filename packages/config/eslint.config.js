import nextPlugin from 'eslint-config-next';
import boundariesPlugin from 'eslint-plugin-boundaries';
import tsParser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';

/** @type {import('eslint').Linter.Config[]} */
export default [
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
        ecmaFeatures: { jsx: true },
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
      boundaries: boundariesPlugin,
    },
    settings: {
      'boundaries/elements': [
        {
          type: 'feature',
          pattern: 'apps/portal/src/features/*',
          mode: 'folder',
        },
        {
          type: 'shared-pkg',
          pattern: 'packages/*',
          mode: 'folder',
        },
        {
          type: 'app-shell',
          pattern: 'apps/portal/src/{app,components,lib}/**',
        },
      ],
    },
    rules: {
      ...tsPlugin.configs.recommended.rules,
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'boundaries/element-types': [
        'error',
        {
          default: 'allow',
          rules: [
            {
              from: 'feature',
              disallow: ['feature'],
              message:
                'Cross-feature imports forbidden — go through @cmt/shared-domain or @cmt/ui',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['packages/shared-domain/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'react', message: '@cmt/shared-domain must not depend on React' },
            { name: 'react-dom', message: '@cmt/shared-domain must not depend on React' },
          ],
          patterns: [
            { group: ['next/*'], message: '@cmt/shared-domain must not depend on Next.js' },
            { group: ['@radix-ui/*'], message: '@cmt/shared-domain must not depend on UI libs' },
          ],
        },
      ],
    },
  },
];
