import type { Firestore } from 'firebase-admin/firestore'
import { createHash, randomUUID } from 'crypto'
import { hashPassword } from '@/lib/auth-utils'

export interface RegisterResult {
  ok: boolean
  userId?: string
}

// Registers a new user with an atomically-enforced unique email. The old
// approach — a `.where('email','==',email).limit(1).get()` existence check
// followed by a separate `.doc(randomUUID()).set()` — has a gap between the
// two calls: two concurrent registrations for the same address can both
// observe "no existing user" and both insert, leaving two user documents
// that share an email the login query (`.where('email','==',...).limit(1)`)
// can only ever return one of.
//
// This makes the check and the insert one atomic operation instead, keyed
// off a dedicated emailIndex/{emailHash} document: whichever registration's
// transaction commits first wins the index slot, and Firestore's own
// optimistic-concurrency retry makes the loser's transaction re-read the
// index, see it now taken, and correctly report EMAIL_TAKEN rather than
// creating a second account.
export async function registerUser(firestore: Firestore, email: string, password: string): Promise<RegisterResult> {
  const userId = randomUUID()
  const passwordHash = await hashPassword(password)
  const now = new Date()
  const emailKey = createHash('sha256').update(email).digest('hex')

  const created = await firestore.runTransaction(async (tx) => {
    const emailIndexRef = firestore.collection('emailIndex').doc(emailKey)
    const emailIndexSnap = await tx.get(emailIndexRef)
    if (emailIndexSnap.exists) return false

    tx.set(emailIndexRef, { userId, createdAt: now })
    tx.set(firestore.collection('users').doc(userId), {
      email,
      passwordHash,
      tier: 'free',
      region: 'us-east1',
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    })
    return true
  })

  return created ? { ok: true, userId } : { ok: false }
}
