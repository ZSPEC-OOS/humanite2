import { describe, it, expect } from 'vitest'
import OpenAI from 'openai'
import { resolveProvider } from '@/lib/providerResolution'
import { runScaleUpSweep } from '../runBenchmark'
import { writeScaleUpReport, formatScaleUpSummary } from '../report'
import { CORPUS } from '../corpus'

// Phase 11's own scale-up spec: "run across 5 tones at intensities 2, 5
// and 8." The full grid (5 tones x 3 intensities x 300 items, each up to 9
// model calls at intensity 8) is real money at a scale well beyond
// liveBenchmark.test.ts's already-expensive single-point run, so this
// stays gated behind the same RUN_LIVE_BENCHMARK opt-in and, unlike
// liveBenchmark.test.ts, deliberately samples a small slice per domain
// rather than the full 300-item corpus — the point of this test is to
// prove the sweep runs end-to-end against a real provider, not to be the
// full-scale run itself (that's a separate, manually-invoked script; see
// README.md).
const LIVE = process.env.RUN_LIVE_BENCHMARK === 'true'
const ITEMS_PER_DOMAIN = 2

function sampleAcrossDomains(n: number) {
  const domains = [...new Set(CORPUS.map(i => i.domain))]
  return domains.flatMap(d => CORPUS.filter(i => i.domain === d).slice(0, n))
}

describe.skipIf(!LIVE)('scale-up sweep acceptance — Phase 11 (opt-in, real cost)', () => {
  it(
    'runs the full 5-tone x 3-intensity grid against a small cross-domain sample and persists a report',
    async () => {
      const { apiKey, baseURL, model } = resolveProvider(null)
      const client = new OpenAI({ apiKey, baseURL })
      const items = sampleAcrossDomains(ITEMS_PER_DOMAIN)

      const sweep = await runScaleUpSweep({ client, model, items })

      expect(sweep.cells).toHaveLength(15)
      for (const cell of sweep.cells) {
        expect(cell.report.itemCount).toBe(items.length)
      }

      const path = writeScaleUpReport(sweep)
      console.log(formatScaleUpSummary(sweep))
      console.log(`\nFull scale-up report written to ${path}`)
    },
    { timeout: 60 * 60 * 1000 },
  )
})
