import type OpenAI from 'openai'
import { splitSentences } from '@/lib/detection/diagnostics/tokenize'
import type { AtomicClaim, ClaimVerdict, ClaimVerificationResult } from './types'

// Model-based claim verification (Phase 7) — covers relation and
// attribution errors Phase 5's deterministic extractors cannot see: which
// entity did what to which (and in what direction), who is credited with a
// statement, and what condition or scope a claim carries. Extracts atomic
// claims from the SOURCE ONLY and verifies each surviving one against the
// OUTPUT in the SAME call — "extract once from source, verify each claim
// against output" per the plan's own corrected-draft table, rather than
// extracting from both texts and diffing them (which doubles extraction
// noise). Budgeted at exactly one call per chunk (see the plan's Budget
// section: "Claim verification ... ≤ 1 batched call").

const MAX_CLAIMS = 12
const MAX_COVERED_FACTS_IN_PROMPT = 40

function buildPrompt(source: string, output: string, coveredFacts: string[]): string {
  const coveredList = coveredFacts.length
    ? coveredFacts.slice(0, MAX_COVERED_FACTS_IN_PROMPT).map(f => `- "${f}"`).join('\n')
    : '- (none)'

  const outputSentences = splitSentences(output)
  const numberedOutput = outputSentences.map((s, i) => `${i}: ${s}`).join('\n')

  return `Extract the atomic claims made in the SOURCE text below, then check whether each one still holds true in the REWRITE.

An atomic claim has this shape: {"subject": "...", "predicate": "...", "object": "...", "qualifiers": ["..."], "polarity": "affirmative"|"negative", "modality": "must"|"may"|"should"|"will"|"shall"|null}. Focus on RELATIONS between entities (who did what to whom, causal direction, comparisons), ATTRIBUTION (who said, found, or reported something), and QUALIFIERS/scope (conditions, exceptions, populations, time windows, words like "only"/"most"/"before X"/"after X") that narrow or condition a claim.

Do NOT extract a claim that is ONLY about one of these exact spans — they are already verified separately and re-checking them wastes effort:
${coveredList}

For each claim, decide whether the REWRITE still entails it: does the REWRITE, read on its own, support exactly this subject/predicate/object/qualifiers/polarity/modality combination? A claim is NOT entailed if the rewrite reverses a relation, reassigns who said or did something, drops or alters a qualifier that narrows the claim's scope, or otherwise changes what is actually being asserted — reordering or rephrasing alone is fine and does not count against it.

The REWRITE's sentences are numbered below. When a claim is not entailed, report the number of the ONE sentence where the problem shows up, or null if it isn't localized to a single sentence (e.g. the claim is simply missing rather than misstated somewhere specific).

REWRITE SENTENCES:
${numberedOutput || '(no sentences)'}

Return ONLY a JSON object of this exact shape:
{"claims": [{"subject": "...", "predicate": "...", "object": "...", "qualifiers": ["..."], "polarity": "affirmative", "modality": null, "entailed": true, "reason": "", "output_sentence_index": null}]}

Extract at most ${MAX_CLAIMS} claims — the ones most load-bearing for the SOURCE's meaning.

SOURCE:
${source}

REWRITE:
${output}`
}

interface RawClaim {
  subject?: unknown
  predicate?: unknown
  object?: unknown
  qualifiers?: unknown
  polarity?: unknown
  modality?: unknown
  entailed?: unknown
  reason?: unknown
  output_sentence_index?: unknown
}

function normalizeVerdict(raw: RawClaim, outputSentenceCount: number): ClaimVerdict {
  const claim: AtomicClaim = {
    subject: String(raw.subject ?? ''),
    predicate: String(raw.predicate ?? ''),
    object: String(raw.object ?? ''),
    qualifiers: Array.isArray(raw.qualifiers) ? raw.qualifiers.slice(0, 10).map(String) : [],
    polarity: raw.polarity === 'negative' ? 'negative' : 'affirmative',
    modality: raw.modality == null ? null : String(raw.modality),
  }
  const rawIndex = Number(raw.output_sentence_index)
  const outputSentenceIndex = Number.isInteger(rawIndex) && rawIndex >= 0 && rawIndex < outputSentenceCount ? rawIndex : null

  return {
    claim,
    entailed: raw.entailed !== false,
    reason: raw.reason ? String(raw.reason) : null,
    outputSentenceIndex,
  }
}

export async function verifyClaims(
  client: OpenAI,
  model: string,
  source: string,
  output: string,
  coveredFacts: string[] = [],
): Promise<ClaimVerificationResult> {
  const outputSentenceCount = splitSentences(output).length

  const completion = await client.chat.completions.create({
    model,
    messages: [{ role: 'user', content: buildPrompt(source, output, coveredFacts) }],
    response_format: { type: 'json_object' },
    temperature: 0,
  })

  const raw = JSON.parse(completion.choices[0]?.message?.content ?? '{}')
  const rawClaims: RawClaim[] = Array.isArray(raw.claims) ? raw.claims.slice(0, MAX_CLAIMS) : []
  const verdicts = rawClaims.map(c => normalizeVerdict(c, outputSentenceCount))
  const failures = verdicts.filter(v => !v.entailed)

  return {
    passed: failures.length === 0,
    claimCount: verdicts.length,
    failures,
  }
}
