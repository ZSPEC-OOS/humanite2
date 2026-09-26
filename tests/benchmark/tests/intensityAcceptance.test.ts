import { describe, it, expect } from 'vitest'
import OpenAI from 'openai'
import { preprocess } from '@/lib/preprocess'
import { chunkFactLockedText } from '@/lib/chunk'
import { humanizeChunk, aggregateChunkResults, joinChunkResults } from '@/lib/humanizePipeline'
import { resolveProvider } from '@/lib/providerResolution'
import { measureIntensity } from '@/lib/evaluation/intensity'
import { CORPUS } from '../corpus'

// Phase 4's own acceptance criterion: "mean transformation magnitude
// strictly increases from I1 to I10 across the corpus, with fidelity pass
// rate >= 98% at every level." Requires real model calls — the whole point
// is measuring what the model actually produces at each level — so it's
// gated behind the same RUN_LIVE_BENCHMARK opt-in as the other live
// acceptance tests.
const LIVE = process.env.RUN_LIVE_BENCHMARK === 'true'
const CHUNK_MAX_CHARS = 24_000
const MAX_GATE_RETRIES = 2
// Small by necessity (10 levels x this many items x up to 3 attempts each
// is already a lot of real calls) — a mean over this few items is more
// exposed to per-call sampling noise than a full-corpus run would be. A
// real go/no-go read of this criterion belongs in the Phase 11 scale-up,
// with a much larger N; this smoke-sized run is what's practical to gate
// behind a routine RUN_LIVE_BENCHMARK invocation.
const SAMPLE_SIZE = 4

describe.skipIf(!LIVE)('intensity acceptance — monotonic transformation magnitude, fidelity holds at every level', () => {
  it(
    'mean transformation magnitude strictly increases from I1 to I10; fidelity pass rate >= 98% at every level',
    async () => {
      const { apiKey, baseURL, model } = resolveProvider(null)
      const client = new OpenAI({ apiKey, baseURL })
      // domain=general has no intensity cap (see DOMAIN_INTENSITY_CAPS) —
      // holding domain constant here means every one of the 10 requested
      // levels reaches the model unclamped, isolating the intensity axis
      // from the domain-cap mechanism (checked separately, and without
      // needing live calls, in effectiveIntensity.test.ts).
      const items = CORPUS.filter(i => i.domain === 'general').slice(0, SAMPLE_SIZE)

      const meanMagnitudeByLevel: number[] = []
      const passRateByLevel: number[] = []

      for (let level = 1; level <= 10; level++) {
        let magnitudeSum = 0
        let passCount = 0

        for (const item of items) {
          const prep = preprocess(item.input)
          const chunks = chunkFactLockedText(prep.sanitized_text, prep.fact_locks, CHUNK_MAX_CHARS)
          const results = []
          for (const chunk of chunks) {
            results.push(await humanizeChunk(
              client, model, chunk.text, chunk.text, chunk.factLocks,
              level, 'balanced', item.domain, MAX_GATE_RETRIES,
            ))
          }
          const outputText = joinChunkResults(results, chunks)
          const agg = aggregateChunkResults(results)
          const metrics = measureIntensity(item.input, outputText, prep.fact_locks.map(l => l.text))

          magnitudeSum += metrics.transformationMagnitude
          if (agg.passed) passCount++
        }

        meanMagnitudeByLevel.push(magnitudeSum / items.length)
        passRateByLevel.push(passCount / items.length)
      }

      console.log('mean transformation magnitude by level:', meanMagnitudeByLevel)
      console.log('fidelity pass rate by level:', passRateByLevel)

      for (let level = 2; level <= 10; level++) {
        expect(
          meanMagnitudeByLevel[level - 1]!,
          `level ${level} (${meanMagnitudeByLevel[level - 1]}) should exceed level ${level - 1} (${meanMagnitudeByLevel[level - 2]})`,
        ).toBeGreaterThan(meanMagnitudeByLevel[level - 2]!)
      }

      for (let level = 1; level <= 10; level++) {
        expect(passRateByLevel[level - 1]!, `fidelity pass rate at level ${level}`).toBeGreaterThanOrEqual(0.98)
      }
    },
    { timeout: 60 * 60 * 1000 },
  )
})
