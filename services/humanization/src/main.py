from contextlib import asynccontextmanager
import logging
import os
import sys
import time

sys.path.insert(0, os.path.normpath(os.path.join(os.path.dirname(__file__), "../..")))
from shared.logging_config import configure_logging
from shared.tracing import configure_tracing
from shared.metrics import HTTP_REQUESTS_TOTAL, HTTP_REQUEST_DURATION, metrics_response

configure_logging(service_name="humanization")
configure_tracing(service_name="humanization")

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

from .routers.humanize import router as humanize_router

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Warming up quality gate models…")
    # Force-import to trigger model loads at startup, not first request
    from .gates.bertscore_gate import THRESHOLD as _bs_thresh
    from .gates.nli_gate import THRESHOLD as _nli_thresh
    from .gates.entity_gate import THRESHOLD as _ent_thresh
    logger.info(
        "Models ready. Thresholds: BERTScore=%.2f NLI=%.2f Entity=%.2f",
        _bs_thresh, _nli_thresh, _ent_thresh,
    )
    yield


app = FastAPI(
    title="Humanite Humanization Engine",
    version="0.4.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def prometheus_middleware(request: Request, call_next):
    start = time.perf_counter()
    response = await call_next(request)
    duration = time.perf_counter() - start
    path = request.url.path
    HTTP_REQUESTS_TOTAL.labels(
        service="humanization",
        method=request.method,
        path=path,
        status_code=str(response.status_code),
    ).inc()
    HTTP_REQUEST_DURATION.labels(service="humanization", path=path).observe(duration)
    return response


app.include_router(humanize_router)


@app.get("/metrics")
async def metrics():
    return metrics_response()


@app.get("/v1/health")
async def health():
    return {"status": "ok", "service": "humanization", "version": "0.4.0"}
