import type OpenAI from 'openai'
import type { FactLock } from './preprocess'
import type { TextChunk } from './chunk'
import { postprocess } from './postprocess'
import { runQualityGates, checkEntityOverlap, cosineSimilarity, DEFAULT_THRESHOLDS, QualityScores, PreservationByType, GateAvailability } from './qualityGates'
import { compileStyle, buildStyleSection, toValidTone, toValidDomain, toValidGenre, toValidAudience } from './style'
import { buildIntensityGuide } from './intensity'
import { validateFactLedger, buildFactLedger } from './fidelity'
import { measureIntensity } from './evaluation/intensity'
import { evaluateIntensityAlignment } from './evaluation/styleEvaluators'
import { repairChunk, type RepairStrategy } from './evaluation/repair'
import { verifyClaims, restoreRelations, type ClaimVerificationResult, type RelationRepairStrategy } from './claims'
import { runStructuredJudge, type StructuredJudgeResult } from './evaluation/judge'
import { candidateCountForIntensity, buildRewritePlan, buildPlanSection, computeScore, type RewritePlan } from './selection'
import { resolveCapabilities } from './providers'
import { buildDocumentContextSection, type DocumentContext } from './document'

export const SYSTEM_PROMPT = `You are a professional editor. Your only job is to rewrite the provided text \
so it reads as natural, fluent human prose. You must:
- Preserve every fact, number, name, date, citation, and technical term exactly as written.
- Never add information that is not in the original.
- Never correct factual errors — your job is style, not content.
- Never remove content — only restructure and rephrase.
- Output ONLY the rewritten text. No preamble, no commentary, no explanation.`

export function buildUserPrompt(
  text: string,
  factLocks: Pick<FactLock, 'text' | 'lock_type' | 'label'>[],
  intensity: number,
  tone: string,
  domain: string,
  // Phase 8's shared structural plan (intensity >= 7 only) — every
  // candidate humanizeChunk generates gets the SAME plan section, so they
  // vary in wording rather than each independently guessing at which
  // sentences to merge or split. Omitted (every pre-Phase-8 caller and
  // test) renders nothing extra.
  plan?: RewritePlan | null,
  // Phase 10: optional overlays on top of tone/domain (see
  // style/compiler.ts's domain > genre > audience > tone precedence) — raw
  // strings, coerced the same safe-default way tone/domain already are,
  // never crashing on an unrecognized value — and the document-wide
  // terminology/abbreviation/section-summary context every chunk of a
  // multi-chunk document shares. All omitted (every pre-Phase-10 caller and
  // test) renders nothing extra.
  genre?: string | null,
  audience?: string | null,
  documentContext?: DocumentContext | null,
): string {
  const lockLines = factLocks.length
    ? factLocks.map(l => `- "${l.text}" [${l.lock_type}/${l.label}]`).join('\n')
    : '- (no explicit locks — still preserve all numbers, names, and dates exactly)'

  const intensityGuide = buildIntensityGuide(intensity)
  const planSection = plan ? buildPlanSection(plan) : ''
  const documentSection = documentContext ? buildDocumentContextSection(documentContext) : ''

  const compiledStyle = compileStyle(toValidTone(tone), toValidDomain(domain), toValidGenre(genre), toValidAudience(audience))
  const styleSection = buildStyleSection(compiledStyle)

  return `## HARD CONSTRAINTS — DO NOT ALTER THESE EXACT STRINGS
The following spans must appear in your output verbatim:
${lockLines}

## STYLE PARAMETERS
${styleSection}

${intensityGuide}
${planSection ? `\n${planSection}\n` : ''}${documentSection ? `\n${documentSection}\n` : ''}
## STYLE GUIDANCE
Prefer plainer alternatives to these AI-typical words where it does not change the sentence's technical or factual meaning — use judgment, not a fixed rule, and never inside a locked span:
- "utilize" often just means "use"
- "leverage" (as a verb) often just means "apply" or "use"
- "delve into" often just means "explore" or "look at"
- generic "robust" often just means "strong" or "reliable" — leave it if it's a defined technical/domain term instead
- "multifaceted" often just means "complex"
- "comprehensive" often just means "thorough"
- "facilitate" often just means "help" or "enable"
Never make a substitution that would change what a sentence claims — this matters most in technical, scientific, or professional writing, where a word like "robust" may carry a specific meaning "strong" doesn't.

## REMOVE THESE AI-TYPICAL OPENERS (always safe — they add no content)
- "Furthermore," / "Moreover," / "Additionally," as sentence openers → remove or restructure
- "In conclusion," → remove; restructure the closing sentence naturally
- "It is important to note that" → remove; integrate the content directly

## INPUT TEXT
${text}`
}

// Scaled to cover a full rewrite of CHUNK_MAX_CHARS (24,000 chars ≈ 6,000
// tokens) worth of input, plus headroom for higher-intensity rewrites that
// tend to run longer than the source. Provider output caps still apply on
// top of this (e.g. some deepseek-flash deployments clamp max_tokens well
// below its documented 384K ceiling).
export function maxTokensForIntensity(intensity: number): number {
  if (intensity <= 3) return 6144
  if (intensity <= 6) return 9216
  return 12288
}

// Hard ceiling on the per-attempt bump below — keeps a chunk that keeps
// truncating from requesting an ever-growing completion size across retries.
const MAX_TOKENS_CEILING = 16384

