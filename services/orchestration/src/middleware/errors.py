"""
Global exception handler — converts unhandled exceptions to structured JSON.
Never logs exception messages — only type names (messages may contain user text).
"""
import logging
import uuid

from fastapi import Request
from fastapi.responses import JSONResponse

logger = logging.getLogger(__name__)


async def global_error_handler(request: Request, exc: Exception) -> JSONResponse:
    request_id = str(uuid.uuid4())
    logger.error(
        "Unhandled exception",
        extra={
            "request_id": request_id,
            "path": request.url.path,
            "method": request.method,
            "exception_type": type(exc).__name__,
            # Never log exc.args — may contain user input
        },
    )
    return JSONResponse(
        status_code=500,
        content={
            "error": {
                "code": "INTERNAL_PIPELINE_ERROR",
                "message": "An internal error occurred. Please retry.",
                "request_id": request_id,
            }
        },
    )
