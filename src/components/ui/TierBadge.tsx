import { PRICING_TIERS } from '@/lib/pricing'
import { isGoldTier } from '@/lib/accountTier'

// Capitalizing the internal tier id directly (free/pro/enterprise) used to
// coincidentally match its display name — it no longer does now that the
// pricing page shows Starter/Pro/Max, so this resolves through the same
// PRICING_TIERS list the pricing page itself renders from. Gold isn't in
// that list at all (it's not a purchasable plan — see accountTier.ts), so
// it's handled separately below rather than added there.
function tierDisplayName(tier: string | null | undefined): string {
  const match = PRICING_TIERS.find(t => t.id === tier)
  return match?.name ?? 'Starter'
}

interface TierBadgeProps {
  tier: string | null | undefined
  /** Layout/display utility classes only (e.g. 'flex' vs 'inline-flex') — the badge's own shape/color classes are fixed below. */
  className?: string
}

// The one place account-tier badges are styled, so every surface that
// shows "your plan" (currently the dashboard header and its mobile menu)
// renders identically and a future surface (an account page, an admin
// table) gets the same Gold treatment for free by reusing this component
// instead of re-implementing the pill.
export function TierBadge({ tier, className = 'inline-flex' }: TierBadgeProps) {
  const gold = isGoldTier(tier)
  return (
    <span
      className={`${className} items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full border ${
        gold
          ? 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-400/40 dark:bg-amber-400/10 dark:text-amber-300'
          : 'border-gray-200 bg-gray-100 text-gray-600 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400'
      }`}
    >
      {gold ? 'Gold User' : `${tierDisplayName(tier)} Plan`}
    </span>
  )
}
