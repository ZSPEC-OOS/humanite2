.PHONY: dev build start lint test test-e2e typecheck generate-jwt-secret benchmark benchmark-scaleup

dev:
	pnpm dev

build:
	pnpm build

start:
	pnpm start

lint:
	pnpm lint

typecheck:
	pnpm tsc --noEmit

test:
	pnpm test:unit

test-e2e:
	pnpm test:e2e

# Live run against the full 300-item benchmark corpus (50 per domain,
# post-Phase-11 scale-up) — spends real API credits (model + configured
# detectors). Requires RUN_LIVE_BENCHMARK=true plus OPENAI_API_KEY
# (GPTZERO_API_KEY/SAPLING_API_KEY optional) in the environment. See
# tests/benchmark/README.md.
benchmark:
	RUN_LIVE_BENCHMARK=true pnpm benchmark

# Phase 11's tone x intensity scale-up sweep (5 tones x intensities 2/5/8)
# against a small cross-domain sample — see
# tests/benchmark/tests/scaleUpSweepAcceptance.test.ts. Same credential
# requirements as `benchmark` above.
benchmark-scaleup:
	RUN_LIVE_BENCHMARK=true pnpm benchmark:scaleup

generate-jwt-secret:
	@openssl rand -base64 32
	@echo "Add the value above to .env.local as JWT_SECRET"
