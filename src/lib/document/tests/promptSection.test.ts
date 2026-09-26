import { describe, it, expect } from 'vitest'
import { buildDocumentContextSection } from '../promptSection'
import { emptyDocumentContext } from '../analysis'

describe('buildDocumentContextSection', () => {
  it('renders an empty string when the context carries nothing', () => {
    expect(buildDocumentContextSection(emptyDocumentContext())).toBe('')
  })

  it('renders terminology instructions when present', () => {
    const section = buildDocumentContextSection({
      ...emptyDocumentContext(),
      terminology: { 'the Corporation': 'the Company' },
    })
    expect(section).toContain('the Company')
    expect(section).toContain('the Corporation')
  })

  it('renders abbreviation instructions when present', () => {
    const section = buildDocumentContextSection({
      ...emptyDocumentContext(),
      abbreviations: { API: 'Application Programming Interface' },
    })
    expect(section).toContain('API')
    expect(section).toContain('Application Programming Interface')
  })

  it('renders section summaries when present', () => {
    const section = buildDocumentContextSection({
      ...emptyDocumentContext(),
      sectionSummaries: ['Introduces the topic.', 'Covers the results.'],
    })
    expect(section).toContain('Introduces the topic.')
    expect(section).toContain('Covers the results.')
  })

  it('renders all three sections together when all are present', () => {
    const section = buildDocumentContextSection({
      genre: null,
      audience: null,
      terminology: { 'the Corporation': 'the Company' },
      abbreviations: { API: 'Application Programming Interface' },
      sectionSummaries: ['Intro.'],
    })
    expect(section).toContain('TERMINOLOGY')
    expect(section).toContain('ABBREVIATIONS')
    expect(section).toContain('OTHER PARTS OF THIS DOCUMENT')
  })
})
