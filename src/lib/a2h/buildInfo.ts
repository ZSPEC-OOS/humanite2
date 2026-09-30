import packageJson from '../../../package.json'

// Snapshot values captured once at BenchmarkRun creation (never re-resolved
// later) so a run's own record answers "what code produced this?" without
// depending on deploy history still being available. There's no CI step in
// this repo that stamps a commit SHA into the build, so this falls back
// through the common hosting-provider env vars before giving up — 'unknown'
// is an honest, visible value rather than a fabricated one.
export function getHumaniteVersion(): string {
  return packageJson.version || 'unknown'
}

export function getGitCommit(): string {
  return (
    process.env.VERCEL_GIT_COMMIT_SHA
    || process.env.GIT_COMMIT_SHA
    || process.env.SOURCE_VERSION
    || 'unknown'
  )
}
