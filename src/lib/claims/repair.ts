import type OpenAI from 'openai'
import { splitSentences } from '@/lib/detection/diagnostics/tokenize'
import { locateSentenceSpans, spliceSentences } from '@/lib/textSplice'
import type { ClaimVerdict } from './types'

// The "restore-relations" repair strategy the plan's Phase 6 spec names
// ahead of time, supplied by Phase 7's claim verifier: a relation,
// attribution, or qualifier failure verifyClaims localizes to one output
// sentence (see ClaimVerdict.outputSentenceIndex) is repaired by rewriting
// just that sentence, the same targeted, sentence-level approach
// evaluation/repair.ts uses for fact failures — cheaper and more precise
// than regenerating the whole chunk.
//
// Unlike fact repair, there is no free (non-model) way to re-verify a
// relation fix — validateFactLedger doesn't cover relations at all, and
// re-running verifyClaims costs another call. So `succeeded` here means
// only "every localized failure got a non-empty replacement sentence", not
// "confirmed correct" — the caller (humanizePipeline.ts) is responsible for
// an authoritative re-check before adopting the repaired text, the same way
// it re-scores a fact repair with a fresh runQualityGates call.

export type RelationRepairStrategy = 'restore_relations' | 'none'

export interface RelationRepairResult {
  attempted: boolean
  strategy: RelationRepairStrategy
  succeeded: boolean
  text: string
  sentencesRepaired: number
}

const REPAIR_SYSTEM_PROMPT = `You are a precise copy editor. You fix ONE sentence at a time so it correctly reflects the relation, attribution, or qualifier described, changing as little else as possible. Output ONLY the corrected sentence — no preamble, no commentary, no surrounding quotation marks.`

function describeClaim(verdict: ClaimVerdict): string {
  const c = verdict.claim
  const parts = [c.subject, c.modality, c.polarity === 'negative' ? 'not' : null, c.predicate, c.object, ...c.qualifiers].filter(Boolean)
  const reason = verdict.reason ? ` — ${verdict.reason}` : ''
  return `- "${parts.join(' ')}"${reason}`
}

async function repairSentence(
  client: OpenAI,
  model: string,
  sourceText: string,
  outputSentence: string,
  verdicts: ClaimVerdict[],
  tone: string,
  domain: string,
): Promise<string | null> {
  const problems = verdicts.map(describeClaim).join('\n')
  const prompt = `Rewrite ONLY the CURRENT sentence below so it correctly reflects these claims from the SOURCE passage, while keeping the same "${tone}" tone and "${domain}" domain conventions as the rest of the passage. Preserve as much of the current sentence's phrasing as possible — correct only what is necessary.

SOURCE PASSAGE (ground truth):
${sourceText}

CURRENT SENTENCE (misstates one or more of the claims below):
${outputSentence}

CLAIMS THAT MUST HOLD, EXACTLY AS DESCRIBED:
${problems}`

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

export async function restoreRelations(
  client: OpenAI,
  model: string,
  sourceText: string,
  outputText: string,
  failures: ClaimVerdict[],
  tone: string,
  domain: string,
): Promise<RelationRepairResult> {
  const localized = failures.filter(f => f.outputSentenceIndex != null)
  if (localized.length === 0) {
    return { attempted: false, strategy: 'none', succeeded: false, text: outputText, sentencesRepaired: 0 }
  }

  const trimmedOutput = outputText.trim()
  const outputSentences = splitSentences(trimmedOutput)
  const spans = locateSentenceSpans(trimmedOutput, outputSentences)

  // Several failing claims can point at the same output sentence — repair
  // that sentence once, with every one of its required corrections in the prompt.
  const failuresByOutputIndex = new Map<number, ClaimVerdict[]>()
  for (const failure of localized) {
    const index = failure.outputSentenceIndex!
    const list = failuresByOutputIndex.get(index) ?? []
    list.push(failure)
    failuresByOutputIndex.set(index, list)
  }

  const replacements = new Map<number, string>()
  for (const [outputIndex, verdicts] of failuresByOutputIndex) {
    const sentence = outputSentences[outputIndex]
    if (sentence == null) continue
    const repaired = await repairSentence(client, model, sourceText, sentence, verdicts, tone, domain)
    if (repaired) replacements.set(outputIndex, repaired)
  }

  if (replacements.size === 0) {
    return { attempted: true, strategy: 'restore_relations', succeeded: false, text: outputText, sentencesRepaired: 0 }
  }

  const repairedText = spliceSentences(trimmedOutput, spans, replacements)
  return { attempted: true, strategy: 'restore_relations', succeeded: true, text: repairedText, sentencesRepaired: replacements.size }
}
