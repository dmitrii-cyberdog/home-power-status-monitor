import js from '@eslint/js'
import { defineConfig, globalIgnores } from 'eslint/config'
import { createNodeResolver, importX } from 'eslint-plugin-import-x'
import jsdoc from 'eslint-plugin-jsdoc'
import n from 'eslint-plugin-n'
import globals from 'globals'

//
//
//

const importGroupLayers = ['config', 'middlewares', 'services', 'utils']

const relativeImportPrefixes = [
  '.',
  ...Array.from({ length: 10 }, (_, i) => '../'.repeat(i + 1).slice(0, -1)),
]

const internalLayerPathGroups = importGroupLayers.flatMap(layer =>
  relativeImportPrefixes.map(prefix => ({
    pattern: `${prefix}/${layer}{,/,/**}`,
    group: 'internal',
    position: 'before',
  })),
)

//
//
//

export default defineConfig([
  // 1. Never lint these (generated / non-source dirs)
  globalIgnores(
    ['.yarn/', '.husky/', 'volume/', '.cleanup-backup/', '.superpowers/'],
    'project/ignores',
  ),

  // 2. Main layer: base presets + project rules for every JS file
  {
    name: 'project/base',
    files: ['**/*.js', '**/*.mjs'],
    extends: [
      js.configs.recommended,
      n.configs['flat/recommended'],
      jsdoc.configs['flat/recommended'],
      importX.flatConfigs.recommended,
    ],
    languageOptions: {
      ecmaVersion: 'latest', // enables optional chaining, ??, etc.
      sourceType: 'module',
      globals: globals.node,
    },
    linterOptions: {
      // eslint-disable comments that no longer suppress anything are errors
      reportUnusedDisableDirectives: 'error',
    },
    settings: {
      'import-x/resolver-next': [
        // Rust-based Node resolver — resolves the extensionless ESM imports
        // (extensionless/register) natively, incl. directory index files
        createNodeResolver(),
      ],
    },
    rules: {
      // n's resolver doesn't understand extensionless imports;
      // import-x/no-unresolved covers missing imports instead
      'n/no-missing-import': 'off',

      'import-x/no-unresolved': [
        'error',
        { esmodule: true, caseSensitive: true },
      ],

      'import-x/extensions': 'off',

      'import-x/first': 'error',
      'import-x/newline-after-import': 'error',
      'import-x/no-self-import': 'error',
      'import-x/no-useless-path-segments': 'error',

      // noisy heuristics from the recommended preset — a default export that
      // shares its name with a named export is our normal entity pattern
      'import-x/no-named-as-default': 'off',
      'import-x/no-named-as-default-member': 'off',

      // false-positives on CJS packages consumed through ESM interop
      // (e.g. `import yup from 'yup'` works at runtime but has no static
      // default export); import-x/named still guards real missing exports
      'import-x/default': 'off',

      'import-x/order': [
        'error',
        {
          groups: [
            'builtin',
            'external',
            'internal',
            ['parent', 'sibling', 'index'],
            'object',
            'type',
          ],
          pathGroups: internalLayerPathGroups,
          pathGroupsExcludedImportTypes: [],
          distinctGroup: true,
          'newlines-between': 'always',
          alphabetize: {
            order: 'asc',
            caseInsensitive: true,
          },
        },
      ],

      //
      //

      'no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '_$',
          varsIgnorePattern: '_$',
          caughtErrorsIgnorePattern: '_',
        },
      ],

      curly: ['error', 'all'],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-var': 'error',
      'prefer-const': ['error', { destructuring: 'all' }],
      'no-promise-executor-return': 'error',
      // Logger service is the logging path — no stray console in src
      'no-console': 'error',

      //
      //

      'n/no-process-env': 'error',
      'n/prefer-node-protocol': 'error',

      //
      //

      // jsdoc: keep the structural checks (param names, tag validity),
      // don't demand full type documentation in a no-TS codebase
      'jsdoc/no-undefined-types': 'off',
      'jsdoc/reject-any-type': 'off',
      'jsdoc/reject-function-type': 'off',
      'jsdoc/require-param-description': 'off',
      'jsdoc/require-returns-description': 'off',
    },
  },

  // 3. The config layer is the only place allowed to read process.env
  {
    name: 'project/config-env',
    files: ['src/config/**', 'tests/**'],
    rules: {
      'n/no-process-env': 'off',
    },
  },

  // 4. Manual entrypoints, one-off tools and tests are console programs
  {
    name: 'project/console-scripts',
    files: ['scripts/**', 'src/services/logger.js', 'tests/**'],
    rules: {
      'no-console': 'off',
    },
  },
])
