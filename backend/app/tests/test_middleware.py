"""Request ids, security headers, the last-resort 500, and rate limiting.

Each test wraps a tiny throwaway app in the middleware under test, so these
need no database and can't be affected by the real routes.
"""

from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from app.core.middleware import RateLimitMiddleware, RequestContextMiddleware


def _app(*middleware) -> FastAPI:
    """A tiny app with the given middleware registered the way main.py does
    it (add_middleware), so it sits inside FastAPI's own error layer exactly
    as in production."""
    app = FastAPI()
    for cls, kwargs in middleware:
        app.add_middleware(cls, **kwargs)

    @app.get("/api/v1/ok")
    async def ok() -> dict[str, str]:
        return {"ok": "yes"}

    @app.get("/health")
    async def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.get("/api/v1/boom")
    async def boom() -> None:
        raise RuntimeError("secret internal detail")

    return app


def _client(asgi) -> AsyncClient:
    # raise_app_exceptions=False: the point is what the middleware SENDS,
    # not whether the exception escapes into the test.
    transport = ASGITransport(app=asgi, raise_app_exceptions=False)
    return AsyncClient(transport=transport, base_url="http://test")


async def test_every_response_gets_a_request_id():
    async with _client(_app((RequestContextMiddleware, {}))) as c:
        r = await c.get("/api/v1/ok")
    assert len(r.headers["x-request-id"]) == 32


async def test_a_well_formed_incoming_request_id_is_kept_and_a_hostile_one_replaced():
    async with _client(_app((RequestContextMiddleware, {}))) as c:
        kept = await c.get("/api/v1/ok", headers={"X-Request-ID": "trace-abc_123"})
        hostile = "<script>alert(1)</script>" + "a" * 100
        replaced = await c.get("/api/v1/ok", headers={"X-Request-ID": hostile})
    assert kept.headers["x-request-id"] == "trace-abc_123"
    # Echoed into logs and a header, so it's replaced, not passed through.
    assert len(replaced.headers["x-request-id"]) == 32


async def test_api_responses_carry_security_headers_and_health_does_not_need_them():
    async with _client(_app((RequestContextMiddleware, {}))) as c:
        api = await c.get("/api/v1/ok")
        health = await c.get("/health")
    assert api.headers["x-content-type-options"] == "nosniff"
    assert api.headers["x-frame-options"] == "DENY"
    assert api.headers["cache-control"] == "no-store"
    assert "content-security-policy" in api.headers
    assert "content-security-policy" not in health.headers


async def test_unhandled_error_becomes_json_500_without_internal_details():
    async with _client(_app((RequestContextMiddleware, {}))) as c:
        r = await c.get("/api/v1/boom")
    assert r.status_code == 500
    body = r.json()
    assert body["request_id"] == r.headers["x-request-id"]
    assert "secret internal detail" not in r.text


async def test_rate_limit_returns_429_with_retry_after_once_the_budget_is_spent():
    async with _client(_app((RateLimitMiddleware, {"per_minute": 3}))) as c:
        statuses = [(await c.get("/api/v1/ok")).status_code for _ in range(4)]
        limited = await c.get("/api/v1/ok")
    assert statuses == [200, 200, 200, 429]
    assert 1 <= int(limited.headers["retry-after"]) <= 60


async def test_rate_limit_ignores_non_api_paths():
    async with _client(_app((RateLimitMiddleware, {"per_minute": 1}))) as c:
        statuses = [(await c.get("/health")).status_code for _ in range(3)]
    assert statuses == [200, 200, 200]


async def test_costly_endpoints_have_their_own_tighter_budget():
    app = _app((RateLimitMiddleware, {"per_minute": 100}))

    @app.get("/api/v1/users/me/export")
    async def export() -> dict[str, str]:
        return {}

    async with _client(app) as c:
        statuses = [(await c.get("/api/v1/users/me/export")).status_code for _ in range(6)]
    assert statuses == [200] * 5 + [429]
