import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ScanReport } from '../ScanReport'
import { useScanStore } from '@/stores/scanStore'
import type { ScanAPIResponse } from '@/lib/api'

beforeEach(() => {
  useScanStore.setState({ status: 'idle', response: null, error: null })
})

const SCANNED_TEXT = 'This is the exact text that was scanned for the heatmap.'

const MOCK_SCAN_RESPONSE: ScanAPIResponse = {
  job_id: 'job-1',
  status: 'completed',
  scan_id: 'scan-1',
  result_url: null,
  schema_version: '3.0',
  provider: { id: 'gptzero' },
  classification: 'ai-generated',
  probabilities: { human: 0.12, ai: 0.88, mixed: 0 },
  predicted_class_probability: 0.88,
  confidence_category: 'high',
  estimated_ai_like_fraction: 0.85,
  segments: [
    {
      id: 'seg-0', text: SCANNED_TEXT, start_char: 0, end_char: SCANNED_TEXT.length,
      classification: 'ai-generated', ai_score: 0.88, highlighted_for_ai: true, source: 'gptzero',
    },
  ],
  diagnostics: {
    word_count: 11, sentence_count: 1, paragraph_count: 1,
    average_sentence_length: 11, sentence_length_stddev: 0,
    lexical_diversity: 0.9, contraction_rate: 0, first_person_rate: 0,
    repeated_bigram_rate: 0, repeated_trigram_rate: 0, question_rate: 0,
    readability_score: 65,
  },
  processing_duration_ms: 320,
  warnings: [],
  explanation: {
    summary: 'Text classified as ai-generated with 88% confidence.',
    detail: 'GPTZero: AI=0.88, Human=0.12.',
  },
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
    expect(screen.getAllByText(/AI-LIKE/i).length).toBeGreaterThan(0)
  })

  it('renders the predicted-class probability percentage', () => {
    useScanStore.setState({ status: 'done', response: MOCK_SCAN_RESPONSE })
    render(<ScanReport />)
    const matches = screen.getAllByText('88%')
    expect(matches.length).toBeGreaterThan(0)
  })

  it('renders the confidence category label', () => {
    useScanStore.setState({ status: 'done', response: MOCK_SCAN_RESPONSE })
    const { container } = render(<ScanReport />)
    expect(container.textContent).toContain('Confidence: High')
  })

  it('renders explanation text', () => {
    useScanStore.setState({ status: 'done', response: MOCK_SCAN_RESPONSE })
    render(<ScanReport />)
    expect(screen.getByText(/classified as ai-generated with 88% confidence/i)).toBeTruthy()
  })

  it('renders provider attribution', () => {
    useScanStore.setState({ status: 'done', response: MOCK_SCAN_RESPONSE })
    render(<ScanReport />)
    expect(screen.getByText(/detection provided by gptzero/i)).toBeTruthy()
  })

  it('renders writing diagnostics when present', () => {
    useScanStore.setState({ status: 'done', response: MOCK_SCAN_RESPONSE })
    render(<ScanReport />)
    expect(screen.getByText(/writing characteristics/i)).toBeTruthy()
  })

  it('renders provider warnings when present', () => {
    useScanStore.setState({
      status: 'done',
      response: { ...MOCK_SCAN_RESPONSE, warnings: ['Low-confidence classification — treat with caution.'] },
    })
    render(<ScanReport />)
    expect(screen.getByText(/low-confidence classification/i)).toBeTruthy()
  })

  it('omits the estimated AI-like content line when null', () => {
    useScanStore.setState({
      status: 'done',
      response: { ...MOCK_SCAN_RESPONSE, estimated_ai_like_fraction: null },
    })
    render(<ScanReport />)
    expect(screen.queryByText(/estimated ai-like content/i)).toBeNull()
  })

  it('renders the document-map heatmap when text and segments are provided', () => {
    useScanStore.setState({ status: 'done', response: MOCK_SCAN_RESPONSE })
    render(<ScanReport text={SCANNED_TEXT} />)
    expect(screen.getByText(/document map/i)).toBeTruthy()
    expect(screen.getByText(SCANNED_TEXT)).toBeTruthy()
  })

  it('does not render the heatmap without the scanned text', () => {
    useScanStore.setState({ status: 'done', response: MOCK_SCAN_RESPONSE })
    render(<ScanReport />)
    expect(screen.queryByText(/document map/i)).toBeNull()
  })
})
