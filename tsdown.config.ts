import { defineConfig } from 'tsdown'

const config = defineConfig({
  entry: {
    index: './src/index.ts',
    'select-mode': './src/select-mode/index.ts',
    version: './src/version/index.ts',
    pack: './src/pack/index.ts',
    publish: './src/publish/index.ts',
    'pr-status': './src/pr-status/index.ts',
    'pr-comment': './src/pr-comment/index.ts',
  },
  format: ['esm'],
  outExtensions: () => ({ js: '.js' }),
  clean: true,
  sourcemap: 'inline',
  minify: true,
  outputOptions: {
    chunkFileNames: 'chunks/[name]-[hash].js',
  },
})
export default config
