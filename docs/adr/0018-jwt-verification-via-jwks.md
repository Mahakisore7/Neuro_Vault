# ADR-018 — Verify Supabase JWTs via JWKS (ES256), not a shared secret

**Problem.** `decode_access_token` verified every Supabase-issued JWT with a static
HS256 secret (`SUPABASE_JWT_SECRET`), copied from the project's dashboard. After going
live against a real Supabase project, every genuine login (email/password and OAuth)
still 401'd — even after confirming, byte for byte, that the secret in `.env` matched
the "Legacy JWT Secret" shown in the dashboard.

**Root cause.** The secret was never wrong. Supabase had migrated this project to
asymmetric signing keys: `GET {SUPABASE_URL}/auth/v1/.well-known/jwks.json` returned a
published `ES256` public key, and the dashboard's own wording confirmed it — the legacy
HS256 secret is now used "only to verify... the `anon` and `service_role`" static API
keys, not session tokens. A self-signed test token (minted and verified with the same
local secret) had passed throughout, which is exactly why this stayed hidden: that test
could never catch a mismatch between the algorithm we verified with and the one
Supabase actually signs with.

**Alternatives considered.**

- *Keep HS256, get a fresh secret.* Not applicable — there is no HS256 secret that
  verifies a token this project no longer signs that way.
- *Accept both HS256 and ES256.* Rejected: accepting more than one algorithm per token
  is the shape of the classic JWT algorithm-confusion vulnerability class. The verifier
  should decide exactly one acceptable algorithm, not the token.

**Chosen.** Verify against Supabase's published JWKS instead of a stored secret, using
PyJWT's `PyJWKClient`:

```python
_jwks_client = PyJWKClient(f"{settings.supabase_url}/auth/v1/.well-known/jwks.json")

def decode_access_token(token: str) -> dict:
    signing_key = _jwks_client.get_signing_key_from_jwt(token)
    return jwt.decode(token, signing_key.key, algorithms=["ES256"], audience="authenticated", ...)
```

`PyJWKClient` fetches the key lazily on first use and caches it, refreshing only when it
sees a `kid` it doesn't recognise (e.g. after a key rotation). `SUPABASE_JWT_SECRET` is
gone from config entirely — replaced by `SUPABASE_URL`, which isn't sensitive (the
frontend already exposes the same value as `NEXT_PUBLIC_SUPABASE_URL`). Verifying a
signature only ever needs the *public* half of an asymmetric key pair, which is the
entire reason JWKS endpoints are meant to be published openly.

**Trade-offs.** `scripts/make_test_token.py` — which minted a self-signed HS256 token to
exercise `decode_access_token` without a live Supabase project — can no longer produce
anything that verifies, since only Supabase holds the ES256 private key. Deleted rather
than kept in a broken state; ADR-014 already commits this project to developing
directly against a real Supabase project, so a local-mint fallback is no longer load-
bearing. Added `cryptography` as a dependency (`pyjwt[crypto]`) — pure-Python PyJWT only
implements HS256; ES256 needs it.

**Learning note.** A test that signs and verifies with the same key can never detect
that the key itself is wrong for the job — it proves the verification *logic* works,
nothing about whether it matches what the real issuer does. The only test that actually
closes that gap is one against a token the real issuer signed.
