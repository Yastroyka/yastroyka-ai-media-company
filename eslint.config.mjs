import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import eslintConfigPrettier from 'eslint-config-prettier/flat';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig(
  globalIgnores([
    '**/node_modules/**',
    '**/.nuxt/**',
    '**/.output/**',
    '**/.nitro/**',
    '**/dist/**',
    '**/coverage/**',
    '**/playwright-report/**',
    '**/test-results/**',
    '**/.cache/**',
  ]),

  {
    files: ['**/*.{js,mjs,cjs}'],

    extends: [js.configs.recommended],

    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: globals.node,
    },
  },

  {
    files: ['**/*.{ts,mts,cts}'],

    extends: [js.configs.recommended, tseslint.configs.recommended],
  },

  eslintConfigPrettier,
);
