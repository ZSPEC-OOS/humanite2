import { diffWords } from 'diff'
import { splitParagraphs, splitSentences, tokenizeWords } from '@/lib/detection/diagnostics/tokenize'
import { mean, rate, round } from '@/lib/detection/diagnostics/util'
import { alignSentences } from '@/lib/textAlign'

export interface IntensityMetrics {
  tokenEditRatio: number
  lexicalReplacementRatio: number
  sentenceBoundaryChangeRatio: number
  sentenceOrderChangeRatio: number
  paragraphBoundaryChangeRatio: number
  // Equal-weighted mean of the five ratios above — the single number
  // Phase 4's acceptance criterion ("mean transformation magnitude
  // strictly increases from I1 to I10") is checked against. `syntactic`
  // and `discourse` (see IntensityTarget) have no corresponding metric
  // here: syntactic is deferred pending a parser choice, and discourse
  // has no simple token-level proxy — both stay guidance-only in the
  // prompt rather than measured here.
  transformationMagnitude: number
}

// difflib-style similarity ratio (2*matches / totalLength) rather than a
// raw edit count, so this stays bounded in [0, 1] regardless of how much
// longer or shorter the output is than the source.
function tokenEditRatio(source: string, output: string): number {
  const sourceWordCount = tokenizeWords(source).length
  const outputWordCount = tokenizeWords(output).length
  if (sourceWordCount === 0 && outputWordCount === 0) return 0

  const parts = diffWords(source, output)
  const commonWordCount = parts
    .filter(part => !part.added && !part.removed)
    .reduce((sum, part) => sum + tokenizeWords(part.value).length, 0)

  const similarity = (2 * commonWordCount) / (sourceWordCount + outputWordCount || 1)
  return round(1 - similarity)
}

// What fraction of the source's REWRITABLE vocabulary (excluding
// fact-locked spans, which must never be "replaced") was dropped in favor
// of different wording. A locked span surviving into the output isn't a
// missed transformation opportunity — it's a hard requirement — so
// excluding it from the denominator avoids penalizing a fact-heavy source
// with an artificially low ratio.
function lexicalReplacementRatio(source: string, output: string, lockedTexts: string[]): number {
  const parts = diffWords(source, output)
  const removedWordCount = parts
    .filter(part => part.removed)
    .reduce((sum, part) => sum + tokenizeWords(part.value).length, 0)

  const sourceWordCount = tokenizeWords(source).length
  const lockedWordCount = lockedTexts.reduce((sum, text) => sum + tokenizeWords(text).length, 0)
  const rewritableWordCount = Math.max(0, sourceWordCount - lockedWordCount)

  return rewritableWordCount === 0 ? 0 : round(rate(removedWordCount, rewritableWordCount))
}

function sentenceBoundaryChangeRatio(source: string, output: string): number {
  const sourceCount = splitSentences(source).length
  const outputCount = splitSentences(output).length
  return sourceCount === 0 ? 0 : round(Math.abs(outputCount - sourceCount) / sourceCount)
}

function paragraphBoundaryChangeRatio(source: string, output: string): number {
  const sourceCount = splitParagraphs(source).length
  const outputCount = splitParagraphs(output).length
  return sourceCount === 0 ? 0 : round(Math.abs(outputCount - sourceCount) / sourceCount)
}

// Fraction of aligned-sentence pairs that appear in a different relative
// order in the output than in the source (a Kendall-tau-style inversion
// count) — distinct from sentenceBoundaryChangeRatio, which only tracks
// how many sentences there are, not what order they're in.
function sentenceOrderChangeRatio(source: string, output: string): number {
  // Already in output order — alignSentences iterates output sentences in
  // order and appends one entry per match.
  const assignment = alignSentences(splitSentences(source), splitSentences(output)).map(a => a.sourceIndex)
  if (assignment.length < 2) return 0

  let inversions = 0
  let pairs = 0
  for (let i = 0; i < assignment.length; i++) {
    for (let j = i + 1; j < assignment.length; j++) {
      pairs++
      if (assignment[j]! < assignment[i]!) inversions++
    }
  }
  return pairs === 0 ? 0 : round(inversions / pairs)
}

// The evaluator src/lib/evaluation/intensity.ts computes token edit ratio,
// lexical replacement ratio, sentence-boundary changes, sentence-order
// changes and paragraph-boundary changes, per the plan's Phase 4 spec.
// `lockedTexts` should be the fact-locked span texts from preprocess() —
// pass [] if unavailable, at the cost of lexicalReplacementRatio no longer
// excluding them from its denominator.
export function measureIntensity(source: string, output: string, lockedTexts: string[] = []): IntensityMetrics {
  const metrics = {
    tokenEditRatio: tokenEditRatio(source, output),
    lexicalReplacementRatio: lexicalReplacementRatio(source, output, lockedTexts),
    sentenceBoundaryChangeRatio: sentenceBoundaryChangeRatio(source, output),
    sentenceOrderChangeRatio: sentenceOrderChangeRatio(source, output),
    paragraphBoundaryChangeRatio: paragraphBoundaryChangeRatio(source, output),
  }
  return {
    ...metrics,
    transformationMagnitude: round(mean(Object.values(metrics))),
  }
}
