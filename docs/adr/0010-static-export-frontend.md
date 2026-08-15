# ADR-010 — Static export for the frontend

**Problem.** How to serve Next.js.

**Chosen.** `output: "export"` — pure HTML/CSS/JS on a CDN.

**Why it is safe here.** Every page is behind auth and every byte of data comes from
the API, so there is nothing to server-render. It removes a running Node process from
the deployment, and it is what a desktop build would need later.

**What it costs, stated plainly.** No middleware, so the auth guard is client-side
only — there is a brief moment before redirect where an unauthenticated user sees the
app shell. That is acceptable **only because the shell contains no data**: every
request that returns real data is authorized by FastAPI. The client-side guard is a
UX affordance, not a security boundary. Do not let that distinction blur.
