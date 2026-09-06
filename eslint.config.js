import globals from 'globals';

export default [
  {
    ignores: [
      'node_modules/**',
      'database/**',
      'logs/**',
      'tmp/**',
      'cache/**',
      '.wwebjs_auth/**',
      'coverage/**',
    ],
  },
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: globals.node,
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-undef': 'error',
      'no-constant-condition': 'off',
      'no-useless-catch': 'off',
    },
  },
];
