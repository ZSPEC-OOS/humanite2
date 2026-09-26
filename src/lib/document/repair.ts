import type OpenAI from 'openai'
import { splitSentences } from '@/lib/detection/diagnostics/tokenize'
import { locateSentenceSpans, spliceSentences } from '@/lib/textSplice'
import type { TerminologyViolation } from './consistency'

// Terminology drift is repaired the same targeted, sentence-level way
// Phase 6's fact repair and Phase 7's relation repair already work: locate
// exactly which sentence carries the banned variant, fix only that
// sentence, and splice it back in — never a whole-document regeneration
// for what is, by construction, a small, localized wording choice.

export interface TerminologyRepairResult {
  attempted: boolean
  succeeded: boolean
  text: string
  sentencesRepaired: number
}

const REPAIR_SYSTEM_PROMPT = `You are a precise copy editor. You fix ONE sentence at a time so it uses the required terminology exactly, changing as little else as possible. Output ONLY the corrected sentence — no preamble, no commentary, no surrounding quotation marks.`

async function repairSentence(
  client: OpenAI,
  model: string,
  sentence: string,
  fixes: Array<{ variant: string; canonical: string }>,
): Promise<string | null> {
  const instructions = fixes.map(f => `- Replace "${f.variant}" with "${f.canonical}" everywhere it appears in this sentence.`).join('\n')
  const prompt = `Rewrite ONLY the CURRENT sentence below, applying these exact terminology fixes and nothing else:

${instructions}

CURRENT SENTENCE:
${sentence}`

  const completion = await client.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: REPAIR_SYSTEM_PROMPT },
      { role: 'user', content: prompt },
    ],
    max_tokens: 512,
    temperature: 0,
  })

  const text = completion.choices[0]?.message?.content?.trim()
  return text || null
}

export async function repairTerminologyDrift(
  client: OpenAI,
  model: string,
  outputText: string,
  violations: TerminologyViolation[],
): Promise<TerminologyRepairResult> {
  if (violations.length === 0) {
    return { attempted: false, succeeded: false, text: outputText, sentencesRepaired: 0 }
  }

  const trimmedOutput = outputText.trim()
  const sentences = splitSentences(trimmedOutput)
  const spans = locateSentenceSpans(trimmedOutput, sentences)

  // A sentence can carry more than one violation — fix it once, with every
  // one of its required substitutions in the same prompt.
  const fixesByIndex = new Map<number, Array<{ variant: string; canonical: string }>>()
  sentences.forEach((sentence, index) => {
    for (const violation of violations) {
      const escaped = violation.variant.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const re = new RegExp(`(?<![a-zA-Z0-9])${escaped}(?![a-zA-Z0-9])`, 'i')
      if (re.test(sentence)) {
        const list = fixesByIndex.get(index) ?? []
        list.push({ variant: violation.variant, canonical: violation.canonical })
        fixesByIndex.set(index, list)
      }
    }
  })

  if (fixesByIndex.size === 0) {
    // Every violation matched at the whole-document level but not within
    // any single split sentence (e.g. it straddles a sentence boundary) —
    // nothing this targeted mechanism can localize a fix into.
    return { attempted: false, succeeded: false, text: outputText, sentencesRepaired: 0 }
  }

  const replacements = new Map<number, string>()
  for (const [index, fixes] of fixesByIndex) {
    const repaired = await repairSentence(client, model, sentences[index]!, fixes)
    if (repaired) replacements.set(index, repaired)
  }

  if (replacements.size === 0) {
    return { attempted: true, succeeded: false, text: outputText, sentencesRepaired: 0 }
  }

  const repairedText = spliceSentences(trimmedOutput, spans, replacements)
  return { attempted: true, succeeded: true, text: repairedText, sentencesRepaired: replacements.size }
}
