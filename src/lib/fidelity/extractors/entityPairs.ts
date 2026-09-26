import type { FidelityFact } from '../types'

// "Compound A showed higher potency than Compound B" — a comparative
// construction binding two entities in a specific order. Swapping them
// leaves both individually present in the output; PROPER_NOUN_RE can't
// even lock either one in the first place (a single-letter/digit second
// token has no lowercase letter to match), so this is invisible to every
// existing check.
const RELATION_RE = /\b(than|compared to|versus|vs\.?)\b/gi

// A short entity label: a capitalized word followed by a single
// letter/digit/short alphanumeric token ("Compound A", "Sample 12",
// "Group B") — deliberately more permissive than preprocess.ts's
// PROPER_NOUN_RE (which requires a lowercase-letter second word) since
// this is exactly the shape PROPER_NOUN_RE excludes.
const ENTITY_LABEL_RE = /\b[A-Z][a-zA-Z]*\s+[A-Z0-9][a-zA-Z0-9]*\b/g

export function extractEntityPairs(sentence: string, sentenceIndex: number): FidelityFact[] {
  const facts: FidelityFact[] = []
  const entityMatches = [...sentence.matchAll(ENTITY_LABEL_RE)]
  if (entityMatches.length < 2) return facts

  for (const relationMatch of sentence.matchAll(RELATION_RE)) {
    const relationStart = relationMatch.index!
    const relationEnd = relationStart + relationMatch[0].length

    let before: RegExpMatchArray | null = null
    let after: RegExpMatchArray | null = null
    for (const entityMatch of entityMatches) {
      if (entityMatch.index! < relationStart) {
        if (!before || entityMatch.index! > before.index!) before = entityMatch
      } else if (entityMatch.index! >= relationEnd) {
        if (!after || entityMatch.index! < after.index!) after = entityMatch
      }
    }

    if (before && after) {
      // The relation marker itself ("than" vs "compared to") is deliberately
      // not part of `data` — a correct rewrite may swap which comparative
      // phrase it uses without changing which entity is first and which is
      // second, which is the only thing an entity swap actually corrupts.
      facts.push({
        type: 'entity_pair',
        sentenceIndex,
        text: sentence.slice(before.index!, after.index! + after[0].length),
        data: {
          first: before[0].toLowerCase(),
          second: after[0].toLowerCase(),
        },
      })
    }
  }
  return facts
}
