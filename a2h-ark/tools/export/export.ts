// Export of Humanite's stored A2H corpus and fixtures into BenchMarkr dataset files (JSONL).
//
// Standalone: Firestore is reached only through the injected `DocSource` interface (`listDocs`), so this
// module has no Firestore, OpenAI or Next dependency. The CLI (cli.ts) wires it to a JSON dump file.
import { createHash } from 'node:crypto'
import { A2H_COLLECTIONS, type BenchmarkFixture, type BenchmarkTopic, type CorpusProject, type CorpusSource, type FixtureSet } from '../../src/shared/types'
import { DOMAINS, type Domain } from '../../src/vendor/style/types'
import { isWithinTolerance, toleranceFor, wordCount } from '../../src/scoring/corpus'
import { VALID_TYPES, validateExpectedShape, versionNumberOf } from '../../src/scoring/fixtures'

// ── The only door to Firestore ─────────────────────────────────────────────

export type DocFilter = Readonly<Record<string, string | number | boolean | null>>
export type RawDoc = Record<string, unknown>

export interface DocSource {
  /** Every document of `collection` whose fields equal every entry of `filter` (all documents when omitted). */
  listDocs(collection: string, filter?: DocFilter): Promise<RawDoc[]>
}

// ── Output shapes (BenchMarkr dataset item inputs; the hash is computed on import) ──

export interface DatasetItemOut {
  key: string
  dimensions: Record<string, string | number>
  content: Record<string, unknown>
  provenance: Record<string, unknown>
}

/** content of a corpus item. `sourceId` is the BenchMarkr key; `humaniteSourceId` is the original document id. */
export interface CorpusContent {
  sourceId: string
  humaniteSourceId: string
  domain: Domain
  topicId: string
  topicNumber: number
  title: string
  description: string
  intendedAudience: string
  writingType: string
  coreConcepts: string[]
  targetWords: number
  text: string
  wordCount: number
}

export interface FixtureContent {
  fixtureId: string
  sourceId: string
  humaniteSourceId: string
  type: string
  ordinal: number
  expected: Record<string, unknown>
  cleanText?: string
  corruptedText?: string
  sourceStart: number | null
  sourceEnd: number | null
  sourceText: string | null
  notes: string | null
  corruptionGeneratorVersion: string | null
}

export interface ExportOptions {
  /** Corpus project to export; required when the data holds more than one frozen project. */
  corpusProjectId?: string
  /** Fixture set to export; default is the highest-versioned locked set of the project. */
  fixtureSetId?: string
}

export interface ExportResult {
  ok: boolean
  /** Problems that stop the export (nothing is written). */
  errors: string[]
  /** Reported, not enforced: word count outside tolerance, hash mismatches, skipped sources. */
  warnings: string[]
  corpus: DatasetItemOut[]
  fixtures: DatasetItemOut[]
  /** Counts etc.; present whenever a project was selected. */
  summary: ExportSummary | null
}

export interface ExportSummary {
  corpusProjectId: string
  corpusVersion: string
  benchmarkVersion: string
  fixtureSetId: string | null
  fixtureVersion: string | null
  corpusItems: number
  corpusPerDomain: Record<string, number>
  lengths: number[]
  outOfTolerance: number
  fixtures: number
  fixturesPerType: Record<string, number>
}

// ── Keys ───────────────────────────────────────────────────────────────────

/** The corpus item key; identical to the key the `a2h-corpus` generator spec produces: `domain__topicNumber__words`. */
export function corpusItemKey(domain: string, topicNumber: number, targetWords: number): string {
  return `${domain}__${topicNumber}__${targetWords}`
}

export function fixtureItemKey(corpusKey: string, type: string, ordinal: number): string {
  return `${corpusKey}__${type}__${ordinal}`
}

const KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/

// ── Build ──────────────────────────────────────────────────────────────────

const str = (v: unknown): string => (typeof v === 'string' ? v : '')

