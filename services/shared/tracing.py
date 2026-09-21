"""
Shared OpenTelemetry bootstrap for all Humanite services.

Usage:
    from shared.tracing import configure_tracing
    configure_tracing(service_name="orchestration")

Gracefully degrades: if opentelemetry packages are not installed the call
is a no-op and a warning is emitted instead of crashing.
"""
import logging
import os

logger = logging.getLogger(__name__)


def configure_tracing(service_name: str) -> None:
    """
    Configures OTLP-HTTP tracing to Jaeger (or any OTLP-compatible collector).
    Auto-instruments FastAPI, httpx, and SQLAlchemy when available.
    """
    try:
        from opentelemetry import trace
        from opentelemetry.sdk.trace import TracerProvider
        from opentelemetry.sdk.trace.export import BatchSpanProcessor
        from opentelemetry.sdk.resources import Resource, SERVICE_NAME
        from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
    except ImportError:
        logger.warning(
            "opentelemetry packages not installed — tracing disabled",
            extra={"service": service_name},
        )
        return

    endpoint = os.getenv(
        "OTEL_EXPORTER_OTLP_ENDPOINT", "http://jaeger:4318/v1/traces"
    )

    resource = Resource.create({SERVICE_NAME: service_name})
    provider = TracerProvider(resource=resource)
    exporter = OTLPSpanExporter(endpoint=endpoint)
    provider.add_span_processor(BatchSpanProcessor(exporter))
    trace.set_tracer_provider(provider)

    # FastAPI auto-instrumentation
    try:
        from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
        FastAPIInstrumentor().instrument()
    except ImportError:
        pass

    # httpx auto-instrumentation
    try:
        from opentelemetry.instrumentation.httpx import HTTPXClientInstrumentor
        HTTPXClientInstrumentor().instrument()
    except ImportError:
        pass

    # SQLAlchemy auto-instrumentation
    try:
        from opentelemetry.instrumentation.sqlalchemy import SQLAlchemyInstrumentor
        SQLAlchemyInstrumentor().instrument()
    except ImportError:
        pass

    logger.info(
        "OpenTelemetry tracing configured",
        extra={"service": service_name, "otlp_endpoint": endpoint},
    )
