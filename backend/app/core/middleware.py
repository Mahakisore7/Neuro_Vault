"""Cross-cutting HTTP concerns: request ids, access logging, security
headers, a last-resort error handler, and rate limiting.

Written as plain ASGI middleware rather than Starlette's BaseHTTPMiddleware,
which buffers each response and is known to interfere with background tasks
and streaming; these only read the request and add a few response headers.
"""

import json
import logging
import time
import uuid
from collections import defaultdict
from collections.abc import Awaitable, Callable, MutableMapping
from typing import Any

from app.core.config import settings

Scope = MutableMapping[str, Any]
Message = MutableMapping[str, Any]
Receive = Callable[[], Awaitable[Message]]
Send = Callable[[Message], Awaitable[None]]
ASGIApp = Callable[[Scope, Receive, Send], Awaitable[None]]

access_log = logging.getLogger("neurovault.access")
error_log = logging.getLogger("neurovault.error")

REQUEST_ID_HEADER = "x-request-id"

# Responses from the JSON API carry per-user data and are never meant to be
# framed, sniffed as another type, or kept by a shared cache.
_API_HEADERS = [
    (b"x-content-type-options", b"nosniff"),
    (b"x-frame-options", b"DENY"),
    (b"referrer-policy", b"no-referrer"),
    (b"cache-control", b"no-store"),
    (b"content-security-policy", b"default-src 'none'; frame-ancestors 'none'"),
]
_HSTS = (b"strict-transport-security", b"max-age=63072000; includeSubDomains")


def _incoming_request_id(scope: Scope) -> str:
    """Reuse a well-formed id from a proxy so one request is traceable end to
    end; otherwise mint one. Bounded and charset-checked, since it is echoed
    into logs and a response header."""
    for name, value in scope.get("headers", []):
        if name == b"x-request-id":
            candidate = value.decode("latin-1")
            if 0 < len(candidate) <= 64 and all(c.isalnum() or c in "-_." for c in candidate):
                return candidate
    return uuid.uuid4().hex


class RequestContextMiddleware:
    """Request id + timing + one structured access-log line per request,
    security headers on API responses, and a JSON 500 (with the request id,
    never a stack trace) for any exception nothing else handled."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        request_id = _incoming_request_id(scope)
        scope.setdefault("state", {})["request_id"] = request_id
        path: str = scope["path"]
        is_api = path.startswith("/api/")
        started = time.perf_counter()
        status = 500
        response_started = False

        async def send_wrapper(message: Message) -> None:
            nonlocal status, response_started
            if message["type"] == "http.response.start":
                response_started = True
                status = message["status"]
                headers = list(message.get("headers", []))
                headers.append((REQUEST_ID_HEADER.encode(), request_id.encode()))
                if is_api:
                    headers.extend(_API_HEADERS)
                if settings.is_production:
                    headers.append(_HSTS)
                message["headers"] = headers
            await send(message)

        try:
            await self.app(scope, receive, send_wrapper)
        except Exception:
            error_log.exception("unhandled error", extra={"request_id": request_id})
            if response_started:
                raise  # too late to replace the response; let the server close it
            body = json.dumps(
                {"detail": "Something went wrong on our side.", "request_id": request_id}
            ).encode()
            await send_wrapper(
                {
                    "type": "http.response.start",
                    "status": 500,
                    "headers": [
                        (b"content-type", b"application/json"),
                        (b"content-length", str(len(body)).encode()),
                    ],
                }
            )
            await send({"type": "http.response.body", "body": body})
        finally:
            access_log.info(
                json.dumps(
                    {
                        "request_id": request_id,
                        "method": scope["method"],
                        "path": path,
                        "status": status,
                        "duration_ms": round((time.perf_counter() - started) * 1000, 1),
                    }
                )
            )


class RateLimitMiddleware:
    """Fixed one-minute windows per client IP, with a much tighter budget for
    the few endpoints that are expensive or destructive.

    In-process memory, so the limit is per server process: right for a single
    instance, and a deliberate stopgap rather than a distributed limiter
    (that would need a shared store such as Redis). Behind a proxy, run
    uvicorn with --proxy-headers so the client IP is the real one.
    """

    # (method, path) -> per-minute budget, checked before the general one.
    STRICT: dict[tuple[str, str], int] = {
        ("GET", "/api/v1/users/me/export"): 5,
        ("DELETE", "/api/v1/users/me"): 5,
        ("DELETE", "/api/v1/notes/trash"): 10,
    }

    def __init__(self, app: ASGIApp, per_minute: int | None = None) -> None:
        self.app = app
        self.per_minute = per_minute or settings.rate_limit_per_minute
        self._window = 0
        self._counts: defaultdict[tuple[str, str], int] = defaultdict(int)

    def _hit(self, key: tuple[str, str], limit: int, window: int) -> bool:
        if window != self._window:
            # A new minute: drop every old counter at once, so memory is
            # bounded by one minute's worth of distinct clients.
            self._window = window
            self._counts.clear()
        self._counts[key] += 1
        return self._counts[key] <= limit

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if (
            scope["type"] != "http"
            or scope["method"] == "OPTIONS"
            or not scope["path"].startswith("/api/")
        ):
            await self.app(scope, receive, send)
            return

        client = scope.get("client")
        ip = client[0] if client else "unknown"
        now = time.time()
        window = int(now // 60)
        route = (scope["method"], scope["path"].rstrip("/"))

        strict = self.STRICT.get(route)
        allowed = self._hit((ip, "general"), self.per_minute, window)
        if allowed and strict is not None:
            allowed = self._hit((ip, f"{route[0]} {route[1]}"), strict, window)

        if allowed:
            await self.app(scope, receive, send)
            return

        retry_after = str(60 - int(now % 60))
        body = json.dumps({"detail": "Too many requests. Wait a moment, then try again."}).encode()
        await send(
            {
                "type": "http.response.start",
                "status": 429,
                "headers": [
                    (b"content-type", b"application/json"),
                    (b"content-length", str(len(body)).encode()),
                    (b"retry-after", retry_after.encode()),
                ],
            }
        )
        await send({"type": "http.response.body", "body": body})
