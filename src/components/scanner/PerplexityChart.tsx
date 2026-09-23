'use client'

interface PerplexityChartProps {
  scores: number[]
}

// Perplexity is a measure of language-model predictability — one detector
// diagnostic among several, not independent proof of authorship. Low
// perplexity occurs naturally in technical procedures, legal boilerplate,
// and other formulaic human writing, so this chart deliberately does not
// map raw magnitude to a "human-like"/"AI-like" verdict via fixed
// thresholds. Bars are shaded by each sentence's predictability *relative
// to this document's own range* — a within-document outlier view, not an
// absolute scale.
function relativeShade(score: number, min: number, max: number): string {
  if (max <= min) return 'bg-gray-400'
  const t = (score - min) / (max - min) // 0 = most predictable, 1 = least
  if (t < 0.33) return 'bg-gray-300'
  if (t < 0.66) return 'bg-gray-500'
  return 'bg-gray-900'
}

export function PerplexityChart({ scores }: PerplexityChartProps) {
  if (!scores.length) return null

  const min     = Math.min(...scores)
  const max     = Math.max(...scores, 1)
  const display = scores.slice(0, 30)
  const avg     = scores.reduce((a, b) => a + b, 0) / scores.length

  return (
    <div>
      <div className="flex items-end gap-0.5 h-10">
        {display.map((score, i) => {
          const height = Math.max((score / max) * 100, 4)
          return (
            <div
              key={i}
              title={`Sentence ${i + 1}: perplexity ${score.toFixed(0)} (predictability relative to this document)`}
              className={`flex-1 rounded-sm transition-all cursor-default ${relativeShade(score, min, max)}`}
              style={{ height: `${height}%` }}
            />
          )
        })}
        {scores.length > 30 && (
          <span className="text-xs text-gray-400 self-end ml-1">
            +{scores.length - 30}
          </span>
        )}
      </div>

      <div className="flex justify-between mt-1.5 text-xs text-gray-400">
        <span>Sentence 1</span>
        <span>Avg: {avg.toFixed(0)}</span>
        <span>Sentence {Math.min(scores.length, 30)}</span>
      </div>

      <div className="flex gap-3 mt-2 text-xs text-gray-400">
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-sm bg-gray-300" />
          More predictable
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-sm bg-gray-900" />
          Less predictable
        </span>
      </div>

      <p className="mt-2 text-xs text-gray-400 leading-relaxed">
        Perplexity measures language-model predictability. It is one detector
        input, shown here relative to this document&apos;s own sentences —
        not independent evidence of machine authorship.
      </p>
    </div>
  )
}
