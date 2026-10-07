# Benchmark service

`POST /api/v1/benchmark/run` and `GET /api/v1/benchmark/health` let an external
benchmarking framework call Humanite's product code over HTTP. This endpoint is
intentionally application-agnostic: it knows nothing about any particular
benchmark, only about three product operations.

## Enabling

Set `HUMANITE_BENCHMARK_TOKEN` to a secret of at least 32 characters. There is
no default. If it is unset, empty, or shorter than 32 characters, both
endpoints return `404` (a too-short token also logs one server line, never the
token). The model provider comes from the usual `OPENAI_API_KEY`,
`OPENAI_BASE_URL`, `OPENAI_MODEL`.

## Auth and security notes

- `Authorization: Bearer <token>`, compared via `crypto.timingSafeEqual` on
  SHA-256 digests (equal length). Missing or wrong token gives `401`
  `{error:{code:'UNAUTHORIZED',message}}`.
- This endpoint bypasses user auth, quota, billing and usage metering on
  purpose (service caller). Treat the token like a production API key, rotate
  it, and leave it unset anywhere the feature is not needed.
- Error messages never include the input text or secrets; upstream error
  messages are not forwarded. Responses are `Cache-Control: no-store`.
- Limits: 50,000 characters per text field, 256 KiB request body.

## POST /api/v1/benchmark/run

```json
{
  "operation": "humanize | repair_grammar | repair_facts",
  "text": "...",
  "settings": { "intensity": 1-10, "tone": "...", "domain": "...", "genre": null, "audience": null },
  "candidateCountOverride": null,
  "extra": { "sourceText": "...", "tone": "...", "domain": "..." }
}
```

Unknown fields are rejected. `settings` defaults: intensity 5, tone
`balanced`, domain `general`. `tone`, `domain`, `genre`, `audience` must be
Humanite's own values (`src/lib/style/types.ts`); `intensity` is an integer
1-10; `candidateCountOverride` is null or an integer 1-5.

| operation | runs |
|---|---|
| `humanize` | `runHumaniteDocument` (preprocess, effective intensity, document context, humanize chunk with gates/retries, consistency pass) |
| `repair_grammar` | `repairGrammar` on `text` (one model call) |
| `repair_facts` | `repairChunk(extra.sourceText, text, extra.tone ?? 'balanced', extra.domain ?? settings.domain)`: fact-ledger-gated sentence repair; `extra.sourceText` is required |

200 response: `output`, `requestedIntensity`, `appliedIntensity`,
`intensityCapped`, `candidateCount`, `modelUsed`, `modelCalls`, `inputTokens`,
`outputTokens`, `retryCount`, `latencyMs`, plus `candidateSelection`,
`gatesUnavailable`, `gatePassed` where the path produces them. Fields a path
does not produce are `null` (or omitted for the optional ones).
`modelCalls` for `humanize` counts only generation-phase calls (a known
product telemetry gap).

Errors are `{error:{code,message}}`: `400` `VALIDATION_ERROR`/`INVALID_JSON`,
`401` `UNAUTHORIZED`, `404` feature off, `413` `PAYLOAD_TOO_LARGE`, `429`
`RATE_LIMITED` (upstream), `502` `UPSTREAM_FAILED`, `500` `INTERNAL_ERROR` or
`NOT_CONFIGURED`.

## GET /api/v1/benchmark/health

Same auth. Returns `{ "ok": true, "operations": ["humanize","repair_grammar","repair_facts"] }`.
