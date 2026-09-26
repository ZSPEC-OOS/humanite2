import type { FidelityFact } from '../types'

// Recognized unit *symbols* — the same whitelist preprocess.ts's NUMBER_RE
// uses, kept in sync deliberately rather than imported, since this pattern
// also needs to interleave them with the spelled-out words below in one
// alternation.
const UNIT_SYMBOLS = '%|°[CF]|km|m|cm|kg|g|mg|lb|ml|l|L|USD|EUR|GBP|mph|kph|Hz|MHz|GHz|TB|GB|MB|KB|ft|yd|mi|oz|qt|pt|rpm|bpm|kW|MW|kV|mA|mol|kcal|kPa|kJ|psi|dB|nm|min|hr'

// Spelled-out units preprocess.ts's NUMBER_RE has no equivalent for — this
// is exactly the "unit-quantity-unrecognized-unit" gap from the Phase 2
// adversarial fixtures ("200 dollars" -> "200 euros" survives today because
// only the bare "200" gets locked).
const UNIT_WORDS = 'dollars?|euros?|pounds?|cents?|hours?|days?|weeks?|months?|years?|minutes?|seconds?|kilograms?|miles?|meters?|feet|inches?|degrees?|percentage\\s+points?|points?'

// Captures an optional leading comparator and/or sign together with the
// number and its unit, as ONE fact — "p > 0.05", "+5%", and "200 dollars"
// are all a quantity with some combination of these modifiers, and
// checking them together catches a modifier changing even when the
// numeric value itself is untouched (the sign-flip and comparator-flip
// adversarial fixtures).
// Boundaries are lookaround assertions for a neighboring letter/digit, not
// \b on both ends — \b requires a transition to/from a word character,
// which a symbol comparator/sign/unit ("+5%.", "p > 0.05") never reliably
// satisfies (non-word "%" directly against non-word "." is never a \b
// boundary, silently dropping the unit via backtracking). The leading
// lookbehind also prevents a match from starting mid-run inside a longer
// digit sequence this pattern can't fully consume (\d{1,3} tops out at 3
// digits without a comma, matching preprocess.ts's NUMBER_RE convention).
const QUANTITY_RE = new RegExp(
  `(?<![a-zA-Z0-9])(?:([<>]|≤|≥)\\s*)?([+-])?\\s*(\\d{1,3}(?:,\\d{3})*(?:\\.\\d+)?)\\s*(${UNIT_SYMBOLS}|${UNIT_WORDS})?(?![a-zA-Z0-9])`,
  'gi',
)

export function extractQuantities(sentence: string, sentenceIndex: number): FidelityFact[] {
  const facts: FidelityFact[] = []
  for (const m of sentence.matchAll(QUANTITY_RE)) {
    const [text, operator, sign, value, unit] = m
    facts.push({
      type: 'quantity',
      sentenceIndex,
      text: text!,
      data: {
        operator: operator ?? null,
        sign: sign ?? null,
        value: value!,
        unit: unit ? unit.toLowerCase().replace(/\s+/g, ' ').trim() : null,
      },
    })
  }
  return facts
}
