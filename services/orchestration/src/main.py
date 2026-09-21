from contextlib import asynccontextmanager
import logging
import os
import sys
import time

# Make shared/ importable: services/orchestration/src -> services/
sys.path.insert(0, os.path.normpath(os.path.join(os.path.dirname(__file__), "../..")))
from shared.logging_config import configure_logging
from shared.tracing import configure_tracing
from shared.metrics import HTTP_REQUESTS_TOTAL, HTTP_REQUEST_DURATION, metrics_response

configure_logging(service_name="orchestration")
configure_tracing(service_name="orchestration")

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

from .middleware.errors import global_error_handler
from .routers.batch   import router as batch_router
from .routers.export  import router as export_router
from .routers.humanize import router as humanize_router
from .routers.jobs import router as jobs_router
from .routers.presets import router as presets_router
from .routers.scan import router as scan_router

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Orchestration service starting…")
    yield
    logger.info("Orchestration service shutting down.")


app = FastAPI(
    title="Humanite Orchestration",
    version="0.6.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.add_exception_handler(Exception, global_error_handler)


@app.middleware("http")
async def prometheus_middleware(request: Request, call_next):
    start = time.perf_counter()
    response = await call_next(request)
    duration = time.perf_counter() - start
    path = request.url.path
    HTTP_REQUESTS_TOTAL.labels(
        service="orchestration",
        method=request.method,
        path=path,
        status_code=str(response.status_code),
    ).inc()
    HTTP_REQUEST_DURATION.labels(service="orchestration", path=path).observe(duration)
    return response


app.include_router(humanize_router)
app.include_router(scan_router)
app.include_router(jobs_router)
app.include_router(batch_router)
app.include_router(presets_router)
app.include_router(export_router)


@app.get("/metrics")
async def metrics():
    return metrics_response()


@app.get("/v1/health")
async def health():
    return {"status": "ok", "service": "orchestration", "version": "0.6.0"}
