import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { InlineDiff } from '../InlineDiff'

describe('InlineDiff', () => {
  it('renders without crashing on identical text', () => {
    render(<InlineDiff original="Hello world" rewritten="Hello world" />)
    expect(screen.getByText('Hello world')).toBeTruthy()
  })

  it('marks added text', () => {
    const { container } = render(
      <InlineDiff original="Hello world" rewritten="Hello beautiful world" />
    )
    const added = container.querySelectorAll('mark')
    expect(added.length).toBeGreaterThan(0)
  })

  it('marks removed text', () => {
    const { container } = render(
      <InlineDiff original="Hello beautiful world" rewritten="Hello world" />
    )
    const removed = container.querySelectorAll('del')
    expect(removed.length).toBeGreaterThan(0)
  })

  it('renders empty strings without error', () => {
    const { container } = render(<InlineDiff original="" rewritten="" />)
    expect(container).toBeTruthy()
  })
})
