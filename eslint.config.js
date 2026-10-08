// Lint rules for the game's modules (src/js), the Node tools (tools/, the configs), the tests (tests/) and the
// standalone add-on (standalone/).
import globals from 'globals';

const rules = {
  'no-undef': 'error',
  'no-unused-vars': ['warn', { vars: 'all', args: 'none', caughtErrors: 'none' }],
  'no-redeclare': 'error',
  'no-dupe-keys': 'error',
  'no-unreachable': 'error',
  'no-self-assign': 'error',
  'no-dupe-else-if': 'error',
  'no-duplicate-case': 'error',
  'no-constant-condition': ['warn', { checkLoops: false }],
  'no-cond-assign': 'warn',
  'no-func-assign': 'error',
  'no-import-assign': 'error',
  'no-unsafe-finally': 'error',
  'no-loss-of-precision': 'warn',
  'no-compare-neg-zero': 'error',
  'use-isnan': 'error',
  'valid-typeof': 'error',
  'no-useless-escape': 'off',
};

export default [
  {
    files: ['src/js/**/*.js', 'standalone/client/**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.browser, __APP_VERSION__: 'readonly' }, // __APP_VERSION__: set by the bundler (tools/build.js)
    },
    rules,
  },
  {
    files: ['tools/**/*.js', '*.config.js', 'standalone/*.js'],
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module', globals: globals.node },
    rules,
  },
  {
    // specs run in Node, and the functions they hand to page.evaluate run in the page, where window.DR is the game
    files: ['tests/**/*.js', 'tools/shots.js', 'standalone/tests/**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.node, ...globals.browser, DR: 'readonly' },
    },
    rules,
  },
  {
    // injected into the page before it loads (tests/support/test.js), so it runs in the browser as a plain script
    files: ['tests/support/dbmock.js'],
    languageOptions: { sourceType: 'script', globals: globals.browser },
  },
];
