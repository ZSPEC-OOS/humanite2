'use client'
import Link from 'next/link'

// Landing page for the A2H benchmark admin area — access is already gated
// by layout.tsx. Corpus administration (Phase 2 of the A2H Benchmark
// Version 1 Coding Plan) is wired up; run execution and analysis tooling
// (Phases 3+) land in later phases.
export default function A2HAdminPage() {
  return (
    <div className="min-h-screen bg-white dark:bg-gray-950 flex items-center justify-center p-6">
      <div className="max-w-md w-full text-center space-y-4">
        <h1 className="text-lg font-semibold text-gray-900 dark:text-gray-100">A2H Benchmark</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Corpus generation, run execution, and analysis tooling.
        </p>
        <div className="flex flex-col gap-2">
          <Link href="/admin/a2h/corpus-design"
            className="text-sm px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
            Corpus Design
          </Link>
          <Link href="/admin/a2h/topics"
            className="text-sm px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
            Topic Outlines
          </Link>
          <Link href="/admin/a2h/corpus"
            className="text-sm px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
            Corpus Matrix
          </Link>
        </div>
        <Link href="/dashboard" className="inline-block text-sm text-gray-400 hover:text-gray-700 dark:text-gray-500 dark:hover:text-gray-300">
          Back to dashboard
        </Link>
      </div>
    </div>
  )
}