// Phase 9: "gates choose infrastructure by capability" — the intensity-
// driven budget above is a request, not a guarantee the endpoint will
// actually honor; capped by the provider's own documented max_tokens
// ceiling (see providers/types.ts) so a request never asks for more
// completion length than the endpoint is known to support. `client.baseURL`
// is always concrete on a real SDK client; undefined only for a bare mock
// object in a test, which resolves as "no override" (full capabilities).
function resolveMaxTokens(client: OpenAI, intensity: number): number {
  return Math.min(maxTokensForIntensity(intensity), resolveCapabilities(client.baseURL).maxOutputTokens)
}

function boostedMaxTokens(client: OpenAI, current: number): number {
  return Math.min(MAX_TOKENS_CEILING, resolveCapabilities(client.baseURL).maxOutputTokens, Math.round(current * 1.5))
}

function buildRetryAddendum(gate: QualityScores): string {
  switch (gate.failed_gate) {
    case 'entity_preservation':
      return `## PREVIOUS ATTEMPT FAILED VALIDATION — FIX THIS\nYour previous rewrite dropped or altered these required exact-match strings. Include every one of them verbatim this time: ${gate.missing_facts.map(f => `"${f}"`).join(', ')}`
    case 'entailment':
      return `## PREVIOUS ATTEMPT FAILED VALIDATION — FIX THIS\nYour previous rewrite changed the meaning of the source. Specific issues found: ${gate.entailment_issues.join('; ') || 'unspecified meaning drift'}. Do not add, remove, or alter any factual claim — rewrite style only.`
    case 'semantic_similarity':
      return `## PREVIOUS ATTEMPT FAILED VALIDATION — FIX THIS\nYour previous rewrite deviated too far from the source content. Keep the same content, structure, and claims — vary only the prose style.`
    case 'truncated':
      return `## PREVIOUS ATTEMPT WAS CUT OFF — FIX THIS\nYour previous rewrite exceeded the output length limit and was truncated mid-sentence. Keep the same content and detail level, but express it more concisely so the full rewrite fits.`
    default:
      return ''
  }
}

// Ranks two gate results so the retry loop can keep the best-scoring attempt
// made so far instead of whichever attempt happened to run last — a later
// retry, prompted to fix one gate, can regress another and score worse
// overall than an earlier failing attempt.
function isBetterAttempt(candidate: QualityScores, current: QualityScores): boolean {
  if (candidate.passed !== current.passed) return candidate.passed
  if (candidate.entity_preservation !== current.entity_preservation) {
    return candidate.entity_preservation > current.entity_preservation
  }
  const candidateEntailment = candidate.entailment ?? -1
  const currentEntailment = current.entailment ?? -1
  if (candidateEntailment !== currentEntailment) return candidateEntailment > currentEntailment
  const candidateSimilarity = candidate.semantic_similarity ?? -1
  const currentSimilarity = current.semantic_similarity ?? -1
  return candidateSimilarity > currentSimilarity
}

// Whether, and how, the post-retry-loop targeted repair step (see
// evaluation/repair.ts) ran on this chunk. `attempted: false` covers both
// "no fact-level problem was found" and "a problem was found but had no
// aligned sentence to target" — repair.ts's RepairResult.strategy
// disambiguates which, when it matters.
export interface RepairSummary {
  attempted: boolean
  strategy: RepairStrategy
  succeeded: boolean
  sentencesRepaired: number
}

// Same shape as RepairSummary, for the "restore-relations" strategy Phase
// 7's model-based claim verifier feeds (see claims/repair.ts) — kept as a
// separate field rather than folded into `repair` above, since both
// mechanisms can fire independently on the same chunk (a fact-level swap
// AND a relation-level one) and conflating their bookkeeping would lose
// which one actually ran.
export interface RelationRepairSummary {
  attempted: boolean
  strategy: RelationRepairStrategy
  succeeded: boolean
  sentencesRepaired: number
}

// Simplified view of ClaimVerificationResult (see src/lib/claims/types.ts)
// — the full AtomicClaim breakdown isn't needed past this point, only
// enough to report and aggregate.
export interface ClaimVerificationSummary {
  checked: number
  failed: number
  issues: string[]
}

export interface ChunkResult {
  text: string
  substitutions: number
  modelUsed: string
  gate: QualityScores | null
  gatesUnavailable: boolean
  // True when the shipped attempt's completion was cut off by the token
  // budget (finish_reason 'length') rather than ending naturally — the gate
  // on that attempt is forced to passed:false regardless of what it scored,
  // since a truncated rewrite is missing content the gates never saw.
  truncated: boolean
  retryCount: number
  // How close the shipped text's measured transformation magnitude (Phase
  // 4's measureIntensity) came to this level's design target — see
  // evaluateIntensityAlignment. Deterministic (no external dependency), so
  // this is always computed, even when gatesUnavailable.
  intensityAlignment: number | null
  repair: RepairSummary
  // null only when the claim-verification call itself failed to run (e.g.
  // gatesUnavailable already broke earlier, or the call errored) — never a
  // fabricated "0 claims checked" standing in for "didn't run".
  claimVerification: ClaimVerificationSummary | null
  relationRepair: RelationRepairSummary
}

