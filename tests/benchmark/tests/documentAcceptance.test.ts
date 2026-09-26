import { describe, it, expect } from 'vitest'
import OpenAI from 'openai'
import { preprocess } from '@/lib/preprocess'
import { chunkFactLockedText } from '@/lib/chunk'
import { humanizeChunk, joinChunkResults } from '@/lib/humanizePipeline'
import { buildDocumentContext, runDocumentConsistencyPass } from '@/lib/document'
import { resolveProvider } from '@/lib/providerResolution'
import { computeReadabilityScore } from '@/lib/detection/diagnostics/readability'
import { measureStyleDiagnostics } from '@/lib/style/measure'
import { corpusByDomain } from '../corpus'

// Phase 10's own acceptance criterion: "terminology consistency >= 99% on
// multi-chunk documents; medical + patient instructions and medical +
// journal manuscript differ in the specified direction on readability and
// terminology metrics." Both halves require real model calls (a document
// analysis pass, real chunk generation, and — for the first — a real
// repair pass), so both stay gated behind the same RUN_LIVE_BENCHMARK
// opt-in as every other acceptance test in this directory.
const LIVE = process.env.RUN_LIVE_BENCHMARK === 'true'
const MAX_GATE_RETRIES = 2
const SAMPLE_SIZE = 8
const PASS_THRESHOLD = 0.9

describe.skipIf(!LIVE)('document context acceptance — Phase 10', () => {
  it(
    'terminology consistency reaches >= 99% on a multi-chunk document that names the same entity two ways',
    async () => {
      const { apiKey, baseURL, model } = resolveProvider(null)
      const client = new OpenAI({ apiKey, baseURL })

      // Three paragraphs, each long enough on its own to become a separate
      // chunk under the small CHUNK_MAX_CHARS below, each referring to the
      // same entity under a different one of its two names — exactly the
      // "consistent rendering across independently-generated chunks"
      // scenario the document context pass exists to fix.
      const paragraphs = [
        'Acme Corporation was founded in 1998 to build reliable industrial sensors. Acme Corporation grew steadily over its first decade, expanding into three new markets and doubling its workforce. Acme Corporation now supplies components to manufacturers across three continents.',
        'The Company reported record revenue in its most recent fiscal year, driven by strong demand in its core sensor product line. The Company also announced a new research partnership intended to accelerate development of its next-generation product family.',
        'Acme Corporation continues to invest heavily in its engineering team, and the Company expects headcount to grow again next year as new contracts are finalized.',
      ]
      const sourceText = paragraphs.join('\n\n')
      const CHUNK_MAX_CHARS_SMALL = 260

      const prep = preprocess(sourceText)
      const chunks = chunkFactLockedText(prep.sanitized_text, prep.fact_locks, CHUNK_MAX_CHARS_SMALL)
      expect(chunks.length).toBeGreaterThan(1)

      const documentContext = await buildDocumentContext(client, model, prep.sanitized_text, null, null)
      console.log('[document context] extracted terminology:', documentContext.terminology)

      const results = []
      for (const chunk of chunks) {
        results.push(await humanizeChunk(
          client, model, chunk.text, chunk.text, chunk.factLocks,
          5, 'balanced', 'business', MAX_GATE_RETRIES,
          null, null, documentContext,
        ))
      }
      const joined = joinChunkResults(results, chunks)
      const consistency = await runDocumentConsistencyPass(client, model, joined, documentContext, results.map(r => r.text))

      expect(consistency.terminologyConsistency).toBeGreaterThanOrEqual(0.99)
    },
    { timeout: 20 * 60 * 1000 },
  )

  it(
    'medical + patient_instructions reads easier and uses shorter sentences than medical + research_paper on >= 90% of sampled items',
    async () => {
      const { apiKey, baseURL, model } = resolveProvider(null)
      const client = new OpenAI({ apiKey, baseURL })
      const items = corpusByDomain('medical').slice(0, SAMPLE_SIZE)

      let easierToRead = 0
      let shorterSentences = 0

      for (const item of items) {
        const prep = preprocess(item.input)
        const patientResult = await humanizeChunk(
          client, model, prep.sanitized_text, prep.sanitized_text, prep.fact_locks,
          5, 'balanced', 'medical', MAX_GATE_RETRIES, 'patient_instructions', null,
        )
        const researchResult = await humanizeChunk(
          client, model, prep.sanitized_text, prep.sanitized_text, prep.fact_locks,
          5, 'balanced', 'medical', MAX_GATE_RETRIES, 'research_paper', null,
        )

        const patientReadability = computeReadabilityScore(patientResult.text)
        const researchReadability = computeReadabilityScore(researchResult.text)
        const patientDiag = measureStyleDiagnostics(patientResult.text)
        const researchDiag = measureStyleDiagnostics(researchResult.text)

        console.log(`[medical genre #${item.id}] readability ${patientReadability} (patient) vs ${researchReadability} (research), ` +
          `sentence_len ${patientDiag.average_sentence_length} vs ${researchDiag.average_sentence_length}`)

        if (patientReadability != null && researchReadability != null && patientReadability > researchReadability) easierToRead++
        if (patientDiag.average_sentence_length < researchDiag.average_sentence_length) shorterSentences++
      }

      const threshold = Math.ceil(items.length * PASS_THRESHOLD)
      expect(easierToRead, 'patient instructions should read easier (higher Flesch score) than a research paper for the same medical content').toBeGreaterThanOrEqual(threshold)
      expect(shorterSentences, 'patient instructions should use shorter sentences than a research paper for the same medical content').toBeGreaterThanOrEqual(threshold)
    },
    { timeout: 20 * 60 * 1000 },
  )
})
