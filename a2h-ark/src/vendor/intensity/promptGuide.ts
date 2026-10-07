// VENDORED from humanite2 src/lib/intensity/promptGuide.ts @ 141e366. Do not edit: the ark is erased after the A2H transfer.
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

  if (target.discourse > 0) {
    // A flat two-way (or old three-way) bucket collapsed several adjacent
    // levels onto byte-identical wording here (levels 3-6 all read "mostly
    // follow the source; only reorder where clearly beneficial", with
    // nothing in the sentence itself distinguishing how much more
    // reordering level 6 asks for than level 3) — the one dimension in this
    // guide that wasn't driven by its own numeric target. Embedding the
    // actual per-level percentage, the same way the lexical/sentence lines
    // already do, gives every level a genuinely distinct discourse
    // instruction instead of sharing one with its neighbors.
    lines.push(`- Sentence order within a paragraph may be reorganized for roughly ${pct(target.discourse)} of paragraphs where it improves the flow of ideas — more reordering at higher intensity, minimal at lower.`)
  } else {
    lines.push('- Keep sentences in their original order.')
  }

  return lines.join('\n')
}