// ── Phase 8: candidate generation and selection ──────────────────────────────
// "Search more at high intensity" — intensity 1-3 keeps the original
// single-candidate retry loop below unchanged (it already fits its own
// budget); intensity >= 4 replaces retrying-on-failure with generating
// several independent candidates up front and picking the best one, per a
// cheap-first funnel: deterministic fidelity (free) -> embedding similarity
// (one batched call) -> the combined structured judge (survivors only).
// Any critical fidelity failure disqualifies a candidate outright — it is
// never ranked, only repaired (by the SAME post-selection repair/claims
// steps the single-candidate path already runs) or, in the worst case,
// shipped as the least-bad option for that repair to work on.

interface CandidateAttempt {
  text: string
  substitutions: number
  modelUsed: string
  truncated: boolean
}

async function generateCandidates(
  client: OpenAI,
  model: string,
  fallbackText: string,
  factLocks: FactLock[],
  intensity: number,
  userPrompt: string,
  count: number,
): Promise<CandidateAttempt[]> {
  const maxTokens = resolveMaxTokens(client, intensity)
  const completions = await Promise.all(
    Array.from({ length: count }, () => client.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      max_tokens: maxTokens,
      temperature: 0.7,
    })),
  )
  return completions.map(completion => {
    const choice = completion.choices[0]
    const rewritten = choice?.message?.content?.trim() ?? fallbackText
    const truncated = choice?.finish_reason === 'length'
    const post = intensity >= 4 ? postprocess(rewritten, factLocks) : { text: rewritten, substitutions: 0 }
    return { text: post.text, substitutions: post.substitutions, modelUsed: completion.model, truncated }
  })
}

interface SelectionOutcome {
  best: { text: string; substitutions: number; modelUsed: string; gate: QualityScores; truncated: boolean } | null
  lastAttempt: CandidateAttempt
  gatesUnavailable: boolean
}

type CandidateWithEntity = CandidateAttempt & { entity: ReturnType<typeof checkEntityOverlap> }

// Every candidate was disqualified somewhere in the funnel — fidelity is a
// hard constraint enforced by disqualifying, never by shipping nothing:
// ship the least-bad candidate (by the same deterministic entity_preservation
// score the funnel's own first stage uses) and score it for real with the
// full orchestrator, so the caller's post-selection repair step has an
// accurate gate to work from.
async function fallbackToScoredCandidate(
  client: OpenAI,
  judgeModel: string,
  sanitizedText: string,
  factLocks: FactLock[],
  tone: string,
  domain: string,
  candidates: CandidateWithEntity[],
  disqualifiedAt: string,
  lastAttempt: CandidateAttempt,
): Promise<SelectionOutcome> {
  const chosen = candidates.reduce((a, b) => (b.entity.score > a.entity.score ? b : a))
  console.warn(`Candidate selection: every candidate was disqualified at the ${disqualifiedAt} stage — shipping the least-bad one for repair to work on`, {
    candidateCount: candidates.length,
  })

  try {
    const gate = await runQualityGates(client, judgeModel, sanitizedText, chosen.text, factLocks, undefined, { tone, domain })
    return {
      best: { text: chosen.text, substitutions: chosen.substitutions, modelUsed: chosen.modelUsed, gate, truncated: chosen.truncated },
      lastAttempt,
      gatesUnavailable: false,
    }
  } catch (err) {
    console.warn('Quality gates unavailable for the fallback candidate, shipping unscored output', {
      type: err instanceof Error ? err.constructor.name : typeof err,
    })
    return { best: null, lastAttempt: chosen, gatesUnavailable: true }
  }
}

