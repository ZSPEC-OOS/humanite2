import type { CompiledStyle } from './types'

// Renders a compiled style into the prompt-ready body humanizePipeline.ts's
// buildUserPrompt embeds under its own "## STYLE PARAMETERS" heading —
// deliberately returns only the body (no heading of its own) so the caller
// controls section placement relative to intensity guidance.
export function buildStyleSection(compiled: CompiledStyle): string {
  // Domain/genre/audience rules already won any same-tag conflict against
  // tone during compilation (see compiler.ts) — but a flat bullet list
  // gives a reader (model included) no signal that one of these lines is a
  // hard override and another is a soft preference. Rendering them as two
  // explicitly labeled groups is what actually makes compliance with, say,
  // legal's "never use contractions" more reliable: it stops competing on
  // equal footing with tone's "use contractions freely" for attention.
  const overrideRules = compiled.rules.filter(r => r.source !== 'tone')
  const toneRules = compiled.rules.filter(r => r.source === 'tone')

  const overrideBlock = overrideRules.length
    ? `\nRequired constraints — these always apply and override tone wherever they conflict with it:\n${overrideRules.map(r => `- ${r.text}`).join('\n')}\n`
    : ''
  const toneBlock = toneRules.length
    ? `\nTone guidance — apply wherever it does not conflict with a required constraint above:\n${toneRules.map(r => `- ${r.text}`).join('\n')}`
    : ''

  const exampleBlock = compiled.examples.length
    ? `\n\nExample of this register:\n${compiled.examples.map(e => `"${e.text}"`).join('\n')}`
    : ''
  // Omitted entirely when not selected — no "Genre: (none)" line cluttering
  // the pre-Phase-10 tone/domain-only prompt shape.
  const genreLine = compiled.genre ? `\nGenre: ${compiled.genre}` : ''
  const audienceLine = compiled.audience ? `\nAudience: ${compiled.audience}` : ''

  return `Tone: ${compiled.tone}
Domain: ${compiled.domain}${genreLine}${audienceLine}
${overrideBlock}${toneBlock}${exampleBlock}`
}
