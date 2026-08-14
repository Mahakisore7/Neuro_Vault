import jwt
from jwt import InvalidTokenError

from app.core.config import settings


class TokenError(Exception):
    """Raised for any invalid token. Deliberately carries no detail about
    WHY it's invalid (expired vs bad signature vs wrong audience) — telling
    an attacker which part of their forgery is wrong is a real information
    leak, so every failure collapses to one message.
    """


def decode_access_token(token: str) -> dict:
    """Verify a Supabase-issued JWT (or, locally, one minted by
    scripts/make_test_token.py using the same secret and claim shape).

    `algorithms=["HS256"]` is not optional and not a default — it MUST be
    passed explicitly. If the accepted algorithm were read from the
    token's own header instead, an attacker could set alg to "none" and
    forge any identity they like. The verifier decides what's acceptable,
    never the token.
    """
    try:
        return jwt.decode(
            token,
            settings.supabase_jwt_secret,
            algorithms=["HS256"],
            audience="authenticated",
            options={"require": ["exp", "sub"]},
        )
    except InvalidTokenError as exc:
        raise TokenError("Invalid or expired token") from exc
