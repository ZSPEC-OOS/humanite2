// Reusable operational script: grants (or changes) an account's tier
// directly in Firestore. This is the administrative mechanism requirement
// #7/#8 in the Gold-tier request calls for — a data update using the
// repository's existing account model (see src/lib/setAccountTier.ts and
// src/lib/accountTier.ts), not a one-off hack specific to any single
// account. Run it again with a different email/tier to grant (or later
// change) any other account.
//
// Usage:
//   npx tsx scripts/setAccountTier.ts <email> <tier>
//
// Example (the account this script was first written for):
//   npx tsx scripts/setAccountTier.ts jdzelazny@gmail.com gold
//
// Requires the same Firebase credentials the running app uses:
//   FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY
//
// The change takes effect the next time the account logs in or refreshes
// its access token (at most 15 minutes, the access token's own lifetime —
// see auth-utils.ts's ACCESS_EXPIRE_MINUTES) — no restart or deploy needed.
import { db } from '@/lib/firestore'
import { setAccountTierByEmail } from '@/lib/setAccountTier'
import { ACCOUNT_TIERS } from '@/lib/accountTier'

async function main() {
  const [, , email, tier] = process.argv

  if (!email || !tier) {
    console.error('Usage: npx tsx scripts/setAccountTier.ts <email> <tier>')
    console.error(`Valid tiers: ${ACCOUNT_TIERS.join(', ')}`)
    process.exitCode = 1
    return
  }

  const result = await setAccountTierByEmail(db(), email, tier)
  if (!result.ok) {
    console.error(result.reason)
    process.exitCode = 1
    return
  }

  console.log(`${email}: tier '${result.previousTier ?? '(none)'}' -> '${tier}' (user ${result.userId})`)
}

main().catch(err => {
  console.error(err)
  process.exitCode = 1
})
