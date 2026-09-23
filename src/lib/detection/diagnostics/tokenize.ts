// Shared low-level tokenization for every diagnostics module — deliberately
// simple regex splitting rather than a real NLP pipeline, since these feed
// descriptive writing statistics, not a classifier (see contracts.ts's
// LocalDiagnostics comment: never combined into an AI-probability of our
// own).

export function splitSentences(text: string): string[] {
  const trimmed = text.trim()
  if (!trimmed) return []
  return (trimmed.match(/[^.!?]+[.!?]*/g) ?? []).map(s => s.trim()).filter(Boolean)
}

export function splitParagraphs(text: string): string[] {
  return text.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean)
}

export function tokenizeWords(text: string): string[] {
  return text.toLowerCase().match(/[a-z0-9']+/g) ?? []
}
