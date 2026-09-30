import type { Firestore } from 'firebase-admin/firestore'
import type OpenAI from 'openai'
import { resolveCapabilities } from '@/lib/providers'
import type { Domain } from '@/lib/style/types'
import type { BenchmarkTopic } from './types'
import { DEFAULT_GENERATION_PROMPT_VERSION } from './types'
import { getCorpusProject } from './corpusProject'
import { listTopics, createTopic, deleteTopicsForDomain } from './topics'
import { normalizeTopicTitle } from './textNormalize'

export { normalizeTopicTitle }

const FIELD_GUIDANCE = [
  'Field guidance:',
  '- title: a concise, specific topic name (e.g. "Community-acquired pneumonia", "Type 2 diabetes mellitus").',
  '- writingType: the kind of document this topic should be written as (e.g. "Clinical overview", "Patient education handout", "Disease-management overview").',
  '- description: one sentence describing the scope of the document.',
  '- intendedAudience: who the document is written for (e.g. "Clinicians", "Newly diagnosed adult patients", "General readers").',
  '- coreConcepts: 4 to 6 short phrases naming the concepts the document must cover (e.g. "causes", "symptoms", "diagnosis", "treatment", "complications").',
].join('\n')

const JSON_SHAPE_INSTRUCTION = [
  'Return strict JSON only, in exactly this shape, with no markdown formatting and no commentary outside the JSON:',
  '{"topics": [{"title": "...", "writingType": "...", "description": "...", "intendedAudience": "...", "coreConcepts": ["...", "..."]}]}',
].join('\n')

// Instructs the model to return one JSON object wrapping a "topics" array
// (OpenAI's json_object response format requires a top-level object, not a
// bare array) — each entry mirroring the admin-authored BenchmarkTopic shape
// minus domainId/topicNumber, which this module assigns deterministically
// from the array's own order rather than trusting the model to number them.
export function buildOutlinePrompt(domainId: Domain, topicCount: number): string {
  return [
    `Generate ${topicCount} distinct topic families for the "${domainId}" domain of a writing benchmark corpus.`,
    'Each topic must be a genuinely distinct standalone subject — no two topics on the list may be variations of the same subject or overlap substantially with each other.',
    JSON_SHAPE_INSTRUCTION,
    '',
    FIELD_GUIDANCE,
    '',
    `Return exactly ${topicCount} topics.`,
  ].join('\n')
}

// Used to grow an already-generated roster (expandOutline) without
// discarding or risking re-rolling any existing topic — the model is shown
// the current roster explicitly and told not to repeat it, rather than
// trusting "generate N more" alone to avoid overlap.
export function buildExpandPrompt(domainId: Domain, additionalCount: number, existingTitles: string[]): string {
  return [
    `Generate ${additionalCount} additional distinct topic families for the "${domainId}" domain of a writing benchmark corpus, extending an existing roster.`,
    'Do NOT repeat or closely duplicate any of these existing topics:',
    ...existingTitles.map((t, i) => `${i + 1}. ${t}`),
    '',
    'Every new topic must be a genuinely distinct standalone subject — distinct from every topic listed above, and distinct from every other new topic in this batch.',
    JSON_SHAPE_INSTRUCTION,
    '',
    FIELD_GUIDANCE,
    '',
    `Return exactly ${additionalCount} new topics.`,
  ].join('\n')
}

// Generous per-topic budget — a real topic entry (title + writingType +
// one-sentence description + audience + 4-6 coreConcepts phrases, plus JSON
// punctuation) tends to run well past a tight estimate once a model pads
// wording despite the prompt's instructions; a too-low ceiling here truncates
// the response mid-JSON, which is indistinguishable downstream from the
// model simply failing to produce JSON at all.
export function outlineMaxTokensFor(topicCount: number): number {
  return Math.min(16384, topicCount * 250 + 800)
}

// Defensive extraction rather than a bare JSON.parse: response_format:
// json_object is honored inconsistently across providers/models — some
// still wrap the object in a ```json fence despite the prompt saying not
// to. Strips a fence if present, then falls back to the first balanced
// {...} substring, before giving up. Throws with a snippet of the actual
// response so a real failure is diagnosable instead of a bare "not valid
// JSON".
function extractJson(content: string): unknown {
  const trimmed = content.trim()
  const withoutFences = trimmed.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim()

  try {
    return JSON.parse(withoutFences)
  } catch {
    // fall through to brace extraction below
  }

  const start = withoutFences.indexOf('{')
  const end = withoutFences.lastIndexOf('}')
  if (start !== -1 && end > start) {
    try {
      return JSON.parse(withoutFences.slice(start, end + 1))
    } catch {
      // fall through to the error below
    }
  }

  const snippet = trimmed.slice(0, 300)
  throw new Error(`Model did not return valid JSON. First 300 characters of its response: ${snippet || '(empty response)'}`)
}

