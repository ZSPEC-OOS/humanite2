import { CORPUS } from '../corpus'
import { DOMAINS } from '../types'
import { TONES } from '@/lib/style'
import { SCALE_UP_INTENSITIES } from '../runBenchmark'
import type { PairwiseComparisonItem } from './types'

// "Add blind human pairwise ratings on a stratified sample" — this builds
// the STRATA (one corpus item per domain x tone x intensity combination),
// deterministically rather than randomly, so the same call always returns
// the same sample and a rerun is reproducible. It deliberately returns
// only WHICH item/settings to generate a comparison from, not any
// generated text: producing that text means a real model call (and, once
// a fine-tuning decision moves past "no-go", a second model to compare
// against), which this pure sampling function has no business making.
// The caller — a script or a future live-gated test, mirroring
// runBenchmark.ts's own real-vs-stub split — generates both passages for
// each returned item, presents them to a rater with labels randomized per
// task, and records the result as a PairwiseRating in index.ts.
export function sampleForPairwiseRating(perStratum = 1): PairwiseComparisonItem[] {
  const tasks: PairwiseComparisonItem[] = []
  for (const domain of DOMAINS) {
    const items = CORPUS.filter(i => i.domain === domain)
    for (const tone of TONES) {
      for (const intensity of SCALE_UP_INTENSITIES) {
        for (let i = 0; i < perStratum && i < items.length; i++) {
          tasks.push({ id: items[i]!.id, domain, tone, intensity })
        }
      }
    }
  }
  return tasks
}
