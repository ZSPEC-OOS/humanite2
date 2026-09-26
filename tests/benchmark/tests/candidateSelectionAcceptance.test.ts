import { describe, it, expect } from 'vitest'
import OpenAI from 'openai'
import { preprocess, type FactLock } from '@/lib/preprocess'
import { postprocess } from '@/lib/postprocess'
import {
  humanizeChunk, buildUserPrompt, maxTokensForIntensity, SYSTEM_PROMPT, type ChunkResult,
} from '@/lib/humanizePipeline'
import { runStructuredJudge } from '@/lib/evaluation/judge'
import { measureIntensity } from '@/lib/evaluation/intensity'
import { evaluateIntensityAlignment } from '@/lib/evaluation/styleEvaluators'
import { computeScore } from '@/lib/selection'
import { resolveProvider } from '@/lib/providerResolution'
import { instrumentClient } from '../runBenchmark'
import { CORPUS } from '../corpus'

// Phase 8's own acceptance criterion: "selected output beats a single
// candidate on the combined benchmark score at intensity >= 7, within the
// budget." Requires real model calls on both sides of the comparison — the
// whole point is measuring whether the candidate-search-and-select
// mechanism actually beats a single generation attempt — so this is gated
// behind the same RUN_LIVE_BENCHMARK opt-in as the other live acceptance
// tests.
const LIVE = process.env.RUN_LIVE_BENCHMARK === 'true'
const INTENSITY = 8 // >= 7: candidateCountForIntensity gives 3 candidates plus a planning call
const MAX_GATE_RETRIES = 2
const SAMPLE_SIZE = 6
// intensity 7-10's own budget ceiling (see the plan's Budget section) —
// checked here as a mean across the sample, not a hard per-call breaker.
const MAX_MEAN_CALLS_PER_CHUNK = 9

// The same weighted combination selectBestCandidate ranks candidates by —
// scores a ChunkResult that already went through the full pipeline
// (repair, claim verification) rather than a raw candidate, so this
// compares final shipped quality, not just the pre-repair winner.
function scoreChunkResult(result: ChunkResult): number | null {
  if (!result.gate) return null
  return computeScore({
    naturalness: result.gate.naturalness ?? 0,
    tone_alignment: result.gate.tone_alignment ?? 0,
    domain_alignment: result.gate.domain_alignment ?? 0,
    intensity_alignment: result.intensityAlignment ?? 0,
    coherence: result.gate.coherence ?? 0,
  })
}

// A single-candidate baseline generation, scored the identical way — no
// planning call, no candidate search, exactly what the pipeline did before
// Phase 8 (and still does at intensity 1-3 today).
async function scoreSingleCandidateBaseline(
  client: OpenAI,
  model: string,
  judgeModel: string,
  source: string,
  factLocks: FactLock[],
  tone: string,
  domain: string,
): Promise<number | null> {
  const prompt = buildUserPrompt(source, factLocks, INTENSITY, tone, domain)
  const completion = await client.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: prompt },
    ],
    max_tokens: maxTokensForIntensity(INTENSITY),
    temperature: 0.7,
  })
  const rewritten = completion.choices[0]?.message?.content?.trim() ?? source
  const post = postprocess(rewritten, factLocks).text

  try {
    const judge = await runStructuredJudge(client, judgeModel, source, post, tone, domain)
    const metrics = measureIntensity(source, post, factLocks.map(l => l.text))
    const intensityAlignment = evaluateIntensityAlignment(metrics.transformationMagnitude, INTENSITY).score
    return computeScore({
      naturalness: judge.naturalness,
      tone_alignment: judge.tone_alignment,
      domain_alignment: judge.domain_alignment,
      intensity_alignment: intensityAlignment ?? 0,
      coherence: judge.coherence,
    })
  } catch {
    return null
  }
}

describe.skipIf(!LIVE)('candidate selection acceptance (Phase 8)', () => {
  it(
    'the selected candidate beats a single-candidate baseline on the combined score, on average, within the call budget',
    async () => {
      const { apiKey, baseURL, model } = resolveProvider(null)
      const judgeModel = process.env.JUDGE_MODEL || model
      // domain=general has no intensity cap (see DOMAIN_INTENSITY_CAPS) —
      // holding domain constant isolates the candidate-selection mechanism
      // from the separately-tested domain-cap mechanism.
      const items = CORPUS.filter(i => i.domain === 'general').slice(0, SAMPLE_SIZE)

      const baselineScores: number[] = []
      const selectedScores: number[] = []
      const callCounts: number[] = []

      for (const item of items) {
        const prep = preprocess(item.input)
        const rawClient = new OpenAI({ apiKey, baseURL })

        const baseline = await scoreSingleCandidateBaseline(
          rawClient, model, judgeModel, prep.sanitized_text, prep.fact_locks, 'balanced', item.domain,
        )
        if (baseline != null) baselineScores.push(baseline)

        const { client: instrumented, usage } = instrumentClient(rawClient)
        const result = await humanizeChunk(
          instrumented, model, prep.sanitized_text, prep.sanitized_text, prep.fact_locks,
          INTENSITY, 'balanced', item.domain, MAX_GATE_RETRIES,
        )
        const selected = scoreChunkResult(result)
        if (selected != null) selectedScores.push(selected)
        callCounts.push(usage.callCount)
      }

      const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length

      console.log('baseline scores:', baselineScores)
      console.log('selected scores:', selectedScores)
      console.log('call counts per chunk:', callCounts)

      expect(baselineScores.length, 'at least some baseline generations must have scored successfully').toBeGreaterThan(0)
      expect(selectedScores.length, 'at least some selected outputs must have scored successfully').toBeGreaterThan(0)

      expect(mean(selectedScores), `selected mean ${mean(selectedScores)} should beat baseline mean ${mean(baselineScores)}`).toBeGreaterThanOrEqual(mean(baselineScores))
      expect(mean(callCounts), `mean calls per chunk ${mean(callCounts)} should stay within the intensity 7-10 budget`).toBeLessThanOrEqual(MAX_MEAN_CALLS_PER_CHUNK)
    },
    { timeout: 20 * 60 * 1000 },
  )
})
