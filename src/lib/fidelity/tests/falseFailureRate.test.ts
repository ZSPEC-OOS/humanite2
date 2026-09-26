import { describe, it, expect } from 'vitest'
import { validateFactLedger } from '../validator'

// Phase 5's other acceptance criterion: "false-failure rate on correct
// rewrites <= 2%." Each pair here is a source and a CORRECT rewrite —
// reworded, reordered, or restructured, but never dropping, adding, or
// rebinding a fact — probing each new extractor category (plus the
// sentence-alignment fallback for legitimate splits/merges) for the
// specific false-positive risk its own binding strategy introduces.
const CORRECT_REWRITE_PAIRS: Array<{ id: string; source: string; rewrite: string }> = [
  // Quantities: reworded around a preserved number+unit.
  { id: 'quantity-reword-1', source: 'Store the sample at 5 mg per vial.', rewrite: 'Each vial should hold the sample at 5 mg.' },
  { id: 'quantity-reword-2', source: 'The shipment weighs 5 kilograms and costs 200 dollars.', rewrite: 'Weighing 5 kilograms, the shipment costs 200 dollars.' },
  { id: 'quantity-reword-3', source: 'Revenue grew by 12 percent last quarter.', rewrite: 'Last quarter saw revenue grow by 12 percent.' },
  { id: 'quantity-reword-4', source: 'The trial enrolled 640 patients across 6 sites.', rewrite: 'Across 6 sites, 640 patients were enrolled in the trial.' },
  { id: 'quantity-reword-5', source: 'The dose should not exceed 20 mg per day.', rewrite: 'The daily dose should not go above 20 mg.' },

  // Ranges: "from...to" reworded as "between...and" (still ordered low->high).
  { id: 'range-reword-1', source: 'The dosing range spans from 5 mg to 20 mg.', rewrite: 'Dosing can range between 5 mg and 20 mg.' },
  { id: 'range-reword-2', source: 'Station rates ranged from 2.1 to 5.8 millimeters per year.', rewrite: 'Rates across stations fell between 2.1 and 5.8 millimeters per year.' },
  { id: 'range-reword-3', source: 'Full return to activity is generally not recommended before 4 to 6 months.', rewrite: 'It is generally not recommended for patients to fully return to activity before 4 to 6 months.' },

  // Scientific notation: reworded around a preserved exact span.
  { id: 'sci-notation-reword-1', source: 'The measured concentration was 3.2 x 10^-4 mol/L.', rewrite: 'Researchers measured a concentration of 3.2 x 10^-4 mol/L.' },
  { id: 'sci-notation-reword-2', source: 'The rate constant was found to be 1.5e-3 per second.', rewrite: 'A rate constant of 1.5e-3 per second was found.' },

  // Modality: reworded, same modal verb kept.
  { id: 'modality-reword-1', source: 'Patients may discontinue the medication after 7 days.', rewrite: 'After 7 days, patients may choose to stop taking the medication.' },
  { id: 'modality-reword-2', source: 'The Borrower shall repay the Loan in 60 equal monthly installments.', rewrite: 'Repayment of the Loan shall proceed in 60 equal monthly installments, per the Borrower\'s obligation.' },
  { id: 'modality-reword-3', source: 'This medication must not be taken within 2 hours of an antacid.', rewrite: 'Patients must not take this medication within 2 hours of an antacid.' },

  // Negation: reworded, same negation marker kept.
  { id: 'negation-reword-1', source: 'The results did not increase significantly.', rewrite: 'Significant increase was not observed in the results.' },
  { id: 'negation-reword-2', source: 'The study drug did not increase the risk of major adverse cardiovascular events.', rewrite: 'No increase in the risk of major adverse cardiovascular events was seen with the study drug.' },
  { id: 'negation-reword-3', source: 'Patients allergic to penicillin should not take this medication.', rewrite: 'This medication should not be taken by patients with a penicillin allergy.' },

  // Version numbers: reworded, order of the two clauses flipped, but each
  // entity keeps its own correct version (a legitimate restructuring, not
  // a swap between entities).
  { id: 'version-reword-1', source: 'Server Alpha runs firmware 2.1; Server Beta runs firmware 3.4.', rewrite: 'Server Beta runs firmware 3.4, while Server Alpha runs firmware 2.1.' },
  { id: 'version-reword-2', source: 'Model A ships with version 4.2.0 pre-installed.', rewrite: 'Version 4.2.0 comes pre-installed on Model A.' },

  // Cross-references: reworded, binding preserved.
  { id: 'cross-reference-reword-1', source: 'See Section 4 for methodology and Section 9 for results.', rewrite: 'Methodology appears in Section 4; results are covered in Section 9.' },

  // Entity pairs: reworded, relation marker changed but order/roles preserved.
  { id: 'entity-pair-reword-1', source: 'Compound A showed higher potency than Compound B in the assay.', rewrite: 'In the assay, Compound A was found to be more potent compared to Compound B.' },

  // Sentence splitting/merging (legitimate high-intensity restructuring) —
  // exercises the alignment fallback rather than a direct per-sentence match.
  { id: 'sentence-split-1', source: 'The report covers three areas: revenue, cost, and headcount changes this quarter.', rewrite: 'The report covers revenue. It also covers cost. It covers headcount changes this quarter too.' },
  { id: 'sentence-merge-1', source: 'Revenue rose 12 percent. Costs fell 4 percent.', rewrite: 'Revenue rose 12 percent while costs fell 4 percent.' },

  // Paragraph-level reordering combined with several fact types at once.
  { id: 'mixed-reword-1', source: 'The vaccine demonstrated 91 percent efficacy against symptomatic infection. Two doses administered 21 days apart were required for full protection.', rewrite: 'Full protection required two doses spaced 21 days apart. Against symptomatic infection, the vaccine demonstrated 91 percent efficacy.' },
  { id: 'mixed-reword-2', source: 'The Tenant shall pay Rent of $2,400 per month, due on the first day of each calendar month.', rewrite: 'Rent of $2,400 per month shall be paid by the Tenant on the first day of each calendar month.' },
  { id: 'mixed-reword-3', source: 'A meta-analysis of 18 trials found that cognitive behavioral therapy reduced insomnia severity index scores by an average of 7.2 points more than control conditions.', rewrite: 'Across 18 trials, a meta-analysis found cognitive behavioral therapy outperformed control conditions by an average of 7.2 points on insomnia severity index scores.' },
  { id: 'mixed-reword-4', source: 'Employee shall be entitled to 15 days of paid vacation per calendar year, accruing at a rate of 1.25 days per month.', rewrite: 'Each calendar year, the Employee shall accrue paid vacation at 1.25 days per month, entitling them to 15 days in total.' },
  { id: 'mixed-reword-5', source: 'The vaccine showed 96 percent efficacy against severe disease among the 15,000 participants who received it.', rewrite: 'Among the 15,000 participants who received it, the vaccine showed 96 percent efficacy against severe disease.' },
  { id: 'mixed-reword-6', source: 'No serious adverse events attributable to the vaccine occurred among the 15,000 participants who received it.', rewrite: 'Among the 15,000 participants who received it, no serious adverse events attributable to the vaccine were recorded.' },
  { id: 'mixed-reword-7', source: 'Warehouse automation reduced average order-fulfillment time from 48 hours to 19 hours.', rewrite: 'Average order-fulfillment time fell from 48 hours to 19 hours after warehouse automation.' },
  { id: 'mixed-reword-8', source: 'The board approved a $250 million share buyback program, to be executed over the next 18 months.', rewrite: 'Over the next 18 months, the board\'s approved $250 million share buyback program will be executed.' },
  { id: 'mixed-reword-9', source: 'Net promoter score improved to 42 this quarter from 31 a year earlier.', rewrite: 'A year earlier the net promoter score stood at 31; this quarter it improved to 42.' },
  { id: 'mixed-reword-10', source: 'A/B testing of the new checkout flow across 220,000 sessions showed a 6.3 percent lift in conversion rate.', rewrite: 'Across 220,000 sessions, the new checkout flow was A/B tested and showed a conversion-rate lift of 6.3 percent.' },
]

describe('Phase 5 deterministic fact ledger — false-failure rate on correct rewrites', () => {
  it('stays at or below the 2% ceiling across the correct-rewrite set', () => {
    const failing: string[] = []
    for (const pair of CORRECT_REWRITE_PAIRS) {
      const result = validateFactLedger(pair.source, pair.rewrite)
      if (!result.passed) {
        failing.push(`${pair.id}: ${result.failures.map(f => f.reason).join('; ')}`)
      }
    }

    const failureRate = failing.length / CORRECT_REWRITE_PAIRS.length
    if (failing.length > 0) {
      console.log('False failures:', failing)
    }
    expect(failureRate, `false-failure rate ${(failureRate * 100).toFixed(1)}% (${failing.length}/${CORRECT_REWRITE_PAIRS.length})`).toBeLessThanOrEqual(0.02)
  })
})
