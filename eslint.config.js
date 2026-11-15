import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

/** Unused names are errors, except a leading underscore marks one kept on purpose (a required parameter). */
const unusedVars = ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none', ignoreRestSiblings: true }];

export default tseslint.config(
  { ignores: ['dist/', 'node_modules/', 'server/node_modules/', 'samples/', 'coverage/'] },
  {
    files: ['**/*.js'],
    extends: [js.configs.recommended],
    languageOptions: { globals: { ...globals.node } },
    rules: { 'no-unused-vars': unusedVars },
  },
  {
    files: ['public/sw.js'],
    languageOptions: { globals: { ...globals.serviceworker } },
  },
  {
    files: ['**/*.{ts,tsx}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    rules: { '@typescript-eslint/no-unused-vars': unusedVars },
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: reactHooks.configs.recommended.rules,
  },
);
