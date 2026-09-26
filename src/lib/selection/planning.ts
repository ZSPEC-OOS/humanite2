import type OpenAI from 'openai'
import type { RewritePlan } from './types'

// "Planning call (intensity >= 7 only) produces a RewritePlan of sentence
// and paragraph operations that all candidates share" — one call up front
// decides HOW to restructure (merge these two sentences, split that one,
// move this clause), and every candidate's generation prompt gets the same
// plan (see buildPlanSection), so candidates differ in wording, not in
// which structural moves they each independently guess at. This is what
// replaces "forcing sentence-length templates" with an explicit plan.

const MAX_OPERATIONS = 6

function buildPlanningPrompt(sourceText: string): string {
  return `Read the SOURCE text below and propose a small number of sentence- and paragraph-level restructuring operations that would make a rewrite of it read as naturally varied prose — merging or splitting sentences, reordering clauses or sentences within a paragraph, moving a topic sentence — without changing any fact, name, number, date, or claim.

Return ONLY a JSON object of this exact shape: {"operations": ["<a short, concrete instruction>", ...]}

Propose at most ${MAX_OPERATIONS} operations. Return {"operations": []} if the text is already well-structured and no operation would help.

SOURCE:
${sourceText}`
}

export async function buildRewritePlan(client: OpenAI, model: string, sourceText: string): Promise<RewritePlan> {
  const completion = await client.chat.completions.create({
    model,
    messages: [{ role: 'user', content: buildPlanningPrompt(sourceText) }],
    response_format: { type: 'json_object' },
    temperature: 0.5,
  })

  const raw = JSON.parse(completion.choices[0]?.message?.content ?? '{}')
  const operations = Array.isArray(raw.operations) ? raw.operations.slice(0, MAX_OPERATIONS).map(String) : []
  return { operations }
}

// Empty string (not a heading with nothing under it) when there's nothing
// to say — buildUserPrompt only inserts this section when it's non-empty.
export function buildPlanSection(plan: RewritePlan): string {
  if (plan.operations.length === 0) return ''
  return `## STRUCTURAL PLAN — every candidate shares this same plan; vary only the wording, not which of these operations you apply\n${plan.operations.map(op => `- ${op}`).join('\n')}`
}
