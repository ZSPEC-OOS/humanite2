.PHONY: dev build start lint test test-e2e typecheck generate-jwt-secret benchmark

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

# Live run against the full 60-item benchmark corpus — spends real API
# credits (model + configured detectors). Requires RUN_LIVE_BENCHMARK=true
# plus OPENAI_API_KEY (GPTZERO_API_KEY/SAPLING_API_KEY optional) in the
# environment. See tests/benchmark/README.md.
benchmark:
	RUN_LIVE_BENCHMARK=true pnpm benchmark

generate-jwt-secret:
	@openssl rand -base64 32
	@echo "Add the value above to .env.local as JWT_SECRET"
