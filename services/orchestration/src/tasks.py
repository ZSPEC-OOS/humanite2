"""
Celery task definitions — imported by the orchestration routers.
The actual task logic is in the worker packages to keep dependencies separate.
"""
import os
from celery import Celery

celery_app = Celery(
    "humanite_orchestration",
    broker=os.environ.get("CELERY_BROKER_URL", "redis://redis:6379/1"),
    backend=os.environ.get("CELERY_RESULT_BACKEND", "redis://redis:6379/3"),
)

celery_app.conf.update(
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    timezone="UTC",
    enable_utc=True,
    task_acks_late=True,
    task_reject_on_worker_lost=True,
)

# Declare task signatures so routers can call .delay() without importing workers
queue_humanize = celery_app.signature("humanize.process")
queue_scan     = celery_app.signature("scan.process")
queue_batch    = celery_app.signature("batch.process")
