import type { FidelityFact } from '../types'

const REFERENCE_KIND = 'Section|Article|Schedule|Exhibit|Appendix|Clause'

// "Section 4 for methodology" — binds a numbered cross-reference to the
// purpose it was attached to. Swapping which reference points to which
// purpose ("Section 9 for methodology and Section 4 for results") leaves
// both section numbers individually present in the output, invisible to a
// plain presence check.
const FORWARD_RE = new RegExp(`\\b(${REFERENCE_KIND})\\s+(\\d+(?:\\.\\d+)*)\\s+(?:for|on|regarding|concerning)\\s+([a-zA-Z]+)`, 'gi')

// The reverse phrasing ("Methodology appears in Section 4") is an equally
// valid, correct rewrite of the same binding — matched separately so a
// correct rewrite that flips which side the reference falls on doesn't
// read as a changed binding.
const BACKWARD_RE = new RegExp(
  `\\b([a-zA-Z]+)\\s+(?:appears?|is covered|are covered|can be found|is discussed|are discussed)?\\s*(?:in|within)\\s+(${REFERENCE_KIND})\\s+(\\d+(?:\\.\\d+)*)`,
  'gi',
)

export function extractCrossReferences(sentence: string, sentenceIndex: number): FidelityFact[] {
  const facts: FidelityFact[] = []
  for (const m of sentence.matchAll(FORWARD_RE)) {
    facts.push({
      type: 'cross_reference',
      sentenceIndex,
      text: m[0],
      data: { kind: m[1]!.toLowerCase(), number: m[2]!, purpose: m[3]!.toLowerCase() },
    })
  }
  for (const m of sentence.matchAll(BACKWARD_RE)) {
    facts.push({
      type: 'cross_reference',
      sentenceIndex,
      text: m[0],
      data: { kind: m[2]!.toLowerCase(), number: m[3]!, purpose: m[1]!.toLowerCase() },
    })
  }
  return facts
}
