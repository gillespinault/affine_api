module.exports = {
  root: true,
  env: {
    node: true,
    es2022: true
  },
  parser: '@typescript-eslint/parser',
  parserOptions: {
    project: ['./tsconfig.json'],
    tsconfigRootDir: __dirname
  },
  plugins: ['@typescript-eslint'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'prettier'
  ],
  ignorePatterns: [
    'dist',
    'affine_source',
    'node_modules',
    '*.config.mjs'
  ],
  rules: {
    '@typescript-eslint/explicit-module-boundary-types': 'off',
    '@typescript-eslint/no-unsafe-assignment': 'off'
  }
};
