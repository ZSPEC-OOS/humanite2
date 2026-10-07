/**
 * POST /api/v1/benchmark/run — internal, application-agnostic benchmark
 * service endpoint. Deliberately bypasses user auth, quota, billing and
 * usage metering (service caller); gated only by HUMANITE_BENCHMARK_TOKEN
 * (404 when unset/too short). See src/lib/benchmark-service and
 * docs/benchmark-service.md.
 */
import { handleBenchmarkRun } from '@/lib/benchmark-service/handlers'

export const maxDuration = 300
export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  return handleBenchmarkRun(req)
}
