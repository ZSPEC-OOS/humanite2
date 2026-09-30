import type { Firestore } from 'firebase-admin/firestore'
import type { LengthLadderConfig } from './types'

const COLLECTION = 'a2hLengthLadder'
// Global singleton — see types.ts's LengthLadderConfig doc comment for why
// this is one shared document rather than one per domain.
const DOC_ID = 'default'

export function validateLadderValues(values: unknown): { ladder: number[] } | { error: string } {
  if (!Array.isArray(values) || values.length === 0) {
    return { error: 'The length ladder must be a non-empty array of word counts.' }
  }
  const numbers: number[] = []
  for (const v of values) {
    const n = Number(v)
    if (!Number.isInteger(n) || n <= 0) {
      return { error: `Every length must be a positive integer — got ${JSON.stringify(v)}.` }
    }
    numbers.push(n)
  }
  if (new Set(numbers).size !== numbers.length) {
    return { error: 'The length ladder contains duplicate values.' }
  }
  return { ladder: [...numbers].sort((a, b) => a - b) }
}

export async function getLengthLadderConfig(firestore: Firestore): Promise<LengthLadderConfig | null> {
  const doc = await firestore.collection(COLLECTION).doc(DOC_ID).get()
  return doc.exists ? (doc.data() as LengthLadderConfig) : null
}

// Persists the ladder while it's still unlocked — freely re-savable until
// locked, since no corpus source has been keyed against it yet.
export async function saveLengthLadder(firestore: Firestore, values: unknown): Promise<LengthLadderConfig> {
  const existing = await getLengthLadderConfig(firestore)
  if (existing?.locked) {
    throw new Error('The length ladder is locked — use expandLengthLadder to add lengths.')
  }
  const result = validateLadderValues(values)
  if ('error' in result) throw new Error(result.error)

  const config: LengthLadderConfig = { ladder: result.ladder, locked: false, lockedAt: null, updatedAt: new Date().toISOString() }
  await firestore.collection(COLLECTION).doc(DOC_ID).set(config)
  return config
}

// Locks the ladder, which gates corpus source generation (the generate
// route refuses targetWords against anything but a locked ladder) — the
// dimension must be settled before content is generated against its
// lengths. Optionally saves a new set of values in the same call, so the
// UI's "Lock" action can commit whatever's in the input without a separate
// save step.
export async function lockLengthLadder(firestore: Firestore, values?: unknown): Promise<LengthLadderConfig> {
  const existing = await getLengthLadderConfig(firestore)
  const source = values ?? existing?.ladder
  if (source == null) throw new Error('Set a length ladder before locking.')
  const result = validateLadderValues(source)
  if ('error' in result) throw new Error(result.error)

  const config: LengthLadderConfig = {
    ladder: result.ladder,
    locked: true,
    lockedAt: existing?.locked ? existing.lockedAt : new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
  await firestore.collection(COLLECTION).doc(DOC_ID).set(config)
  return config
}

// Growing the ladder only — never removes an existing length, since a
// source may already exist (and be frozen) at that length in any domain.
// Rejects any additional value already present in the current ladder,
// consistent with validateLadderValues' "duplicates are an error, never a
// silent no-op" rule for a single submission.
export async function expandLengthLadder(firestore: Firestore, additionalValues: unknown): Promise<LengthLadderConfig> {
  const existing = await getLengthLadderConfig(firestore)
  if (!existing || !existing.locked) {
    throw new Error('Lock the length ladder before expanding it.')
  }
  const result = validateLadderValues(additionalValues)
  if ('error' in result) throw new Error(result.error)

  const overlap = result.ladder.filter(n => existing.ladder.includes(n))
  if (overlap.length > 0) {
    throw new Error(`These lengths already exist in the ladder: ${overlap.join(', ')}.`)
  }

  const merged = [...existing.ladder, ...result.ladder].sort((a, b) => a - b)
  const config: LengthLadderConfig = { ...existing, ladder: merged, updatedAt: new Date().toISOString() }
  await firestore.collection(COLLECTION).doc(DOC_ID).set(config)
  return config
}
