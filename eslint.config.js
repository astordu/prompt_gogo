'use strict';

const js = require('@eslint/js');
const globals = require('globals');

module.exports = [
  {
    ignores: ['coverage/**', 'dist/**', 'downloads/**', 'node_modules/**'],
    linterOptions: {
      reportUnusedDisableDirectives: 'off'
    }
  },
  js.configs.recommended,
  {
    files: ['src/**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      globals: {
        ...globals.browser,
        ...globals.node,
        providerModule: 'readonly',
        shortcutDraftModule: 'readonly',
        templateModule: 'readonly'
      },
      sourceType: 'commonjs'
    },
    rules: {
      'no-unused-vars': 'off'
    }
  },
  {
    files: ['test/**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      globals: globals.node,
      sourceType: 'commonjs'
    },
    rules: {
      'no-unused-vars': 'off'
    }
  }
];
