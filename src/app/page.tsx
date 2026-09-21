import Link from 'next/link'

export default function LandingPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-white px-6 text-center">
      <h1 className="text-6xl font-bold tracking-tight text-gray-900">Humanite</h1>
      <p className="mt-4 max-w-md text-lg text-gray-500">
        Turn AI-generated text into natural, human writing.
      </p>
      <Link
        href="/dashboard"
        className="mt-10 inline-flex items-center justify-center rounded-lg bg-gray-900 px-8 py-3.5 text-sm font-semibold text-white transition-colors hover:bg-gray-800"
      >
        Start Humanite
      </Link>
    </main>
  )
}