async function selectBestCandidate(
  client: OpenAI,
  model: string,
  judgeModel: string,
  fallbackText: string,
  sanitizedText: string,
  factLocks: FactLock[],
  intensity: number,
  tone: string,
  domain: string,
  candidateCount: number,
  genre?: string | null,
  audience?: string | null,
  documentContext?: DocumentContext | null,
): Promise<SelectionOutcome> {
  // "Planning call (intensity >= 7 only) produces a RewritePlan ... that
  // all candidates share." A planning failure degrades to no plan rather
  // than aborting candidate generation entirely — every candidate still
  // gets generated and judged normally, just without a shared structural
  // nudge.
  const plan = intensity >= 7
    ? await buildRewritePlan(client, model, sanitizedText).catch(err => {
        console.warn('Rewrite planning unavailable, generating candidates without a shared plan', {
          type: err instanceof Error ? err.constructor.name : typeof err,
        })
        return { operations: [] }
      })
    : { operations: [] }

  const userPrompt = buildUserPrompt(sanitizedText, factLocks, intensity, tone, domain, plan, genre, audience, documentContext)
  const candidates = await generateCandidates(client, model, fallbackText, factLocks, intensity, userPrompt, candidateCount)
  const lastAttempt = candidates[0]!

  // Stage 1: deterministic fidelity (free) — entity_preservation and the
  // Phase 5 fact ledger, exactly the two checks that cost nothing, run
  // first so a bad candidate never reaches a paid check at all.
  const stage1: CandidateWithEntity[] = candidates.map(c => ({ ...c, entity: checkEntityOverlap(c.text, factLocks) }))
  const stage1Survivors = stage1.filter(c =>
    !c.truncated && c.entity.score >= DEFAULT_THRESHOLDS.entityOverlap && validateFactLedger(sanitizedText, c.text).passed,
  )
  if (stage1Survivors.length === 0) {
    return fallbackToScoredCandidate(client, judgeModel, sanitizedText, factLocks, tone, domain, stage1, 'entity_preservation', lastAttempt)
  }

  // Phase 9: gates choose infrastructure by capability — resolved once for
  // the whole funnel, since generation and judging share the same client
  // (and so the same endpoint) within a single humanizeChunk call.
  const capabilities = resolveCapabilities(client.baseURL)

  // Stage 2: embedding similarity (cheap) — ONE batched call across every
  // stage-1 survivor plus the source, not one call per candidate. Skipped
  // entirely, not attempted-and-caught, when the provider has no
  // embeddings capability at all.
  const similarityByCandidate = new Map<CandidateWithEntity, number>()
  let similarityAvailable = false
  if (capabilities.embeddings) {
    try {
      const resp = await client.embeddings.create({
        model: capabilities.embeddingModel!,
        input: [sanitizedText, ...stage1Survivors.map(c => c.text)],
      })
      const embeddings = resp.data.map(d => d.embedding)
      const sourceEmbedding = embeddings[0]!
      stage1Survivors.forEach((c, i) => similarityByCandidate.set(c, cosineSimilarity(sourceEmbedding, embeddings[i + 1]!)))
      similarityAvailable = true
    } catch (err) {
      console.warn('Batched candidate similarity unavailable, skipping the cheap filter stage', {
        type: err instanceof Error ? err.constructor.name : typeof err,
      })
    }
  }

  const stage2Survivors = similarityAvailable
    ? stage1Survivors.filter(c => similarityByCandidate.get(c)! >= DEFAULT_THRESHOLDS.semanticSimilarity)
    : stage1Survivors
  if (stage2Survivors.length === 0) {
    return fallbackToScoredCandidate(client, judgeModel, sanitizedText, factLocks, tone, domain, stage1Survivors, 'semantic_similarity', lastAttempt)
  }

  // Stage 3: the combined structured judge call — survivors only, and
  // never attempted at all when the provider has no jsonOutput capability
  // (runStructuredJudge relies on response_format: json_object to parse
  // reliably) — every candidate then falls through the SAME "no candidate
  // could be judged" path stage3Survivors.length === 0 already handles.
  const judgeResults = capabilities.jsonOutput
    ? await Promise.allSettled(stage2Survivors.map(c => runStructuredJudge(client, judgeModel, sanitizedText, c.text, tone, domain)))
    : stage2Survivors.map(() => ({ status: 'rejected' as const, reason: new Error('structured JSON output not supported by this provider') }))
  const stage3Survivors: Array<{ candidate: CandidateWithEntity; judge: StructuredJudgeResult }> = []
  judgeResults.forEach((result, i) => {
    if (result.status === 'fulfilled' && result.value.entailment_probability >= DEFAULT_THRESHOLDS.entailment) {
      stage3Survivors.push({ candidate: stage2Survivors[i]!, judge: result.value })
    }
  })

  if (stage3Survivors.length === 0) {
    const anyJudged = judgeResults.some(r => r.status === 'fulfilled')
    if (!anyJudged) {
      // The judge is unavailable entirely, not merely failing individual
      // candidates on entailment — matches the single-candidate path's own
      // gatesUnavailable convention rather than silently shipping unjudged.
      return { best: null, lastAttempt, gatesUnavailable: true }
    }
    return fallbackToScoredCandidate(client, judgeModel, sanitizedText, factLocks, tone, domain, stage2Survivors, 'entailment', lastAttempt)
  }

  // Rank survivors by the plan's weighted formula
  // (S = w_N·N + w_T·T + w_D·D + w_I·I + w_C·C) — the only point in this
  // funnel where a soft quality dimension (not a hard fidelity constraint)
  // decides the outcome.
  let winner = stage3Survivors[0]!
  let winnerScore = -Infinity
  for (const survivor of stage3Survivors) {
    const metrics = measureIntensity(sanitizedText, survivor.candidate.text, factLocks.map(l => l.text))
    const intensityAlignment = evaluateIntensityAlignment(metrics.transformationMagnitude, intensity).score!
    const score = computeScore({
      naturalness: survivor.judge.naturalness,
      tone_alignment: survivor.judge.tone_alignment,
      domain_alignment: survivor.judge.domain_alignment,
      intensity_alignment: intensityAlignment,
      coherence: survivor.judge.coherence,
    })
    if (score > winnerScore) {
      winnerScore = score
      winner = survivor
    }
  }

  const { candidate, judge } = winner
  const similarity = similarityByCandidate.get(candidate) ?? null
  const gate: QualityScores = {
    semantic_similarity: similarity == null ? null : round(similarity),
    entailment: round(judge.entailment_probability),
    entity_preservation: round(candidate.entity.score),
    passed: true,
    failed_gate: null,
    gates_available: { semantic_similarity: similarityAvailable, entailment: true },
    missing_facts: candidate.entity.missing,
    entailment_issues: judge.entailment_issues,
    preservation_by_type: candidate.entity.by_type,
    tone_alignment: round(judge.tone_alignment),
    domain_alignment: round(judge.domain_alignment),
    coherence: round(judge.coherence),
    naturalness: round(judge.naturalness),
    style_issues: judge.style_issues,
  }

  return {
    best: { text: candidate.text, substitutions: candidate.substitutions, modelUsed: candidate.modelUsed, gate, truncated: candidate.truncated },
    lastAttempt,
    gatesUnavailable: false,
  }
}

interface RetryLoopOutcome {
  best: { text: string; substitutions: number; modelUsed: string; gate: QualityScores; truncated: boolean } | null
  lastAttempt: { text: string; substitutions: number; modelUsed: string; truncated: boolean }
  retryCount: number
  gatesUnavailable: boolean
}

