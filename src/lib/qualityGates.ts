import type OpenAI from 'openai'
import type { FactLock, FactLockType } from './preprocess'
import { runStructuredJudge, type StructuredJudgeResult } from './evaluation/judge'
import { resolveCapabilities } from './providers'

export interface GateThresholds {
  entityOverlap: number
  semanticSimilarity: number
  entailment: number
}

// Not yet calibrated against a labeled fixture set — starting values chosen to
// be conservative (favor a retry over a false pass). Revisit once real
// humanize output is available to measure the true score distribution.
export const DEFAULT_THRESHOLDS: GateThresholds = {
  entityOverlap: 1.0,
  semanticSimilarity: 0.6,
  entailment: 0.75,
}

export type FailedGate = 'entity_preservation' | 'entailment' | 'semantic_similarity' | 'truncated' | null

// Per-category breakdown backing the preservation report (spec §52) —
// "Numbers 100%, Citations 100%, Quotes 100%" rather than one aggregate
// entity_preservation score with no visibility into which category, if any,
// actually failed.
export interface CategoryPreservation {
  total: number
  preserved: number
  missing: string[]
}

export type PreservationByType = Partial<Record<FactLockType, CategoryPreservation>>

// Which of the two externally-dependent gates actually ran and contributed
// to `passed` — entity_preservation has no equivalent flag since it always
// runs (see below). `passed: true` only means "no gate that DID run
// failed"; a caller that needs to know whether that covered the whole
// picture, or just entity_preservation because both other gates were down,
// must check this instead of inferring it from a null score (a per-chunk
// average can mask a per-chunk null — see aggregateChunkResults in
// humanizePipeline.ts).
export interface GateAvailability {
  semantic_similarity: boolean
  entailment: boolean
}

export interface QualityScores {
  // null only when this specific gate failed to run (e.g. a custom model
  // endpoint doesn't support the embedding call semantic similarity needs)
  // — never a fabricated score standing in for "didn't run".
  semantic_similarity: number | null
  entailment: number | null
  // Always present: deterministic string matching with no external
  // dependency, so nothing can prevent it from running.
  entity_preservation: number
  passed: boolean
  failed_gate: FailedGate
  gates_available: GateAvailability
  missing_facts: string[]
  entailment_issues: string[]
  preservation_by_type: PreservationByType
  // Populated only when the caller passes a styleContext (tone/domain) to
  // runQualityGates — null/[] otherwise, the same "didn't run" convention
  // semantic_similarity/entailment already use. Never fed into `passed`/
  // `failed_gate`: style is measured and reported here, not yet retried —
  // see evaluation/styleEvaluators.ts for the pass/fail interpretation
  // humanizeOutput.ts's `style.passed` derives from these raw scores.
  tone_alignment: number | null
  domain_alignment: number | null
  coherence: number | null
  naturalness: number | null
  style_issues: string[]
}

// ── Gate 1: entity overlap ───────────────────────────────────────────────────
// Deterministic, no API call. Verifies every fact-locked span (numbers, dates,
// citations identified by preprocess()) survives verbatim in the rewrite —
// enforces the prompt's "preserve every fact exactly" instruction instead of
// trusting the model complied.

// Non-overlapping count of an exact substring — how many times `needle`
// genuinely appears in `haystack`, not just whether it appears at all.
function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0
  let count = 0
  let index = haystack.indexOf(needle)
  while (index !== -1) {
    count++
    index = haystack.indexOf(needle, index + needle.length)
  }
  return count
}

export function checkEntityOverlap(
  output: string,
  factLocks: FactLock[],
): { score: number; missing: string[]; by_type: PreservationByType } {
  const by_type: PreservationByType = {}
  const missing: string[] = []

  // Grouped by exact text, not checked lock-by-lock: a value repeated N
  // times in the source (e.g. "2024" three times) needs N occurrences in
  // the output. A per-lock output.includes() can't tell "all three
  // survived" from "only one did" — it only answers "does this value
  // appear anywhere at all", so two dropped duplicates would still each
  // independently read as preserved off the one surviving copy.
  const groups = new Map<string, FactLock[]>()
  for (const lock of factLocks) {
    const group = groups.get(lock.text)
    if (group) group.push(lock)
    else groups.set(lock.text, [lock])
  }

  for (const group of groups.values()) {
    const preservedCount = Math.min(group.length, countOccurrences(output, group[0]!.text))
    group.forEach((lock, i) => {
      const entry = by_type[lock.lock_type] ?? { total: 0, preserved: 0, missing: [] }
      entry.total += 1
      if (i < preservedCount) {
        entry.preserved += 1
      } else {
        entry.missing.push(lock.text)
        missing.push(lock.text)
      }
      by_type[lock.lock_type] = entry
    })
  }

  const score = factLocks.length === 0 ? 1 : (factLocks.length - missing.length) / factLocks.length
  return { score, missing, by_type }
}

