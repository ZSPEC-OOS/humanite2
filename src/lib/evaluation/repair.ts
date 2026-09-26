import type OpenAI from 'openai'
import { splitSentences } from '@/lib/detection/diagnostics/tokenize'
import { alignSentences } from '@/lib/textAlign'
import { validateFactLedger } from '@/lib/fidelity'
import type { FidelityFailure } from '@/lib/fidelity'

// Diagnose -> classify -> repair, reserved for fact/relation failures Phase
// 5's deterministic fact ledger catches that the whole-document
// entity_preservation check (qualityGates.ts) does not — a value swap
// between two sentences (e.g. two entities' version numbers transposed)
// survives entity_preservation, since both values still appear SOMEWHERE in
// the output, but fails validateFactLedger, which binds each fact to the
// specific sentence it must hold in. Repairing just the affected sentence
// is cheaper and more precise than regenerating the whole chunk, which is
// why this runs as a targeted, POST-retry-loop step rather than folded into
// humanizePipeline.ts's existing regenerate-the-whole-chunk retry loop.

export type RepairStrategy = 'sentence_repair' | 'none'

export interface RepairResult {
  attempted: boolean
  strategy: RepairStrategy
  succeeded: boolean
  text: string
  sentencesRepaired: number
}

// A fact failure is only repairable at the sentence level when its source
// sentence aligned to SOME output sentence — with no aligned sentence to
// target (a genuinely dropped clause, not a rephrasing), there is nothing
// to splice a fix into and this strategy does not apply.
export function classifyFailure(failures: FidelityFailure[], alignedSourceIndexes: Set<number>): RepairStrategy {
  const hasLocalizedFailure = failures.some(f => alignedSourceIndexes.has(f.fact.sentenceIndex))
  return hasLocalizedFailure ? 'sentence_repair' : 'none'
}

const REPAIR_SYSTEM_PROMPT = `You are a precise copy editor. You fix ONE sentence at a time so it correctly includes required facts, changing as little else as possible. Output ONLY the corrected sentence — no preamble, no commentary, no surrounding quotation marks.`

export async function repairSentence(
  client: OpenAI,
  model: string,
  sourceSentence: string,
  outputSentence: string,
  failures: FidelityFailure[],
  tone: string,
  domain: string,
): Promise<string | null> {
  const requiredFacts = failures.map(f => `- "${f.fact.text}" (${f.fact.type})`).join('\n')
  const prompt = `Rewrite ONLY the CURRENT sentence below so every required fact appears exactly as written, while keeping the same "${tone}" tone and "${domain}" domain conventions as the rest of the passage. Preserve as much of the current sentence's phrasing as possible — correct only what is necessary.

SOURCE SENTENCE (ground truth for the facts below):
${sourceSentence}

CURRENT SENTENCE (has a fidelity problem):
${outputSentence}

REQUIRED FACTS THAT MUST APPEAR, EXACTLY AS WRITTEN:
${requiredFacts}`

  const completion = await client.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: REPAIR_SYSTEM_PROMPT },
      { role: 'user', content: prompt },
    ],
    max_tokens: 512,
    temperature: 0.3,
  })

  const text = completion.choices[0]?.message?.content?.trim()
  return text || null
}

// Finds each output sentence's exact character span in `text` by searching
// forward from the end of the previous span — sentences come from
// splitSentences(text), so each is a verbatim (trim-only) substring of
// `text` in order, letting a repaired sentence be spliced back in without
// disturbing whitespace/formatting the split step itself discarded.
function locateSentenceSpans(text: string, sentences: string[]): Array<{ start: number; end: number }> {
  const spans: Array<{ start: number; end: number }> = []
  let searchFrom = 0
  for (const sentence of sentences) {
    const start = text.indexOf(sentence, searchFrom)
    if (start === -1) {
      spans.push({ start: searchFrom, end: searchFrom })
      continue
    }
    const end = start + sentence.length
    spans.push({ start, end })
    searchFrom = end
  }
  return spans
}

function spliceSentences(text: string, spans: Array<{ start: number; end: number }>, replacements: Map<number, string>): string {
  let result = ''
  let cursor = 0
  spans.forEach((span, index) => {
    const replacement = replacements.get(index)
    if (replacement == null) return
    result += text.slice(cursor, span.start) + replacement
    cursor = span.end
  })
  result += text.slice(cursor)
  return result
}

export async function repairChunk(
  client: OpenAI,
  model: string,
  sourceText: string,
  outputText: string,
  tone: string,
  domain: string,
): Promise<RepairResult> {
  const fidelityResult = validateFactLedger(sourceText, outputText)
  if (fidelityResult.passed) {
    return { attempted: false, strategy: 'none', succeeded: false, text: outputText, sentencesRepaired: 0 }
  }

  const trimmedOutput = outputText.trim()
  const sourceSentences = splitSentences(sourceText)
  const outputSentences = splitSentences(trimmedOutput)
  const alignments = alignSentences(sourceSentences, outputSentences)
  const outputIndexBySourceIndex = new Map(alignments.map(a => [a.sourceIndex, a.outputIndex]))

  const strategy = classifyFailure(fidelityResult.failures, new Set(outputIndexBySourceIndex.keys()))
  if (strategy === 'none') {
    return { attempted: false, strategy: 'none', succeeded: false, text: outputText, sentencesRepaired: 0 }
  }

  // Several failing facts can point at the same output sentence — repair
  // that sentence once, with every one of its required facts in the prompt.
  const failuresByOutputIndex = new Map<number, FidelityFailure[]>()
  for (const failure of fidelityResult.failures) {
    const outputIndex = outputIndexBySourceIndex.get(failure.fact.sentenceIndex)
    if (outputIndex == null) continue
    const list = failuresByOutputIndex.get(outputIndex) ?? []
    list.push(failure)
    failuresByOutputIndex.set(outputIndex, list)
  }

  const spans = locateSentenceSpans(trimmedOutput, outputSentences)
  const replacements = new Map<number, string>()
  for (const [outputIndex, failures] of failuresByOutputIndex) {
    const sourceIndex = failures[0]!.fact.sentenceIndex
    const repaired = await repairSentence(client, model, sourceSentences[sourceIndex]!, outputSentences[outputIndex]!, failures, tone, domain)
    if (repaired) replacements.set(outputIndex, repaired)
  }

  if (replacements.size === 0) {
    return { attempted: true, strategy, succeeded: false, text: outputText, sentencesRepaired: 0 }
  }

  const repairedText = spliceSentences(trimmedOutput, spans, replacements)
  // Never ship a "repair" that didn't actually fix the underlying problem —
  // verify against the same deterministic check that flagged it.
  const verification = validateFactLedger(sourceText, repairedText)

  return {
    attempted: true,
    strategy,
    succeeded: verification.passed,
    text: verification.passed ? repairedText : outputText,
    sentencesRepaired: verification.passed ? replacements.size : 0,
  }
}
