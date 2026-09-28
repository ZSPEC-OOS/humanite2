import type { BenchmarkTopic } from './types'

// Builds the corpus-generation prompt per §6.3 ("do not truncate" — each
// length in a topic's ladder is its own natural standalone document, never a
// mechanical truncation or padding of another length) and §7 (topic,
// audience, purpose, central concepts, and writing type held constant across
// the ladder so length is the only thing that varies).
export function buildGenerationPrompt(topic: BenchmarkTopic, targetWords: number): string {
  return [
    `Write a natural, standalone ${topic.writingType} of approximately ${targetWords} words on the following topic.`,
    `Topic: ${topic.title}`,
    `Description: ${topic.description}`,
    `Intended audience: ${topic.intendedAudience}`,
    `Core concepts to cover: ${topic.coreConcepts.join(', ')}`,
    '',
    `Write this as its own complete, natural document at roughly ${targetWords} words — do not write a longer piece and cut it short, and do not pad a shorter piece with filler to reach the count. Return only the document text: no title restatement, no preamble, and no commentary about length or word count.`,
  ].join('\n')
}

// A generous ceiling on completion tokens so a longer target (up to 2,000
// words, roughly 2,700 tokens of English prose) is never cut off mid-
// document by the request itself — separate from whether the model actually
// lands within wordCountTolerance.ts's band, which is checked afterward
// against the real returned text.
export function maxTokensFor(targetWords: number): number {
  return Math.min(4096, Math.ceil(targetWords * 2.2) + 200)
}
