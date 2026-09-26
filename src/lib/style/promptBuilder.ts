import type { CompiledStyle } from './types'

// Renders a compiled style into the prompt-ready body humanizePipeline.ts's
// buildUserPrompt embeds under its own "## STYLE PARAMETERS" heading —
// deliberately returns only the body (no heading of its own) so the caller
// controls section placement relative to intensity guidance.
export function buildStyleSection(compiled: CompiledStyle): string {
  const ruleLines = compiled.rules.map(rule => `- ${rule.text}`).join('\n')
  const exampleBlock = compiled.examples.length
    ? `\n\nExample of this register:\n${compiled.examples.map(e => `"${e.text}"`).join('\n')}`
    : ''

  return `Tone: ${compiled.tone}
Domain: ${compiled.domain}

${ruleLines}${exampleBlock}`
}
