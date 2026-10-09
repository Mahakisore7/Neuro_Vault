# ADR-024: Rate limiting is per client IP, in process memory

**Context.** The API had no limit on request volume. A runaway client loop, or someone
scripting the export or account-deletion endpoints, could hammer the database with
nothing to slow it down. A limiter needs somewhere to count requests. The usual
production answer is a shared store (Redis), so every server process sees the same
counts.

**Options.**
1. Redis-backed limiter (e.g. `slowapi` + Redis). Correct across many processes, but it
   adds a service to run, configure and pay for. This project deploys as one process.
2. In-process counters. No new infrastructure, but each process counts on its own, and
   a restart resets the counts.
3. Leave it to the hosting platform's edge. That isn't available on every host, and it
   can't give individual endpoints their own budgets.

**Chosen: 2.** `RateLimitMiddleware` (`app/core/middleware.py`) uses fixed one-minute
windows keyed by client IP:
- a general budget (`RATE_LIMIT_PER_MINUTE`, default 300);
- tighter budgets for the costly or destructive endpoints: export 5, account deletion 5,
  Empty Trash 10.

Over budget, the API answers `429` with `Retry-After`. Counters are cleared every new
minute, so memory is bounded by one minute's distinct clients.

**Consequences.**
- With N processes, the effective limit is N x the budget. Moving to Redis is the step
  if the API is ever scaled out, and only the counter storage changes.
- Keying by IP means users behind one NAT share a budget. 300/min is generous for one
  person, so this only bites a crowded shared network.
- Behind a proxy, uvicorn must run with `--proxy-headers`, or every request appears to
  come from the proxy and all users share one budget.

**Learning note.** A limiter is only as correct as its key and its store. The algorithm
(fixed window here) matters less than *who* is being counted and *where* the counts
live.
