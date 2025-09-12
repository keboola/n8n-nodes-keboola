module.exports = {
  root: true,

  extends: ['plugin:n8n-nodes-base/community'],

  ignorePatterns: [
    'dist/',
    'coverage/',
    'lcov.info',
    'vitest.config.ts',
    'vitest.setup.ts',
  ],

  overrides: [
    {
      files: ['**/*.ts'],
      parser: '@typescript-eslint/parser',
      parserOptions: {
        tsconfigRootDir: __dirname,
        project: ['./tsconfig.json'],
      },
    },
    {
      files: ['**/*.js', '**/*.cjs', '**/*.mjs'],
      parser: 'espree',
      parserOptions: { project: null, ecmaVersion: 'latest', sourceType: 'module' },
    },
    {
      files: ['tests/**/*.test.ts', 'vitest.setup.ts'],
      parserOptions: { project: null },
      env: { node: true, 'vitest/globals': true },
    },
  ],
};
