# ADR-006 — PyJWT instead of python-jose

**Problem.** Verify Supabase-issued JWTs.

**Chosen.** `PyJWT`. `python-jose` is effectively unmaintained and has a history of
algorithm-confusion CVEs. PyJWT is actively maintained and is what the Supabase Python
ecosystem uses.

**Note on the verification method.** We verify with the shared HS256 secret today
because that is what our Supabase project issues. Supabase is moving to asymmetric
signing keys with JWKS; when we migrate, only `core/security.py` changes. The previous
doc set *claimed* JWKS verification while the code used the shared secret — the claim
and the code are kept in sync here.
