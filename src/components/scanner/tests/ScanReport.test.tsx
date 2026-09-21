import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ScanReport } from '../ScanReport'
import { useScanStore } from '@/stores/scanStore'

beforeEach(() => {
  useScanStore.setState({ status: 'idle', response: null, error: null })
})

const MOCK_SCAN_RESPONSE = {
  job_id: 'job-1',
  status: 'completed',
  scan_id: 'scan-1',
  classification: 'ai-generated' as const,
  confidence: 0.88,
  human_probability: 0.12,
  ai_probability: 0.88,
  uncertain_probability: 0.0,
  per_sentence_perplexity: [42.1, 38.6, 55.2, 71.0],
  top_features: [
    { feature: 'transition_density', observed_value: 0.33,
      direction: 'ai_indicator' as const, contribution: 0.72 },
  ],
  explanation: {
    summary: 'Text classified as ai-generated with 88% confidence.',
    detail: 'Transformer classifier output: AI=0.88, Human=0.12.',
  },
  model_used: 'roberta-base',
  processing_duration_ms: 320,
  result_url: null,
  warning: null,
}

describe('ScanReport', () => {
  it('shows idle state when no scan run', () => {
    render(<ScanReport />)
    expect(screen.getByText(/run a scan/i)).toBeTruthy()
  })

  it('shows loading spinner while scanning', () => {
    useScanStore.setState({ status: 'loading' })
    render(<ScanReport />)
    expect(screen.getByText('Analyzing…')).toBeTruthy()
  })

  it('shows error message on failure', () => {
    useScanStore.setState({ status: 'error', error: 'Scan failed: 502' })
    render(<ScanReport />)
    expect(screen.getByText('Scan failed: 502')).toBeTruthy()
  })

  it('renders classification badge for ai-generated', () => {
    useScanStore.setState({ status: 'done', response: MOCK_SCAN_RESPONSE })
    render(<ScanReport />)
    expect(screen.getByText(/AI GENERATED/i)).toBeTruthy()
  })

  it('renders confidence percentage', () => {
    useScanStore.setState({ status: 'done', response: MOCK_SCAN_RESPONSE })
    render(<ScanReport />)
    const matches = screen.getAllByText('88%')
    expect(matches.length).toBeGreaterThan(0)
  })

  it('renders explanation text', () => {
    useScanStore.setState({ status: 'done', response: MOCK_SCAN_RESPONSE })
    render(<ScanReport />)
    expect(screen.getByText(/classified as ai-generated with 88% confidence/i)).toBeTruthy()
  })

  it('renders perplexity chart when scores are present', () => {
    useScanStore.setState({ status: 'done', response: MOCK_SCAN_RESPONSE })
    render(<ScanReport />)
    expect(screen.getByText(/per-sentence perplexity/i)).toBeTruthy()
  })
})