export async function buildExport(db: DocSource, options: ExportOptions = {}): Promise<ExportResult> {
  const errors: string[] = []
  const warnings: string[] = []
  const fail = (): ExportResult => ({ ok: false, errors, warnings, corpus: [], fixtures: [], summary: null })

  // 1. project
  const projects = (await db.listDocs(A2H_COLLECTIONS.projects)) as unknown as CorpusProject[]
  let project: CorpusProject | undefined
  if (options.corpusProjectId) {
    project = projects.find(p => p.id === options.corpusProjectId)
    if (!project) errors.push(`Corpus project "${options.corpusProjectId}" not found.`)
    else if (project.status !== 'frozen') warnings.push(`Corpus project "${project.id}" is ${project.status}, not frozen; only frozen sources are exported.`)
  } else {
    const frozen = projects.filter(p => p.status === 'frozen')
    if (frozen.length === 1) project = frozen[0]
    else errors.push(frozen.length === 0 ? 'No frozen corpus project found; pass corpusProjectId.' : `Several frozen corpus projects (${frozen.map(p => p.id).join(', ')}); pass corpusProjectId.`)
  }
  if (!project) return fail()
  const projectId = project.id

  // 2. corpus
  const topics = (await db.listDocs(A2H_COLLECTIONS.topics, { corpusProjectId: projectId })) as unknown as BenchmarkTopic[]
  const topicById = new Map(topics.map(t => [t.id, t]))
  const sources = (await db.listDocs(A2H_COLLECTIONS.sources, { corpusProjectId: projectId })) as unknown as CorpusSource[]

  const corpus: DatasetItemOut[] = []
  const keyBySourceId = new Map<string, { key: string; domain: Domain; topicNumber: number; targetWords: number }>()
  const seenKeys = new Set<string>()
  const perDomain: Record<string, number> = {}
  const lengths = new Set<number>()
  let outOfTolerance = 0

  for (const s of [...sources].sort((a, b) => a.id.localeCompare(b.id))) {
    if (s.status !== 'frozen') {
      warnings.push(`Source ${s.id} is ${s.status}, not frozen; skipped.`)
      continue
    }
    const topic = topicById.get(s.topicId)
    if (!topic) { errors.push(`Source ${s.id}: topic ${s.topicId} not found in project ${projectId}.`); continue }
    if (!(DOMAINS as readonly string[]).includes(s.domainId)) { errors.push(`Source ${s.id}: unknown domain "${s.domainId}".`); continue }
    if (!Number.isInteger(topic.topicNumber) || topic.topicNumber < 1) { errors.push(`Source ${s.id}: topic ${topic.id} has no valid topicNumber.`); continue }
    if (typeof s.text !== 'string' || !s.text.trim()) { errors.push(`Source ${s.id}: empty text.`); continue }
    if (!Number.isInteger(s.targetWords) || s.targetWords <= 0) { errors.push(`Source ${s.id}: invalid targetWords.`); continue }

    const key = corpusItemKey(s.domainId, topic.topicNumber, s.targetWords)
    if (!KEY_PATTERN.test(key)) { errors.push(`Source ${s.id}: key "${key}" is not a valid dataset item key.`); continue }
    if (seenKeys.has(key)) { errors.push(`Duplicate corpus key "${key}" (source ${s.id}).`); continue }
    seenKeys.add(key)

    const words = wordCount(s.text)
    if (words !== s.actualWords) warnings.push(`Source ${s.id}: stored actualWords ${s.actualWords} differs from recomputed ${words}.`)
    if (s.sha256 && createHash('sha256').update(s.text).digest('hex') !== s.sha256) warnings.push(`Source ${s.id}: text does not match its stored sha256.`)
    if (!isWithinTolerance(s.targetWords, words)) {
      outOfTolerance++
      warnings.push(`Source ${s.id} (${key}): ${words} words is outside ±${(toleranceFor(s.targetWords) * 100).toFixed(0)}% of ${s.targetWords}.`)
    }

    const content: CorpusContent = {
      sourceId: key,
      humaniteSourceId: s.id,
      domain: s.domainId,
      topicId: s.topicId,
      topicNumber: topic.topicNumber,
      title: topic.title,
      description: topic.description,
      intendedAudience: topic.intendedAudience,
      writingType: topic.writingType,
      coreConcepts: [...topic.coreConcepts],
      targetWords: s.targetWords,
      text: s.text,
      wordCount: words,
    }
    corpus.push({
      key,
      dimensions: { domain: s.domainId, topic: topic.topicNumber, words: s.targetWords },
      content: content as unknown as Record<string, unknown>,
      provenance: {
        producer: 'a2h-ark/export',
        humanite: {
          corpusProjectId: projectId,
          corpusVersion: project.corpusVersion,
          benchmarkVersion: project.benchmarkVersion,
          sourceId: s.id,
          sha256: s.sha256 ?? null,
          generatorProvider: s.generatorProvider ?? null,
          generatorModel: s.generatorModel ?? null,
          generationPromptVersion: s.generationPromptVersion ?? null,
          generationPrompt: s.generationPrompt ?? null,
          temperature: s.temperature ?? null,
          generatedAt: s.generatedAt ?? null,
          frozenAt: s.frozenAt ?? null,
        },
      },
    })
    keyBySourceId.set(s.id, { key, domain: s.domainId, topicNumber: topic.topicNumber, targetWords: s.targetWords })
    perDomain[s.domainId] = (perDomain[s.domainId] ?? 0) + 1
    lengths.add(s.targetWords)
  }
  if (corpus.length === 0 && errors.length === 0) errors.push(`Project ${projectId} has no frozen sources.`)

  // 3. fixtures
  const fixtures: DatasetItemOut[] = []
  const perType: Record<string, number> = {}
  let set: FixtureSet | undefined
  const sets = (await db.listDocs(A2H_COLLECTIONS.fixtureSets, { corpusProjectId: projectId })) as unknown as FixtureSet[]
  if (options.fixtureSetId) {
    set = sets.find(x => x.id === options.fixtureSetId)
    if (!set) errors.push(`Fixture set "${options.fixtureSetId}" not found for project ${projectId}.`)
    else if (set.status !== 'locked') warnings.push(`Fixture set ${set.id} is ${set.status}, not locked.`)
  } else {
    const locked = sets.filter(x => x.status === 'locked').sort((a, b) => versionNumberOf(b.fixtureVersion) - versionNumberOf(a.fixtureVersion) || a.id.localeCompare(b.id))
    set = locked[0]
    if (!set) warnings.push(`Project ${projectId} has no locked fixture set; fixtures.jsonl will be empty.`)
  }
  if (set) {
    const docs = (await db.listDocs(A2H_COLLECTIONS.fixtures, { fixtureSetId: set.id })) as unknown as BenchmarkFixture[]
    const seenFixtureKeys = new Set<string>()
    for (const f of [...docs].sort((a, b) => a.id.localeCompare(b.id))) {
      const label = `Fixture ${f.id}`
      if (!(VALID_TYPES as readonly string[]).includes(f.type)) { errors.push(`${label}: unknown type "${str(f.type)}".`); continue }
      const shape = validateExpectedShape(f.type, f.expected ?? {})
      if (shape.length > 0) { errors.push(`${label} (${f.type}): invalid expected: ${shape.join(' ')}`); continue }
      const src = keyBySourceId.get(f.sourceId)
      if (!src) { errors.push(`${label}: source ${f.sourceId} is not an exported (frozen) source of project ${projectId}.`); continue }
      const key = fixtureItemKey(src.key, f.type, f.ordinal)
      if (!KEY_PATTERN.test(key)) { errors.push(`${label}: key "${key}" is not a valid dataset item key.`); continue }
      if (seenFixtureKeys.has(key)) { errors.push(`Duplicate fixture key "${key}" (fixture ${f.id}).`); continue }
      seenFixtureKeys.add(key)
      const expected = f.expected as Record<string, unknown>
      const content: FixtureContent = {
        fixtureId: f.id,
        sourceId: src.key,
        humaniteSourceId: f.sourceId,
        type: f.type,
        ordinal: f.ordinal,
        expected,
        ...(typeof expected['cleanText'] === 'string' ? { cleanText: expected['cleanText'] } : {}),
        ...(typeof expected['corruptedText'] === 'string' ? { corruptedText: expected['corruptedText'] } : {}),
        sourceStart: f.sourceStart ?? null,
        sourceEnd: f.sourceEnd ?? null,
        sourceText: f.sourceText ?? null,
        notes: f.notes ?? null,
        corruptionGeneratorVersion: f.corruptionGeneratorVersion ?? null,
      }
      fixtures.push({
        key,
        dimensions: { type: f.type, domain: src.domain, topic: src.topicNumber, words: src.targetWords, ordinal: f.ordinal },
        content: content as unknown as Record<string, unknown>,
        provenance: {
          producer: 'a2h-ark/export',
          humanite: { corpusProjectId: projectId, fixtureSetId: set.id, fixtureVersion: set.fixtureVersion, fixtureId: f.id },
        },
      })
      perType[f.type] = (perType[f.type] ?? 0) + 1
    }
  }

  // deterministic order: by key (BenchMarkr's own export order)
  const byKey = (a: DatasetItemOut, b: DatasetItemOut) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)
  corpus.sort(byKey)
  fixtures.sort(byKey)

  const summary: ExportSummary = {
    corpusProjectId: projectId,
    corpusVersion: project.corpusVersion,
    benchmarkVersion: project.benchmarkVersion,
    fixtureSetId: set?.id ?? null,
    fixtureVersion: set?.fixtureVersion ?? null,
    corpusItems: corpus.length,
    corpusPerDomain: sortedRecord(perDomain),
    lengths: [...lengths].sort((a, b) => a - b),
    outOfTolerance,
    fixtures: fixtures.length,
    fixturesPerType: sortedRecord(perType),
  }
  return { ok: errors.length === 0, errors, warnings, corpus, fixtures, summary }
}

