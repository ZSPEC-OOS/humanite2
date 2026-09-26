import { intensityTarget } from './targets'

function pct(n: number): string {
  return `${Math.round(n * 100)}%`
}

// Replaces the old 3-bucket intensityGuide (<=3 / <=6 / >6) in
// humanizePipeline.ts's buildUserPrompt with a genuinely distinct target
// per level. Also drops the old high-intensity instruction to add
// "parentheticals, em-dashes, rhetorical questions" — those are exactly
// the recognized AI tells the improvement plan's baseline table flags as
// a defect (a prompt that induces the very patterns the product exists to
// remove), so rewriting this section for Phase 4 is also where that gets
// fixed rather than carried forward unchanged.
export function buildIntensityGuide(level: number): string {
  const target = intensityTarget(level)

  const lines = [
    `Intensity ${target.level}/10 — aim for approximately:`,
    `- ${pct(target.lexical)} of non-locked words replaced with different phrasing (synonyms, restructured clauses) while preserving meaning exactly.`,
    `- ${pct(target.sentence)} of sentence boundaries changed from the source (splitting long sentences, merging short ones) where it improves flow.`,
  ]

  if (target.paragraph > 0) {
    lines.push(`- Up to ${pct(target.paragraph)} of paragraph boundaries may change (splitting or merging paragraphs) if it improves structure.`)
  } else {
    lines.push('- Keep every paragraph break exactly where the source has it.')
  }

  if (target.discourse >= 0.3) {
    lines.push('- Sentence order within a paragraph may be reorganized where it improves the flow of ideas.')
  } else if (target.discourse > 0) {
    lines.push('- Sentence order should mostly follow the source; only reorder where clearly beneficial.')
  } else {
    lines.push('- Keep sentences in their original order.')
  }

  return lines.join('\n')
}
