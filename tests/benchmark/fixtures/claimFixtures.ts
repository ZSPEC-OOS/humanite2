// Phase 7's own adversarial fixtures — pairs of source and a deliberately
// corrupted rewrite covering the three failure categories the plan names
// that Phase 5's deterministic extractors cannot see at all: which entity a
// relation runs between (and in which direction), who a statement is
// attributed to, and what qualifier narrows a claim's scope. Each fixture
// is deliberately built with NO numbers, dates, citations, modal verbs, or
// capitalized entity-pair labels — the exact spans Phase 5's extractors
// key on — so the corruption is invisible to validateFactLedger (see
// src/lib/claims/tests/gapFixtures.test.ts, which checks this against the
// real function rather than asserting it by hand) and only a model that
// actually reads the relation can catch it.

export type ClaimFixtureCategory = 'relation-swap' | 'attribution-swap' | 'qualifier-detachment'

export interface ClaimFixture {
  id: string
  category: ClaimFixtureCategory
  description: string
  source: string
  corrupted: string
}

export const CLAIM_FIXTURES: ClaimFixture[] = [
  {
    id: 'relation-swap-causal-direction',
    category: 'relation-swap',
    description: 'Causal direction reversed between two clauses — the entities and wording barely change.',
    source: 'Because sales grew sharply, the company increased hiring across every region.',
    corrupted: 'Because the company increased hiring across every region, sales grew sharply.',
  },
  {
    id: 'relation-swap-comparative-age-group',
    category: 'relation-swap',
    description: 'A comparison between two lowercase (non-proper-noun) groups is reversed — outside entityPairs.ts\'s capitalized-label pattern.',
    source: "The vaccine's efficacy was higher in younger adults than in older adults.",
    corrupted: "The vaccine's efficacy was higher in older adults than in younger adults.",
  },
  {
    id: 'relation-swap-recommendation-timing',
    category: 'relation-swap',
    description: 'Which timing choice produces the better outcome is reversed.',
    source: 'Taking the medication before meals improves absorption compared to taking it after meals.',
    corrupted: 'Taking the medication after meals improves absorption compared to taking it before meals.',
  },
  {
    id: 'attribution-swap-regulator',
    category: 'attribution-swap',
    description: 'Who issued the warning changes from the regulator to the manufacturer.',
    source: 'According to federal regulators, the drug carries a black-box warning for cardiac risk.',
    corrupted: 'According to the manufacturer, the drug carries a black-box warning for cardiac risk.',
  },
  {
    id: 'attribution-swap-author-vs-reviewers',
    category: 'attribution-swap',
    description: "Who reported the finding changes from the study's own author to its reviewers.",
    source: 'The lead author reported that the effect size was smaller than expected.',
    corrupted: 'The peer reviewers reported that the effect size was smaller than expected.',
  },
  {
    id: 'attribution-swap-executive-vs-analysts',
    category: 'attribution-swap',
    description: 'The explanation for the sales growth is credited to a different speaker.',
    source: 'Sales grew, the chief executive said, due to strong holiday demand.',
    corrupted: 'Sales grew, outside analysts said, due to strong holiday demand.',
  },
  {
    id: 'qualifier-detachment-family-history',
    category: 'qualifier-detachment',
    description: 'Dropping "with a family history of the condition" broadens the claim to every patient.',
    source: 'The treatment is effective in most patients with a family history of the condition.',
    corrupted: 'The treatment is effective in most patients.',
  },
  {
    id: 'qualifier-detachment-first-week',
    category: 'qualifier-detachment',
    description: 'Dropping "only during the first week" turns a temporary side effect into a persistent one.',
    source: 'Side effects are common only during the first week of treatment.',
    corrupted: 'Side effects are common during treatment.',
  },
  {
    id: 'qualifier-detachment-introductory-period',
    category: 'qualifier-detachment',
    description: 'Dropping the eligibility window extends the policy to every new customer.',
    source: 'The policy applies to new customers who sign up during the introductory period.',
    corrupted: 'The policy applies to new customers.',
  },
]
