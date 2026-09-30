import type { Firestore } from 'firebase-admin/firestore'
import type OpenAI from 'openai'
import type { ClaimVerifierCalibrationResult } from './a2h16'
import { runClaimVerifierCalibration } from './a2h16'

// Calibration tests the model-based claim VERIFIER itself against a fixed
// dataset (see a2h16.ts) — independent of any corpus project or run, so it
// is cached globally by verifierConfigVersion alone, not scoped to a
// fixture set or run. Idempotent the same way BenchmarkRepairAttempt is:
// an existing result is reused unless the caller explicitly forces a
// recomputation, so a page load never silently re-triggers a paid call.
const COLLECTION = 'a2hClaimVerifierCalibrations'

export async function getClaimVerifierCalibration(firestore: Firestore, verifierConfigVersion: string): Promise<ClaimVerifierCalibrationResult | null> {
  const doc = await firestore.collection(COLLECTION).doc(verifierConfigVersion).get()
  return doc.exists ? (doc.data() as ClaimVerifierCalibrationResult) : null
}

export async function getOrRunClaimVerifierCalibration(
  firestore: Firestore,
  client: OpenAI,
  model: string,
  verifierConfigVersion: string,
  force = false,
): Promise<ClaimVerifierCalibrationResult> {
  if (!force) {
    const existing = await getClaimVerifierCalibration(firestore, verifierConfigVersion)
    if (existing) return existing
  }
  const result = await runClaimVerifierCalibration(client, model, verifierConfigVersion)
  await firestore.collection(COLLECTION).doc(verifierConfigVersion).set(result)
  return result
}
