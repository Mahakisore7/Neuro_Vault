import jwt
from jwt import PyJWKClient
from jwt.exceptions import InvalidTokenError, PyJWKClientError

from app.core.config import settings


class TokenError(Exception):
    """Raised for any invalid token. Deliberately carries no detail about
    WHY it's invalid (expired vs bad signature vs wrong audience) — telling
    an attacker which part of their forgery is wrong is a real information
    leak, so every failure collapses to one message.
    """


# PyJWKClient fetches https://{project}.supabase.co/auth/v1/.well-known/jwks.json
# lazily, on the first call that needs it - not at import time - and caches the
# result, refreshing only if it sees a "kid" (key id) it doesn't recognise yet
# (e.g. after Supabase rotates the signing key). One client for the process.
_jwks_client = PyJWKClient(f"{settings.supabase_url}/auth/v1/.well-known/jwks.json")

# Supabase stamps iat from its own clock. If this server's clock is even a
# fraction of a second behind, a token used right after sign-in has an iat
# "in the future" and PyJWT rejects it as not yet valid: the user sees
# "session expired" on their first page load. A few seconds of tolerance is
# the standard fix; it also lets exp run that long past, which is harmless.
CLOCK_SKEW_LEEWAY_SECONDS = 30


def decode_access_token(token: str) -> dict:
    """Verify a Supabase-issued JWT.

    Supabase signs session tokens asymmetrically (ES256) against a per-project
    key pair, publishing only the public half at the JWKS URL above - so
    verification here can never mint a valid token, only check one (ADR-018).

    `algorithms=["ES256"]` is not optional and not a default — it MUST be
    passed explicitly. If the accepted algorithm were read from the token's
    own header instead, an attacker could set alg to "none" and forge any
    identity they like. The verifier decides what's acceptable, never the
    token.
    """
    try:
        signing_key = _jwks_client.get_signing_key_from_jwt(token)
        return jwt.decode(
            token,
            signing_key.key,
            algorithms=["ES256"],
            audience="authenticated",
            options={"require": ["exp", "sub"]},
            leeway=CLOCK_SKEW_LEEWAY_SECONDS,
        )
    except (InvalidTokenError, PyJWKClientError) as exc:
        raise TokenError("Invalid or expired token") from exc
