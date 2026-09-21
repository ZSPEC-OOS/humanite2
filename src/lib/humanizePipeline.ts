import type OpenAI from 'openai'
import type { FactLock } from './preprocess'
import { postprocess } from './postprocess'
import { runQualityGates, QualityScores } from './qualityGates'

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

## VOCABULARY SUBSTITUTIONS (mandatory)
Replace these words wherever they appear, unless inside a locked span:
- "utilize" → "use"
- "leverage" (verb) → "apply" or "use"
- "delve into" → "explore"
- "robust" (generic) → "strong" or "reliable"
- "multifaceted" → "complex"
- "comprehensive" → "thorough"
- "facilitate" → "help" or "enable"
- "Furthermore," / "Moreover," / "Additionally," (sentence openers) → remove or replace
- "In conclusion," → remove; restructure closing sentence naturally
- "It is important to note that" → remove; integrate content directly

## INPUT TEXT
${text}`
}

export function maxTokensForIntensity(intensity: number): number {
  if (intensity <= 3) return 2048
  if (intensity <= 6) return 3072
  return 4096
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

export interface AggregatedQuality {
  bertscore_f1: number | null
  nli_entailment: number | null
  entity_overlap: number | null
  passed: boolean | null
  failed_gate: string | null
  retry_count: number
  missing_facts: string[]
  entailment_issues: string[]
}

// Combines per-chunk gate results into one score set. Used for both the
// single-chunk synchronous path and the multi-chunk async path so a document
// that happens to fit in one chunk reports identically either way.
export function aggregateChunkResults(results: ChunkResult[]): AggregatedQuality {
  const totalRetries = results.reduce((sum, r) => sum + r.retryCount, 0)
  const missingFacts = results.flatMap(r => r.gate?.missing_facts ?? [])
  const entailmentIssues = results.flatMap(r => r.gate?.entailment_issues ?? [])
  const scored = results.filter((r): r is ChunkResult & { gate: QualityScores } => !r.gatesUnavailable && r.gate != null)

  if (scored.length === 0) {
    return {
      bertscore_f1: null,
      nli_entailment: null,
      entity_overlap: null,
      passed: null,
      failed_gate: null,
      retry_count: totalRetries,
      missing_facts: missingFacts,
      entailment_issues: entailmentIssues,
    }
  }

  const average = (select: (g: QualityScores) => number) =>
    round(scored.reduce((sum, r) => sum + select(r.gate), 0) / scored.length)
  const firstFailure = scored.find(r => !r.gate.passed)

  return {
    bertscore_f1: average(g => g.bertscore_f1),
    nli_entailment: average(g => g.nli_entailment),
    entity_overlap: average(g => g.entity_overlap),
    passed: scored.every(r => r.gate.passed),
    failed_gate: firstFailure?.gate.failed_gate ?? null,
    retry_count: totalRetries,
    missing_facts: missingFacts,
    entailment_issues: entailmentIssues,
  }
}

function round(n: number): number {
  return Math.round(n * 10000) / 10000
}
