# Deployment Guide

## Overview

Humanite is a single Next.js application — frontend, API routes, auth,
job storage (Firestore), and AI-detection orchestration all live in this
one deployable unit. There is no separate backend service.

```
push to main
    │
    ▼
Vercel builds and deploys automatically
(GitHub integration — no custom deploy workflow needed)
```

`.github/workflows/cd.yml` is intentionally a no-op placeholder — Vercel's
own GitHub integration handles every deployment. It exists only so a
manual `workflow_dispatch` run has somewhere to land if you ever want one.

---

## Local development

```bash
# 1. Copy and fill in secrets
cp .env.local.template .env.local
# Edit .env.local — see "Environment variables" below

# 2. Install dependencies
pnpm install

# 3. Run the dev server
pnpm dev
# → http://localhost:3000
```

No Docker, database containers, or other services are required for local
development — Firestore, OpenAI, and (optionally) GPTZero are all reached
directly over the network using the credentials in `.env.local`.

---

## Environment variables

`.env.local.template` is the source of truth — copy it and fill in the
**Required** section at minimum:

| Variable | Purpose |
|---|---|
| `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY` | Firestore — job storage, presets, API config sync |
| `OPENAI_API_KEY` | The humanization model (or any OpenAI-compatible endpoint) |
| `JWT_SECRET` | Signs auth tokens — any long random string (`make generate-jwt-secret`) |

Everything else in the template is optional and documented inline,
including:

- **AI detection (GPTZero)** — `GPTZERO_API_KEY` + `DETECTION_PROVIDER=gptzero`.
  Left unset, detection runs against a built-in mock provider instead, so
  neither local dev nor CI ever spends a real GPTZero request. See
  `src/lib/detection/gateway.ts`.
- **Cloudflare R2** — cross-device sync for the "AI Model Config" panel.
- **Stripe** — the `/pricing` page's paid-tier checkout.
- **Watermark verification** — `WATERMARK_SECRET_SALT`, `NEXT_PUBLIC_APP_URL`.

In Vercel, set these under **Project Settings → Environment Variables**
instead of committing `.env.local`.

---

## Running tests

```bash
pnpm tsc --noEmit    # type check
pnpm test:unit       # vitest
pnpm test:e2e         # playwright
pnpm lint            # next lint
```

Or via the Makefile: `make typecheck`, `make test`, `make test-e2e`, `make lint`.

---

## CI (GitHub Actions — `ci.yml`)

Triggered on every push and pull request to `main`. Runs type checking,
unit tests, and a production build against placeholder env vars, so a
missing/misconfigured real credential never blocks CI. Concurrency is
configured to cancel in-progress runs on the same ref.

---

## Health check

`GET /api/v1/health` returns `{ "status": "ok" }` — used as the smoke
check after a Vercel deploy.

---

## Rollback

Use Vercel's own deployment history (dashboard → Deployments → pick a
previous build → Promote to Production) to roll back. There is no
separate rollback mechanism to manage.
