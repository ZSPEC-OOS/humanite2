import type { Firestore, Query, DocumentData } from 'firebase-admin/firestore'
import { createHash } from 'crypto'
import type OpenAI from 'openai'
import type { Domain } from '@/lib/style/types'
import type { BenchmarkTopic, CorpusSource, CorpusSourceStatus } from './types'
import { isWithinTolerance } from './wordCountTolerance'
import { buildGenerationPrompt, maxTokensFor } from './generationPrompt'
import { getCorpusProject, markGeneratingIfNeeded } from './corpusProject'

const COLLECTION = 'a2hCorpusSources'

function wordCount(text: string): number {
  const trimmed = text.trim()
  return trimmed ? trimmed.split(/\s+/).length : 0
}

// A deterministic id (rather than a random one) makes "regenerate this cell"
// a natural upsert to the same document instead of needing a separate lookup
// step, and makes the matrix UI's per-cell state trivial to key. Scoped by
// corpusProjectId (not corpusVersion — that's now just a descriptive label
// on the project) so two projects can never collide on the same topic x
// length cell: UNIQUE(corpusProjectId, topicId, targetWords), not just
// UNIQUE(topicId, targetWords).
function sourceDocId(corpusProjectId: string, topicId: string, targetWords: number): string {
  return `${corpusProjectId}__${topicId}__${targetWords}`
}

export async function getSource(
  firestore: Firestore,
  corpusProjectId: string,
  topicId: string,
  targetWords: number,
): Promise<CorpusSource | null> {
  const doc = await firestore.collection(COLLECTION).doc(sourceDocId(corpusProjectId, topicId, targetWords)).get()
  return doc.exists ? (doc.data() as CorpusSource) : null
}

export async function listSources(firestore: Firestore, corpusProjectId: string, domainId?: Domain): Promise<CorpusSource[]> {
  let query: Query<DocumentData> = firestore.collection(COLLECTION).where('corpusProjectId', '==', corpusProjectId)
  if (domainId) query = query.where('domainId', '==', domainId)
  const snap = await query.get()
  return snap.docs.map(d => d.data() as CorpusSource)
}

export interface GenerateSourceParams {
  corpusProjectId: string
  topic: BenchmarkTopic
  targetWords: number
  temperature: number | null
  client: OpenAI
  model: string
  providerLabel: string
}

// Calls the caller's own configured model (resolveProvider.ts — never a
// server-side key this admin doesn't control) to write one topic x length
// cell, then computes word count/hash/tolerance status deterministically
// from the actual returned text — a model-reported word count is never
// trusted. Refuses to silently overwrite an already-accepted cell: per §7,
// "regenerate failed cells only; never overwrite accepted text silently."
// Requires the project's blueprint to already be locked — a source
// generated against a still-editable topic roster or length ladder isn't
// yet the immutable unit the rest of the benchmark's comparability depends
// on.
export async function generateSource(
  firestore: Firestore,
  params: GenerateSourceParams,
  forceOverwrite = false,
): Promise<CorpusSource> {
  const { corpusProjectId, topic, targetWords, temperature, client, model, providerLabel } = params
  const project = await getCorpusProject(firestore, corpusProjectId)
  if (!project) throw new Error('Corpus project not found.')
  if (project.status === 'draft') {
    throw new Error('Lock the blueprint before generating corpus sources.')
  }
  if (project.status === 'archived') {
    throw new Error('Cannot generate sources for an archived project.')
  }
  if (!project.lengthLadder.includes(targetWords)) {
    throw new Error(`targetWords must be one of: ${project.lengthLadder.join(', ')}`)
  }

  const existing = await getSource(firestore, corpusProjectId, topic.id, targetWords)
  if (existing && !forceOverwrite && (existing.status === 'validated' || existing.status === 'frozen')) {
    throw new Error(`Source for this cell is already ${existing.status} — pass force to regenerate.`)
  }

  const prompt = buildGenerationPrompt(topic, targetWords)
  const completion = await client.chat.completions.create({
    model,
    messages: [{ role: 'user', content: prompt }],
    max_tokens: maxTokensFor(targetWords),
    ...(temperature != null ? { temperature } : {}),
  })
  const text = completion.choices[0]?.message?.content?.trim() ?? ''
  if (!text) throw new Error('Generation returned empty text.')

  const actualWords = wordCount(text)
  const status: CorpusSourceStatus = isWithinTolerance(targetWords, actualWords) ? 'validated' : 'validation_failed'
  const id = sourceDocId(corpusProjectId, topic.id, targetWords)
  const source: CorpusSource = {
    id,
    corpusProjectId,
    domainId: topic.domainId,
    topicId: topic.id,
    targetWords,
    actualWords,
    generatorProvider: providerLabel,
    generatorModel: model,
    generationPrompt: prompt,
    generationPromptVersion: topic.generationPromptVersion,
    temperature,
    seed: null,
    text,
    sha256: createHash('sha256').update(text).digest('hex'),
    generatedAt: new Date().toISOString(),
    frozenAt: null,
    status,
  }
  await firestore.collection(COLLECTION).doc(id).set(source)
  await markGeneratingIfNeeded(firestore, corpusProjectId)
  return source
}

// Freezing requires an explicit call per §23 ("Corpus freezing should
// require an explicit confirmation step") and only ever promotes a
// 'validated' source — a validation_failed cell must be regenerated (or its
// tolerance override reconsidered) before it can be frozen, and a frozen
// source's hash is never recomputed once set. This is the per-cell freeze;
// see corpusProject.ts's freezeCorpusProject for the whole-project milestone.
export async function freezeSource(
  firestore: Firestore,
  corpusProjectId: string,
  topicId: string,
  targetWords: number,
): Promise<CorpusSource> {
  const id = sourceDocId(corpusProjectId, topicId, targetWords)
  const ref = firestore.collection(COLLECTION).doc(id)
  const snap = await ref.get()
  if (!snap.exists) throw new Error('No source exists for this cell yet.')
  const source = snap.data() as CorpusSource
  if (source.status !== 'validated') {
    throw new Error(`Cannot freeze a source with status '${source.status}' — only a validated source can be frozen.`)
  }
  const frozenAt = new Date().toISOString()
  await ref.update({ status: 'frozen', frozenAt })
  return { ...source, status: 'frozen', frozenAt }
}
