FROM python:3.12-slim-bookworm AS base
WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1

FROM base AS development
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
CMD ["celery", "-A", "src.celery_app", "worker", "-Q", "scan.interactive", "-c", "4", "--loglevel=info"]

FROM base AS production
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY src/ ./src/
RUN useradd -m -u 1001 appuser && chown -R appuser /app
USER appuser
CMD ["celery", "-A", "src.celery_app", "worker", "-Q", "scan.interactive", "-c", "4", "--loglevel=info"]
