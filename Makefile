.PHONY: dev build start lint test test-e2e typecheck generate-jwt-secret

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

generate-jwt-secret:
	@openssl rand -base64 32
	@echo "Add the value above to .env.local as JWT_SECRET"
