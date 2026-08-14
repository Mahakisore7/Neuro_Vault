"""Mint a JWT that verifies against this backend, without a Supabase account.

decode_access_token() (app/core/security.py) checks three things: the HS256
signature against SUPABASE_JWT_SECRET, the "authenticated" audience, and the
presence of "exp" and "sub". This script produces a token satisfying all
three, signed with the SAME secret read from .env — so it exercises the
exact production verification code path. When a real Supabase project
exists later, only the secret changes; nothing in the backend does.

Usage:
    uv run python -m scripts.make_test_token
    uv run python -m scripts.make_test_token --email someone@example.com
"""

import argparse
from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

import jwt

from app.core.config import settings

# Fixed, not random by default: re-running the script logs in as the SAME
# demo user, which is what lets you create data, then re-authenticate as
# that same user later and see it again — a random UUID every run would
# create a fresh, empty user each time.
DEFAULT_USER_ID = UUID("00000000-0000-0000-0000-000000000001")


def make_token(user_id: UUID, email: str, hours_valid: int = 24) -> str:
    now = datetime.now(UTC)
    payload = {
        "sub": str(user_id),
        "email": email,
        "aud": "authenticated",
        "iat": now,
        "exp": now + timedelta(hours=hours_valid),
        "user_metadata": {"full_name": email.split("@")[0]},
    }
    return jwt.encode(payload, settings.supabase_jwt_secret, algorithm="HS256")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--email", default="demo@neurovault.local")
    parser.add_argument("--random-user", action="store_true", help="mint for a NEW random user")
    parser.add_argument("--hours", type=int, default=24)
    args = parser.parse_args()

    uid = uuid4() if args.random_user else DEFAULT_USER_ID
    token = make_token(uid, args.email, args.hours)

    print(f"user id : {uid}")
    print(f"email   : {args.email}")
    print(f"expires : {args.hours}h from now")
    print()
    print("Paste this into /docs -> Authorize -> bearerAuth (no 'Bearer ' prefix needed):")
    print()
    print(token)
