import { create } from 'zustand'
import { apiScan, ScanAPIResponse } from '@/lib/api'

interface ScanState {
  response: ScanAPIResponse | null
  status: 'idle' | 'loading' | 'done' | 'error'
  error: string | null
  scan: (text: string) => Promise<void>
  // Adopts a result computed elsewhere (the automatic post-humanize scan)
  // without making a network call — every existing consumer of this store
  // (the AI Detection stat, ScanReport) lights up identically either way.
  applyResult: (resp: ScanAPIResponse) => void
  reset: () => void
}

// Mirrors humanizeStore.ts's activeGeneration — a stale-write guard, not real
// request cancellation (apiScan takes no AbortSignal). Without it, clicking
// "Re-check"/"Clear" mid-scan doesn't stop the original call, and its result
// can land after the reset and silently overwrite the current view.
let activeGeneration = 0

export const useScanStore = create<ScanState>((set) => ({
  response: null,
  status: 'idle',
  error: null,

  scan: async (text) => {
    const myGeneration = ++activeGeneration
    set({ status: 'loading', error: null })
    try {
      const resp = await apiScan(text, 'standard')
      if (myGeneration !== activeGeneration) return
      set({ response: resp, status: 'done' })
    } catch (e) {
      if (myGeneration !== activeGeneration) return
      const msg = e instanceof Error ? e.message : 'Scan failed.'
      set({ status: 'error', error: msg })
    }
  },

  applyResult: (resp) => {
    activeGeneration++ // a fresh (auto-scan) result always supersedes any in-flight manual scan
    set({ response: resp, status: 'done', error: null })
  },

  reset: () => {
    activeGeneration++
    set({ response: null, status: 'idle', error: null })
  },
}))
