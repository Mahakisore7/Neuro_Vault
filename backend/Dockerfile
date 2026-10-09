# syntax=docker/dockerfile:1

# ── base ──────────────────────────────────────────────────────────────────────
FROM python:3.12-slim AS base
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_COMPILE_BYTECODE=1
COPY --from=ghcr.io/astral-sh/uv:0.5 /uv /usr/local/bin/uv
WORKDIR /app

# ── dev: hot reload, dev dependencies present ──────────────────────────────────
# uv.lock must exist before this builds — run `uv sync` locally first (Stage 1
# verification does this before docker compose up).
FROM base AS dev
COPY pyproject.toml uv.lock ./
RUN --mount=type=cache,target=/root/.cache/uv uv sync --frozen
COPY . .
EXPOSE 8000
CMD ["uv", "run", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--reload"]

# ── prod: what a host builds by default (last stage) ──────────────────────────
# No dev dependencies, no --reload, not root. docker-compose picks `dev`
# explicitly; a platform that builds the Dockerfile as-is (Render) gets this.
FROM base AS prod
COPY pyproject.toml uv.lock ./
RUN --mount=type=cache,target=/root/.cache/uv uv sync --frozen --no-dev
COPY . .
RUN useradd --create-home --uid 10001 app && chown -R app /app
USER app
ENV PATH="/app/.venv/bin:$PATH" \
    PORT=8000
EXPOSE 8000
# Migrations run first on every start. `alembic upgrade head` is a no-op when
# already current, and a failed migration stops the deploy instead of
# serving a schema the code doesn't expect.
# --proxy-headers: behind the host's load balancer, take the client IP from
# X-Forwarded-For, or every request looks like the proxy and shares one
# rate-limit budget (ADR-024). One worker for the same reason: the limiter's
# counters live in process memory. --no-access-log: the app writes its own
# JSON access line per request (with the request id); this would duplicate it.
CMD ["sh", "-c", "alembic upgrade head && exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT} --proxy-headers --forwarded-allow-ips='*' --workers 1 --no-access-log"]
