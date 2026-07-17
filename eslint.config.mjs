import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['dist/', 'demo/evidence/', 'demo/test-results/', 'tests/golden/', 'coverage/'],
  },
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
);
