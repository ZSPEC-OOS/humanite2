import type OpenAI from 'openai'
import type { FactLock } from './preprocess'
import type { TextChunk } from './chunk'
import { postprocess } from './postprocess'
import { runQualityGates, QualityScores, PreservationByType, GateAvailability } from './qualityGates'

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

  return `## HARD CONSTRAINTS — DO NOT ALTER THESE EXACT STRINGS
The following spans must appear in your output verbatim:
${lockLines}

## STYLE PARAMETERS
Tone: ${tone}
Domain: ${domain}
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

function buildRetryAddendum(gate: QualityScores): string {
  switch (gate.failed_gate) {
    case 'entity_overlap':
      return `## PREVIOUS ATTEMPT FAILED VALIDATION — FIX THIS\nYour previous rewrite dropped or altered these required exact-match strings. Include every one of them verbatim this time: ${gate.missing_facts.map(f => `"${f}"`).join(', ')}`
    case 'entailment':
      return `## PREVIOUS ATTEMPT FAILED VALIDATION — FIX THIS\nYour previous rewrite changed the meaning of the source. Specific issues found: ${gate.entailment_issues.join('; ') || 'unspecified meaning drift'}. Do not add, remove, or alter any factual claim — rewrite style only.`
    case 'semantic_similarity':
      return `## PREVIOUS ATTEMPT FAILED VALIDATION — FIX THIS\nYour previous rewrite deviated too far from the source content. Keep the same content, structure, and claims — vary only the prose style.`
    default:
      return ''
  }
}

export interface ChunkResult {
  text: string
  substitutions: number
  modelUsed: string
  gate: QualityScores | null
  gatesUnavailable: boolean
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
  let userPrompt = basePrompt
  let postText = fallbackText
  let substitutions = 0
  let modelUsed = model
  let gateResult: QualityScores | null = null
  let gatesUnavailable = false
  let retryCount = 0

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const completion = await client.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      max_tokens: maxTokensForIntensity(intensity),
      temperature: 0.7,
    })

    const rewritten = completion.choices[0]?.message?.content?.trim() ?? fallbackText
    modelUsed = completion.model

    const post = intensity >= 4 ? postprocess(rewritten, factLocks) : { text: rewritten, substitutions: 0 }
    postText = post.text
    substitutions = post.substitutions
    retryCount = attempt

    try {
      gateResult = await runQualityGates(client, model, sanitizedText, postText, factLocks)
    } catch (gateErr) {
      console.warn('Quality gates unavailable, shipping unscored output', {
        type: gateErr instanceof Error ? gateErr.constructor.name : typeof gateErr,
      })
      gatesUnavailable = true
      break
    }

    if (gateResult.passed || attempt === maxRetries) break
    userPrompt = `${basePrompt}\n\n${buildRetryAddendum(gateResult)}`
  }

  return { text: postText, substitutions, modelUsed, gate: gateResult, gatesUnavailable, retryCount }
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
  nli_entailment: number | null
  entity_overlap: number | null
  passed: boolean | null
  failed_gate: string | null
  // True when at least one soft-quality gate (semantic similarity or
  // entailment) never ran for at least one scored chunk — see gates_available.
  // `passed` can still be true while `degraded` is true: it means "nothing
  // that ran, failed", not "everything was checked". A caller that treats
  // `passed: true` alone as a green light for e.g. a "verified" claim is
  // exactly the gap this field closes.
  degraded: boolean
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
  const scored = results.filter((r): r is ChunkResult & { gate: QualityScores } => !r.gatesUnavailable && r.gate != null)

  if (scored.length === 0) {
    return {
      semantic_similarity: null,
      nli_entailment: null,
      entity_overlap: null,
      passed: null,
      failed_gate: null,
      degraded: true,
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
    nli_entailment: average(g => g.nli_entailment),
    entity_overlap: average(g => g.entity_overlap),
    passed: scored.every(r => r.gate.passed),
    failed_gate: firstFailure?.gate.failed_gate ?? null,
    degraded: !gatesAvailable.semantic_similarity || !gatesAvailable.entailment,
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
