import { SiteNav } from '@/components/marketing/SiteNav'
import { SiteFooter } from '@/components/marketing/SiteFooter'

// Page shell only — copy for this page is provided separately.
export default function SolutionsPage() {
  return (
    <main className="min-h-screen bg-white dark:bg-gray-950">
      <div className="flex min-h-screen flex-col">
        <SiteNav />

        <div className="flex-1 px-6 pb-20 pt-6 md:px-14">
          <div className="mx-auto max-w-2xl text-center">
            <h1 className="mt-4 font-display text-4xl font-bold text-gray-900 dark:text-gray-100 md:text-6xl">
              Solutions
            </h1>
          </div>
        </div>

        <SiteFooter />
      </div>
    </main>
  )
}
