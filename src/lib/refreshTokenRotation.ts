import type { Firestore } from 'firebase-admin/firestore'
import { generateRefreshToken } from '@/lib/auth-utils'

export interface RotationResult {
  ok: boolean
  userId?: string
  rawRefreshToken?: string
}

// Consumes `tokenHash` and mints its successor atomically, inside a single
// Firestore transaction — the read (is this token still valid and unused?)
// and the write (mark it used, create the next one) must commit together.
// Split across two separate calls (as this used to be), two concurrent
// requests holding the same still-valid token can both read "not yet
// revoked" before either write lands, and both walk away with a working
// successor token — defeating the family-based reuse/theft detection below,
// which depends on a SECOND use of an already-consumed token being
// detectable at all.
//
// Firestore's optimistic-concurrency retry does the actual work here: if
// two transactions both read the same token doc with revokedAt: null, only
// one commits: the loser's transaction retries automatically, re-reads the
// token (now revoked by the winner), and correctly falls into the
// theft-detection branch below instead of silently succeeding a second time.
export async function rotateRefreshToken(firestore: Firestore, tokenHash: string): Promise<RotationResult> {
  return firestore.runTransaction(async (tx) => {
    const tokenRef = firestore.collection('refreshTokens').doc(tokenHash)
    const tokenSnap = await tx.get(tokenRef)
    if (!tokenSnap.exists) return { ok: false }

    const token = tokenSnap.data()!

    // Reuse of an already-consumed token — the family is presumed stolen.
    // Revoked inside the same transaction as the read that detected it, so
    // this decision and its consequence are atomic with each other too.
    if (token.revokedAt) {
      const familySnap = await tx.get(
        firestore.collection('refreshTokens')
          .where('familyId', '==', token.familyId)
          .where('revokedAt', '==', null),
      )
      const now = new Date()
      familySnap.docs.forEach(d => tx.update(d.ref, { revokedAt: now }))
      return { ok: false }
    }

    if (token.expiresAt.toDate() < new Date()) {
      return { ok: false }
    }

    const { raw, hash } = generateRefreshToken()
    tx.update(tokenRef, { revokedAt: new Date() })
    tx.set(firestore.collection('refreshTokens').doc(hash), {
      userId: token.userId,
      familyId: token.familyId,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      createdAt: new Date(),
      revokedAt: null,
    })

    return { ok: true, userId: token.userId, rawRefreshToken: raw }
  })
}
