// The A2H pack: the entry module BenchMarkr loads (BENCHMARKR_PACKS). It carries the target adapter, the benchmark
// package and the corpus generator spec.
//
// Build and load:
//   npm run build:pack                         -> dist/pack.mjs (one file; `diff`, the scoring and the spec are bundled)
//   BENCHMARKR_PACKS=/abs/path/to/pack.mjs     -> the server imports it at startup
// The file imports `@benchmarkr/core` and `@benchmarkr/contracts` at run time and must share the server's instances
// of them (errors are matched with instanceof), so install it where Node resolves those packages: inside the
// BenchMarkr checkout (any directory under it), or in a directory whose node_modules links to the checkout's.
import { definePack, type BenchmarkrPack } from '@benchmarkr/contracts'
import { specs } from '../generator-specs/index'
import { createA2hTargetAdapter } from './adapter'
import { createA2hBenchmarkPackage } from './package'
import { PACK_ID, PACK_VERSION } from './util'

export { createA2hTargetAdapter } from './adapter'
export { createA2hBenchmarkPackage } from './package'
export type { PackOptions } from './suite'

export function createA2hPack(): BenchmarkrPack {
  return definePack({
    packId: PACK_ID,
    name: 'Humanite A2H benchmark',
    version: PACK_VERSION,
    targetAdapters: [createA2hTargetAdapter()],
    benchmarkPackages: [createA2hBenchmarkPackage()],
    generatorSpecs: specs,
  })
}

export default createA2hPack
