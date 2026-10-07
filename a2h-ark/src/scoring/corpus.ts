// Pure corpus helpers extracted from humanite2 src/lib/a2h/{corpus,corpusProject,topics,topicMutations,wordCountTolerance}.ts
// @ 141e366. Only logic the corpus specification and the export need; everything that read or wrote Firestore
// or called a model is left behind. Behaviour is copied verbatim.
import { DOMAINS, type Domain } from '../vendor/style/types'
import { MAX_TOPICS_PER_DOMAIN, DOMAIN_CODE, type BenchmarkTopic } from '../shared/types'
import { normalizeTopicTitle } from '../shared/textNormalize'

// ── Word-count acceptance bands (wordCountTolerance.ts, §7.2) ──────────────

export function toleranceFor(targetWords: number): number {
  if (targetWords <= 300) return 0.05
  if (targetWords <= 1000) return 0.04
  return 0.03
}

export function isWithinTolerance(targetWords: number, actualWords: number): boolean {
  const diff = Math.abs(actualWords - targetWords) / targetWords
  return diff <= toleranceFor(targetWords)
}

// corpus.ts's private wordCount: whitespace-split count of the trimmed text.
export function wordCount(text: string): number {
  const trimmed = text.trim()
  return trimmed ? trimmed.split(/\s+/).length : 0
}

// ── Ids (corpus.ts sourceDocId, corpusProject.ts cell key, topics page display code) ──

// A deterministic source id: UNIQUE(corpusProjectId, topicId, targetWords).
export function sourceDocId(corpusProjectId: string, topicId: string, targetWords: number): string {
  return `${corpusProjectId}__${topicId}__${targetWords}`
}

// The (topic x length) cell key used by freeze validation and the manifest.
export function sourceCellKey(topicId: string, targetWords: number): string {
  return `${topicId}__${targetWords}`
}

// Cosmetic display code of a topic, e.g. "MED-01" (the admin topics page); never a storage key.
export function topicDisplayCode(domainId: Domain, topicNumber: number): string {
  return `${DOMAIN_CODE[domainId]}-${String(topicNumber).padStart(2, '0')}`
}

export { normalizeTopicTitle, DOMAIN_CODE }

// ── Project configuration validators (corpusProject.ts) ───────────────────

export function validateProjectName(name: unknown): string | null {
  if (typeof name !== 'string' || !name.trim()) return 'name is required'
  if (name.trim().length > 200) return 'name must be 200 characters or fewer'
  return null
}

export function validateDomains(domains: unknown): { domains: Domain[] } | { error: string } {
  if (!Array.isArray(domains) || domains.length === 0) {
    return { error: 'Select at least one domain.' }
  }
  const invalid = domains.find(d => !(DOMAINS as readonly string[]).includes(d))
  if (invalid !== undefined) {
    return { error: `domains must only contain: ${DOMAINS.join(', ')}` }
  }
  return { domains: [...new Set(domains as Domain[])] }
}

export function validateTopicCountDefault(value: unknown): { topicCountDefault: number } | { error: string } {
  const n = Number(value)
  if (!Number.isInteger(n) || n < 1 || n > MAX_TOPICS_PER_DOMAIN) {
    return { error: `topicCountDefault must be an integer between 1 and ${MAX_TOPICS_PER_DOMAIN}` }
  }
  return { topicCountDefault: n }
}

export function validateTopicCountOverrides(
  value: unknown,
  domains: Domain[],
): { topicCountOverrides: Partial<Record<Domain, number>> } | { error: string } {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { error: 'topicCountOverrides must be an object.' }
  }
  const result: Partial<Record<Domain, number>> = {}
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!domains.includes(key as Domain)) {
      return { error: `topicCountOverrides.${key} is not a selected domain for this project.` }
    }
    const n = Number(raw)
    if (!Number.isInteger(n) || n < 1 || n > MAX_TOPICS_PER_DOMAIN) {
      return { error: `topicCountOverrides.${key} must be an integer between 1 and ${MAX_TOPICS_PER_DOMAIN}` }
    }
    result[key as Domain] = n
  }
  return { topicCountOverrides: result }
}

// Non-empty, positive integers, no duplicates, sorted ascending.
export function validateLengthLadder(values: unknown): { lengthLadder: number[] } | { error: string } {
  if (!Array.isArray(values) || values.length === 0) {
    return { error: 'The length ladder must be a non-empty array of word counts.' }
  }
  const numbers: number[] = []
  for (const v of values) {
    const n = Number(v)
    if (!Number.isInteger(n) || n <= 0) {
      return { error: `Every length must be a positive integer — got ${JSON.stringify(v)}.` }
    }
    numbers.push(n)
  }
  if (new Set(numbers).size !== numbers.length) {
    return { error: 'The length ladder contains duplicate values.' }
  }
  return { lengthLadder: [...numbers].sort((a, b) => a - b) }
}

