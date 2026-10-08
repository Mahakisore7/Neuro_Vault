"""decode_access_token against a locally generated ES256 key.

The JWKS lookup is replaced with this key, so these tests exercise the real
jwt.decode call (algorithm, audience, required claims, leeway) without
reaching Supabase.
"""

import time
from types import SimpleNamespace

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import ec

from app.core import security
from app.core.security import CLOCK_SKEW_LEEWAY_SECONDS, TokenError, decode_access_token

_KEY = ec.generate_private_key(ec.SECP256R1())


@pytest.fixture(autouse=True)
def _local_jwks(monkeypatch):
    monkeypatch.setattr(
        security._jwks_client,
        "get_signing_key_from_jwt",
        lambda _token: SimpleNamespace(key=_KEY.public_key()),
    )


def _token(*, iat_offset: float = 0, exp_offset: float = 3600) -> str:
    now = time.time()
    claims = {
        "sub": "2f85af4b-0000-0000-0000-000000000000",
        "aud": "authenticated",
        "iat": int(now + iat_offset),
        "exp": int(now + exp_offset),
    }
    return jwt.encode(claims, _KEY, algorithm="ES256")


def test_token_issued_by_a_clock_slightly_ahead_is_accepted():
    # Seen for real: Supabase's clock ran ~0.4s ahead of the dev machine, and
    # the first API call after sign-in failed as "session expired".
    assert decode_access_token(_token(iat_offset=5))["sub"].startswith("2f85af4b")


def test_token_from_far_in_the_future_is_still_rejected():
    with pytest.raises(TokenError):
        decode_access_token(_token(iat_offset=CLOCK_SKEW_LEEWAY_SECONDS + 60))


def test_expired_token_is_rejected_once_past_the_leeway():
    with pytest.raises(TokenError):
        decode_access_token(_token(iat_offset=-7200, exp_offset=-(CLOCK_SKEW_LEEWAY_SECONDS + 60)))
