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

export const useScanStore = create<ScanState>((set) => ({
  response: null,
  status: 'idle',
  error: null,

  scan: async (text) => {
    set({ status: 'loading', error: null })
    try {
      const resp = await apiScan(text, 'standard')
      set({ response: resp, status: 'done' })
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Scan failed.'
      set({ status: 'error', error: msg })
    }
  },

  applyResult: (resp) => set({ response: resp, status: 'done', error: null }),

  reset: () => set({ response: null, status: 'idle', error: null }),
}))
