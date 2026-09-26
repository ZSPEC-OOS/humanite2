import type { Firestore } from 'firebase-admin/firestore'
import { ACCOUNT_TIERS } from './accountTier'

export interface SetAccountTierResult {
  ok: boolean
  userId?: string
  previousTier?: string | undefined
  reason?: string
}

// Looks up an account by email and overwrites its stored `tier` — the same
// field userRegistration.ts sets to 'free' at signup and every login/
// refresh route re-reads to sign into that session's access token (see
// auth-utils.ts's issueAccessToken). Granting Gold (or any other tier) to
// an account is exactly this: a data change on the existing `tier` field,
// never a parallel entitlement table or a per-account code branch — the
// change takes effect the next time that account logs in or refreshes its
// (short-lived, 15-minute) access token.
//
// Mirrors the login route's own lookup (email + not-deleted) rather than a
// bare email match, so a soft-deleted account can't be silently reactivated
// by granting it a tier.
export async function setAccountTierByEmail(
  firestore: Firestore,
  email: string,
  tier: string,
): Promise<SetAccountTierResult> {
  if (!ACCOUNT_TIERS.includes(tier)) {
    return { ok: false, reason: `Unknown tier '${tier}'. Valid tiers: ${ACCOUNT_TIERS.join(', ')}` }
  }

  const normalizedEmail = email.trim().toLowerCase()
  const snap = await firestore.collection('users')
    .where('email', '==', normalizedEmail)
    .where('deletedAt', '==', null)
    .limit(1)
    .get()

  if (snap.empty) {
    return { ok: false, reason: `No account found for ${normalizedEmail}` }
  }

  const userDoc = snap.docs[0]!
  const previousTier = (userDoc.data() as { tier?: string }).tier
  await userDoc.ref.update({ tier, updatedAt: new Date() })

  return { ok: true, userId: userDoc.id, previousTier }
}
