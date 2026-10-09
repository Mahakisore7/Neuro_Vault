# Deploying NeuroVault

The database and auth already live on Supabase. Deploying means hosting the two
pieces that currently run on your laptop:

| Piece | Host | Config in this repo |
|---|---|---|
| API (FastAPI) | [Render](https://render.com), free web service, Docker | `render.yaml`, `backend/Dockerfile` (last stage, `prod`) |
| Web app (Next.js) | [Vercel](https://vercel.com), Hobby plan | none needed: Vercel detects Next.js and pnpm |

Do the steps in this order. Each one needs a URL from the step before it.

## 1. API on Render

1. Render dashboard → **New → Blueprint** → connect GitHub → pick this repository.
   Render reads `render.yaml` and proposes a web service called `neurovault-api`.
2. It asks for the four values marked `sync: false`:

   | Variable | Value |
   |---|---|
   | `DATABASE_URL` | Supabase → **Connect** → **Session pooler** string, with `postgresql://` changed to `postgresql+asyncpg://`. This is the same value as in your local `.env`. |
   | `DATABASE_URL_SYNC` | The same string, unchanged (`postgresql://`) |
   | `SUPABASE_URL` | `https://<project-ref>.supabase.co` |
   | `ALLOWED_ORIGINS` | For now `http://localhost:3000`. You replace it in step 3. |

   Use the **Session pooler** string, not "Direct connection". On the free plan the
   direct host is IPv6-only, and Render can't reach IPv6.
3. Create. The first build takes a few minutes. On every start the container runs
   `alembic upgrade head`, then the server. A failed migration fails the deploy instead
   of serving a mismatched schema.
4. Check it: open `https://neurovault-api.onrender.com/health` (your URL may differ).
   You should see `{"status":"ok",...}`. `/docs` returns 404 on purpose: API docs are
   off in production.

## 2. Web app on Vercel

1. Vercel → **Add New → Project** → import this repository.
2. Set **Root Directory** to `frontend`. Leave framework and build settings on auto.
3. Environment variables (all three are public by design, which is why they are
   `NEXT_PUBLIC_`):

   | Variable | Value |
   |---|---|
   | `NEXT_PUBLIC_SUPABASE_URL` | `https://<project-ref>.supabase.co` |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase → Project Settings → API → `anon` `public` key |
   | `NEXT_PUBLIC_API_URL` | The Render URL from step 1, with no trailing slash |

   These are read at **build** time and also go into the Content Security Policy's
   `connect-src`. If you change one, redeploy.
4. Deploy, and note the production URL, e.g. `https://neurovault.vercel.app`.

## 3. Connect the two

1. Render → `neurovault-api` → **Environment** → set `ALLOWED_ORIGINS` to the Vercel URL.
   To keep local development working against this API too, use a comma list:
   `https://neurovault.vercel.app,http://localhost:3000`. Saving redeploys.
2. Supabase → **Authentication → URL Configuration**:
   - **Site URL**: the Vercel URL. Email links fall back to it.
   - **Redirect URLs**: add `https://neurovault.vercel.app/**` and keep
     `http://localhost:3000/**`.
3. Google sign-in needs no change. Google redirects to Supabase's own callback, and
   Supabase then redirects to the URLs above.

## 4. Smoke test the live site

- Sign up with email, and confirm the email. The link should open the Vercel site.
- Sign out → **Forgot password?** → the email link should open `/reset-password` on the
  Vercel site.
- Create a note, type, and reload. The text is still there.
- Profile → **Export data** downloads `neurovault-export-<date>.json`.
- In the browser dev tools, any API response has an `X-Request-ID` header. Render →
  **Logs** shows a JSON line with the same id.

## Things to know

- **Cold starts.** A free Render service sleeps after 15 minutes without traffic, and
  the first request then takes up to about a minute. Before a demo or viva, open
  `/health` a minute early.
- **Vercel preview deployments** get their own URLs, which the API's CORS list doesn't
  include. Their API calls fail unless you add that URL to `ALLOWED_ORIGINS`. Production
  is unaffected.
- **One instance only.** Rate limits are counted in process memory (ADR-024), and the
  container runs one worker. Scaling to several instances would need a shared store
  (Redis) for the limiter first.
- **Rollback.** Render → **Events** → roll back to a previous deploy. Migrations only go
  forward. A rollback past a migration needs `alembic downgrade` run by hand against
  the database first, so check the migration's `downgrade()` before relying on it.
- **Secrets** live only in the Render and Vercel dashboards. `backend/.dockerignore`
  keeps `.env` out of the image, and `.env` files are git-ignored.
