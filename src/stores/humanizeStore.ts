import { create } from 'zustand'
import { apiHumanize, apiGetJob, HumanizeAPIResponse, HumanizeSettings } from '@/lib/api'

const POLL_INTERVAL_MS = 3_000
const MAX_POLLS = 100 // ~5 minutes — matches the async route's maxDuration budget

interface HumanizeState {
  settings: HumanizeSettings
  response: HumanizeAPIResponse | null
  status: 'idle' | 'loading' | 'done' | 'error'
  error: string | null
  // Set while waiting on a background job for a long document, so the UI can
  // show something more informative than a generic spinner.
  progressMessage: string | null
  setSettings: (patch: Partial<HumanizeSettings>) => void
  humanize: (text: string) => Promise<void>
  reset: () => void
}

const DEFAULT_SETTINGS: HumanizeSettings = {
  intensity: 5,
  tone: 'balanced',
  domain: 'general',
  preserve_citations: true,
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export const useHumanizeStore = create<HumanizeState>((set, get) => ({
  settings: DEFAULT_SETTINGS,
  response: null,
  status: 'idle',
  error: null,
  progressMessage: null,

  setSettings: (patch) =>
    set((state) => ({ settings: { ...state.settings, ...patch } })),

  humanize: async (text) => {
    set({ status: 'loading', error: null, progressMessage: null })
    try {
      const resp = await apiHumanize(text, get().settings)

      if (resp.status !== 'pending') {
        set({ response: resp, status: 'done' })
        return
      }

      set({ progressMessage: 'Processing your document in the background — this can take a few minutes for long text…' })

      for (let i = 0; i < MAX_POLLS; i++) {
        await sleep(POLL_INTERVAL_MS)
        const job = await apiGetJob(resp.job_id)

        if (job.status === 'completed' && job.output) {
          set({
            response: {
              job_id: job.job_id,
              status: 'completed',
              output: job.output,
              preprocessing_metadata: resp.preprocessing_metadata,
              processing_metadata: job.processing_metadata,
              result_url: null,
              warning: null,
            },
            status: 'done',
            progressMessage: null,
          })
          return
        }
        if (job.status === 'failed') {
          set({ status: 'error', error: 'Humanization failed while processing your document.', progressMessage: null })
          return
        }
      }

      set({ status: 'error', error: 'Timed out waiting for your document to finish processing.', progressMessage: null })
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Humanization failed.'
      set({ status: 'error', error: msg, progressMessage: null })
    }
  },

  reset: () => set({ response: null, status: 'idle', error: null, progressMessage: null }),
}))
