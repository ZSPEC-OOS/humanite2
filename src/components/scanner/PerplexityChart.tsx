'use client'

interface PerplexityChartProps {
  scores: number[]
}

const HIGH_PERP = 120    // above this = very human-like
const LOW_PERP  = 30     // below this = very AI-like

function barColor(score: number): string {
  if (score >= HIGH_PERP) return 'bg-green-500'
  if (score >= 60)        return 'bg-green-300'
  if (score >= LOW_PERP)  return 'bg-amber-400'
  return 'bg-red-400'
}

export function PerplexityChart({ scores }: PerplexityChartProps) {
  if (!scores.length) return null

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
              title={`Sentence ${i + 1}: perplexity ${score.toFixed(0)}`}
              className={`flex-1 rounded-sm transition-all cursor-default ${barColor(score)}`}
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

      <div className="flex justify-between mt-1.5 text-xs text-white/25">
        <span>Sentence 1</span>
        <span>Avg: {avg.toFixed(0)}</span>
        <span>Sentence {Math.min(scores.length, 30)}</span>
      </div>

      <div className="flex gap-3 mt-2 text-xs text-white/30">
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-sm bg-green-500" />
          High (human-like)
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-sm bg-amber-400" />
          Medium
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-sm bg-red-400" />
          Low (AI-like)
        </span>
      </div>
    </div>
  )
}