// The original single-candidate generate → postprocess → gate-check →
// (retry on failure) loop, unchanged from before Phase 8 — used whenever
// candidateCountForIntensity(intensity) is 1 (intensity 1-3), which already
// fits its own budget without needing the candidate-search alternative
// above.
async function runSingleCandidateRetryLoop(
  client: OpenAI,
  model: string,
  judgeModel: string,
  fallbackText: string,
  sanitizedText: string,
  factLocks: FactLock[],
  intensity: number,
  tone: string,
  domain: string,
  maxRetries: number,
  genre?: string | null,
  audience?: string | null,
  documentContext?: DocumentContext | null,
): Promise<RetryLoopOutcome> {
  const basePrompt = buildUserPrompt(sanitizedText, factLocks, intensity, tone, domain, null, genre, audience, documentContext)
  let userPrompt = basePrompt
  let retryCount = 0
  let gatesUnavailable = false
  let currentMaxTokens = resolveMaxTokens(client, intensity)

  // Tracks the best-scoring attempt seen so far, not just the most recent
  // one — a later retry can regress relative to an earlier failing attempt
  // (see isBetterAttempt), and shipping "whatever came last" would silently
  // prefer that regression.
  let best: { text: string; substitutions: number; modelUsed: string; gate: QualityScores; truncated: boolean } | null = null
  let lastAttempt: { text: string; substitutions: number; modelUsed: string; truncated: boolean } = {
    text: fallbackText,
    substitutions: 0,
    modelUsed: model,
    truncated: false,
  }

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const completion = await client.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      max_tokens: currentMaxTokens,
      temperature: 0.7,
    })

    const choice = completion.choices[0]
    const rewritten = choice?.message?.content?.trim() ?? fallbackText
    const modelUsed = completion.model
    // A completion cut off mid-rewrite is silently missing trailing content
    // — detected here via finish_reason rather than shipped as if it were a
    // complete, validated rewrite (see the forced passed:false below).
    const truncated = choice?.finish_reason === 'length'
    const post = intensity >= 4 ? postprocess(rewritten, factLocks) : { text: rewritten, substitutions: 0 }
    retryCount = attempt
    lastAttempt = { text: post.text, substitutions: post.substitutions, modelUsed, truncated }

    let gateResult: QualityScores
    try {
      gateResult = await runQualityGates(client, judgeModel, sanitizedText, post.text, factLocks, undefined, { tone, domain })
    } catch (gateErr) {
      console.warn('Quality gates unavailable, shipping unscored output', {
        type: gateErr instanceof Error ? gateErr.constructor.name : typeof gateErr,
      })
      gatesUnavailable = true
      break
    }

    if (truncated) {
      // Never let a truncated attempt read as validated, whatever the gates
      // happened to score on the partial text — preserves whatever more
      // specific failure reason the deterministic gates already found.
      gateResult = { ...gateResult, passed: false, failed_gate: gateResult.failed_gate ?? 'truncated' }
    }

    if (!best || isBetterAttempt(gateResult, best.gate)) {
      best = { text: post.text, substitutions: post.substitutions, modelUsed, gate: gateResult, truncated }
    }

    if (gateResult.passed || attempt === maxRetries) break
    userPrompt = `${basePrompt}\n\n${buildRetryAddendum(gateResult)}`
    if (truncated) currentMaxTokens = boostedMaxTokens(client, currentMaxTokens)
  }

  return { best, lastAttempt, retryCount, gatesUnavailable }
}

