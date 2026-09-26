import type OpenAI from 'openai'
import type { Audience, Genre } from '@/lib/style'
import type { DocumentContext } from './types'

// "A document analysis pass builds DocumentContext ... shared by every
// chunk" — one call, before any chunk is generated, reading the source
// (not the rewrite) to find terminology/abbreviations that need to survive
// consistently across every chunk. Capped rather than sent in full: this
// pass only needs a REPRESENTATIVE sample to spot a source's own term/
// abbreviation patterns, not every character of an ASYNC_MAX_CHARS-sized
// document, and keeping this to one bounded call (like Phase 8's own
// per-chunk planning call) matters more than exhaustively covering a very
// long document's tail.
const MAX_ANALYZED_CHARS = 40_000
const MAX_TERMS = 20
const MAX_ABBREVIATIONS = 20
const MAX_SECTION_SUMMARIES = 30

function buildAnalysisPrompt(sourceText: string, genre: Genre | null, audience: Audience | null): string {
  const analyzed = sourceText.length > MAX_ANALYZED_CHARS ? sourceText.slice(0, MAX_ANALYZED_CHARS) : sourceText
  const genreLine = genre ? `\nThe rewrite's genre will be "${genre}".` : ''
  const audienceLine = audience ? `\nThe rewrite's audience will be "${audience}".` : ''

  return `Read the SOURCE text below (it may be truncated if long) and identify what a rewrite split across several independent pieces would need to keep consistent with itself throughout.${genreLine}${audienceLine}

1. TERMINOLOGY: find any entity, concept, or defined term the SOURCE ITSELF refers to with more than one surface form (e.g. "the Company" and "the Corporation" for the same entity, or "user" and "customer" for the same role). For each one, pick the single rendering that should be used EVERY time throughout a rewrite — prefer whichever form the source itself uses most often. Skip any term the source already renders consistently.

2. ABBREVIATIONS: find every abbreviation the source itself defines or spells out (e.g. "Application Programming Interface (API)"), and record its exact expansion.

3. SECTION SUMMARIES: write one short line per paragraph or section of the source, summarizing what it covers — this gives a later piece of the rewrite context about what an earlier piece already said, without needing the whole source repeated.

Return ONLY a JSON object of this exact shape:
{"terminology": {"<a variant phrase>": "<the one canonical rendering to use instead>"}, "abbreviations": {"<abbreviation>": "<its full expansion>"}, "section_summaries": ["<one line per paragraph/section>"]}

Return empty objects/arrays for anything that does not apply. Report at most ${MAX_TERMS} terminology entries and ${MAX_ABBREVIATIONS} abbreviations.

SOURCE:
${analyzed}`
}

interface RawAnalysis {
  terminology?: unknown
  abbreviations?: unknown
  section_summaries?: unknown
}

function normalizeStringRecord(value: unknown, maxEntries: number): Record<string, string> {
  if (typeof value !== 'object' || value == null) return {}
  const entries: Array<[string, string]> = Object.entries(value as Record<string, unknown>)
    .filter((entry): entry is [string, string] => {
      const [k, v] = entry
      return typeof k === 'string' && k.trim().length > 0 && typeof v === 'string' && v.trim().length > 0
    })
    .slice(0, maxEntries)
  return Object.fromEntries(entries)
}

export async function buildDocumentContext(
  client: OpenAI,
  model: string,
  sourceText: string,
  genre: Genre | null,
  audience: Audience | null,
): Promise<DocumentContext> {
  const completion = await client.chat.completions.create({
    model,
    messages: [{ role: 'user', content: buildAnalysisPrompt(sourceText, genre, audience) }],
    response_format: { type: 'json_object' },
    temperature: 0,
  })

  const raw: RawAnalysis = JSON.parse(completion.choices[0]?.message?.content ?? '{}')

  return {
    genre,
    audience,
    terminology: normalizeStringRecord(raw.terminology, MAX_TERMS),
    abbreviations: normalizeStringRecord(raw.abbreviations, MAX_ABBREVIATIONS),
    sectionSummaries: Array.isArray(raw.section_summaries) ? raw.section_summaries.slice(0, MAX_SECTION_SUMMARIES).map(String) : [],
  }
}

// A neutral, empty context — used when document analysis is skipped or
// unavailable (see humanizePipeline.ts), so every downstream consumer can
// treat "no context" and "an empty context" identically rather than
// special-casing null throughout the chunk-generation and consistency-
// check paths.
export function emptyDocumentContext(genre: Genre | null = null, audience: Audience | null = null): DocumentContext {
  return { genre, audience, terminology: {}, abbreviations: {}, sectionSummaries: [] }
}
