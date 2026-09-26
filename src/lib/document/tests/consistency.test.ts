import { describe, it, expect } from 'vitest'
import { checkTerminologyConsistency } from '../consistency'
import { emptyDocumentContext } from '../analysis'
import type { DocumentContext } from '../types'

function context(overrides: Partial<DocumentContext> = {}): DocumentContext {
  return { ...emptyDocumentContext(), ...overrides }
}

describe('checkTerminologyConsistency — terminology', () => {
  it('reports perfect consistency (1) when there is nothing to check', () => {
    const result = checkTerminologyConsistency(context(), 'Any text at all.')
    expect(result.terminologyConsistency).toBe(1)
    expect(result.terminologyViolations).toHaveLength(0)
  })

  it('reports perfect consistency when every occurrence uses the canonical form', () => {
    const ctx = context({ terminology: { 'the Corporation': 'the Company' } })
    const result = checkTerminologyConsistency(ctx, 'The Company filed its report. The Company later amended it.')
    expect(result.terminologyConsistency).toBe(1)
    expect(result.terminologyViolations).toHaveLength(0)
  })

  it('reports a violation and a reduced score when a banned variant appears', () => {
    const ctx = context({ terminology: { 'the Corporation': 'the Company' } })
    const result = checkTerminologyConsistency(ctx, 'The Company filed its report. The Corporation later amended it.')
    expect(result.terminologyConsistency).toBeCloseTo(0.5, 6)
    expect(result.terminologyViolations).toEqual([{ variant: 'the Corporation', canonical: 'the Company', count: 1 }])
  })

  it('counts every occurrence of the variant, not just whether it appears at all', () => {
    const ctx = context({ terminology: { 'the Corporation': 'the Company' } })
    const result = checkTerminologyConsistency(ctx, 'The Corporation did X. The Corporation did Y. The Corporation did Z.')
    expect(result.terminologyViolations[0]!.count).toBe(3)
    expect(result.terminologyConsistency).toBe(0)
  })

  it('does not penalize a term whose concept never appears in the checked text at all', () => {
    const ctx = context({ terminology: { 'the Corporation': 'the Company', foo: 'bar' } })
    const result = checkTerminologyConsistency(ctx, 'The Company filed its report.')
    // "foo"/"bar" never appear either way — excluded from the ratio entirely.
    expect(result.terminologyConsistency).toBe(1)
  })

  it('is case-insensitive', () => {
    const ctx = context({ terminology: { 'the corporation': 'the company' } })
    const result = checkTerminologyConsistency(ctx, 'THE CORPORATION filed its report.')
    expect(result.terminologyViolations[0]!.count).toBe(1)
  })

  it('aggregates across multiple terms into one overall consistency score', () => {
    const ctx = context({ terminology: { 'Corp': 'the Company', 'the vendor': 'the Supplier' } })
    // "the Company" used correctly twice; "the Supplier" used correctly
    // once but with one violation of "the vendor" — 3 canonical of 4 total
    // opportunities.
    const result = checkTerminologyConsistency(ctx, 'the Company here. the Company there. the Supplier once. the vendor again.')
    expect(result.terminologyConsistency).toBeCloseTo(0.75, 6)
  })

  it('skips a term whose variant and canonical are the same string (case-insensitively)', () => {
    const ctx = context({ terminology: { API: 'API' } })
    const result = checkTerminologyConsistency(ctx, 'The API is documented here.')
    expect(result.terminologyViolations).toHaveLength(0)
    expect(result.terminologyConsistency).toBe(1)
  })
})

describe('checkTerminologyConsistency — abbreviations', () => {
  it('reports perfect preservation when nothing to check', () => {
    const result = checkTerminologyConsistency(context(), 'Any text.')
    expect(result.abbreviationPreservation).toBe(1)
  })

  it('reports full preservation when the abbreviation form survives', () => {
    const ctx = context({ abbreviations: { API: 'Application Programming Interface' } })
    const result = checkTerminologyConsistency(ctx, 'Call the API to fetch data.')
    expect(result.abbreviationPreservation).toBe(1)
    expect(result.abbreviationGaps).toHaveLength(0)
  })

  it('reports full preservation when only the expansion survives (no gap)', () => {
    const ctx = context({ abbreviations: { API: 'Application Programming Interface' } })
    const result = checkTerminologyConsistency(ctx, 'Call the Application Programming Interface to fetch data.')
    expect(result.abbreviationPreservation).toBe(1)
  })

  it('reports a gap when neither the abbreviation nor its expansion survives', () => {
    const ctx = context({ abbreviations: { API: 'Application Programming Interface' } })
    const result = checkTerminologyConsistency(ctx, 'Call the interface to fetch data.')
    expect(result.abbreviationPreservation).toBe(0)
    expect(result.abbreviationGaps).toEqual([{ abbreviation: 'API', expansion: 'Application Programming Interface' }])
  })

  it('averages preservation across multiple abbreviations independently', () => {
    const ctx = context({ abbreviations: { API: 'Application Programming Interface', CLI: 'Command Line Interface' } })
    const result = checkTerminologyConsistency(ctx, 'Call the API to fetch data.')
    expect(result.abbreviationPreservation).toBeCloseTo(0.5, 6)
    expect(result.abbreviationGaps).toEqual([{ abbreviation: 'CLI', expansion: 'Command Line Interface' }])
  })
})
