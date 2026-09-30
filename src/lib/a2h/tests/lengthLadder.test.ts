import { describe, it, expect } from 'vitest'
import type { Firestore } from 'firebase-admin/firestore'
import { validateLadderValues, getLengthLadderConfig, saveLengthLadder, lockLengthLadder, expandLengthLadder } from '../lengthLadder'

function makeFirestore() {
  const docs = new Map<string, Record<string, unknown>>()
  function docRef(id: string) {
    return {
      get: async () => ({ exists: docs.has(id), data: () => docs.get(id) }),
      set: async (data: Record<string, unknown>) => { docs.set(id, data) },
    }
  }
  const collection = { doc: (id: string) => docRef(id) }
  const firestore = { collection: () => collection }
  return { firestore: firestore as unknown as Firestore, docs }
}

describe('validateLadderValues', () => {
  it('accepts a non-empty array of positive integers, sorted ascending', () => {
    const result = validateLadderValues([500, 100, 1000])
    expect('ladder' in result && result.ladder).toEqual([100, 500, 1000])
  })

  it('rejects an empty array', () => {
    expect(validateLadderValues([])).toHaveProperty('error')
  })

  it('rejects a non-array', () => {
    expect(validateLadderValues('not an array')).toHaveProperty('error')
    expect(validateLadderValues(undefined)).toHaveProperty('error')
  })

  it('rejects a non-integer or non-positive value', () => {
    expect(validateLadderValues([100, 0])).toHaveProperty('error')
    expect(validateLadderValues([100, -50])).toHaveProperty('error')
    expect(validateLadderValues([100, 200.5])).toHaveProperty('error')
  })

  it('rejects duplicate values — this must fail: 100, 200, 500, 500, 1000', () => {
    const result = validateLadderValues([100, 200, 500, 500, 1000])
    expect(result).toHaveProperty('error')
    expect('error' in result && result.error).toMatch(/duplicate/i)
  })
})

describe('getLengthLadderConfig', () => {
  it('returns null when no ladder has been saved', async () => {
    const { firestore } = makeFirestore()
    expect(await getLengthLadderConfig(firestore)).toBeNull()
  })
})

describe('saveLengthLadder', () => {
  it('persists an unlocked, sorted ladder', async () => {
    const { firestore } = makeFirestore()
    const config = await saveLengthLadder(firestore, [300, 100, 200])
    expect(config.ladder).toEqual([100, 200, 300])
    expect(config.locked).toBe(false)
    expect(await getLengthLadderConfig(firestore)).toEqual(config)
  })

  it('rejects invalid values without persisting', async () => {
    const { firestore } = makeFirestore()
    await expect(saveLengthLadder(firestore, [100, 100])).rejects.toThrow(/duplicate/i)
    expect(await getLengthLadderConfig(firestore)).toBeNull()
  })

  it('refuses to save once locked', async () => {
    const { firestore } = makeFirestore()
    await lockLengthLadder(firestore, [100, 200])
    await expect(saveLengthLadder(firestore, [100, 200, 300])).rejects.toThrow(/locked/i)
  })
})

describe('lockLengthLadder', () => {
  it('locks a previously-saved ladder and sets lockedAt', async () => {
    const { firestore } = makeFirestore()
    await saveLengthLadder(firestore, [100, 200])
    const locked = await lockLengthLadder(firestore)
    expect(locked.locked).toBe(true)
    expect(locked.lockedAt).not.toBeNull()
    expect(locked.ladder).toEqual([100, 200])
  })

  it('can save-and-lock in one call', async () => {
    const { firestore } = makeFirestore()
    const locked = await lockLengthLadder(firestore, [500, 1000])
    expect(locked.locked).toBe(true)
    expect(locked.ladder).toEqual([500, 1000])
  })

  it('throws when nothing has been saved and no values are provided', async () => {
    const { firestore } = makeFirestore()
    await expect(lockLengthLadder(firestore)).rejects.toThrow(/set a length ladder/i)
  })

  it('is idempotent — locking an already-locked ladder preserves the original lockedAt', async () => {
    const { firestore } = makeFirestore()
    const first = await lockLengthLadder(firestore, [100, 200])
    const second = await lockLengthLadder(firestore, [100, 200])
    expect(second.lockedAt).toBe(first.lockedAt)
  })
})

describe('expandLengthLadder', () => {
  it('grows a locked ladder with new, non-overlapping lengths', async () => {
    const { firestore } = makeFirestore()
    await lockLengthLadder(firestore, [100, 200, 500])
    const expanded = await expandLengthLadder(firestore, [1000, 300])
    expect(expanded.ladder).toEqual([100, 200, 300, 500, 1000])
    expect(expanded.locked).toBe(true)
  })

  it('refuses to expand an unlocked ladder', async () => {
    const { firestore } = makeFirestore()
    await saveLengthLadder(firestore, [100, 200])
    await expect(expandLengthLadder(firestore, [300])).rejects.toThrow(/lock the length ladder/i)
  })

  it('refuses to expand with a length that already exists — never a silent no-op', async () => {
    const { firestore } = makeFirestore()
    await lockLengthLadder(firestore, [100, 200, 500])
    await expect(expandLengthLadder(firestore, [200])).rejects.toThrow(/already exist/i)
  })

  it('never removes an existing length — the ladder only grows', async () => {
    const { firestore } = makeFirestore()
    await lockLengthLadder(firestore, [100, 200])
    const expanded = await expandLengthLadder(firestore, [300])
    expect(expanded.ladder).toContain(100)
    expect(expanded.ladder).toContain(200)
    expect(expanded.ladder).toContain(300)
  })
})
