"""
Prometheus metrics definitions shared across all Humanite services.
Each service imports only the metrics relevant to it.
Metrics are registered once at module load — never re-registered.
"""
from prometheus_client import (
    Counter,
    Gauge,
    Histogram,
    generate_latest,
    CONTENT_TYPE_LATEST,
)

# ── HTTP metrics (all services) ───────────────────────────────────────────────

HTTP_REQUESTS_TOTAL = Counter(
    "humanite_http_requests_total",
    "Total HTTP requests handled",
    ["service", "method", "path", "status_code"],
)

HTTP_REQUEST_DURATION = Histogram(
    "humanite_http_request_duration_seconds",
    "HTTP request latency in seconds",
    ["service", "path"],
    buckets=[0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0, 30.0],
)

# ── Humanization metrics ──────────────────────────────────────────────────────

HUMANIZE_JOBS_TOTAL = Counter(
    "humanite_humanize_jobs_total",
    "Total humanization jobs processed",
    ["status"],
)

BERTSCORE_GATE_FAILURES = Counter(
    "humanite_bertscore_gate_failures_total",
    "Humanization attempts that failed the BERTScore gate",
    ["retry_attempt"],
)

BERTSCORE_F1 = Histogram(
    "humanite_bertscore_f1",
    "BERTScore F1 distribution for humanized outputs",
    buckets=[0.70, 0.75, 0.80, 0.85, 0.88, 0.90, 0.92, 0.94, 0.96, 0.98, 1.0],
)

HUMANIZE_DURATION = Histogram(
    "humanite_humanize_duration_seconds",
    "End-to-end humanization job duration",
    buckets=[1, 2, 5, 10, 20, 30, 45, 60, 90, 120],
)

# ── Scanner metrics ───────────────────────────────────────────────────────────

SCAN_JOBS_TOTAL = Counter(
    "humanite_scan_jobs_total",
    "Total scan jobs processed",
    ["classification"],
)

SCAN_CONFIDENCE = Histogram(
    "humanite_scan_confidence",
    "Scanner confidence score distribution",
    buckets=[0.50, 0.60, 0.65, 0.70, 0.75, 0.80, 0.85, 0.90, 0.95, 1.0],
)

SCAN_DURATION = Histogram(
    "humanite_scan_duration_seconds",
    "End-to-end scan job duration",
    buckets=[0.1, 0.25, 0.5, 1.0, 2.0, 5.0, 10.0, 30.0],
)

# ── Quality gate metrics ──────────────────────────────────────────────────────

QUALITY_GATE_RESULTS = Counter(
    "humanite_quality_gate_results_total",
    "Quality gate pass/fail counts",
    ["gate", "result"],
)

# ── Content moderation metrics ────────────────────────────────────────────────

MODERATION_BLOCKS_TOTAL = Counter(
    "humanite_moderation_blocks_total",
    "Content policy violations blocked",
    ["violation_category"],
)

# ── Job queue metrics ─────────────────────────────────────────────────────────

ACTIVE_JOBS = Gauge(
    "humanite_active_jobs",
    "Currently processing jobs",
    ["job_type"],
)

BATCH_JOBS_TOTAL = Counter(
    "humanite_batch_jobs_total",
    "Batch jobs submitted",
    ["status"],
)


def metrics_response():
    """Return a FastAPI Response with Prometheus text format."""
    from fastapi.responses import Response
    return Response(
        content=generate_latest(),
        media_type=CONTENT_TYPE_LATEST,
    )
