import { defineConfig } from 'vitest/config'

const config = defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  oxc: {
    target: 'node22',
  },
  test: {
    environment: 'node',
    setupFiles: [
      'core-js/actual/disposable-stack',
      'core-js/actual/async-disposable-stack',
    ],
  },
})
export default config
