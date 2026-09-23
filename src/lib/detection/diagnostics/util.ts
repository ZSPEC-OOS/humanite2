// Small numeric helpers shared across the diagnostics modules — no NLP
// dependency, just arithmetic over whatever the tokenizers below produce.

export function round(n: number): number {
  return Math.round(n * 10000) / 10000
}

export function rate(count: number, total: number): number {
  return total === 0 ? 0 : count / total
}

export function mean(nums: number[]): number {
  return nums.length === 0 ? 0 : nums.reduce((sum, n) => sum + n, 0) / nums.length
}

export function stddev(nums: number[], avg: number): number {
  if (nums.length === 0) return 0
  const variance = nums.reduce((sum, n) => sum + (n - avg) ** 2, 0) / nums.length
  return Math.sqrt(variance)
}
