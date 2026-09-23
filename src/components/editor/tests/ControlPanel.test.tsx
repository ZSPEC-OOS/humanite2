import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ControlPanel } from '../ControlPanel'
import { useHumanizeStore } from '@/stores/humanizeStore'

beforeEach(() => {
  useHumanizeStore.setState({
    settings: { intensity: 5, tone: 'balanced', domain: 'general' },
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

  it('positions each intensity tick by its actual percent-of-range, not evenly spaced', () => {
    render(<ControlPanel />)
    // Value v on a 1-10 range sits at (v-1)/9 of the track — tick "6" must
    // land near 56%, not at the ~50% an evenly-spaced flex layout would put
    // the 3rd of 5 labels regardless of its value.
    const six = screen.getByText('6').closest('div') as HTMLElement
    expect(six.style.left).toBe(`${((6 - 1) / 9) * 100}%`)
    const seven = screen.getByText('7').closest('div') as HTMLElement
    expect(seven.style.left).toBe(`${((7 - 1) / 9) * 100}%`)
  })
})
