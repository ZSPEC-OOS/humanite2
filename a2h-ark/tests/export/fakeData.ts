// Fake in-memory Humanite corpus + fixtures for the export tests. Texts have exact word counts.
import { DOMAINS, type Domain } from '../../src/vendor/style/types'
import { A2H_COLLECTIONS } from '../../src/shared/types'
import { createHash } from 'node:crypto'
import type { DocFilter, DocSource, RawDoc } from '../../tools/export/export'

export const PROJECT_ID = 'proj1'
export const LADDER = [100, 200, 500] as const

export function text(words: number, tag = 'w'): string {
  return Array.from({ length: words }, (_, i) => `${tag}${i}`).join(' ') + '.'
}

export function makeDump(opts: { topicsPerDomain?: number; ladder?: readonly number[]; skewWords?: Record<string, number> } = {}): Record<string, RawDoc[]> {
  const topicsPerDomain = opts.topicsPerDomain ?? 3
  const ladder = opts.ladder ?? LADDER
  const projects: RawDoc[] = [{
    id: PROJECT_ID, name: 'Fake', benchmarkVersion: 'A2H-BV001', corpusVersion: 'CORPUS-V001', domains: [...DOMAINS],
    topicCountDefault: topicsPerDomain, topicCountOverrides: {}, topicCountByDomain: {}, lengthLadder: [...ladder],
    status: 'frozen', createdAt: 't', updatedAt: 't', frozenAt: 't',
  }]
  const topics: RawDoc[] = []
  const sources: RawDoc[] = []
  for (const d of DOMAINS) {
    for (let n = 1; n <= topicsPerDomain; n++) {
      const topicId = `tp_${d}_${n}`
      topics.push({
        id: topicId, corpusProjectId: PROJECT_ID, domainId: d, topicNumber: n, title: `${d} topic ${n}`, description: 'Scope.',
        intendedAudience: 'General readers', writingType: 'Overview', coreConcepts: ['a', 'b'], generationPromptVersion: 'GEN-V001', enabled: true,
        createdAt: 't', updatedAt: 't',
      })
      for (const target of ladder) {
        const id = `${PROJECT_ID}__${topicId}__${target}`
        const words = opts.skewWords?.[id] ?? target
        const body = text(words, `${d[0]}${n}`)
        sources.push({
          id, corpusProjectId: PROJECT_ID, domainId: d as Domain, topicId, targetWords: target, actualWords: words,
          generatorProvider: 'p', generatorModel: 'm', generationPrompt: 'prompt', generationPromptVersion: 'GEN-V001',
          temperature: null, seed: null, text: body, sha256: createHash('sha256').update(body).digest('hex'),
          generatedAt: 't', frozenAt: 't', status: 'frozen',
        })
      }
    }
  }
  const fixtureSets: RawDoc[] = [
    { id: 'fs1', corpusProjectId: PROJECT_ID, name: 'v1', fixtureVersion: 'FIXTURE-V001', status: 'locked', createdAt: 't', updatedAt: 't', lockedAt: 't' },
    { id: 'fs2', corpusProjectId: PROJECT_ID, name: 'v2', fixtureVersion: 'FIXTURE-V002', status: 'locked', createdAt: 't', updatedAt: 't', lockedAt: 't' },
    { id: 'fs3', corpusProjectId: PROJECT_ID, name: 'v3 draft', fixtureVersion: 'FIXTURE-V003', status: 'draft', createdAt: 't', updatedAt: 't', lockedAt: null },
  ]
  const grammar = (n: number): Record<string, unknown> => ({
    cleanText: `Sentence ${n} where the system works.`, corruptedText: `Sentence ${n} where the system work.`,
    category: 'subject_verb_agreement', incorrectText: 'work', expectedCorrection: 'works', anchorText: 'work',
  })
  const fixtures: RawDoc[] = ['general', 'legal'].flatMap(d => [0, 1].map(ord => ({
    id: `fx_${d}_${ord}_v2`, fixtureSetId: 'fs2', corpusProjectId: PROJECT_ID, sourceId: `${PROJECT_ID}__tp_${d}_1__${ladder[0]}`, type: 'grammar_repair',
    ordinal: ord, expected: grammar(ord), sourceStart: null, sourceEnd: null, sourceText: null, notes: null, corruptionGeneratorVersion: 'GRAMMAR-CORRUPT-V1',
    createdAt: 't', updatedAt: 't',
  })))
  fixtures.push({ id: 'fx_old', fixtureSetId: 'fs1', corpusProjectId: PROJECT_ID, sourceId: `${PROJECT_ID}__tp_general_1__${ladder[0]}`, type: 'grammar_repair', ordinal: 0, expected: grammar(9), sourceStart: null, sourceEnd: null, sourceText: null, notes: null, corruptionGeneratorVersion: null, createdAt: 't', updatedAt: 't' })
  return {
    [A2H_COLLECTIONS.projects]: projects, [A2H_COLLECTIONS.topics]: topics, [A2H_COLLECTIONS.sources]: sources,
    [A2H_COLLECTIONS.fixtureSets]: fixtureSets, [A2H_COLLECTIONS.fixtures]: fixtures,
  }
}

/** A DocSource over a plain object, with equality filters (what the CLI's dump source does too). */
export function memorySource(dump: Record<string, RawDoc[]>): DocSource {
  return {
    async listDocs(collection: string, filter?: DocFilter) {
      const docs = dump[collection] ?? []
      return docs.filter(d => !filter || Object.entries(filter).every(([k, v]) => d[k] === v)).map(d => structuredClone(d))
    },
  }
}
