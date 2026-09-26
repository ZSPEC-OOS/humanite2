import type { DocumentContext } from './types'

// Renders the shared context every chunk's prompt embeds, the same way
// Phase 8's buildPlanSection shares one plan across candidates — here, one
// DocumentContext shares canonical terminology/abbreviations and prior-
// section awareness across every chunk of a document. Empty string (no
// section at all) when the context carries nothing worth constraining,
// rather than an empty heading.
export function buildDocumentContextSection(context: DocumentContext): string {
  const parts: string[] = []

  const terminologyEntries = Object.entries(context.terminology)
  if (terminologyEntries.length > 0) {
    const lines = terminologyEntries.map(([variant, canonical]) => `- Use "${canonical}" — never "${variant}" — every time, in this and every other part of the document.`)
    parts.push(`TERMINOLOGY (must match every other part of this document):\n${lines.join('\n')}`)
  }

  const abbreviationEntries = Object.entries(context.abbreviations)
  if (abbreviationEntries.length > 0) {
    const lines = abbreviationEntries.map(([abbr, expansion]) => `- "${abbr}" means "${expansion}" — expand it this way on first use in this part; never a different expansion.`)
    parts.push(`ABBREVIATIONS (must match every other part of this document):\n${lines.join('\n')}`)
  }

  if (context.sectionSummaries.length > 0) {
    parts.push(`OTHER PARTS OF THIS DOCUMENT (for context — do not repeat this content, it is handled elsewhere):\n${context.sectionSummaries.map(s => `- ${s}`).join('\n')}`)
  }

  if (parts.length === 0) return ''
  return `## DOCUMENT-WIDE CONSISTENCY — this text is one part of a larger document\n${parts.join('\n\n')}`
}
