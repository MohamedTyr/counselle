"""The single typed configuration surface for Counselle (ADR 0018).

One ``Settings`` object, loaded once via :func:`get_settings`, validated fail-fast:
a missing or malformed value kills boot with one aggregated, readable error.
Layering: code defaults -> ``.env`` / environment (``COUNSELLE_`` prefix) -> explicit
overrides. Editorial content (prompts, menus, shortlists, calendars) lives in
``config/assets/`` and is loaded through :func:`load_prompt` / :func:`load_yaml_asset`.

Google credentials ride the standard unprefixed ``GOOGLE_APPLICATION_CREDENTIALS``
environment variable and are deliberately NOT a Settings field (see ``.env.example``).

Never log Settings values: ``repr()``/``str()`` mask DSNs and API keys, but the live
attributes hold real secrets.
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Any, Literal
from urllib.parse import urlsplit

import yaml
from pydantic import Field, ValidationError
from pydantic_settings import BaseSettings, SettingsConfigDict

_ENV_PREFIX = "COUNSELLE_"

#: Fields whose values must never appear unmasked in repr/str/logs.
_SECRET_FIELDS = frozenset({"db_ro_dsn", "db_app_dsn", "tavily_api_key"})


def _mask_secret(name: str, value: str) -> str:
    """Mask a secret for display: DSNs show scheme + host only, keys show ``***``."""
    if name.endswith("_dsn"):
        parts = urlsplit(value)
        if parts.scheme and parts.hostname:
            return f"{parts.scheme}://***@{parts.hostname}"
        return "***"
    return "***"


class Settings(BaseSettings):
    """Every deploy- or cost-relevant knob, in one place (ADR 0018, ARCHITECTURE §18)."""

    model_config = SettingsConfigDict(env_file=".env", env_prefix=_ENV_PREFIX, extra="ignore")

    # --- Models ---
    model_counselor: str = "google-vertex:gemini-2.5-pro"
    model_cheap: str = "google-vertex:gemini-2.5-flash"
    model_clarifier: str = "google-vertex:gemini-2.5-flash"
    max_tool_rounds: int = 12  # agent tool-loop bound (eng-review)

    # --- Database ---
    db_ro_dsn: str  # pipeline DB, counselle_ro role (read-only) — required
    db_app_dsn: str  # counselle.* schema (checkpointer, embeddings) — required
    db_statement_timeout_ms: int = 8000
    db_row_cap: int = 500
    db_pool_min: int = 1
    db_pool_max: int = 5

    # --- Sessions ---
    checkpointer: Literal["postgres", "memory"] = "postgres"
    session_ttl_days: int | None = None  # None = keep everything

    # --- Discovery ---
    embed_model: str = "gemini-embedding-001"
    embed_dimensions: int = 768
    reconcile_interval_minutes: int = 20
    vector_search_enabled: bool = True

    # --- Sources ---
    tavily_api_key: str | None = None  # required only when any external source is enabled
    source_web_default: bool = True
    source_reddit_default: bool = True
    source_edu_default: bool = True
    search_max_results: int = 5

    # --- GCP ---
    # Credentials ride the standard GOOGLE_APPLICATION_CREDENTIALS var (unprefixed,
    # not a Settings field — documented in .env.example).
    google_cloud_project: str | None = None
    google_cloud_location: str = "us-central1"

    # --- API ---
    api_host: str = "127.0.0.1"
    api_port: int = 8000
    cors_origins: list[str] = Field(default_factory=lambda: ["http://localhost:8000"])
    sse_keepalive_s: int = 15
    # Frozen constant: the SSE event-protocol version (ADR 0016). Re-exported from
    # domain/ in Phase 1; bump only with an architecture discussion.
    protocol_version: int = 1

    # --- Observability ---
    log_level: str = "INFO"
    usage_accounting: bool = True

    # --- Assets ---
    assets_dir: Path = Path(__file__).parent / "assets"

    def __repr__(self) -> str:
        """Repr with secrets masked — safe to print, still never log it routinely."""
        rendered: list[str] = []
        for name in type(self).model_fields:
            value = getattr(self, name)
            if name in _SECRET_FIELDS and isinstance(value, str):
                rendered.append(f"{name}={_mask_secret(name, value)!r}")
            else:
                rendered.append(f"{name}={value!r}")
        return f"Settings({', '.join(rendered)})"

    __str__ = __repr__


@lru_cache
def get_settings() -> Settings:
    """Load and cache the Settings, failing fast with one aggregated, readable error."""
    try:
        # Required fields (the DSNs) arrive via the environment, which mypy can't see.
        return Settings()  # type: ignore[call-arg]
    except ValidationError as exc:
        lines = ["Invalid Counselle configuration — fix the following and restart:"]
        for error in exc.errors():
            field = ".".join(str(part) for part in error["loc"])
            env_var = f"{_ENV_PREFIX}{field.upper()}"
            lines.append(f"  - {env_var}: {error['msg']}")
        raise RuntimeError("\n".join(lines)) from exc


# NOTE: get_settings/load_prompt/load_yaml_asset caches are coupled — tests that clear
# one must clear all three (load_* key only on `name`, not on assets_dir).
@lru_cache
def load_prompt(name: str) -> str:
    """Load an agent prompt from ``config/assets/prompts/<name>.md`` (ADR 0018)."""
    path = get_settings().assets_dir / "prompts" / f"{name}.md"
    return path.read_text(encoding="utf-8")


@lru_cache
def load_yaml_asset(name: str) -> Any:
    """Load and parse a versioned data asset from ``config/assets/<name>.yaml``."""
    path = get_settings().assets_dir / f"{name}.yaml"
    with path.open(encoding="utf-8") as handle:
        return yaml.safe_load(handle)