export function resolveTopicCountByDomain(
  domains: Domain[],
  topicCountDefault: number,
  topicCountOverrides: Partial<Record<Domain, number>>,
): Partial<Record<Domain, number>> {
  const result: Partial<Record<Domain, number>> = {}
  for (const d of domains) {
    result[d] = topicCountOverrides[d] ?? topicCountDefault
  }
  return result
}

// ── Topic parsing (topics.ts) ──────────────────────────────────────────────

export type CreateTopicInput = Omit<BenchmarkTopic, 'id' | 'enabled' | 'createdAt' | 'updatedAt'>

export function parseTopicInput(body: Record<string, unknown>): { input: Omit<CreateTopicInput, 'corpusProjectId'> } | { error: string } {
  const domainId = body['domainId']
  if (typeof domainId !== 'string' || !DOMAINS.includes(domainId as Domain)) {
    return { error: `domainId must be one of: ${DOMAINS.join(', ')}` }
  }
  const topicNumber = Number(body['topicNumber'])
  if (!Number.isInteger(topicNumber) || topicNumber < 1 || topicNumber > MAX_TOPICS_PER_DOMAIN) {
    return { error: `topicNumber must be an integer between 1 and ${MAX_TOPICS_PER_DOMAIN}` }
  }
  const str = (k: string) => (typeof body[k] === 'string' ? (body[k] as string).trim() : '')
  const title = str('title')
  if (!title) return { error: 'title is required' }
  const description = str('description')
  if (!description) return { error: 'description is required' }
  const intendedAudience = str('intendedAudience')
  if (!intendedAudience) return { error: 'intendedAudience is required' }
  const writingType = str('writingType')
  if (!writingType) return { error: 'writingType is required' }
  const rawConcepts = body['coreConcepts']
  const coreConcepts = Array.isArray(rawConcepts)
    ? rawConcepts.filter((c): c is string => typeof c === 'string' && c.trim().length > 0).map(c => c.trim())
    : []
  if (coreConcepts.length === 0) return { error: 'coreConcepts must include at least one entry' }
  const generationPromptVersion = str('generationPromptVersion')
  if (!generationPromptVersion) return { error: 'generationPromptVersion is required' }

  return {
    input: {
      domainId: domainId as Domain,
      topicNumber,
      title,
      description,
      intendedAudience,
      writingType,
      coreConcepts,
      generationPromptVersion,
    },
  }
}

export type TopicPatch = Partial<
  Pick<BenchmarkTopic, 'title' | 'description' | 'intendedAudience' | 'writingType' | 'coreConcepts' | 'generationPromptVersion' | 'enabled'>
>

export function parseTopicPatch(body: Record<string, unknown>): TopicPatch {
  const patch: TopicPatch = {}
  if (typeof body['title'] === 'string') patch.title = body['title'].trim()
  if (typeof body['description'] === 'string') patch.description = body['description'].trim()
  if (typeof body['intendedAudience'] === 'string') patch.intendedAudience = body['intendedAudience'].trim()
  if (typeof body['writingType'] === 'string') patch.writingType = body['writingType'].trim()
  const concepts = body['coreConcepts']
  if (Array.isArray(concepts)) {
    patch.coreConcepts = concepts.filter((c): c is string => typeof c === 'string' && c.trim().length > 0).map(c => c.trim())
  }
  if (typeof body['generationPromptVersion'] === 'string') patch.generationPromptVersion = body['generationPromptVersion'].trim()
  if (typeof body['enabled'] === 'boolean') patch.enabled = body['enabled']
  return patch
}

// ── Topic uniqueness (the pure checks inside topicMutations.ts) ────────────

// createTopicChecked's sibling checks: the number must be unused and the normalized title not duplicated
// within the domain. Returns the error message, or null when the topic may be created.
export function checkNewTopicAgainstSiblings(
  input: { domainId: string; topicNumber: number; title: string },
  siblings: ReadonlyArray<{ topicNumber: number; title: string }>,
): string | null {
  if (siblings.some(t => t.topicNumber === input.topicNumber)) {
    return `Topic number ${input.topicNumber} is already used in ${input.domainId}.`
  }
  const normalized = normalizeTopicTitle(input.title)
  if (siblings.some(t => normalizeTopicTitle(t.title) === normalized)) {
    return `A topic titled "${input.title}" already exists in ${input.domainId}.`
  }
  return null
}

// updateTopicChecked's title check: a changed title must not collide (normalized) with another topic.
export function checkTopicTitleChange(
  topic: { id: string; domainId: string },
  newTitle: string,
  siblings: ReadonlyArray<{ id: string; title: string }>,
): string | null {
  const normalized = normalizeTopicTitle(newTitle)
  if (siblings.some(t => t.id !== topic.id && normalizeTopicTitle(t.title) === normalized)) {
    return `A topic titled "${newTitle}" already exists in ${topic.domainId}.`
  }
  return null
}
