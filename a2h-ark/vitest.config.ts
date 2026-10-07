import { defineConfig } from 'vitest/config'

// The ark is standalone: it never imports from Humanite's src/. The pack layer (src/pack) imports
// BenchMarkr's contracts; set BENCHMARKR_PATH to a BenchMarkr checkout to run those tests here.
import path from 'path'
const benchmarkr = process.env['BENCHMARKR_PATH'] ?? path.resolve(__dirname, '../../benchmarkr')

export default defineConfig({
  css: { postcss: { plugins: [] } },
  test: { environment: 'node', globals: false, include: ['tests/**/*.test.ts'] },
  resolve: {
    alias: {
      '@benchmarkr/core': path.join(benchmarkr, 'packages/core/src/index.ts'),
      '@benchmarkr/contracts': path.join(benchmarkr, 'packages/contracts/src/index.ts'),
    },
  },
})
