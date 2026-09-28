'use client'
import Link from 'next/link'

// Placeholder landing page for the A2H benchmark admin area (Phase 0 of the
// A2H Benchmark Version 1 Coding Plan) — access is already gated by
// layout.tsx; the corpus/run/analysis tooling itself lands in later phases.
export default function A2HAdminPage() {
  return (
    <div className="min-h-screen bg-white dark:bg-gray-950 flex items-center justify-center p-6">
      <div className="max-w-md text-center space-y-3">
        <h1 className="text-lg font-semibold text-gray-900 dark:text-gray-100">A2H Benchmark</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Corpus generation, run execution, and analysis tooling are not built yet.
        </p>
        <Link href="/dashboard" className="inline-block text-sm text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-100">
          Back to dashboard
        </Link>
      </div>
    </div>
  )
}
