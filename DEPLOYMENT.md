# Deployment Guide

## Overview

Humanite is deployed as a set of Docker images onto Kubernetes.  
The pipeline is fully automated via GitHub Actions (`cd.yml`) and follows a
**staging → smoke-test → production** promotion model.

```
push to main
    │
    ├─► Build images (ghcr.io) ──────────────────────────────────────────────┐
    │     gateway · orchestration · web                                       │
    │                                                                         ▼
    └────────────────────────────────────────────────────► Deploy → Staging
                                                                │
                                                        Smoke tests pass?
                                                                │ yes
                                                                ▼
                                                      Deploy → Production
                                               (environment protection gate)
```

---

## Local development

```bash
# 1. Copy and fill in secrets
cp .env.local.template .env.local
# Edit .env.local — set OPENAI_API_KEY, WATERMARK_SECRET_SALT, JWT_*

# 2. Generate JWT key-pair (first time only)
make generate-jwt-keys
# Paste the printed values into .env.local, then delete the .pem files

# 3. Start the full stack
make dev-up
# Frontend → http://localhost:3000
# API gateway → http://localhost:8080

# 4. Run database migrations and seed data
make db-migrate
make db-seed

# 5. Verify everything is healthy
make health-check

# Tear down (removes volumes)
make dev-down
```

### What `dev-up` starts

| Service | Port | Description |
|---|---|---|
| `gateway` (Go) | 8080 | API gateway / JWT auth |
| `orchestration` | 8000 | Core API (FastAPI) |
| `preprocessing` | 8001 | Document ingestion |
| `humanization` | 8002 | AI rewriting service |
| `scanner` | 8003 | AI-detection scanner |
| `user-management` | 8004 | Auth / billing |
| `worker-humanize` | — | Celery worker |
| `worker-scan` | — | Celery worker |
| `web` (Next.js) | 3000 | Frontend |
| `postgres` | 5432 | Database |
| `redis` | 6379 | Queue / cache |
| `minio` | 9000/9001 | Object storage |
| `ollama` | 11434 | Local LLM |
| `mailhog` | 8025 | Dev mail catcher |
| `jaeger` | 16686 | Distributed tracing |

---

## Running tests

```bash
make test          # all service tests via docker-compose.test.yml
make lint          # ruff + mypy across services/, workers/, ml/
```

---

## CI (GitHub Actions — `ci.yml`)

Triggered on every push and pull request. Runs linting, unit tests, and type
checks. Concurrency is configured to cancel in-progress runs on the same ref.

---

## CD (GitHub Actions — `cd.yml`)

### Triggers

| Event | Behaviour |
|---|---|
| Push to `main` | Full pipeline: build → staging → smoke → production |
| `workflow_dispatch` | Choose `staging` or `production` manually |

### Required secrets

Configure these in **GitHub → Settings → Environments**:

| Secret | Where used | Description |
|---|---|---|
| `KUBECONFIG_STAGING` | staging job | Base64-encoded kubeconfig for the staging cluster |
| `KUBECONFIG_PRODUCTION` | production job | Base64-encoded kubeconfig for the production cluster |
| `STAGING_URL` | smoke-test job | Base URL of the staging deployment (e.g. `https://staging.humanite.io`) |

### Build

Three images are built in parallel and pushed to GHCR:

```
ghcr.io/<org>/humanite/gateway:<sha>
ghcr.io/<org>/humanite/orchestration:<sha>
ghcr.io/<org>/humanite/web:<sha>
```

Each image is also tagged `latest` on `main`.

### Deploy

Kustomize overlays are applied with `kubectl apply -k`:

```
infra/k8s/overlays/staging     (namespace: humanite-staging)
infra/k8s/overlays/production  (namespace: humanite-production)
```

The image tag for each deployment is then updated to the short SHA:

```bash
kubectl set image deployment/gateway \
  gateway=ghcr.io/<org>/humanite/gateway:<sha7>
```

Rollout is watched with `kubectl rollout status --timeout=5m` (staging) /
`--timeout=10m` (production).

### Smoke tests

After staging deploys, the pipeline hits:

- `$STAGING_URL/v1/health`
- `$STAGING_URL/metrics`

Both must return HTTP 200. Production only proceeds if smoke tests pass.

### Production gate

The `production` GitHub environment should have **required reviewers** configured
so a human approves before the final deploy step runs.

---

## Kubernetes infrastructure

Manifests live in `infra/k8s/`:

```
infra/k8s/
├── base/
│   ├── gateway.yaml          # Deployment + Service
│   ├── orchestration.yaml    # Deployment + Service + HPA + PDB
│   └── kustomization.yaml
└── overlays/
    ├── staging/
    │   └── kustomization.yaml   # 2 replicas, lighter resources, HPA max 5
    └── production/
        └── kustomization.yaml   # production replicas & resource limits
```

### Security posture (enforced in manifests)

- Containers run as non-root (`runAsNonRoot: true`, UID 65532 for gateway)
- `allowPrivilegeEscalation: false`
- `readOnlyRootFilesystem: true`
- All Linux capabilities dropped (`capabilities.drop: [ALL]`)
- Secrets injected via `secretKeyRef` — never baked into images

### Kubernetes secrets

Before first deploy, create the `humanite-secrets` Secret in each namespace:

```bash
kubectl create secret generic humanite-secrets \
  --namespace humanite-staging \
  --from-literal=redis-url="redis://<host>:6379/0" \
  --from-literal=jwt-secret="<public-key-pem>"

# Repeat for humanite-production
```

---

## Pre-flight checklist

Run the automated checklist before any production release:

```bash
bash scripts/production_checklist.sh
```

It verifies Dockerfiles, K8s manifests, Prometheus metrics endpoints, CI/CD
files, ML regression gates, and E2E test setup. All `[FAIL]` items must be
resolved before deploying.

---

## Manual rollback

```bash
# List recent rollout history
kubectl rollout history deployment/gateway -n humanite-production

# Roll back one revision
kubectl rollout undo deployment/gateway -n humanite-production

# Roll back to a specific revision
kubectl rollout undo deployment/gateway --to-revision=3 -n humanite-production
```
