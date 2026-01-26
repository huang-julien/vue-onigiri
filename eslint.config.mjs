import unjs from 'eslint-config-unjs'
import stylistic from '@stylistic/eslint-plugin'
export default unjs({
  ignores: [
    // ignore paths
    '**/dist',
  ],
  rules: {
    // rule overrides
    'unicorn/no-null': 'off',
    'unicorn/filename-case': 'off',
  },
  markdown: {
    rules: {
      // markdown rule overrides
    },
  },
}, stylistic.configs.recommended)
