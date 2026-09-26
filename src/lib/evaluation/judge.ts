import type OpenAI from 'openai'

// "Tone, domain and fidelity judging run in one structured call on a
// separately configured model (JUDGE_MODEL)" per the plan's Phase 6 spec.
// Extends Phase 1's entailment-only judge call (qualityGates.ts's
// checkEntailment, kept as its own standalone primitive for existing
// callers) with tone/domain/coherence/naturalness in the SAME call rather
// than three or four additional ones — directly serving the Budget
// section's "merged; survivors only" call-count target.
export interface StructuredJudgeResult {
  entailment_probability: number
  entailment_issues: string[]
  // 0-1: how well the output matches the requested tone/domain — null
  // fields never appear here (this call either fully succeeds or the
  // caller catches the rejection), unlike the per-gate null convention
  // used where a gate can PARTIALLY fail.
  tone_alignment: number
  domain_alignment: number
  // Logical flow / readability, independent of tone or domain fit.
  coherence: number
  // Carries low weight until calibrated against blind human ratings (per
  // the plan) — a subjective judge estimate only; the log-probability
  // proxy (Binoculars-style, ref. 5) stays unimplemented until Phase 9
  // reports which providers even support returning logprobs.
  naturalness: number
  style_issues: string[]
}

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n))
}

export async function runStructuredJudge(
  client: OpenAI,
  judgeModel: string,
  original: string,
  output: string,
  tone: string,
  domain: string,
): Promise<StructuredJudgeResult> {
  const prompt = `Compare the ORIGINAL and REWRITE below. The REWRITE was produced with a target tone of "${tone}" and a target domain of "${domain}".

Judge four independent things and return ONLY a JSON object of this exact shape:
{"entailment_probability": <0.0-1.0>, "entailment_issues": ["<short description of each contradiction, addition, or omission>"], "tone_alignment": <0.0-1.0>, "domain_alignment": <0.0-1.0>, "coherence": <0.0-1.0>, "naturalness": <0.0-1.0>, "style_issues": ["<short description of each tone/domain/coherence problem found>"]}

- entailment_probability: 1.0 means the REWRITE is fully faithful to the ORIGINAL's factual content. Lower it for any added claim, dropped claim, changed number/name/date, or altered meaning. The REWRITE may reorder or rephrase freely without penalty.
- tone_alignment: 1.0 means the REWRITE's register (formality, contraction use, sentence length, person, hedging) matches the "${tone}" target well. Judge the REWRITE alone, not the ORIGINAL's tone.
- domain_alignment: 1.0 means the REWRITE respects "${domain}"-domain conventions (e.g. legal: no contractions, preserved defined terms and modal verbs; medical: preserved negation and dose-frequency relations; technical: preserved identifiers and step order; academic: preserved hedge strength and citation attachment).
- coherence: 1.0 means the REWRITE reads as a logically well-organized, readable passage on its own, independent of tone or domain fit.
- naturalness: 1.0 means the REWRITE reads as natural, fluent prose. This is a rough, uncalibrated estimate — do not overweight it relative to the other three.

issues arrays are empty if there are none.

ORIGINAL:
${original}

REWRITE:
${output}`

  const completion = await client.chat.completions.create({
    model: judgeModel,
    messages: [{ role: 'user', content: prompt }],
    response_format: { type: 'json_object' },
    temperature: 0,
  })

  const raw = JSON.parse(completion.choices[0]?.message?.content ?? '{}')
  return {
    entailment_probability: clamp01(Number(raw.entailment_probability) || 0),
    entailment_issues: Array.isArray(raw.entailment_issues) ? raw.entailment_issues.slice(0, 10).map(String) : [],
    tone_alignment: clamp01(Number(raw.tone_alignment) || 0),
    domain_alignment: clamp01(Number(raw.domain_alignment) || 0),
    coherence: clamp01(Number(raw.coherence) || 0),
    naturalness: clamp01(Number(raw.naturalness) || 0),
    style_issues: Array.isArray(raw.style_issues) ? raw.style_issues.slice(0, 10).map(String) : [],
  }
}
