import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { ApiConfigModal } from '../ApiConfigModal'
import { useApiConfigStore } from '@/stores/apiConfigStore'

const DEFAULT_CONFIG = {
  nickname: '', modelId: '', baseUrl: '',
  hasApiKey: false, apiKeyHint: '', hasGptzeroKey: false, gptzeroKeyHint: '',
}

// Deep-audit regression test: the draft-reset effect used to depend on
// `config` directly, and syncFromServer() always replaces `config` with a
// freshly-parsed object (a new reference even when nothing changed) — so a
// GET resolving while the user is mid-keystroke would silently wipe out
// whatever they'd already typed. The fix populates the draft once per
// modal-open rather than on every subsequent `config` reference change.
describe('ApiConfigModal — stale-closure draft reset', () => {
  beforeEach(() => {
    useApiConfigStore.setState({ config: { ...DEFAULT_CONFIG } })
  })

  it('does not wipe out an API key the user already typed when syncFromServer resolves afterwards', async () => {
    let resolveSync!: () => void
    const syncFromServer = vi.fn(() => new Promise<void>(resolve => { resolveSync = resolve }))
    useApiConfigStore.setState({ syncFromServer })

    render(<ApiConfigModal open onClose={() => {}} />)

    const apiKeyInput = screen.getByPlaceholderText('sk-…') as HTMLInputElement
    fireEvent.change(apiKeyInput, { target: { value: 'sk-user-typed-key' } })
    expect(apiKeyInput.value).toBe('sk-user-typed-key')

    // The server GET now resolves, replacing `config` with a brand-new
    // object reference (simulating apiConfigStore's real syncFromServer).
    await act(async () => {
      useApiConfigStore.setState({ config: { ...DEFAULT_CONFIG, nickname: 'Synced From Server' } })
      resolveSync()
      await Promise.resolve()
    })

    // The user's in-progress key must survive — never silently reset.
    expect((screen.getByPlaceholderText('sk-…') as HTMLInputElement).value).toBe('sk-user-typed-key')
  })

  it('still populates the draft from config on a fresh open', () => {
    useApiConfigStore.setState({ config: { ...DEFAULT_CONFIG, nickname: 'My Saved Config' } })
    render(<ApiConfigModal open onClose={() => {}} />)
    expect((screen.getByPlaceholderText('e.g. My GPT-4o') as HTMLInputElement).value).toBe('My Saved Config')
  })

  it('re-populates fresh on the NEXT open after the modal has closed', async () => {
    useApiConfigStore.setState({ syncFromServer: vi.fn().mockResolvedValue(undefined) })
    const { rerender } = render(<ApiConfigModal open={false} onClose={() => {}} />)
    await act(async () => {
      useApiConfigStore.setState({ config: { ...DEFAULT_CONFIG, nickname: 'Updated Elsewhere' } })
    })
    await act(async () => {
      rerender(<ApiConfigModal open onClose={() => {}} />)
    })
    expect((screen.getByPlaceholderText('e.g. My GPT-4o') as HTMLInputElement).value).toBe('Updated Elsewhere')
  })
})