// ── Gate 2: semantic similarity ──────────────────────────────────────────────
// Did the rewrite preserve the source's content, not just its surface form —
// approximated with embedding cosine similarity rather than a locally-hosted
// contextual-embedding model (the latter doesn't fit a serverless request
// budget). This is genuinely what it's named: cosine similarity between two
// embeddings, not BERTScore — an earlier revision reported it under a
// `bertscore_f1` field name, which this module never actually computed.

export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0
  let normA = 0
  let normB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!
    normA += a[i]! * a[i]!
    normB += b[i]! * b[i]!
  }
  if (normA === 0 || normB === 0) return 0
  return dot / (Math.sqrt(normA) * Math.sqrt(normB))
}

export async function checkSemanticSimilarity(
  client: OpenAI,
  original: string,
  output: string,
  // Provider-specific (see providers/types.ts's embeddingModel) — defaults
  // to OpenAI's own model so every pre-Phase-9 direct caller of this
  // function (this module's own tests included) is unaffected.
  embeddingModel = 'text-embedding-3-small',
): Promise<number> {
  const resp = await client.embeddings.create({
    model: embeddingModel,
    input: [original, output],
  })
  const [a, b] = resp.data.map(d => d.embedding)
  return cosineSimilarity(a!, b!)
}

// ── Gate 3: entailment / contradiction check ─────────────────────────────────
// No locally-hosted NLI model ships in a serverless function either — this
// uses an LLM judge with an explicit rubric in its place.

export async function checkEntailment(
  client: OpenAI,
  model: string,
  original: string,
  output: string,
): Promise<{ score: number; issues: string[] }> {
  const prompt = `Compare the ORIGINAL and REWRITE below. The REWRITE may reorder or rephrase freely, but must not add, remove, or contradict any factual claim present in the ORIGINAL.

Return ONLY a JSON object of this exact shape:
{"entailment_probability": <0.0-1.0>, "issues": ["<short description of each contradiction, addition, or omission found>"]}

entailment_probability = 1.0 means the REWRITE is fully faithful to the ORIGINAL's factual content. Lower it for any added claim, dropped claim, changed number/name/date, or altered meaning. issues is empty if there are none.

ORIGINAL:
${original}

REWRITE:
${output}`

  const completion = await client.chat.completions.create({
    model,
    messages: [{ role: 'user', content: prompt }],
    response_format: { type: 'json_object' },
    temperature: 0,
  })

  const raw = JSON.parse(completion.choices[0]?.message?.content ?? '{}')
  const score = Math.min(1, Math.max(0, Number(raw.entailment_probability) || 0))
  const issues = Array.isArray(raw.issues) ? raw.issues.slice(0, 10).map(String) : []
  return { score, issues }
}

// ── Gate 4 (reported, not gated): tone/domain/coherence/naturalness ─────────
// "Tone, domain and fidelity judging run in one structured call on a
// separately configured model" per the plan's Phase 6 spec — when the
// caller supplies a styleContext, the entailment judgment above is folded
// into this SAME call (runStructuredJudge) rather than made as a second,
// separate request, and its extra dimensions are surfaced alongside
// entailment. Normalized to one shape here so the orchestrator below never
// has to branch on which judge function actually ran.

interface NormalizedJudgeResult {
  entailment: { score: number; issues: string[] }
  style: StructuredJudgeResult | null
}

async function runJudge(
  client: OpenAI,
  model: string,
  original: string,
  output: string,
  styleContext?: { tone: string; domain: string },
): Promise<NormalizedJudgeResult> {
  if (styleContext) {
    const result = await runStructuredJudge(client, model, original, output, styleContext.tone, styleContext.domain)
    return { entailment: { score: result.entailment_probability, issues: result.entailment_issues }, style: result }
  }
  const result = await checkEntailment(client, model, original, output)
  return { entailment: result, style: null }
}

