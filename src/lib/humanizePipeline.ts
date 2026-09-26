import type OpenAI from 'openai'
import type { FactLock } from './preprocess'
import type { TextChunk } from './chunk'
import { postprocess } from './postprocess'
import { runQualityGates, QualityScores, PreservationByType, GateAvailability } from './qualityGates'
import { compileStyle, buildStyleSection, toValidTone, toValidDomain } from './style'

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
): string {
  const lockLines = factLocks.length
    ? factLocks.map(l => `- "${l.text}" [${l.lock_type}/${l.label}]`).join('\n')
    : '- (no explicit locks — still preserve all numbers, names, and dates exactly)'

  let intensityGuide: string
  if (intensity <= 3) {
    intensityGuide =
      'Apply minimal changes — fix only the most obvious AI patterns (flatten transition word overuse, reduce passive voice). Keep structure identical.'
  } else if (intensity <= 6) {
    intensityGuide =
      'Apply moderate rewriting — vary sentence rhythm, replace AI-typical vocabulary, restructure for flow. Preserve all paragraph breaks.'
  } else {
    intensityGuide =
      'Apply thorough rewriting — diversify sentence lengths aggressively (mix 6-word fragments with 28-word sentences), add natural register markers (parentheticals, em-dashes, rhetorical questions where appropriate), replace all AI-typical openers and vocabulary. Preserve paragraph structure.'
  }

  const compiledStyle = compileStyle(toValidTone(tone), toValidDomain(domain))
  const styleSection = buildStyleSection(compiledStyle)

  return `## HARD CONSTRAINTS — DO NOT ALTER THESE EXACT STRINGS
The following spans must appear in your output verbatim:
${lockLines}

## STYLE PARAMETERS
${styleSection}

Intensity: ${intensity}/10
${intensityGuide}

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

function boostedMaxTokens(current: number): number {
  return Math.min(MAX_TOKENS_CEILING, Math.round(current * 1.5))
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
}

// Runs the generate → postprocess → gate-check → (retry on failure) loop for
// a single chunk of text. Shared by the synchronous path (one chunk = the
// whole document) and the async background path (one call per chunk of a
// long document) so both go through identical quality enforcement.
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
): Promise<ChunkResult> {
  const basePrompt = buildUserPrompt(sanitizedText, factLocks, intensity, tone, domain)
  // The judge (entailment/fidelity check) runs on a separately configured
  // model when available, falling back to the generator itself only when no
  // JUDGE_MODEL is set — a model judging its own output is a documented
  // self-preference bias (ref. 7 in the improvement plan).
  const judgeModel = process.env.JUDGE_MODEL || model
  let userPrompt = basePrompt
  let retryCount = 0
  let gatesUnavailable = false
  let currentMaxTokens = maxTokensForIntensity(intensity)

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
      gateResult = await runQualityGates(client, judgeModel, sanitizedText, post.text, factLocks)
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
    if (truncated) currentMaxTokens = boostedMaxTokens(currentMaxTokens)
  }

  if (gatesUnavailable) {
    return {
      text: lastAttempt.text,
      substitutions: lastAttempt.substitutions,
      modelUsed: lastAttempt.modelUsed,
      gate: best?.gate ?? null,
      gatesUnavailable: true,
      truncated: lastAttempt.truncated,
      retryCount,
    }
  }

  return {
    text: best?.text ?? lastAttempt.text,
    substitutions: best?.substitutions ?? lastAttempt.substitutions,
    modelUsed: best?.modelUsed ?? lastAttempt.modelUsed,
    gate: best?.gate ?? null,
    gatesUnavailable: false,
    truncated: best?.truncated ?? lastAttempt.truncated,
    retryCount,
  }
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
  const preservationByType = mergePreservationByType(results)
  const anyTruncated = results.some(r => r.truncated)
  const scored = results.filter((r): r is ChunkResult & { gate: QualityScores } => !r.gatesUnavailable && r.gate != null)

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
  }
}

function round(n: number): number {
  return Math.round(n * 10000) / 10000
}