// Runs the generate → postprocess → gate-check → (retry on failure) loop for
// a single chunk of text (candidateCountForIntensity(intensity) === 1), or
// generates and selects among several candidates otherwise (Phase 8's
// selectBestCandidate). Either way, the SAME post-selection repair/claim-
// verification tail below runs on whichever text was chosen. Shared by the
// synchronous path (one chunk = the whole document) and the async
// background path (one call per chunk of a long document) so both go
// through identical quality enforcement.
export async function humanizeChunk(
  client: OpenAI,
  model: string,
  fallbackText: string,
  sanitizedText: string,
  factLocks: FactLock[],
  intensity: number,
  tone: string,
  domain: string,
  maxRetries: number,
  genre?: string | null,
  audience?: string | null,
  documentContext?: DocumentContext | null,
): Promise<ChunkResult> {
  // The judge (entailment/fidelity check) runs on a separately configured
  // model when available, falling back to the generator itself only when no
  // JUDGE_MODEL is set — a model judging its own output is a documented
  // self-preference bias (ref. 7 in the improvement plan).
  const judgeModel = process.env.JUDGE_MODEL || model
  const candidateCount = candidateCountForIntensity(intensity)

  let best: { text: string; substitutions: number; modelUsed: string; gate: QualityScores; truncated: boolean } | null
  let lastAttempt: { text: string; substitutions: number; modelUsed: string; truncated: boolean }
  let retryCount = 0
  let gatesUnavailable = false

  if (candidateCount > 1) {
    // Phase 8: generate several independent candidates and select the best
    // one, rather than retrying a single candidate on failure — see
    // selectBestCandidate above.
    const selection = await selectBestCandidate(client, model, judgeModel, fallbackText, sanitizedText, factLocks, intensity, tone, domain, candidateCount, genre, audience, documentContext)
    best = selection.best
    lastAttempt = selection.lastAttempt
    gatesUnavailable = selection.gatesUnavailable
  } else {
    const retryLoop = await runSingleCandidateRetryLoop(
      client, model, judgeModel, fallbackText, sanitizedText, factLocks, intensity, tone, domain, maxRetries, genre, audience, documentContext,
    )
    best = retryLoop.best
    lastAttempt = retryLoop.lastAttempt
    retryCount = retryLoop.retryCount
    gatesUnavailable = retryLoop.gatesUnavailable
  }

  if (gatesUnavailable) {
    const intensityAlignment = intensityAlignmentScore(sanitizedText, lastAttempt.text, factLocks, intensity)
    return {
      text: lastAttempt.text,
      substitutions: lastAttempt.substitutions,
      modelUsed: lastAttempt.modelUsed,
      gate: best?.gate ?? null,
      gatesUnavailable: true,
      truncated: lastAttempt.truncated,
      retryCount,
      intensityAlignment,
      repair: { attempted: false, strategy: 'none', succeeded: false, sentencesRepaired: 0 },
      claimVerification: null,
      relationRepair: { attempted: false, strategy: 'none', succeeded: false, sentencesRepaired: 0 },
    }
  }

  // Targeted, one-shot repair for fact/relation failures the whole-document
  // entity_preservation gate can miss (see evaluation/repair.ts) — a
  // deterministic, free diagnostic (validateFactLedger) runs regardless of
  // whether `best.gate` already passed, and only escalates to an LLM call
  // if it actually finds a sentence-localized problem. Never part of the
  // retry budget above: this is a single extra attempt on the best chunk
  // the loop already settled on, not another full-chunk regeneration.
  let repair: RepairSummary = { attempted: false, strategy: 'none', succeeded: false, sentencesRepaired: 0 }
  if (best) {
    const fidelityCheck = validateFactLedger(sanitizedText, best.text)
    if (!fidelityCheck.passed) {
      const repairAttempt = await repairChunk(client, model, sanitizedText, best.text, tone, domain)
      repair = {
        attempted: repairAttempt.attempted,
        strategy: repairAttempt.strategy,
        succeeded: repairAttempt.succeeded,
        sentencesRepaired: repairAttempt.sentencesRepaired,
      }
      if (repairAttempt.succeeded) {
        try {
          const repairedGate = await runQualityGates(client, judgeModel, sanitizedText, repairAttempt.text, factLocks, undefined, { tone, domain })
          // Adopt unless the re-scored repair is a strict regression on the
          // gate's own (fidelity-ledger-blind) terms — repairChunk already
          // verified internally that the repair fixes the sentence-bound
          // fact failure that triggered it, a dimension isBetterAttempt
          // cannot see at all, so a mere tie on entity/entailment/
          // similarity must still count as an improvement, not a wash.
          if (!isBetterAttempt(best.gate, repairedGate)) {
            best = { ...best, text: repairAttempt.text, gate: repairedGate }
          }
        } catch (gateErr) {
          console.warn('Could not re-score a repaired chunk, shipping the pre-repair best instead', {
            type: gateErr instanceof Error ? gateErr.constructor.name : typeof gateErr,
          })
        }
      }
    }
  }

  // Phase 7: model-based claim verification, covering relation and
  // attribution errors the deterministic fact ledger above cannot see (a
  // reversed causal direction, a statement reattributed to a different
  // speaker, a dropped scope qualifier) — both individually-correct values
  // can survive entity_preservation AND validateFactLedger while the
  // relation between them is wrong. Budgeted at exactly one call
  // (verifyClaims), regardless of outcome; a "restore-relations" repair
  // (the strategy Phase 6 named ahead of time) only escalates to two more
  // calls when verification actually finds a localized failure.
  let claimVerification: ClaimVerificationSummary | null = null
  let relationRepair: RelationRepairSummary = { attempted: false, strategy: 'none', succeeded: false, sentencesRepaired: 0 }
  if (best) {
    try {
      const coveredFacts = buildFactLedger(sanitizedText).map(f => f.text)
      let verification: ClaimVerificationResult = await verifyClaims(client, judgeModel, sanitizedText, best.text, coveredFacts)

      if (!verification.passed) {
        const relationAttempt = await restoreRelations(client, model, sanitizedText, best.text, verification.failures, tone, domain)
        if (relationAttempt.attempted && relationAttempt.succeeded) {
          // No free re-check exists for a relation fix the way
          // validateFactLedger re-checks a fact fix — verifyClaims itself
          // is the only way to confirm it, so this spends one more call
          // rather than adopting on faith. A free deterministic guard
          // still runs first, since a relation rewrite could otherwise
          // silently drop a fact the earlier repair step already restored.
          const stillHasFacts = validateFactLedger(sanitizedText, relationAttempt.text).passed
          if (stillHasFacts) {
            try {
              const reVerification = await verifyClaims(client, judgeModel, sanitizedText, relationAttempt.text, coveredFacts)
              if (reVerification.passed || reVerification.failures.length < verification.failures.length) {
                best = { ...best, text: relationAttempt.text }
                verification = reVerification
                relationRepair = { attempted: true, strategy: relationAttempt.strategy, succeeded: reVerification.passed, sentencesRepaired: relationAttempt.sentencesRepaired }
              } else {
                relationRepair = { attempted: true, strategy: relationAttempt.strategy, succeeded: false, sentencesRepaired: 0 }
              }
            } catch (err) {
              console.warn('Could not re-verify a relation repair, shipping the pre-repair claim verdict instead', {
                type: err instanceof Error ? err.constructor.name : typeof err,
              })
              relationRepair = { attempted: true, strategy: relationAttempt.strategy, succeeded: false, sentencesRepaired: 0 }
            }
          } else {
            relationRepair = { attempted: true, strategy: relationAttempt.strategy, succeeded: false, sentencesRepaired: 0 }
          }
        } else {
          relationRepair = { attempted: relationAttempt.attempted, strategy: relationAttempt.strategy, succeeded: false, sentencesRepaired: 0 }
        }
      }

      claimVerification = {
        checked: verification.claimCount,
        failed: verification.failures.length,
        issues: verification.failures.map(f => f.reason ?? 'claim not entailed'),
      }
    } catch (err) {
      console.warn('Claim verification unavailable, continuing without it', {
        type: err instanceof Error ? err.constructor.name : typeof err,
      })
    }
  }

  const shippedText = best?.text ?? lastAttempt.text
  const intensityAlignment = intensityAlignmentScore(sanitizedText, shippedText, factLocks, intensity)

  return {
    text: shippedText,
    substitutions: best?.substitutions ?? lastAttempt.substitutions,
    modelUsed: best?.modelUsed ?? lastAttempt.modelUsed,
    gate: best?.gate ?? null,
    gatesUnavailable: false,
    truncated: best?.truncated ?? lastAttempt.truncated,
    claimVerification,
    relationRepair,
    retryCount,
    intensityAlignment,
    repair,
  }
}