// A capability this endpoint doesn't support is never attempted at all —
// "a missing capability marks that metric unavailable instead of failing a
// call" (Phase 9) — but still flows through the SAME Promise.allSettled and
// gates_available bookkeeping a genuine network failure already used, via
// a pre-rejected promise instead of a real request.
function unsupported(reason: string): Promise<never> {
  return Promise.reject(new Error(reason))
}

// ── Orchestrator ──────────────────────────────────────────────────────────────
// Failure priority: an exact-match fact drop is the most concrete, highest-
// confidence defect, so it's reported first when multiple gates fail at once.

export async function runQualityGates(
  client: OpenAI,
  model: string,
  original: string,
  output: string,
  factLocks: FactLock[],
  thresholds: GateThresholds = DEFAULT_THRESHOLDS,
  // Optional and additive: omitted (every existing caller), behavior is
  // byte-for-byte identical to before this parameter existed — the judge
  // call stays checkEntailment, and the four new QualityScores fields stay
  // null. Only a caller that opts in (humanizePipeline.ts's humanizeChunk)
  // gets the combined structured judge and populated style scores.
  styleContext?: { tone: string; domain: string },
): Promise<QualityScores> {
  // entity_preservation has no external dependency and must never be lost just
  // because an unrelated, network-dependent gate fails — computed first,
  // and the other two are caught independently (Promise.allSettled, not
  // Promise.all) instead of one rejection failing all three at once. A gate
  // that couldn't run reports null rather than a fabricated score, and is
  // excluded from the pass/fail decision rather than counted as a failure.
  const entity = checkEntityOverlap(output, factLocks)

  // Phase 9: gates choose infrastructure by capability. `client.baseURL` is
  // always a concrete string on a real SDK client (defaulting to OpenAI's
  // own endpoint when never overridden) — undefined only for a bare mock
  // object in a test, which resolves the same as "no override".
  const capabilities = resolveCapabilities(client.baseURL)

  const [similarityResult, judgeResult] = await Promise.allSettled([
    capabilities.embeddings
      ? checkSemanticSimilarity(client, original, output, capabilities.embeddingModel!)
      : unsupported('embeddings not supported by this provider'),
    capabilities.jsonOutput
      ? runJudge(client, model, original, output, styleContext)
      : unsupported('structured JSON output not supported by this provider'),
  ])

  if (similarityResult.status === 'rejected') {
    console.warn('Semantic similarity gate unavailable, continuing without it', {
      type: similarityResult.reason instanceof Error ? similarityResult.reason.constructor.name : typeof similarityResult.reason,
    })
  }
  if (judgeResult.status === 'rejected') {
    console.warn('Entailment gate unavailable, continuing without it', {
      type: judgeResult.reason instanceof Error ? judgeResult.reason.constructor.name : typeof judgeResult.reason,
    })
  }

  const similarity = similarityResult.status === 'fulfilled' ? similarityResult.value : null
  const judge = judgeResult.status === 'fulfilled' ? judgeResult.value : null
  const entailment = judge?.entailment ?? null
  const style = judge?.style ?? null

  let failedGate: FailedGate = null
  if (entity.score < thresholds.entityOverlap) failedGate = 'entity_preservation'
  else if (entailment != null && entailment.score < thresholds.entailment) failedGate = 'entailment'
  else if (similarity != null && similarity < thresholds.semanticSimilarity) failedGate = 'semantic_similarity'

  return {
    semantic_similarity: similarity == null ? null : round(similarity),
    entailment: entailment == null ? null : round(entailment.score),
    entity_preservation: round(entity.score),
    passed: failedGate === null,
    failed_gate: failedGate,
    gates_available: {
      semantic_similarity: similarityResult.status === 'fulfilled',
      entailment: judgeResult.status === 'fulfilled',
    },
    missing_facts: entity.missing,
    entailment_issues: entailment?.issues ?? [],
    preservation_by_type: entity.by_type,
    tone_alignment: style == null ? null : round(style.tone_alignment),
    domain_alignment: style == null ? null : round(style.domain_alignment),
    coherence: style == null ? null : round(style.coherence),
    naturalness: style == null ? null : round(style.naturalness),
    style_issues: style?.style_issues ?? [],
  }
}

function round(n: number): number {
  return Math.round(n * 10000) / 10000
}
