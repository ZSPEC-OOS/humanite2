import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ControlPanel } from '../ControlPanel'
import { useHumanizeStore } from '@/stores/humanizeStore'

beforeEach(() => {
  useHumanizeStore.setState({
    settings: { intensity: 5, tone: 'balanced', domain: 'general', preserve_citations: true },
  })
})

describe('ControlPanel', () => {
  it('renders the intensity slider', () => {
    render(<ControlPanel />)
    expect(screen.getByRole('slider')).toBeTruthy()
  })

  it('intensity slider updates store', () => {
    render(<ControlPanel />)
    fireEvent.change(screen.getByRole('slider'), { target: { value: '8' } })
    expect(useHumanizeStore.getState().settings.intensity).toBe(8)
  })

  it('renders tone dropdown with all options', () => {
    render(<ControlPanel />)
    const selects = screen.getAllByRole('combobox')
    expect(selects.length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('Balanced')).toBeTruthy()
  })

  it('tone change updates store', () => {
    render(<ControlPanel />)
    const [toneSelect] = screen.getAllByRole('combobox')
    fireEvent.change(toneSelect!, { target: { value: 'formal' } })
    expect(useHumanizeStore.getState().settings.tone).toBe('formal')
  })

  it('renders domain dropdown', () => {
    render(<ControlPanel />)
    expect(screen.getByText('General')).toBeTruthy()
  })

  it('domain change updates store', () => {
    render(<ControlPanel />)
    const selects = screen.getAllByRole('combobox')
    fireEvent.change(selects[1]!, { target: { value: 'academic' } })
    expect(useHumanizeStore.getState().settings.domain).toBe('academic')
  })

  it('renders preserve_citations checkbox', () => {
    render(<ControlPanel />)
    const checkbox = screen.getByRole('checkbox')
    expect(checkbox).toBeTruthy()
    expect((checkbox as HTMLInputElement).checked).toBe(true)
  })
})