function intensityAlignmentScore(sourceText: string, outputText: string, factLocks: FactLock[], level: number): number {
  const metrics = measureIntensity(sourceText, outputText, factLocks.map(l => l.text))
  return evaluateIntensityAlignment(metrics.transformationMagnitude, level).score!
}

// Reassembles chunk results using each chunk's own recorded separator
// (see TextChunk.separatorAfter) instead of a fixed '\n\n' — the source
// chunker splits on paragraph breaks when it can, but falls back to a
// sentence space or nothing at all for an oversized paragraph, and blindly
// rejoining with '\n\n' fabricates paragraph breaks that were never there.
// Only emits a separator between two results that are BOTH already present,
// so a partial (still-processing) join never gets a trailing separator
// dangling off the last completed chunk.
export function joinChunkResults(results: ChunkResult[], chunks: TextChunk[]): string {
  return results
    .map((r, i) => (i < results.length - 1 ? r.text + (chunks[i]?.separatorAfter ?? '') : r.text))
    .join('')
}

export interface AggregatedQuality {
  semantic_similarity: number | null
  entailment: number | null
  entity_preservation: number | null
  passed: boolean | null
  failed_gate: string | null
  // True when at least one soft-quality gate (semantic similarity or
  // entailment) never ran for at least one scored chunk — see gates_available.
  // `passed` can still be true while `degraded` is true: it means "nothing
  // that ran, failed", not "everything was checked". A caller that treats
  // `passed: true` alone as a green light for e.g. a "verified" claim is
  // exactly the gap this field closes.
  degraded: boolean
  // True when at least one chunk's shipped attempt was cut off by the token
  // budget — distinct from `degraded`: a truncated chunk already forces its
  // own `passed: false` (a definite defect), not merely "unmeasured".
  truncated: boolean
  gates_available: GateAvailability
  retry_count: number
  missing_facts: string[]
  entailment_issues: string[]
  preservation_by_type: PreservationByType
  // Style dimensions — see qualityGates.ts's QualityScores and
  // evaluation/styleEvaluators.ts. Averaged the same null-safe way as
  // entailment/semantic_similarity above; never fed into `passed`/
  // `failed_gate`, which stay fidelity-only.
  tone_alignment: number | null
  domain_alignment: number | null
  naturalness: number | null
  style_issues: string[]
  // How close the document's actual transformation magnitude came to the
  // requested level's design target, averaged across chunks — deterministic,
  // so unlike the fields above this is never null just because a chunk's
  // gates were unavailable.
  intensity_alignment: number | null
  repair: {
    attempted: boolean
    // True only when every chunk that attempted a repair succeeded — a
    // document is not "cleanly repaired" if even one chunk's attempt failed.
    succeeded: boolean
    sentences_repaired: number
  }
  // Phase 7's model-based claim verification — summed/concatenated across
  // ALL chunks, never gated on `scored`, since claim verification runs in
  // its own try/catch independent of the main quality-gate call (see
  // humanizeChunk) rather than being tied to whether that gate succeeded.
  claims_checked: number
  claims_failed: number
  claim_issues: string[]
  relation_repair: {
    attempted: boolean
    succeeded: boolean
    sentences_repaired: number
  }
}

// Sums each category's total/preserved counts and concatenates its missing
// list across every chunk — the document-level view of what Phase 10's
// preservation report renders, built the same way for a one-chunk document
// as a many-chunk one.
function mergePreservationByType(results: ChunkResult[]): PreservationByType {
  const merged: PreservationByType = {}
  for (const r of results) {
    const byType = r.gate?.preservation_by_type
    if (!byType) continue
    for (const key of Object.keys(byType) as (keyof PreservationByType)[]) {
      const cat = byType[key]!
      const entry = merged[key] ?? { total: 0, preserved: 0, missing: [] }
      entry.total += cat.total
      entry.preserved += cat.preserved
      entry.missing.push(...cat.missing)
      merged[key] = entry
    }
  }
  return merged
}

