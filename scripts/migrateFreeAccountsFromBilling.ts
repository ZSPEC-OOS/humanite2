// One-time reconciliation: before this patch, the Stripe webhook
// (src/app/api/v1/billing/webhook/route.ts) logged every checkout/
// subscription event into `billing_events` but never updated
// `users/{id}.tier` — so an account that genuinely paid for Starter/Pro/Max
// could be stuck at `tier: 'free'` forever. This script finds exactly those
// accounts from the raw event log and corrects them.
//
// Reports by default; pass --apply to actually write the corrections.
//
// Usage:
//   npx tsx scripts/migrateFreeAccountsFromBilling.ts            # dry run / report
//   npx tsx scripts/migrateFreeAccountsFromBilling.ts --apply    # write corrections
//
// Safety:
//  - Never touches an account whose CURRENT stored tier isn't exactly
//    'free' — an account already on starter/pro/enterprise/gold is left
//    exactly as is (see "Pricing Cleanup" patch §27/§28: a historically
//    unverified 'free' account must never be assumed to deserve a paid
//    tier, and an already-correct tier must never be second-guessed by this
//    script).
//  - Only upgrades an account whose MOST RECENT resolvable billing event
//    (by receivedAt) proves an ACTIVE paid subscription — a
//    checkout.session.completed or customer.subscription.updated event more
//    recent than any customer.subscription.deleted for that same user. A
//    subsequently-cancelled subscription resolves back to 'free' and is
//    correctly left alone (already free, nothing to apply).
//  - Never assigns 'gold' from billing evidence — gold is administratively
//    assigned only (see accountTier.ts) and is never a tier any Stripe event
//    can resolve to.
//
// Requires the same Firebase credentials the running app uses:
//   FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY
import type Stripe from 'stripe'
import { db } from '@/lib/firestore'
import { resolveEntitlementFromCheckoutSession, resolveEntitlementFromSubscription } from '@/lib/billingEntitlement'

interface BillingEventRow {
  type: string
  stripeEventId: string
  data: unknown
  receivedAt: { toDate?: () => Date } | Date | string
}

function toDate(value: BillingEventRow['receivedAt']): Date {
  if (value instanceof Date) return value
  if (typeof value === 'string') return new Date(value)
  if (value && typeof value.toDate === 'function') return value.toDate()
  return new Date(0)
}

// Mirrors the webhook route's own resolveEntitlement() switch — kept
// separate (not imported) because the webhook's version operates on a live
// Stripe.Event, while this script reads the already-persisted plain-object
// `data` field back out of Firestore.
function resolveFromEvent(row: BillingEventRow): { userId: string | null; tier: string | null } {
  switch (row.type) {
    case 'checkout.session.completed':
      return resolveEntitlementFromCheckoutSession(row.data as Stripe.Checkout.Session)
    case 'customer.subscription.updated':
      return resolveEntitlementFromSubscription(row.data as Stripe.Subscription)
    case 'customer.subscription.deleted': {
      const { userId } = resolveEntitlementFromSubscription(row.data as Stripe.Subscription)
      return { userId, tier: 'free' }
    }
    default:
      return { userId: null, tier: null }
  }
}

async function main() {
  const apply = process.argv.includes('--apply')
  const firestore = db()

  const eventsSnap = await firestore.collection('billing_events').get()
  const latestByUser = new Map<string, { tier: string; at: Date; stripeEventId: string }>()

  for (const doc of eventsSnap.docs) {
    const row = doc.data() as BillingEventRow
    const { userId, tier } = resolveFromEvent(row)
    if (!userId || !tier) continue
    const at = toDate(row.receivedAt)
    const existing = latestByUser.get(userId)
    if (!existing || at > existing.at) {
      latestByUser.set(userId, { tier, at, stripeEventId: row.stripeEventId })
    }
  }

  const usersSnap = await firestore.collection('users').where('tier', '==', 'free').get()
  const candidates: Array<{ userId: string; email: string; from: string; to: string; evidenceEventId: string }> = []

  for (const userDoc of usersSnap.docs) {
    const resolved = latestByUser.get(userDoc.id)
    if (!resolved) continue
    // No upgrade evidence (still resolves to free), or a tier this script
    // must never assign from billing evidence alone.
    if (resolved.tier === 'free' || resolved.tier === 'gold') continue

    const user = userDoc.data() as { email?: string; tier?: string }
    candidates.push({
      userId: userDoc.id,
      email: user.email ?? '(unknown)',
      from: user.tier ?? 'free',
      to: resolved.tier,
      evidenceEventId: resolved.stripeEventId,
    })
  }

  if (candidates.length === 0) {
    console.log('No accounts found with billing evidence of an active paid subscription while stored as free. Nothing to do.')
    return
  }

  console.log(`${apply ? 'Applying' : 'Would apply'} ${candidates.length} correction(s):`)
  for (const c of candidates) {
    console.log(`  ${c.email} (${c.userId}): '${c.from}' -> '${c.to}' (evidence: billing_events/${c.evidenceEventId})`)
    if (apply) {
      await firestore.collection('users').doc(c.userId).update({ tier: c.to, updatedAt: new Date() })
    }
  }

  if (!apply) {
    console.log('\nDry run only — re-run with --apply to write these corrections.')
  }
}

main().catch(err => {
  console.error(err)
  process.exitCode = 1
})
