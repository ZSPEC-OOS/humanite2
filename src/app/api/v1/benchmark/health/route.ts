/**
 * GET /api/v1/benchmark/health — probe for the internal benchmark service.
 * Same token gate as /run (404 when the feature is off). Bypasses user auth
 * on purpose; see docs/benchmark-service.md.
 */
import { handleBenchmarkHealth } from '@/lib/benchmark-service/handlers'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  return handleBenchmarkHealth(req)
}
