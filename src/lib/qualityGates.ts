import type OpenAI from 'openai'
import type { FactLock } from './preprocess'

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

export type FailedGate = 'entity_overlap' | 'entailment' | 'semantic_similarity' | null

export interface QualityScores {
  bertscore_f1: number
  nli_entailment: number
  entity_overlap: number
  passed: boolean
  failed_gate: FailedGate
  missing_facts: string[]
  entailment_issues: string[]
}

// ── Gate 1: entity overlap ───────────────────────────────────────────────────
// Deterministic, no API call. Verifies every fact-locked span (numbers, dates,
// citations identified by preprocess()) survives verbatim in the rewrite —
// enforces the prompt's "preserve every fact exactly" instruction instead of
// trusting the model complied.

export function checkEntityOverlap(
  output: string,
  factLocks: FactLock[],
): { score: number; missing: string[] } {
  if (factLocks.length === 0) return { score: 1, missing: [] }
  const missing = factLocks.filter(lock => !output.includes(lock.text)).map(lock => lock.text)
  return {
    score: (factLocks.length - missing.length) / factLocks.length,
    missing,
  }
}

// ── Gate 2: semantic similarity ──────────────────────────────────────────────
// Approximates the "BERTScore F1" signal (did the rewrite preserve the
// source's content, not just its surface form) using embedding cosine
// similarity rather than a locally-hosted contextual-embedding model — the
// latter doesn't fit a serverless request budget. Reported under the
// `bertscore_f1` field for API continuity; it is not literal BERTScore.

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
): Promise<number> {
  const resp = await client.embeddings.create({
    model: 'text-embedding-3-small',
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
): Promise<QualityScores> {
  const entity = checkEntityOverlap(output, factLocks)
  const [similarity, entailment] = await Promise.all([
    checkSemanticSimilarity(client, original, output),
    checkEntailment(client, model, original, output),
  ])

  let failedGate: FailedGate = null
  if (entity.score < thresholds.entityOverlap) failedGate = 'entity_overlap'
  else if (entailment.score < thresholds.entailment) failedGate = 'entailment'
  else if (similarity < thresholds.semanticSimilarity) failedGate = 'semantic_similarity'

  return {
    bertscore_f1: round(similarity),
    nli_entailment: round(entailment.score),
    entity_overlap: round(entity.score),
    passed: failedGate === null,
    failed_gate: failedGate,
    missing_facts: entity.missing,
    entailment_issues: entailment.issues,
  }
}

function round(n: number): number {
  return Math.round(n * 10000) / 10000
}