// Calls the model and returns its parsed JSON, or throws a diagnosable
// error (truncation, or a snippet of unparseable content) — shared by
// generateOutline and expandOutline so both go through the identical
// capability-gated response_format / truncation-detection / defensive-
// parsing path.
async function callOutlineModel(client: OpenAI, model: string, prompt: string, requestedCount: number): Promise<unknown> {
  // Omitted (rather than always sent) for a provider whose endpoint doesn't
  // support strict JSON mode — some non-OpenAI-compliant endpoints reject an
  // unrecognized response_format outright instead of ignoring it, which
  // would otherwise fail the whole call before extractJson ever gets a
  // chance to parse anything.
  const jsonModeSupported = resolveCapabilities(client.baseURL).jsonOutput
  const completion = await client.chat.completions.create({
    model,
    messages: [{ role: 'user', content: prompt }],
    ...(jsonModeSupported ? { response_format: { type: 'json_object' as const } } : {}),
    max_tokens: outlineMaxTokensFor(requestedCount),
    temperature: 0.7,
  })

  const choice = completion.choices[0]
  if (choice?.finish_reason === 'length') {
    throw new Error(
      `Model response was cut off before completing (hit the ${outlineMaxTokensFor(requestedCount)}-token limit) — retry with a smaller topic count, or the model may need a larger output budget.`,
    )
  }

  return extractJson(choice?.message?.content ?? '')
}

export interface ParsedOutlineTopic {
  title: string
  writingType: string
  description: string
  intendedAudience: string
  coreConcepts: string[]
}

// Tolerant of a malformed or partial entry (silently skipped rather than
// failing the whole batch on one bad element) — but the batch as a whole
// still fails if too few entries survive, since a caller asking for
// `topicCount` topics and silently getting fewer is exactly the kind of
// under-delivery this must not paper over. Duplicate titles — within this
// batch, or against `existingTitles` from an already-generated roster
// (expandOutline) — fail the whole batch outright rather than silently
// dropping the duplicate: a caller asking for N genuinely new topics and
// silently getting fewer is the same under-delivery the count check above
// already guards against.
export function parseOutlineResponse(
  raw: unknown,
  topicCount: number,
  existingTitles: string[] = [],
): { topics: ParsedOutlineTopic[] } | { error: string } {
  if (typeof raw !== 'object' || raw === null || !Array.isArray((raw as Record<string, unknown>).topics)) {
    return { error: 'Model response did not include a "topics" array.' }
  }

  const parsed: ParsedOutlineTopic[] = []
  for (const entry of (raw as { topics: unknown[] }).topics) {
    if (typeof entry !== 'object' || entry === null) continue
    const e = entry as Record<string, unknown>
    const title = typeof e.title === 'string' ? e.title.trim() : ''
    const writingType = typeof e.writingType === 'string' ? e.writingType.trim() : ''
    const description = typeof e.description === 'string' ? e.description.trim() : ''
    const intendedAudience = typeof e.intendedAudience === 'string' ? e.intendedAudience.trim() : ''
    const coreConcepts = Array.isArray(e.coreConcepts)
      ? e.coreConcepts.filter((c): c is string => typeof c === 'string' && c.trim().length > 0).map(c => c.trim())
      : []
    if (!title || !writingType || !description || !intendedAudience || coreConcepts.length === 0) continue
    parsed.push({ title, writingType, description, intendedAudience, coreConcepts })
  }

  if (parsed.length < topicCount) {
    return { error: `Model returned only ${parsed.length} valid topics of the requested ${topicCount} — retry generation.` }
  }
  const trimmed = parsed.slice(0, topicCount)

  const seen = new Map<string, string>()
  for (const t of trimmed) {
    const key = normalizeTopicTitle(t.title)
    const collidesWith = seen.get(key)
    if (collidesWith) {
      return { error: `Generated outline contains duplicate topics: "${collidesWith}" and "${t.title}".` }
    }
    seen.set(key, t.title)
  }

  const existingKeys = new Set(existingTitles.map(normalizeTopicTitle))
  for (const t of trimmed) {
    if (existingKeys.has(normalizeTopicTitle(t.title))) {
      return { error: `Generated topic "${t.title}" duplicates an existing topic already in the roster.` }
    }
  }

  return { topics: trimmed }
}

