import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/** Shared config for services and packages. apps/web has its own config that adds Next.js rules. */
export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/.next/**', '**/coverage/**', '**/node_modules/**', 'apps/web/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.node },
      parserOptions: {
        // Mirrors the services' tsconfig. Without this, `consistent-type-imports` would autofix
        // constructor-injected classes into `import type`, erasing the runtime reference Nest DI needs.
        experimentalDecorators: true,
        emitDecoratorMetadata: true,
      },
    },
    rules: {
      'no-console': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      // Nest modules are decorator-only classes or expose only static `forRoot()`/`register()` factories.
      '@typescript-eslint/no-extraneous-class': 'off',
    },
  },
  {
    files: ['**/*.test.ts', '**/test/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
  prettier,
);
