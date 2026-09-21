from contextlib import asynccontextmanager
import logging
import os
import sys
import time

sys.path.insert(0, os.path.normpath(os.path.join(os.path.dirname(__file__), "../..")))
from shared.logging_config import configure_logging
from shared.tracing import configure_tracing
from shared.metrics import HTTP_REQUESTS_TOTAL, HTTP_REQUEST_DURATION, metrics_response

configure_logging(service_name="user-management")
configure_tracing(service_name="user-management")

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

from .routers.auth import router as auth_router

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("User management service starting…")
    yield
    logger.info("User management service shutting down.")


app = FastAPI(title="Humanite User Management", version="0.2.0", lifespan=lifespan)

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
        service="user-management",
        method=request.method,
        path=path,
        status_code=str(response.status_code),
    ).inc()
    HTTP_REQUEST_DURATION.labels(service="user-management", path=path).observe(duration)
    return response


app.include_router(auth_router)


@app.get("/metrics")
async def metrics():
    return metrics_response()


@app.get("/v1/health")
async def health() -> dict:
    return {"status": "ok", "service": "user-management", "version": "0.2.0"}
