// @vitest-environment node
import { describe, it, expect } from 'vitest'
import OpenAI from 'openai'
import { preprocess } from '@/lib/preprocess'
import { chunkFactLockedText } from '@/lib/chunk'
import { humanizeChunk, aggregateChunkResults, joinChunkResults } from '@/lib/humanizePipeline'
import { CORPUS } from '../corpus'

// Phase 9's own acceptance criterion: "the benchmark runs on every
// supported provider; no gate fails because of an unsupported call." Real
// coverage of this needs a real account with each provider — this
// deployment/session has no way to hold six paid provider keys at once, so
// each provider sub-test is independently skipped unless ITS OWN env var is
// actually configured, the same "a detector without a configured key
// reports an error for that item rather than aborting the whole run"
// convention runBenchmark.ts already uses for GPTZero/Sapling. Gated
// overall behind RUN_LIVE_BENCHMARK like every other acceptance test, since
// even a single configured provider still spends real money here.
const LIVE = process.env.RUN_LIVE_BENCHMARK === 'true'
const CHUNK_MAX_CHARS = 24_000
const MAX_GATE_RETRIES = 2
const INTENSITY = 5
const TONE = 'balanced'

interface ProviderFixture {
  name: string
  apiKeyEnvVar: string
  baseURL: string
  modelEnvVar: string
  defaultModel: string
}

// One fixture per adapter in src/lib/providers/ — deliberately not
// including the deployment's own default OpenAI path, which every other
// live acceptance test in this suite already exercises continuously.
const PROVIDER_FIXTURES: ProviderFixture[] = [
  { name: 'openrouter', apiKeyEnvVar: 'OPENROUTER_API_KEY', baseURL: 'https://openrouter.ai/api/v1', modelEnvVar: 'OPENROUTER_MODEL', defaultModel: 'openai/gpt-4o-mini' },
  { name: 'deepseek', apiKeyEnvVar: 'DEEPSEEK_API_KEY', baseURL: 'https://api.deepseek.com/v1', modelEnvVar: 'DEEPSEEK_MODEL', defaultModel: 'deepseek-chat' },
  { name: 'groq', apiKeyEnvVar: 'GROQ_API_KEY', baseURL: 'https://api.groq.com/openai/v1', modelEnvVar: 'GROQ_MODEL', defaultModel: 'llama-3.1-8b-instant' },
  { name: 'mistral', apiKeyEnvVar: 'MISTRAL_API_KEY', baseURL: 'https://api.mistral.ai/v1', modelEnvVar: 'MISTRAL_MODEL', defaultModel: 'mistral-small-latest' },
  { name: 'anthropic', apiKeyEnvVar: 'ANTHROPIC_API_KEY', baseURL: 'https://api.anthropic.com/v1', modelEnvVar: 'ANTHROPIC_MODEL', defaultModel: 'claude-3-5-haiku-latest' },
]

describe.skipIf(!LIVE)('provider capabilities acceptance (Phase 9)', () => {
  for (const fixture of PROVIDER_FIXTURES) {
    const apiKey = process.env[fixture.apiKeyEnvVar]

    it.skipIf(!apiKey)(
      `${fixture.name}: the pipeline completes without any gate throwing an unhandled error`,
      async () => {
        const client = new OpenAI({ apiKey, baseURL: fixture.baseURL })
        const model = process.env[fixture.modelEnvVar] || fixture.defaultModel
        const item = CORPUS.find(i => i.domain === 'general')!

        const prep = preprocess(item.input)
        const chunks = chunkFactLockedText(prep.sanitized_text, prep.fact_locks, CHUNK_MAX_CHARS)

        const results = []
        for (const chunk of chunks) {
          // humanizeChunk's own try/catch layers are exactly what's under
          // test — a throw escaping here means some capability-gated call
          // was attempted (and failed) instead of being skipped.
          const result = await humanizeChunk(
            client, model, chunk.text, chunk.text, chunk.factLocks,
            INTENSITY, TONE, item.domain, MAX_GATE_RETRIES,
          )
          results.push(result)
        }

        const outputText = joinChunkResults(results, chunks)
        const agg = aggregateChunkResults(results)

        console.log(`[${fixture.name}] gates_available:`, agg.gates_available, 'degraded:', agg.degraded)

        expect(outputText.length, 'the provider must have produced some rewritten text').toBeGreaterThan(0)
        // Never a hard requirement that every gate ran — only that the
        // pipeline itself completed and reported honestly on what did.
        expect(typeof agg.degraded).toBe('boolean')
      },
      60 * 1000,
    )
  }

  it('at least documents which providers were actually exercised this run', () => {
    const configured = PROVIDER_FIXTURES.filter(f => process.env[f.apiKeyEnvVar]).map(f => f.name)
    console.log('providers exercised this run:', configured.length ? configured : '(none — no provider-specific keys configured)')
    // Always passes — this is a report, not a requirement that every
    // provider's key happens to be configured in any given environment.
    expect(true).toBe(true)
  })
})
