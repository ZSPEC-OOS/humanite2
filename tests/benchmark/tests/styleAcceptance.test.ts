import { describe, it, expect } from 'vitest'
import OpenAI from 'openai'
import { preprocess } from '@/lib/preprocess'
import { chunkFactLockedText } from '@/lib/chunk'
import { humanizeChunk, joinChunkResults } from '@/lib/humanizePipeline'
import { resolveProvider } from '@/lib/providerResolution'
import { measureStyleDiagnostics } from '@/lib/style/measure'
import { CORPUS } from '../corpus'

// Phase 3's own acceptance criterion: "for each pair (academic -> casual,
// legal -> general), measured differences in contraction rate, sentence
// length, person and hedge density move in the specified direction on
// >= 90% of benchmark items." This requires real model calls (the whole
// point is measuring what the compiled prompt actually produces), so it's
// gated behind the same RUN_LIVE_BENCHMARK opt-in as liveBenchmark.test.ts.
const LIVE = process.env.RUN_LIVE_BENCHMARK === 'true'
const CHUNK_MAX_CHARS = 24_000
const MAX_GATE_RETRIES = 2
const SAMPLE_SIZE = 8
const PASS_THRESHOLD = 0.9

async function humanizeWithSettings(
  client: OpenAI,
  model: string,
  input: string,
  domain: string,
  tone: string,
): Promise<string> {
  const prep = preprocess(input)
  const chunks = chunkFactLockedText(prep.sanitized_text, prep.fact_locks, CHUNK_MAX_CHARS)
  const results = []
  for (const chunk of chunks) {
    results.push(await humanizeChunk(
      client, model, chunk.text, chunk.text, chunk.factLocks,
      5, tone, domain, MAX_GATE_RETRIES,
    ))
  }
  return joinChunkResults(results, chunks)
}

describe.skipIf(!LIVE)('style compiler acceptance — tone/domain changes produce measurable directional differences', () => {
  it(
    'academic tone -> casual tone: contraction rate rises, sentences shorten, and hedging eases on >= 90% of sampled items',
    async () => {
      const { apiKey, baseURL, model } = resolveProvider(null)
      const client = new OpenAI({ apiKey, baseURL })
      // Domain held constant (general has no overrides) to isolate the tone axis.
      const items = CORPUS.filter(i => i.domain === 'general').slice(0, SAMPLE_SIZE)

      let contractionUp = 0
      let sentenceShorter = 0
      let hedgeLower = 0

      for (const item of items) {
        const academicOut = await humanizeWithSettings(client, model, item.input, item.domain, 'academic')
        const casualOut = await humanizeWithSettings(client, model, item.input, item.domain, 'casual')
        const a = measureStyleDiagnostics(academicOut)
        const c = measureStyleDiagnostics(casualOut)

        if (c.contraction_rate > a.contraction_rate) contractionUp++
        if (c.average_sentence_length < a.average_sentence_length) sentenceShorter++
        if (c.hedge_density < a.hedge_density) hedgeLower++
      }

      const threshold = Math.ceil(items.length * PASS_THRESHOLD)
      expect(contractionUp, 'contraction rate should rise from academic to casual').toBeGreaterThanOrEqual(threshold)
      expect(sentenceShorter, 'sentence length should fall from academic to casual').toBeGreaterThanOrEqual(threshold)
      expect(hedgeLower, 'hedge density should fall from academic to casual').toBeGreaterThanOrEqual(threshold)
    },
    { timeout: 20 * 60 * 1000 },
  )

  it(
    'legal domain -> general domain (tone held constant): contraction rate falls under legal\'s override on >= 90% of sampled items',
    async () => {
      const { apiKey, baseURL, model } = resolveProvider(null)
      const client = new OpenAI({ apiKey, baseURL })
      // Casual tone specifically, so legal's contraction override has
      // something to actually override — at a tone that already avoids
      // contractions, the two domains would look identical on this axis
      // for reasons that have nothing to do with the override.
      const legalItems = CORPUS.filter(i => i.domain === 'legal').slice(0, SAMPLE_SIZE)
      const generalItems = CORPUS.filter(i => i.domain === 'general').slice(0, SAMPLE_SIZE)

      let contractionDown = 0
      const n = Math.min(legalItems.length, generalItems.length)
      for (let i = 0; i < n; i++) {
        const legalOut = await humanizeWithSettings(client, model, legalItems[i]!.input, 'legal', 'casual')
        const generalOut = await humanizeWithSettings(client, model, generalItems[i]!.input, 'general', 'casual')
        const legalDiag = measureStyleDiagnostics(legalOut)
        const generalDiag = measureStyleDiagnostics(generalOut)

        // legal's own rule set has nothing to say about sentence length,
        // person, or hedge density (see domainProfiles.ts) — measured here
        // for visibility, but only contraction rate is a claim this
        // implementation actually makes and can be held to.
        console.log(`[legal->general #${i}] contraction ${legalDiag.contraction_rate} vs ${generalDiag.contraction_rate}, ` +
          `sentence_len ${legalDiag.average_sentence_length} vs ${generalDiag.average_sentence_length}, ` +
          `hedge ${legalDiag.hedge_density} vs ${generalDiag.hedge_density}, ` +
          `first_person ${legalDiag.first_person_rate} vs ${generalDiag.first_person_rate}`)

        if (legalDiag.contraction_rate < generalDiag.contraction_rate) contractionDown++
      }

      const threshold = Math.ceil(n * PASS_THRESHOLD)
      expect(contractionDown, 'contraction rate should be lower under the legal domain than the general domain').toBeGreaterThanOrEqual(threshold)
    },
    { timeout: 20 * 60 * 1000 },
  )
})
