// "Candidates: intensity 1–3 → 1; 4–6 → 2; 7–10 → 3" per the plan's Phase 8
// spec — search more at high intensity, where there's more room for a
// generation attempt to go wrong (or right) in different ways, and where
// the domain caps (see intensity/effectiveIntensity.ts) already keep the
// riskiest domains off this path entirely (legal caps at 4, medical at 5).
export function candidateCountForIntensity(intensity: number): number {
  if (intensity <= 3) return 1
  if (intensity <= 6) return 2
  return 3
}
