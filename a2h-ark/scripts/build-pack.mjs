// Builds the A2H pack into one ES module that BenchMarkr can load through BENCHMARKR_PACKS.
//
//   npm run build:pack            ->  dist/pack.mjs
//
// Everything the pack needs is bundled (the ark's scoring, the vendored Humanite code, the `diff` package and the
// generator spec JSON) EXCEPT `@benchmarkr/core` and `@benchmarkr/contracts`: the pack must share the very same
// module instances as the BenchMarkr server (error classes are matched with `instanceof`), so it imports them at
// run time and Node must be able to resolve them from where the file is installed (see TRANSFER notes below).
import { build } from 'esbuild'
import { mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const outfile = process.env.A2H_PACK_OUT ?? resolve(root, 'dist/pack.mjs')
await mkdir(dirname(outfile), { recursive: true })

const result = await build({
  absWorkingDir: root,
  entryPoints: ['src/pack/index.ts'],
  outfile,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  external: ['@benchmarkr/core', '@benchmarkr/contracts'],
  loader: { '.json': 'json' },
  legalComments: 'none',
  logLevel: 'info',
  metafile: true,
  // Lets bundled CommonJS dependencies (`diff`) use require() inside an ES module.
  banner: { js: "import { createRequire as __a2hCreateRequire } from 'node:module'; const require = __a2hCreateRequire(import.meta.url);" },
})

const externals = new Set()
for (const output of Object.values(result.metafile.outputs)) {
  for (const imported of output.imports) if (imported.external) externals.add(imported.path)
}
console.log(`pack: ${outfile}`)
console.log(`runtime imports: ${[...externals].sort().join(', ')}`)
