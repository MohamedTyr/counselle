"""Root test configuration.

B3 added a required ``COUNSELLE_JWT_SECRET`` setting. ``api/auth.py`` calls
``get_settings()`` at import time, so the var must exist BEFORE any test module
imports it. We set it here (at collection import, before any fixture runs) and
clear the ``get_settings`` lru_cache so a value loaded from a developer's real
``.env`` doesn't mask the test default.

A ``.env`` in the repo root still supplies the DB DSNs; this only guarantees the
JWT secret is present for the auth wiring during tests.
"""

from __future__ import annotations

import os

# A ≥32-byte dev/test secret (never a real key). Set BEFORE get_settings runs.
os.environ.setdefault(
    "COUNSELLE_JWT_SECRET", "test-jwt-secret-deadbeef-deadbeef-0123456789"
)

from config.settings import get_settings  # noqa: E402 — must follow the env setdefault

get_settings.cache_clear()