function sortedRecord(r: Record<string, number>): Record<string, number> {
  return Object.fromEntries(Object.entries(r).sort(([a], [b]) => (a < b ? -1 : 1)))
}

// ── Serialization ──────────────────────────────────────────────────────────

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, v]) => [k, sortKeysDeep(v)]))
  }
  return value
}

/** One JSON object per line, keys sorted, trailing newline; byte-identical for identical input. */
export function toJsonl(items: readonly DatasetItemOut[]): string {
  return items.map(i => JSON.stringify(sortKeysDeep(i))).join('\n') + (items.length > 0 ? '\n' : '')
}

export interface ExportFiles {
  'corpus.jsonl': string
  'fixtures.jsonl': string
  'manifest.json': string
}

export const MANIFEST_FORMAT = 'a2h-ark.export-manifest.v1'

/** Serialize a successful result to the three files (contents only; no I/O, no clock). */
export function serializeExport(result: ExportResult): ExportFiles {
  if (!result.ok || !result.summary) throw new Error('Cannot serialize a failed export.')
  const corpus = toJsonl(result.corpus)
  const fixtures = toJsonl(result.fixtures)
  const file = (text: string, lines: number) => ({ sha256: createHash('sha256').update(text).digest('hex'), bytes: Buffer.byteLength(text), lines })
  const manifest = {
    format: MANIFEST_FORMAT,
    source: {
      corpusProjectId: result.summary.corpusProjectId,
      corpusVersion: result.summary.corpusVersion,
      benchmarkVersion: result.summary.benchmarkVersion,
      fixtureSetId: result.summary.fixtureSetId,
      fixtureVersion: result.summary.fixtureVersion,
    },
    counts: {
      corpusItems: result.summary.corpusItems,
      corpusPerDomain: result.summary.corpusPerDomain,
      lengths: result.summary.lengths,
      outOfTolerance: result.summary.outOfTolerance,
      fixtures: result.summary.fixtures,
      fixturesPerType: result.summary.fixturesPerType,
      warnings: result.warnings.length,
    },
    files: {
      'corpus.jsonl': file(corpus, result.corpus.length),
      'fixtures.jsonl': file(fixtures, result.fixtures.length),
    },
  }
  return { 'corpus.jsonl': corpus, 'fixtures.jsonl': fixtures, 'manifest.json': JSON.stringify(sortKeysDeep(manifest), null, 2) + '\n' }
}
