import { create } from 'zustand'
import { apiHumanize, apiGetJob, HumanizeAPIResponse, HumanizeOutput, HumanizeSettings } from '@/lib/api'
import { useScanStore } from './scanStore'

const POLL_INTERVAL_MS = 3_000
const MAX_POLLS = 100 // ~5 minutes — matches the async route's maxDuration budget

// Humanize now auto-scans its own output server-side (see
// src/app/api/v1/humanize/route.ts). Adopting that result into the scan
// store here means every existing consumer (the AI Detection stat,
// ScanReport) shows it immediately — no separate "Scan" click needed, and
// no changes needed to those components.
function applyDetectionToScanStore(output: HumanizeOutput) {
  if (!output.detection) return
  useScanStore.getState().applyResult({
    job_id: output.watermark.job_id,
    status: 'completed',
    scan_id: null,
    result_url: null,
    ...output.detection,
  })
}

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
    // Clear any detection result from a previous run — otherwise the AI
    // Detection stat would show a stale score from the last humanize while
    // this one is still in flight.
    useScanStore.getState().reset()
    try {
      const resp = await apiHumanize(text, get().settings)

      if (resp.status !== 'pending') {
        if (resp.output) applyDetectionToScanStore(resp.output)
        set({ response: resp, status: 'done' })
        return
      }

      set({ progressMessage: 'Processing your document in the background — this can take a few minutes for long text…' })

      for (let i = 0; i < MAX_POLLS; i++) {
        await sleep(POLL_INTERVAL_MS)
        const job = await apiGetJob(resp.job_id)

        if (job.progress) {
          set({ progressMessage: `Processing your document — section ${job.progress.chunks_completed} of ${job.progress.chunks_total}…` })
        }

        if (job.status === 'completed' && job.output) {
          applyDetectionToScanStore(job.output)
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
        // Processing stopped without reaching 'completed' (an error, or the
        // background function ran out of time) — recover whatever chunks did
        // finish instead of discarding real, already-paid-for output.
        if (job.status === 'failed') {
          if (job.partial_output) {
            applyDetectionToScanStore(job.partial_output)
            set({
              response: {
                job_id: job.job_id,
                status: 'completed',
                output: job.partial_output,
                preprocessing_metadata: resp.preprocessing_metadata,
                processing_metadata: job.processing_metadata,
                result_url: null,
                warning: `Processing stopped early after section ${job.progress?.chunks_completed ?? '?'} of ${job.progress?.chunks_total ?? '?'} — showing the part that finished.`,
              },
              status: 'done',
              progressMessage: null,
            })
            return
          }
          set({ status: 'error', error: 'Humanization failed while processing your document.', progressMessage: null })
          return
        }
      }

      // Polling window exhausted without the job reaching a terminal state —
      // one last check for whatever partial progress was recorded before
      // giving up entirely.
      const lastJob = await apiGetJob(resp.job_id).catch(() => null)
      if (lastJob?.partial_output) {
        applyDetectionToScanStore(lastJob.partial_output)
        set({
          response: {
            job_id: lastJob.job_id,
            status: 'completed',
            output: lastJob.partial_output,
            preprocessing_metadata: resp.preprocessing_metadata,
            processing_metadata: lastJob.processing_metadata,
            result_url: null,
            warning: `Processing didn't finish in time after section ${lastJob.progress?.chunks_completed ?? '?'} of ${lastJob.progress?.chunks_total ?? '?'} — showing the part that finished.`,
          },
          status: 'done',
          progressMessage: null,
        })
        return
      }

      set({ status: 'error', error: 'Timed out waiting for your document to finish processing.', progressMessage: null })
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Humanization failed.'
      set({ status: 'error', error: msg, progressMessage: null })
    }
  },

  reset: () => set({ response: null, status: 'idle', error: null, progressMessage: null }),
}))
