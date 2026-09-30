import type { CorpusProjectStatus } from '@/lib/a2h/types'

export type CorpusStepKey = 'setup' | 'blueprint' | 'matrix' | 'freeze'

const STEPS: { key: CorpusStepKey; label: string }[] = [
  { key: 'setup', label: 'Setup' },
  { key: 'blueprint', label: 'Topic Blueprint' },
  { key: 'matrix', label: 'Source Matrix' },
  { key: 'freeze', label: 'Freeze' },
]

function completedSteps(status: CorpusProjectStatus): Set<CorpusStepKey> {
  switch (status) {
    case 'blueprint_locked':
    case 'generating':
      return new Set<CorpusStepKey>(['setup', 'blueprint'])
    case 'frozen':
      return new Set<CorpusStepKey>(['setup', 'blueprint', 'matrix', 'freeze'])
    case 'archived':
      return new Set<CorpusStepKey>(['setup', 'blueprint'])
    case 'draft':
    default:
      return new Set<CorpusStepKey>()
  }
}

// A small, always-visible orientation strip so an admin always knows where
// they are in the corpus lifecycle, what's already done, and what has to
// happen next — the whole reason the flow was split into named steps rather
// than one undifferentiated settings page.
export function CorpusSteps({ status, current }: { status: CorpusProjectStatus; current: CorpusStepKey }) {
  const done = completedSteps(status)
  return (
    <div className="flex flex-wrap items-center gap-x-1 gap-y-1.5 text-xs">
      {STEPS.map((step, i) => {
        const isDone = done.has(step.key)
        const isCurrent = step.key === current
        return (
          <div key={step.key} className="flex items-center gap-1">
            <span
              className={`inline-flex items-center gap-1 px-2 py-1 rounded-full font-medium ${
                isCurrent
                  ? 'bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900'
                  : isDone
                    ? 'text-green-700 dark:text-green-400'
                    : 'text-gray-400 dark:text-gray-600'
              }`}
            >
              {isDone && !isCurrent ? '✓' : `${i + 1}.`} {step.label}
            </span>
            {i < STEPS.length - 1 && <span className="text-gray-300 dark:text-gray-700">→</span>}
          </div>
        )
      })}
    </div>
  )
}
