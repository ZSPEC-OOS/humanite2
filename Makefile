.PHONY: dev-up dev-down db-migrate db-seed health-check test lint generate-jwt-keys

dev-up:
	@echo "Starting Humanite dev stack..."
	docker compose -f docker-compose.dev.yml up --build --wait
	@echo "Stack ready. Frontend: http://localhost:3000 | API: http://localhost:8080"

dev-down:
	docker compose -f docker-compose.dev.yml down -v

db-migrate:
	docker exec humanite-orchestration-1 alembic upgrade head

db-seed:
	docker exec humanite-orchestration-1 python /app/scripts/seed_dev_db.py

health-check:
	@curl -sf http://localhost:8080/v1/health | python3 -m json.tool
	@echo "Gateway: OK"
	@curl -sf http://localhost:8000/v1/health | python3 -m json.tool
	@echo "Orchestration: OK"

test:
	docker compose -f docker-compose.test.yml up --build --abort-on-container-exit
	docker compose -f docker-compose.test.yml down -v

lint:
	ruff check services/ workers/ ml/
	mypy services/ --ignore-missing-imports

generate-jwt-keys:
	openssl genrsa -out jwt_private.pem 2048
	openssl rsa -in jwt_private.pem -pubout -out jwt_public.pem
	@echo "Add contents to .env.local as JWT_PRIVATE_KEY and JWT_PUBLIC_KEY"
	@echo "Delete pem files after — never commit them"
