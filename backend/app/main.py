import logging
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

# Import the full model registry FIRST, before anything below has a chance
# to import a single model module on its own. This is what avoids the
# circular-import trap described in app/db/base.py and app/models/__init__.py:
# once this line has run, every model class is safely importable from
# anywhere, in any order, for the rest of the process's life.
import app.models  # noqa: E402, F401
from app.core.config import settings  # noqa: E402
from app.core.exceptions import (  # noqa: E402
    ConflictError,
    DomainError,
    NotFoundError,
    PermissionDeniedError,
    ValidationError,
)
from app.core.middleware import (  # noqa: E402
    RateLimitMiddleware,
    RequestContextMiddleware,
)

# One JSON object per line from the app's own loggers (access + errors), so
# a log platform can index fields like request_id without parsing prose.
logging.basicConfig(level=logging.INFO, format="%(message)s")

@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    yield
    from app.db.session import engine

    await engine.dispose()


app = FastAPI(
    title=settings.app_name,
    version=settings.version,
    debug=settings.debug,
    lifespan=lifespan,
    docs_url=None if settings.is_production else "/docs",
    redoc_url=None,
)

# Middleware runs outermost-last-added. CORS must wrap everything else so a
# 429 or 500 still carries CORS headers - otherwise the browser reports an
# opaque CORS failure instead of the real status. Rate limiting sits inside
# the request context, so even a rejected request is logged with its id.
app.add_middleware(RateLimitMiddleware)
app.add_middleware(RequestContextMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-Request-ID"],
    expose_headers=["X-Request-ID", "Retry-After"],
)


# ── Domain exceptions → HTTP status codes, in exactly one place ────────────
_STATUS_MAP: dict[type[DomainError], int] = {
    NotFoundError: 404,
    PermissionDeniedError: 403,
    ConflictError: 409,
    ValidationError: 422,
}


@app.exception_handler(DomainError)
async def handle_domain_error(request: Request, exc: DomainError) -> JSONResponse:
    for error_type, status_code in _STATUS_MAP.items():
        if isinstance(exc, error_type):
            return JSONResponse(status_code=status_code, content={"detail": str(exc)})
    return JSONResponse(status_code=400, content={"detail": str(exc)})


@app.get("/health", tags=["health"])
async def health() -> dict[str, str]:
    return {"status": "ok", "version": settings.version}


from app.api.v1.router import api_router  # noqa: E402

app.include_router(api_router, prefix="/api/v1")
