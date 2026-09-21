import os
from celery import Celery

celery_app = Celery(
    "humanite_humanize_worker",
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
    task_queues={"humanize.interactive": {}},
    task_default_queue="humanize.interactive",
)

celery_app.autodiscover_tasks(["src.batch_tasks"])
