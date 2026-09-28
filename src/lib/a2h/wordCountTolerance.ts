// Word-count acceptance bands per §7.2 — tighter at longer lengths, where a
// fixed percentage represents a much larger absolute word budget. These are
// deliberately plain functions, not constants baked into corpus.ts, so the
// corpus version can carry its own tolerance config later without touching
// the generation/persistence code that calls this.
export function toleranceFor(targetWords: number): number {
  if (targetWords <= 300) return 0.05
  if (targetWords <= 1000) return 0.04
  return 0.03
}

export function isWithinTolerance(targetWords: number, actualWords: number): boolean {
  const diff = Math.abs(actualWords - targetWords) / targetWords
  return diff <= toleranceFor(targetWords)
}
