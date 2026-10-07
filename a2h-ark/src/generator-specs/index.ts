// The A2H corpus as BenchMarkr generator specs. The specs are plain JSON (data, not code); this module
// only types and exposes them. It does not import BenchMarkr: validation is done by handing a parser
// (BenchMarkr's `parseGeneratorSpec`) to `parseSpecs`, so the ark stays dependency-free.
import corpus from './corpus.json'

export const GENERATOR_SPEC_FORMAT = 'benchmarkr.generator-spec.v1' as const

/** The parts of a spec the ark relies on. The full schema is BenchMarkr's (`generatorSpecSchema`). */
export interface GeneratorSpecDocument {
  format: typeof GENERATOR_SPEC_FORMAT
  id: string
  name: string
  version: string
  description?: string
  datasetKind: string
  serviceRoles: ReadonlyArray<Record<string, unknown>>
  axes: ReadonlyArray<Record<string, unknown>>
  outline?: Record<string, unknown>
  item: Record<string, unknown>
}

export const CORPUS_SPEC_ID = 'a2h-corpus'

/** The corpus spec: domain x topic x length. */
export const corpusSpec = corpus as unknown as GeneratorSpecDocument

/** Every generator spec the ark ships. There is no fixtures spec: fixtures come from the export tool. */
export const specs: readonly GeneratorSpecDocument[] = [corpusSpec]

/** Dataset kinds of the datasets the ark's specs and export tool produce. */
export const CORPUS_DATASET_KIND = 'a2h-corpus'
export const FIXTURES_DATASET_KIND = 'a2h-fixtures'

/** The ids of the three values-axes/entities-axis dimensions every corpus item carries. */
export const CORPUS_DIMENSIONS = { domain: 'domain', topic: 'topic', words: 'words' } as const

type ParseResult<T> = { valid: true; value: T } | { valid: false; issues: ReadonlyArray<{ path: string; message: string }> }

/** Validate every shipped spec with BenchMarkr's `parseGeneratorSpec` (or any parser of its shape). Throws on the first invalid one. */
export function parseSpecs<T>(parse: (input: unknown) => ParseResult<T>): T[] {
  return specs.map(spec => {
    const result = parse(spec)
    if (!result.valid) {
      const summary = result.issues.slice(0, 5).map(i => `${i.path}: ${i.message}`).join('; ')
      throw new Error(`Invalid generator spec ${spec.id}: ${summary}`)
    }
    return result.value
  })
}

export function getSpec(id: string): GeneratorSpecDocument {
  const spec = specs.find(s => s.id === id)
  if (!spec) throw new Error(`No generator spec "${id}". Available: ${specs.map(s => s.id).join(', ')}`)
  return spec
}