export interface GenerateOutlineParams {
  corpusProjectId: string
  domainId: Domain
  client: OpenAI
  model: string
}

// Bulk-generates a domain's full topic roster (within one project) in one
// model call, per the admin-driven workflow: configure the project's
// topicCountByDomain, then generate — while the project is still 'draft'.
// Generating against a project that's already past 'draft' would let the
// roster drift out from under corpus/detector data keyed to topic slot
// numbers, since the blueprint is meant to be fully settled before it locks.
export async function generateOutline(
  firestore: Firestore,
  params: GenerateOutlineParams,
  forceOverwrite = false,
): Promise<BenchmarkTopic[]> {
  const { corpusProjectId, domainId, client, model } = params
  const project = await getCorpusProject(firestore, corpusProjectId)
  if (!project) throw new Error('Corpus project not found.')
  if (project.status !== 'draft') {
    throw new Error(`Cannot generate an outline — project is ${project.status}, not draft.`)
  }
  const topicCount = project.topicCountByDomain[domainId]
  if (!topicCount) {
    throw new Error(`Set a topic count for ${domainId} before generating an outline.`)
  }

  const existing = await listTopics(firestore, corpusProjectId, domainId)
  if (existing.length > 0 && !forceOverwrite) {
    throw new Error('Topics already exist for this domain — pass force to regenerate, or use expandOutline to add more without discarding these.')
  }

  const raw = await callOutlineModel(client, model, buildOutlinePrompt(domainId, topicCount), topicCount)
  const parsed = parseOutlineResponse(raw, topicCount)
  if ('error' in parsed) throw new Error(parsed.error)

  if (existing.length > 0) await deleteTopicsForDomain(firestore, corpusProjectId, domainId)

  return Promise.all(
    parsed.topics.map((t, index) =>
      createTopic(firestore, {
        corpusProjectId,
        domainId,
        topicNumber: index + 1,
        title: t.title,
        description: t.description,
        intendedAudience: t.intendedAudience,
        writingType: t.writingType,
        coreConcepts: t.coreConcepts,
        generationPromptVersion: DEFAULT_GENERATION_PROMPT_VERSION,
      }),
    ),
  )
}

// Grows an already-generated roster up to the domain's (raised) configured
// count without touching a single existing topic — the safe counterpart to
// generateOutline's forceOverwrite path, which discards everything. Requires
// the project's topicCountByDomain[domain] to already have been raised past
// the current roster size; this function only ever appends. Only usable
// while the project is still 'draft' — same as generateOutline.
export async function expandOutline(firestore: Firestore, params: GenerateOutlineParams): Promise<BenchmarkTopic[]> {
  const { corpusProjectId, domainId, client, model } = params
  const project = await getCorpusProject(firestore, corpusProjectId)
  if (!project) throw new Error('Corpus project not found.')
  if (project.status !== 'draft') {
    throw new Error(`Cannot expand an outline — project is ${project.status}, not draft.`)
  }
  const topicCount = project.topicCountByDomain[domainId]
  if (!topicCount) {
    throw new Error(`Set a topic count for ${domainId} before generating an outline.`)
  }

  const existing = await listTopics(firestore, corpusProjectId, domainId)
  if (existing.length === 0) {
    throw new Error('No topics exist yet for this domain — use generateOutline for the initial roster.')
  }
  const needed = topicCount - existing.length
  if (needed <= 0) {
    throw new Error(`This domain already has ${existing.length} topics, which meets or exceeds the configured count of ${topicCount} — raise the count first.`)
  }

  const existingTitles = existing.map(t => t.title)
  const raw = await callOutlineModel(client, model, buildExpandPrompt(domainId, needed, existingTitles), needed)
  const parsed = parseOutlineResponse(raw, needed, existingTitles)
  if ('error' in parsed) throw new Error(parsed.error)

  return Promise.all(
    parsed.topics.map((t, index) =>
      createTopic(firestore, {
        corpusProjectId,
        domainId,
        topicNumber: existing.length + index + 1,
        title: t.title,
        description: t.description,
        intendedAudience: t.intendedAudience,
        writingType: t.writingType,
        coreConcepts: t.coreConcepts,
        generationPromptVersion: DEFAULT_GENERATION_PROMPT_VERSION,
      }),
    ),
  )
}