// Combines per-chunk gate results into one score set. Used for both the
// single-chunk synchronous path and the multi-chunk async path so a document
// that happens to fit in one chunk reports identically either way.
export function aggregateChunkResults(results: ChunkResult[]): AggregatedQuality {
  const totalRetries = results.reduce((sum, r) => sum + r.retryCount, 0)
  const missingFacts = results.flatMap(r => r.gate?.missing_facts ?? [])
  const entailmentIssues = results.flatMap(r => r.gate?.entailment_issues ?? [])
  const styleIssues = results.flatMap(r => r.gate?.style_issues ?? [])
  const preservationByType = mergePreservationByType(results)
  const anyTruncated = results.some(r => r.truncated)
  const scored = results.filter((r): r is ChunkResult & { gate: QualityScores } => !r.gatesUnavailable && r.gate != null)

  // Deterministic and independent of whether any chunk's gates ran, unlike
  // every other field aggregated below — averaged over ALL chunks, never
  // gated on `scored`.
  const intensityAlignmentValues = results.map(r => r.intensityAlignment).filter((v): v is number => v != null)
  const intensityAlignment = intensityAlignmentValues.length === 0
    ? null
    : round(intensityAlignmentValues.reduce((sum, v) => sum + v, 0) / intensityAlignmentValues.length)
  const repairAttempted = results.filter(r => r.repair.attempted)
  const repair = {
    attempted: repairAttempted.length > 0,
    succeeded: repairAttempted.length > 0 && repairAttempted.every(r => r.repair.succeeded),
    sentences_repaired: results.reduce((sum, r) => sum + r.repair.sentencesRepaired, 0),
  }

  const claimsChecked = results.reduce((sum, r) => sum + (r.claimVerification?.checked ?? 0), 0)
  const claimsFailed = results.reduce((sum, r) => sum + (r.claimVerification?.failed ?? 0), 0)
  const claimIssues = results.flatMap(r => r.claimVerification?.issues ?? [])
  const relationRepairAttempted = results.filter(r => r.relationRepair.attempted)
  const relationRepair = {
    attempted: relationRepairAttempted.length > 0,
    succeeded: relationRepairAttempted.length > 0 && relationRepairAttempted.every(r => r.relationRepair.succeeded),
    sentences_repaired: results.reduce((sum, r) => sum + r.relationRepair.sentencesRepaired, 0),
  }

  if (scored.length === 0) {
    return {
      semantic_similarity: null,
      entailment: null,
      entity_preservation: null,
      passed: null,
      failed_gate: null,
      degraded: true,
      truncated: anyTruncated,
      gates_available: { semantic_similarity: false, entailment: false },
      retry_count: totalRetries,
      missing_facts: missingFacts,
      entailment_issues: entailmentIssues,
      preservation_by_type: preservationByType,
      tone_alignment: null,
      domain_alignment: null,
      naturalness: null,
      style_issues: styleIssues,
      intensity_alignment: intensityAlignment,
      repair,
      claims_checked: claimsChecked,
      claims_failed: claimsFailed,
      claim_issues: claimIssues,
      relation_repair: relationRepair,
    }
  }

  // A per-chunk score can itself be null (that specific gate didn't run for
  // that chunk — see qualityGates.ts) — averaged only over the chunks where
  // it actually ran, not treated as 0 and dragging the average down.
  const average = (select: (g: QualityScores) => number | null) => {
    const values = scored.map(r => select(r.gate)).filter((v): v is number => v != null)
    return values.length === 0 ? null : round(values.reduce((sum, v) => sum + v, 0) / values.length)
  }
  const firstFailure = scored.find(r => !r.gate.passed)
  // A gate must have actually run for EVERY scored chunk to count as
  // "available" document-wide — one chunk silently missing entailment means
  // the aggregate entailment score doesn't cover the whole document, even
  // if every other chunk's entailment gate ran fine.
  const gatesAvailable: GateAvailability = {
    semantic_similarity: scored.every(r => r.gate.gates_available.semantic_similarity),
    entailment: scored.every(r => r.gate.gates_available.entailment),
  }

  return {
    semantic_similarity: average(g => g.semantic_similarity),
    entailment: average(g => g.entailment),
    entity_preservation: average(g => g.entity_preservation),
    // Already correctly reflects truncation: humanizeChunk forces a
    // truncated chunk's own gate.passed to false before it ever reaches here.
    passed: scored.every(r => r.gate.passed),
    failed_gate: firstFailure?.gate.failed_gate ?? null,
    degraded: !gatesAvailable.semantic_similarity || !gatesAvailable.entailment,
    truncated: anyTruncated,
    gates_available: gatesAvailable,
    retry_count: totalRetries,
    missing_facts: missingFacts,
    entailment_issues: entailmentIssues,
    preservation_by_type: preservationByType,
    tone_alignment: average(g => g.tone_alignment),
    domain_alignment: average(g => g.domain_alignment),
    naturalness: average(g => g.naturalness),
    style_issues: styleIssues,
    intensity_alignment: intensityAlignment,
    repair,
    claims_checked: claimsChecked,
    claims_failed: claimsFailed,
    claim_issues: claimIssues,
    relation_repair: relationRepair,
  }
}

function round(n: number): number {
  return Math.round(n * 10000) / 10000
}
