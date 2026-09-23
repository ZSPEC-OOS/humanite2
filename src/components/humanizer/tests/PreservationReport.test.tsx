import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { PreservationReport } from '../PreservationReport'
import type { PreservationByType } from '@/lib/api'

describe('PreservationReport', () => {
  it('renders nothing when closed', () => {
    const { container } = render(<PreservationReport open={false} onClose={() => {}} data={{}} />)
    expect(container.firstChild).toBeNull()
  })

  it('shows an empty state when no categories have any locks', () => {
    render(<PreservationReport open onClose={() => {}} data={{}} />)
    expect(screen.getByText(/no fact-locked spans/i)).toBeTruthy()
  })

  it('renders a per-category breakdown with percentages and counts', () => {
    const data: PreservationByType = {
      number: { total: 4, preserved: 4, missing: [] },
      citation: { total: 2, preserved: 1, missing: ['[3]'] },
    }
    render(<PreservationReport open onClose={() => {}} data={data} />)

    expect(screen.getByText('Numbers')).toBeTruthy()
    expect(screen.getByText('100% (4/4)')).toBeTruthy()
    expect(screen.getByText('Citations')).toBeTruthy()
    expect(screen.getByText('50% (1/2)')).toBeTruthy()
    expect(screen.getByText(/Dropped: "\[3\]"/)).toBeTruthy()
  })

  it('computes an overall total across categories', () => {
    const data: PreservationByType = {
      number: { total: 3, preserved: 3, missing: [] },
      date: { total: 1, preserved: 0, missing: ['January 5, 2024'] },
    }
    render(<PreservationReport open onClose={() => {}} data={data} />)
    expect(screen.getByText('75% (3/4)')).toBeTruthy()
  })

  it('omits categories with zero total locks', () => {
    const data: PreservationByType = {
      number: { total: 0, preserved: 0, missing: [] },
      citation: { total: 1, preserved: 1, missing: [] },
    }
    render(<PreservationReport open onClose={() => {}} data={data} />)
    expect(screen.queryByText('Numbers')).toBeNull()
    expect(screen.getByText('Citations')).toBeTruthy()
  })

  it('calls onClose when the close button is clicked', () => {
    const onClose = vi.fn()
    render(<PreservationReport open onClose={onClose} data={{ number: { total: 1, preserved: 1, missing: [] } }} />)
    screen.getByRole('button', { name: '' }).click()
    expect(onClose).toHaveBeenCalled()
  })
})
