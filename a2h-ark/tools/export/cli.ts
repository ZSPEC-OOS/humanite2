// CLI wiring: reads a JSON/JSONL dump of Humanite's A2H Firestore collections and writes
// corpus.jsonl, fixtures.jsonl and manifest.json.
//
//   npx vite-node tools/export/cli.ts   (or tsx) --dump a2h-dump.json --out out/ [--project <id>] [--fixture-set <id>]
//
// Dump formats (see README): an object { "<collectionName>": [ {doc}, ... ], ... }, or an array / JSONL of
// { "collection": "<name>", "id": "<docId>", "data": {doc} } records.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildExport, serializeExport, type DocFilter, type DocSource, type RawDoc } from './export'

type DumpRecord = { collection: string; id?: string; data?: RawDoc } & RawDoc

/** An in-memory `DocSource` over parsed dump contents. Filters are field-equality, like Firestore `where(.., '==', ..)`. */
export function docSourceFromDump(dump: unknown): DocSource {
  const byCollection = new Map<string, RawDoc[]>()
  const add = (collection: string, doc: RawDoc, id?: string) => {
    const list = byCollection.get(collection) ?? []
    list.push(id !== undefined && doc['id'] === undefined ? { id, ...doc } : doc)
    byCollection.set(collection, list)
  }
  if (Array.isArray(dump)) {
    for (const r of dump as DumpRecord[]) {
      if (!r || typeof r.collection !== 'string') throw new Error('Dump array entries need a "collection" string.')
      if (r.data) add(r.collection, r.data, r.id)
      else { const { collection, ...rest } = r; add(collection, rest as RawDoc) }
    }
  } else if (dump && typeof dump === 'object') {
    for (const [collection, docs] of Object.entries(dump as Record<string, unknown>)) {
      if (!Array.isArray(docs)) throw new Error(`Dump collection "${collection}" must be an array of documents.`)
      for (const d of docs as RawDoc[]) add(collection, d)
    }
  } else throw new Error('The dump must be a JSON object or array.')
  return {
    async listDocs(collection: string, filter?: DocFilter) {
      const docs = byCollection.get(collection) ?? []
      if (!filter) return docs.map(d => ({ ...d }))
      return docs.filter(d => Object.entries(filter).every(([k, v]) => d[k] === v)).map(d => ({ ...d }))
    },
  }
}

export function parseDumpText(text: string, fileName = 'dump.json'): unknown {
  if (fileName.endsWith('.jsonl')) return text.split(/\r?\n/).filter(l => l.trim()).map(l => JSON.parse(l))
  return JSON.parse(text)
}

export interface CliArgs { dump: string; out: string; project?: string; fixtureSet?: string }

export function parseArgs(argv: string[]): CliArgs {
  const args: Record<string, string> = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!
    if (!a.startsWith('--')) throw new Error(`Unexpected argument "${a}".`)
    const v = argv[++i]
    if (v === undefined) throw new Error(`${a} needs a value.`)
    args[a.slice(2)] = v
  }
  const unknown = Object.keys(args).filter(k => !['dump', 'out', 'project', 'fixture-set'].includes(k))
  if (unknown.length) throw new Error(`Unknown option --${unknown[0]}.`)
  if (!args['dump'] || !args['out']) throw new Error('Usage: cli.ts --dump <file.json|file.jsonl> --out <dir> [--project <id>] [--fixture-set <id>]')
  return { dump: args['dump'], out: args['out'], ...(args['project'] ? { project: args['project'] } : {}), ...(args['fixture-set'] ? { fixtureSet: args['fixture-set'] } : {}) }
}

export async function run(argv: string[], log: (s: string) => void = console.log): Promise<number> {
  const args = parseArgs(argv)
  const db = docSourceFromDump(parseDumpText(readFileSync(args.dump, 'utf8'), args.dump))
  const result = await buildExport(db, {
    ...(args.project ? { corpusProjectId: args.project } : {}),
    ...(args.fixtureSet ? { fixtureSetId: args.fixtureSet } : {}),
  })
  for (const w of result.warnings) log(`warning: ${w}`)
  if (!result.ok) {
    for (const e of result.errors) log(`error: ${e}`)
    log(`Export failed with ${result.errors.length} error(s); nothing written.`)
    return 1
  }
  const files = serializeExport(result)
  mkdirSync(args.out, { recursive: true })
  for (const [name, content] of Object.entries(files)) writeFileSync(path.join(args.out, name), content)
  const s = result.summary!
  log(`corpus.jsonl: ${s.corpusItems} items ${JSON.stringify(s.corpusPerDomain)}; lengths ${s.lengths.join(',')}; out of tolerance: ${s.outOfTolerance}`)
  log(`fixtures.jsonl: ${s.fixtures} fixtures ${JSON.stringify(s.fixturesPerType)} (set ${s.fixtureSetId ?? 'none'})`)
  log(`Wrote ${args.out}/{corpus.jsonl,fixtures.jsonl,manifest.json}`)
  return 0
}

// Entry point: `tsx tools/export/cli.ts ...` (argv[1] is this file) or `vite-node tools/export/cli.ts ...`
// (vite-node removes the script name, so argv[1] is its own binary). Never when imported (tests).
const entry = process.argv[1] ? path.resolve(process.argv[1]) : ''
if (!process.env['VITEST'] && (entry === fileURLToPath(import.meta.url) || path.basename(entry).startsWith('vite-node'))) {
  run(process.argv.slice(2)).then(code => process.exit(code), err => { console.error(String(err instanceof Error ? err.message : err)); process.exit(2) })
}
