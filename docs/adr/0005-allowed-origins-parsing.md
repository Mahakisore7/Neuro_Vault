# ADR-005 — `ALLOWED_ORIGINS` parsing

**Problem.** pydantic-settings JSON-decodes complex types from environment variables
*before* validators run. `ALLOWED_ORIGINS=http://localhost:3000` therefore raises
`SettingsError` at import time and the backend never starts. The previous doc set
shipped exactly that value in `.env.example` and instructed you to set it in
production too.

**Chosen.** Opt out of the JSON decoding, then split on commas.

```python
from typing import Annotated
from pydantic_settings import NoDecode

allowed_origins: Annotated[list[str], NoDecode] = ["http://localhost:3000"]

@field_validator("allowed_origins", mode="before")
@classmethod
def _split_origins(cls, v: str | list[str]) -> list[str]:
    if isinstance(v, str):
        return [o.strip() for o in v.split(",") if o.strip()]
    return v
```

Verified against pydantic-settings 2.14.2.

**Learning note.** Configuration bugs are the ones that reach production, because
config is the part that differs between environments and therefore the part your
tests do not cover. Parse and validate it at startup so failure is loud and early.
